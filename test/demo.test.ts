import { afterAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { composeContext } from "@/lib/app-context";
import { createAppointment } from "@/modules/appointments/service";
import { deleteExpiredDemos } from "@/modules/demo/cleanup";
import { DEMO, DEMO_REMOVED_PERMISSIONS, demoDelivery, demoExpired } from "@/modules/demo/policy";
import { createDemoWorkspace } from "@/modules/demo/workspace";
import { processDueNotifications } from "@/modules/notifications/process";
import { scanAccountNotices } from "@/modules/notifications/account-notices";
import { renderWhatsappMessage, whatsappKindOf } from "@/modules/whatsapp/templates";
import { addDays, todayInTz, zonedTimeToUtc } from "@/lib/time";
import { createSchedulableOrganization } from "./helpers";

const created: string[] = [];
async function demo(kind: "public" | "supervised" = "public", allowedRecipients: string[] = []) {
  const workspace = await createDemoWorkspace({ kind, allowedRecipients });
  created.push(workspace.organizationId);
  return workspace;
}

afterAll(async () => {
  await db.appointment.deleteMany({ where: { organizationId: { in: created } } });
  await db.organization.deleteMany({ where: { id: { in: created } } });
  await db.user.deleteMany({ where: { email: { endsWith: `@${DEMO.emailDomain}` }, memberships: { none: {} } } });
});

describe("política de la demo (funciones puras)", () => {
  const base = { isDemo: true, demoKind: "public", demoAllowedRecipients: ["yo@example.com"] };

  it("un negocio real nunca se trata como demo", () => {
    expect(demoDelivery({ isDemo: false, demoKind: null, demoAllowedRecipients: [] }, "a@b.co")).toBe("live");
  });

  it("la demo pública simula siempre, aunque el destinatario figure en la lista", () => {
    expect(demoDelivery(base, "yo@example.com")).toBe("simulate");
    expect(demoDelivery(base, "otra@example.com")).toBe("simulate");
  });

  it("la demo supervisada envía solo a los destinatarios autorizados (sin distinguir mayúsculas) y simula al resto", () => {
    const supervised = { ...base, demoKind: "supervised" };
    expect(demoDelivery(supervised, " Yo@Example.com ")).toBe("send");
    expect(demoDelivery(supervised, "visitante@example.com")).toBe("simulate");
    expect(demoDelivery(supervised, "")).toBe("simulate");
    expect(demoDelivery({ ...supervised, demoAllowedRecipients: [] }, "yo@example.com")).toBe("simulate");
  });

  it("un tipo de demo desconocido simula (ante la duda, no se envía)", () => {
    expect(demoDelivery({ ...base, demoKind: "otro" }, "yo@example.com")).toBe("simulate");
  });

  it("vencimiento", () => {
    const now = new Date();
    expect(demoExpired({ isDemo: true, demoExpiresAt: new Date(now.getTime() - 1000) }, now)).toBe(true);
    expect(demoExpired({ isDemo: true, demoExpiresAt: new Date(now.getTime() + 60000) }, now)).toBe(false);
    expect(demoExpired({ isDemo: false, demoExpiresAt: new Date(now.getTime() - 1000) }, now)).toBe(false);
  });
});

describe("plantillas de WhatsApp compartidas", () => {
  const input = { customerFirstName: "Ana", organizationName: "Barbería", serviceName: "Corte", when: "mañana 10:00", professionalName: "Luciano" };

  it("la confirmación y el recordatorio traen respuestas rápidas y un enlace seguro; reprogramar nunca es una respuesta de chat", () => {
    for (const kind of ["booking_confirmation", "reminder"] as const) {
      const message = renderWhatsappMessage(kind, input);
      expect(message.body).toContain("Ana");
      expect(message.buttons.filter((b) => b.kind === "reply").map((b) => b.action).sort()).toEqual(["cancel", "confirm"]);
      expect(message.buttons.find((b) => b.action === "manage")?.kind).toBe("link");
    }
  });

  it("los textos no llevan datos sensibles ni promociones", () => {
    for (const kind of ["booking_confirmation", "reminder", "cancellation", "reschedule"] as const) {
      expect(renderWhatsappMessage(kind, input).body).not.toMatch(/precio|\$|descuento|promo|nota|diagn/i);
    }
  });

  it("solo los avisos al cliente tienen plantilla; los internos no", () => {
    expect(whatsappKindOf("booking_confirmation")).toBe("booking_confirmation");
    expect(whatsappKindOf("professional_change")).toBe("reschedule");
    expect(whatsappKindOf("booking_received_owner")).toBeNull();
    expect(whatsappKindOf("account_notice")).toBeNull();
  });
});

describe("negocio de demostración", () => {
  it("se crea completo, aislado y marcado: tres profesionales, servicios, clientes y turnos, sin suscripción", async () => {
    const workspace = await demo();
    const organization = await db.organization.findUniqueOrThrow({
      where: { id: workspace.organizationId },
      include: { professionals: true, services: true, customers: true, appointments: true, subscription: true },
    });
    expect(organization).toMatchObject({ isDemo: true, demoKind: "public", teamModeEnabled: true });
    expect(organization.professionals).toHaveLength(3);
    expect(organization.services.length).toBeGreaterThanOrEqual(3);
    expect(organization.appointments.length).toBeGreaterThan(8);
    expect(organization.subscription).toBeNull();
    expect(workspace.email.endsWith(`@${DEMO.emailDomain}`)).toBe(true);
    expect(organization.demoExpiresAt!.getTime()).toBeGreaterThan(Date.now());
    // Los datos de clientes son inventados.
    expect(organization.customers.every((c) => c.email?.endsWith("@example.com"))).toBe(true);
  });

  it("dos visitantes reciben negocios distintos y sin datos en común", async () => {
    const [a, b] = [await demo(), await demo()];
    expect(a.organizationId).not.toBe(b.organizationId);
    expect(a.slug).not.toBe(b.slug);
    const customersA = await db.customer.findMany({ where: { organizationId: a.organizationId }, select: { id: true } });
    const customersB = await db.customer.findMany({ where: { organizationId: b.organizationId }, select: { id: true } });
    expect(customersA.filter((c) => customersB.some((x) => x.id === c.id))).toHaveLength(0);
  });

  it("el «propietario» de una demo no tiene facturación ni invitaciones", async () => {
    const workspace = await demo();
    const organization = await db.organization.findUniqueOrThrow({ where: { id: workspace.organizationId } });
    const user = await db.user.findUniqueOrThrow({ where: { email: workspace.email } });
    const membership = await db.membership.findFirstOrThrow({ where: { userId: user.id } });
    const context = composeContext({ user, membership, organization, professional: null });
    for (const permission of DEMO_REMOVED_PERMISSIONS) expect(context.permissions.has(permission)).toBe(false);
    // Sigue pudiendo operar la agenda y el equipo.
    expect(context.permissions.has("appointments.manage")).toBe(true);
    expect(context.permissions.has("team.manage")).toBe(true);
  });

  it("un negocio real conserva todos sus permisos", async () => {
    const shop = await createSchedulableOrganization();
    try {
      const organization = await db.organization.findUniqueOrThrow({ where: { id: shop.organization.id } });
      const user = await db.user.findFirstOrThrow({ where: { memberships: { some: { organizationId: organization.id } } } });
      const membership = await db.membership.findFirstOrThrow({ where: { userId: user.id } });
      const context = composeContext({ user, membership, organization, professional: null });
      expect(context.permissions.has("billing.manage")).toBe(true);
      expect(context.permissions.has("team.invite")).toBe(true);
    } finally {
      await shop.cleanup();
    }
  });
});

describe("los avisos de una demo nunca salen", () => {
  async function bookOnPublicPage(workspace: Awaited<ReturnType<typeof demo>>, email: string) {
    const organization = await db.organization.findUniqueOrThrow({ where: { id: workspace.organizationId } });
    const service = await db.service.findFirstOrThrow({ where: { organizationId: organization.id } });
    const day = addDays(todayInTz(organization.timezone), 6);
    const startsAt = zonedTimeToUtc(day, 10 * 60 + 30, organization.timezone);
    const result = await createAppointment({
      organization,
      serviceId: service.id,
      startsAt,
      customer: { name: "Visitante Real", email, phone: null },
      actor: "customer",
      professional: "any",
    });
    expect(result.ok).toBe(true);
    return result.ok ? result.appointment : null!;
  }

  it("una reserva de un visitante, con su correo real, queda registrada como simulada y no llama a ningún servicio de correo", async () => {
    const workspace = await demo();
    const fetchSpy = vi.fn(async (_url: unknown, _init?: RequestInit) => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_FROM", "Agendia <no-reply@example.com>");
    try {
      const appointment = await bookOnPublicPage(workspace, "persona.real@gmail.com");
      const pending = await db.notification.findMany({ where: { appointmentId: appointment.id } });
      expect(pending.length).toBeGreaterThan(0);

      await processDueNotifications(50);

      const after = await db.notification.findMany({ where: { appointmentId: appointment.id } });
      const toCustomer = after.filter((n) => n.recipient === "persona.real@gmail.com");
      expect(toCustomer.length).toBeGreaterThan(0);
      for (const notification of after.filter((n) => n.scheduledFor <= new Date())) {
        expect(notification.status).toBe("sent");
        expect(notification.lastError).toContain("simulado");
      }
      expect(fetchSpy.mock.calls.filter(([url]) => String(url).includes("resend"))).toHaveLength(0);
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it("en una demo supervisada solo se envía al destinatario autorizado", async () => {
    const workspace = await demo("supervised", ["presentador@example.com"]);
    const fetchSpy = vi.fn(async (_url: unknown, _init?: RequestInit) => new Response(JSON.stringify({ id: "x" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_FROM", "Agendia <no-reply@example.com>");
    try {
      await bookOnPublicPage(workspace, "presentador@example.com");
      await bookOnPublicPage(workspace, "otro.cliente@gmail.com").catch(() => null);
      await processDueNotifications(50);
      const sentTo = fetchSpy.mock.calls
        .filter(([url]) => String(url).includes("resend"))
        .map(([, init]) => JSON.parse(String(init?.body)).to as string[])
        .flat();
      expect(sentTo).toContain("presentador@example.com");
      expect(sentTo).not.toContain("otro.cliente@gmail.com");
      expect(sentTo.every((address) => address === "presentador@example.com")).toBe(true);
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it("los avisos de la cuenta (fin de prueba) no se generan para una demo", async () => {
    const workspace = await demo();
    await db.organization.update({ where: { id: workspace.organizationId }, data: { trialEndsAt: new Date(Date.now() + 86400000) } });
    await scanAccountNotices();
    expect(await db.notification.count({ where: { organizationId: workspace.organizationId, type: "account_notice" } })).toBe(0);
  });
});

describe("topes y borrado", () => {
  it("una demo llena no admite más turnos", async () => {
    const workspace = await demo();
    const organization = await db.organization.findUniqueOrThrow({ where: { id: workspace.organizationId } });
    const service = await db.service.findFirstOrThrow({ where: { organizationId: organization.id } });
    const existing = await db.appointment.count({ where: { organizationId: organization.id } });
    const pro = await db.professional.findFirstOrThrow({ where: { organizationId: organization.id } });
    const customer = await db.customer.findFirstOrThrow({ where: { organizationId: organization.id } });
    // Se completa el tope con turnos lejanos para no chocar con los existentes.
    const rows = Array.from({ length: DEMO.maxAppointments - existing }, (_, i) => {
      const startsAt = new Date(Date.now() + (40 + i) * 86400000);
      return {
        organizationId: organization.id,
        professionalId: pro.id,
        serviceId: service.id,
        customerId: customer.id,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 1800000),
        manageToken: `fill-${workspace.slug}-${i}`,
      };
    });
    await db.appointment.createMany({ data: rows });

    const day = addDays(todayInTz(organization.timezone), 5);
    const result = await createAppointment({
      organization,
      serviceId: service.id,
      startsAt: zonedTimeToUtc(day, 11 * 60, organization.timezone),
      customer: { name: "Uno más", email: null, phone: null },
      actor: "customer",
      professional: "any",
    });
    expect(result).toMatchObject({ ok: false });
  });

  it("borra solo las demos vencidas y deja intactos los negocios reales y las demos vigentes", async () => {
    const real = await createSchedulableOrganization();
    const vigente = await demo();
    const vencida = await demo();
    await db.organization.update({ where: { id: vencida.organizationId }, data: { demoExpiresAt: new Date(Date.now() - 60000) } });
    // Un negocio real con vencimiento en el pasado (no debería importar: no es demo).
    await db.organization.update({ where: { id: real.organization.id }, data: { demoExpiresAt: new Date(Date.now() - 60000) } });
    try {
      const removed = await deleteExpiredDemos();
      expect(removed).toBeGreaterThanOrEqual(1);
      expect(await db.organization.count({ where: { id: vencida.organizationId } })).toBe(0);
      expect(await db.user.count({ where: { email: vencida.email } })).toBe(0);
      expect(await db.appointment.count({ where: { organizationId: vencida.organizationId } })).toBe(0);
      expect(await db.organization.count({ where: { id: vigente.organizationId } })).toBe(1);
      expect(await db.organization.count({ where: { id: real.organization.id } })).toBe(1);
      expect(await db.user.count({ where: { email: vigente.email } })).toBe(1);
    } finally {
      await real.cleanup();
    }
  });
});
