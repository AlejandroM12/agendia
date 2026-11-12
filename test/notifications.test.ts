import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { db } from "@/lib/db";
import { addDays, todayInTz, zonedTimeToUtc } from "@/lib/time";
import { cancelAppointment, createAppointment, rescheduleAppointment } from "@/modules/appointments/service";
import { processDueNotifications } from "@/modules/notifications/process";
import { createSchedulableOrganization } from "./helpers";

type Ctx = Awaited<ReturnType<typeof createSchedulableOrganization>>;

describe("notificaciones (outbox)", () => {
  let ctx: Ctx;
  let inThreeDays: string;
  const at = (minutes: number) => zonedTimeToUtc(inThreeDays, minutes, ctx.organization.timezone);
  const customer = { name: "Ana Cliente", email: "ana.cliente@example.com", phone: null };

  const book = () =>
    createAppointment({
      organization: ctx.organization,
      serviceId: ctx.service.id,
      startsAt: at(10 * 60),
      customer,
      actor: "customer",
    });

  const rows = () =>
    db.notification.findMany({ where: { organizationId: ctx.organization.id }, orderBy: { createdAt: "asc" } });

  /** Procesa solo las notificaciones de esta organización de prueba. */
  async function drain() {
    // El procesador es global; se limita el alcance del test dejando
    // "en el futuro" lo que no pertenece a esta organización.
    return processDueNotifications(100);
  }

  beforeEach(async () => {
    ctx = await createSchedulableOrganization();
    inThreeDays = addDays(todayInTz(ctx.organization.timezone), 3);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await ctx.cleanup();
  });

  it("una reserva encola confirmación, aviso al profesional y recordatorio 24 h antes", async () => {
    const result = await book();
    if (!result.ok) throw new Error("setup");

    const all = await rows();
    expect(all.map((n) => n.type).sort()).toEqual(["booking_confirmation", "booking_received_owner", "reminder"]);

    const reminder = all.find((n) => n.type === "reminder")!;
    expect(reminder.recipient).toBe(customer.email);
    expect(reminder.scheduledFor.getTime()).toBe(result.appointment.startsAt.getTime() - 24 * 3600000);
    expect(all.find((n) => n.type === "booking_received_owner")!.recipient).toBe(ctx.ownerEmail);
  });

  it("sin email del cliente no se encola nada para él; sin recordatorios activos no hay recordatorio", async () => {
    const organization = await db.organization.update({
      where: { id: ctx.organization.id },
      data: { remindersEnabled: false },
    });
    await createAppointment({
      organization, serviceId: ctx.service.id, startsAt: at(9 * 60),
      customer: { name: "Sin Email", email: null, phone: "1155550000" }, actor: "professional",
    });
    await createAppointment({
      organization, serviceId: ctx.service.id, startsAt: at(11 * 60), customer, actor: "professional",
    });

    const all = await rows();
    expect(all.map((n) => n.type)).toEqual(["booking_confirmation"]);
  });

  it("cancelar anula el recordatorio pendiente y avisa la cancelación", async () => {
    const result = await book();
    if (!result.ok) throw new Error("setup");

    await cancelAppointment({ organization: ctx.organization, appointmentId: result.appointment.id, actor: "professional" });

    const all = await rows();
    expect(all.find((n) => n.type === "reminder")!.status).toBe("canceled");
    expect(all.filter((n) => n.type === "cancellation" && n.status === "pending")).toHaveLength(1);
  });

  it("reprogramar reemplaza el recordatorio por uno con el horario nuevo", async () => {
    const result = await book();
    if (!result.ok) throw new Error("setup");

    const moved = await rescheduleAppointment({
      organization: ctx.organization, appointmentId: result.appointment.id, startsAt: at(15 * 60), actor: "professional",
    });
    if (!moved.ok) throw new Error("setup");

    const reminders = (await rows()).filter((n) => n.type === "reminder");
    expect(reminders).toHaveLength(2);
    expect(reminders.filter((n) => n.status === "canceled")).toHaveLength(1);
    const active = reminders.find((n) => n.status === "pending")!;
    expect(active.scheduledFor.getTime()).toBe(moved.appointment.startsAt.getTime() - 24 * 3600000);
  });

  it("sin canal de email configurado no simula envíos: quedan como 'skipped'", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("EMAIL_FROM", "");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await book();
    await drain();

    const due = (await rows()).filter((n) => n.type !== "reminder");
    expect(due.every((n) => n.status === "skipped")).toBe(true);
    expect(due.every((n) => n.sentAt === null)).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    // El recordatorio futuro sigue pendiente: todavía no era su hora.
    expect((await rows()).find((n) => n.type === "reminder")!.status).toBe("pending");
  });

  it("con el canal configurado envía una sola vez aunque se procese dos veces o en paralelo", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubEnv("EMAIL_FROM", "Agendia <test@example.com>");
    const fetchSpy = vi.fn(async (_url: unknown, _init?: RequestInit) => new Response(JSON.stringify({ id: "email_1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    await book();
    await Promise.all([drain(), drain()]);
    await drain();

    const mine = fetchSpy.mock.calls.filter(([, init]) => {
      const body = JSON.parse(String((init as RequestInit).body));
      return body.to[0] === customer.email || body.to[0] === ctx.ownerEmail;
    });
    expect(mine).toHaveLength(2); // confirmación al cliente + aviso al profesional

    const sent = (await rows()).filter((n) => n.status === "sent");
    expect(sent.map((n) => n.type).sort()).toEqual(["booking_confirmation", "booking_received_owner"]);
    expect(sent.every((n) => n.sentAt !== null)).toBe(true);
  });

  it("si el proveedor falla, reintenta más tarde y registra el error sin marcar como enviado", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubEnv("EMAIL_FROM", "Agendia <test@example.com>");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));

    await book();
    const before = Date.now();
    await drain();

    const confirmation = (await rows()).find((n) => n.type === "booking_confirmation")!;
    expect(confirmation.status).toBe("pending");
    expect(confirmation.attempts).toBe(1);
    expect(confirmation.lastError).toContain("500");
    expect(confirmation.scheduledFor.getTime()).toBeGreaterThan(before);
    expect(confirmation.lockedUntil).toBeNull();
  });

  it("no envía el recordatorio de un turno que fue cancelado después de encolarlo", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubEnv("EMAIL_FROM", "Agendia <test@example.com>");
    const fetchSpy = vi.fn(async (_url: unknown, _init?: RequestInit) => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await book();
    if (!result.ok) throw new Error("setup");

    // Simula una carrera: el turno se cancela "por fuera" y el recordatorio
    // queda pendiente con su hora ya vencida.
    await db.appointment.update({ where: { id: result.appointment.id }, data: { status: "canceled" } });
    await db.notification.updateMany({
      where: { appointmentId: result.appointment.id, type: "reminder" },
      data: { scheduledFor: new Date(Date.now() - 1000) },
    });
    await drain();

    const reminder = (await rows()).find((n) => n.type === "reminder")!;
    expect(reminder.status).toBe("canceled");
    const reminderCalls = fetchSpy.mock.calls.filter(([, init]) =>
      String((init as RequestInit).body).includes("Recordatorio"),
    );
    expect(reminderCalls).toHaveLength(0);
  });
});
