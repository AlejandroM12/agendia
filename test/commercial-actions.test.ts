import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "@/lib/dal";
import { db } from "@/lib/db";
import { createSchedulableOrganization, fakeContext } from "./helpers";

/**
 * Acciones comerciales y de onboarding con la sesión de un negocio. Solo se reemplaza la capa que lee la
 * cookie (lib/dal): permisos, cupos y validaciones son los reales. Mercado Pago no se invoca acá.
 */

const session = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("@/lib/dal", async () => (await import("./dal-mock")).createDalMock(() => session.current as AppContext));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

import { saveBusinessStep, saveHoursStep, saveServicesStep, saveTeamStep } from "@/app/onboarding/actions";
import { cancelSubscriptionAction, startSubscriptionAction } from "@/modules/billing/actions";
import { saveKeepSelectionAction } from "@/modules/team/capacity-actions";
import { registerOrganization } from "@/modules/organizations/register";
import { addProfessional, uniqueSuffix } from "./helpers";

type Tenant = Awaited<ReturnType<typeof createSchedulableOrganization>>;
let tenant: Tenant;

const form = (fields: Record<string, string | string[]>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) for (const item of Array.isArray(value) ? value : [value]) data.append(key, item);
  return data;
};
const run = async (fn: () => Promise<unknown>) => {
  try {
    return await fn();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};
async function actAs(role: AppContext["role"] = "owner", canWrite = true) {
  const organization = await db.organization.findUniqueOrThrow({ where: { id: tenant.organization.id } });
  session.current = fakeContext({ userId: tenant.userId, email: tenant.ownerEmail, organization, role, canWrite });
}

beforeEach(async () => {
  tenant = await createSchedulableOrganization();
  vi.stubEnv("MERCADOPAGO_ACCESS_TOKEN", "TEST-token");
  vi.stubEnv("MERCADOPAGO_WEBHOOK_SECRET", "secret");
  vi.stubEnv("MERCADOPAGO_MODE", "live");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await db.auditLog.deleteMany({ where: { organizationId: tenant.organization.id } });
  await tenant.cleanup();
});

describe("contratar: autorización y validación en el servidor", () => {
  it("solo el propietario puede contratar o cancelar; ni administradores ni profesionales", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    for (const role of ["admin", "professional"] as const) {
      await actAs(role);
      expect(await startSubscriptionAction(undefined, form({ tier: "profesional", payerEmail: "p@example.com" }))).toMatchObject({ message: expect.any(String) });
      expect(await cancelSubscriptionAction()).toMatchObject({ message: expect.any(String) });
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await db.subscription.count({ where: { organizationId: tenant.organization.id } })).toBe(0);
  });

  it("un nivel desconocido o manipulado no contrata nada, y el Plan Equipo no se vende sin publicarlo", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    await actAs("owner");
    expect(await startSubscriptionAction(undefined, form({ tier: "gratis", payerEmail: "p@example.com" }))).toMatchObject({ message: "Elegí un plan válido." });
    expect(await startSubscriptionAction(undefined, form({ tier: "equipo", payerEmail: "p@example.com" }))).toMatchObject({ message: "Ese plan todavía no está disponible." });
    // La pausa de emergencia también detiene la venta del Plan Equipo.
    vi.stubEnv("PUBLISH_TEAM_PLANS", "1");
    vi.stubEnv("TEAM_FEATURES_PAUSED", "1");
    expect(await startSubscriptionAction(undefined, form({ tier: "equipo", payerEmail: "p@example.com" }))).toMatchObject({ message: "Ese plan todavía no está disponible." });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("con los planes publicados el propietario llega a Mercado Pago con el importe del plan, sin activar nada", async () => {
    vi.stubEnv("PUBLISH_TEAM_PLANS", "1");
    const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
      if (String(url).endsWith("/users/me")) return new Response(JSON.stringify({ tags: [] }), { status: 200 }); // cuenta de producción
      const body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ id: "pre-1", init_point: "https://mp.test/pre-1", status: "pending", ...body }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    await actAs("owner");
    const result = await run(() => startSubscriptionAction(undefined, form({ tier: "equipo", payerEmail: "p@example.com" })));
    expect(result).toBe("REDIRECT:https://mp.test/pre-1");
    expect(JSON.parse(String(fetchMock.mock.calls.find(([url]) => !String(url).endsWith("/users/me"))?.[1]?.body)).auto_recurring).toMatchObject({ transaction_amount: 19900, currency_id: "ARS" });
    expect((await db.organization.findUniqueOrThrow({ where: { id: tenant.organization.id } })).status).toBe("trial");
  });

  it("elegir quiénes siguen recibiendo reservas es solo del propietario", async () => {
    const other = await addProfessional(tenant.organization.id, { displayName: "Otra" });
    await actAs("admin");
    expect(await saveKeepSelectionAction(undefined, form({ keep: [other.id] }))).toMatchObject({ message: expect.any(String) });
    expect((await db.professional.findUniqueOrThrow({ where: { id: other.id } })).keepBookable).toBeNull();
    await actAs("owner");
    expect(await saveKeepSelectionAction(undefined, form({ keep: [other.id] }))).toMatchObject({ ok: true });
    expect((await db.professional.findUniqueOrThrow({ where: { id: other.id } })).keepBookable).toBe(true);
  });
});

describe("registro con intención de plan", () => {
  it("guarda la intención sin crear suscripción ni dar lugares", async () => {
    const suffix = uniqueSuffix();
    const result = await registerOrganization({ name: "Equipo Test", email: `eq-${suffix}@example.com`, password: "Contrasena123", emailVerified: true, intendedPlan: "equipo" });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const membership = await db.membership.findFirstOrThrow({ where: { userId: result.userId }, include: { organization: true } });
    expect(membership.organization).toMatchObject({ intendedPlan: "equipo", status: "trial" });
    expect(await db.subscription.count({ where: { organizationId: membership.organizationId } })).toBe(0);
    expect(await db.professional.count({ where: { organizationId: membership.organizationId, active: true } })).toBe(1);
    expect(membership.organization.trialEndsAt.getTime() - membership.organization.trialStartedAt.getTime()).toBe(14 * 86400000);
    await db.organization.delete({ where: { id: membership.organizationId } });
    await db.user.delete({ where: { id: result.userId } });
  });
});

describe("onboarding «¿Cómo trabajás?»", () => {
  const fresh = () => db.organization.update({ where: { id: tenant.organization.id }, data: { onboardingCompletedAt: null, industry: null } });

  it("sin funciones de equipo se guarda siempre «por mi cuenta» y el flujo no cambia", async () => {
    await fresh();
    await actAs("owner");
    const result = await run(() => saveBusinessStep(undefined, form({ name: "Mi negocio", industry: "otro", workMode: "team" })));
    expect(result).toBe("REDIRECT:/onboarding?paso=2");
    expect((await db.organization.findUniqueOrThrow({ where: { id: tenant.organization.id } })).workMode).toBe("solo");
  });

  it("con equipos: trabajo con otras personas → equipo, servicios y horarios; el equipo es opcional", async () => {
    await db.organization.update({ where: { id: tenant.organization.id }, data: { teamModeEnabled: true } });
    await fresh();
    await db.service.deleteMany({ where: { organizationId: tenant.organization.id } });
    await actAs("owner");

    expect(await run(() => saveBusinessStep(undefined, form({ name: "Barbería Test", industry: "belleza", workMode: "team" })))).toBe("REDIRECT:/onboarding?paso=2");
    await actAs("owner");
    expect((await db.organization.findUniqueOrThrow({ where: { id: tenant.organization.id } })).workMode).toBe("team");

    // Más profesionales que los de la prueba (2): se rechaza sin dejar a medias lo hecho.
    expect(await saveTeamStep(undefined, form({ ownerAttends: "yes", names: "Lucía\nMartín" }))).toMatchObject({ message: expect.stringMatching(/admite hasta 2/) });
    expect(await db.professional.count({ where: { organizationId: tenant.organization.id, active: true } })).toBe(2);

    // Quien administra y no atiende no ocupa lugar: entran 2 profesionales.
    await db.professional.deleteMany({ where: { organizationId: tenant.organization.id, displayName: { in: ["Lucía", "Martín"] } } });
    expect(await run(() => saveTeamStep(undefined, form({ ownerAttends: "no", names: "Lucía\nMartín" })))).toBe("REDIRECT:/onboarding?paso=3");
    const active = await db.professional.findMany({ where: { organizationId: tenant.organization.id, active: true }, orderBy: { createdAt: "asc" } });
    expect(active.map((p) => p.displayName)).toEqual(["Lucía", "Martín"]);
    // Volver a enviar el paso no duplica a nadie.
    await run(() => saveTeamStep(undefined, form({ ownerAttends: "no", names: "Lucía\nMartín" })));
    expect(await db.professional.count({ where: { organizationId: tenant.organization.id } })).toBe(3);

    expect(await run(() => saveServicesStep(undefined, form({ services: JSON.stringify([{ name: "Corte", durationMinutes: 30, price: null }]) })))).toBe("REDIRECT:/onboarding?paso=4");

    const hours = JSON.stringify([{ weekday: 1, startMinute: 540, endMinute: 1080 }]);
    expect(await run(() => saveHoursStep(undefined, form({ rules: hours })))).toBe("REDIRECT:/dashboard?bienvenida=1");
    // El horario habitual quedó para todos los profesionales activos.
    for (const pro of active) {
      expect(await db.availabilityRule.count({ where: { organizationId: tenant.organization.id, professionalId: pro.id } })).toBe(1);
    }
    expect((await db.organization.findUniqueOrThrow({ where: { id: tenant.organization.id } })).onboardingCompletedAt).not.toBeNull();
  });

  it("«Completar más tarde» no cambia nada y no obliga a invitar a nadie", async () => {
    await db.organization.update({ where: { id: tenant.organization.id }, data: { teamModeEnabled: true, workMode: "team", onboardingCompletedAt: null } });
    await actAs("owner");
    expect(await run(() => saveTeamStep(undefined, form({ skip: "1" })))).toBe("REDIRECT:/onboarding?paso=3");
    expect(await db.professional.count({ where: { organizationId: tenant.organization.id } })).toBe(1);
    expect(await db.invitation.count({ where: { organizationId: tenant.organization.id } })).toBe(0);
  });

  it("si no atiende y no agrega a nadie, no se queda sin profesional", async () => {
    await db.organization.update({ where: { id: tenant.organization.id }, data: { teamModeEnabled: true, workMode: "team", onboardingCompletedAt: null } });
    await actAs("owner");
    expect(await saveTeamStep(undefined, form({ ownerAttends: "no", names: "" }))).toMatchObject({ message: expect.stringMatching(/al menos a un profesional/) });
    expect(await db.professional.count({ where: { organizationId: tenant.organization.id, active: true } })).toBe(1);
  });

  it("solo quien puede configurar el negocio completa el onboarding", async () => {
    await db.organization.update({ where: { id: tenant.organization.id }, data: { teamModeEnabled: true, workMode: "team", onboardingCompletedAt: null } });
    await actAs("professional");
    expect(await saveTeamStep(undefined, form({ ownerAttends: "yes", names: "Alguien" }))).toMatchObject({ message: expect.any(String) });
    expect(await db.professional.count({ where: { organizationId: tenant.organization.id } })).toBe(1);
  });
});

describe("solo lectura: los turnos ya confirmados se siguen gestionando", () => {
  async function confirmed() {
    const { createAppointment } = await import("@/modules/appointments/service");
    const { addDays, todayInTz, zonedTimeToUtc } = await import("@/lib/time");
    const when = zonedTimeToUtc(addDays(todayInTz(tenant.organization.timezone), 3), 600, tenant.organization.timezone);
    const result = await createAppointment({
      organization: tenant.organization,
      serviceId: tenant.service.id,
      startsAt: when,
      customer: { name: "Cliente", email: `c-${uniqueSuffix()}@example.com`, phone: null },
      actor: "customer",
    });
    if (!result.ok) throw new Error("no se pudo crear el turno");
    return result.appointment;
  }

  it("con la prueba terminada se puede cancelar un turno confirmado, pero no crear ni mover turnos", async () => {
    const { cancelAppointmentAction, createAppointmentAction, rescheduleAppointmentAction } = await import("@/modules/appointments/actions");
    const appointment = await confirmed();
    await db.organization.update({ where: { id: tenant.organization.id }, data: { status: "trial_readonly", trialEndsAt: new Date(Date.now() - 86400000) } });
    await actAs("owner", false);

    expect(await run(() => rescheduleAppointmentAction(appointment.id, undefined, form({ date: "2099-01-01", time: "10:00" })))).toMatchObject({ message: expect.any(String) });
    expect(await createAppointmentAction(undefined, form({}))).toMatchObject({ message: expect.any(String) });
    expect(await cancelAppointmentAction(appointment.id)).toMatchObject({ ok: true });
    expect((await db.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).status).toBe("canceled");
  });

  it("también se puede cerrar un turno como completado, pero no deshacerlo", async () => {
    const { setOutcomeAction } = await import("@/modules/appointments/actions");
    const appointment = await confirmed();
    await db.organization.update({ where: { id: tenant.organization.id }, data: { status: "trial_readonly", trialEndsAt: new Date(Date.now() - 86400000) } });
    await actAs("owner", false);
    await setOutcomeAction(appointment.id, "no_show");
    expect((await db.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).status).toBe("no_show");
    await setOutcomeAction(appointment.id, "confirmed");
    expect((await db.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).status).toBe("no_show");
  });

  it("una cuenta suspendida no puede gestionar nada", async () => {
    const { cancelAppointmentAction } = await import("@/modules/appointments/actions");
    const appointment = await confirmed();
    await db.organization.update({ where: { id: tenant.organization.id }, data: { status: "suspended" } });
    await actAs("owner", false);
    expect(await cancelAppointmentAction(appointment.id)).toMatchObject({ message: expect.any(String) });
    expect((await db.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).status).toBe("confirmed");
  });
});
