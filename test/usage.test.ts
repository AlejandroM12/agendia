import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { db } from "@/lib/db";
import { getDailyEmailUsage, getUsageByOrganization, monthRange, totalUsage } from "@/modules/system/usage";
import { addProfessional, createSchedulableOrganization, enableTeam, uniqueSuffix } from "./helpers";

type Tenant = Awaited<ReturnType<typeof createSchedulableOrganization>>;

let busy: Tenant;
let quiet: Tenant;
const range = monthRange();

async function appointmentWithNotifications(tenant: Tenant, notifications: Array<{ type: string; status: string; attempts: number }>) {
  const customer = await db.customer.create({ data: { organizationId: tenant.organization.id, name: `Uso ${uniqueSuffix()}` } });
  const professional = await db.professional.findFirstOrThrow({ where: { organizationId: tenant.organization.id } });
  const startsAt = new Date(Date.now() + 86400000 * (2 + Math.floor(Math.random() * 20)));
  const appointment = await db.appointment.create({
    data: {
      organizationId: tenant.organization.id, professionalId: professional.id, serviceId: tenant.service.id, customerId: customer.id,
      startsAt, endsAt: new Date(startsAt.getTime() + 1800000), manageToken: `uso-${uniqueSuffix()}-xxxxxxxxxxxx`,
    },
  });
  for (const n of notifications) {
    await db.notification.create({
      data: {
        organizationId: tenant.organization.id, appointmentId: appointment.id, recipient: "x@example.com", scheduledFor: new Date(),
        idempotencyKey: `uso-${uniqueSuffix()}-${Math.random()}`,
        type: n.type as never, status: n.status as never, attempts: n.attempts,
      },
    });
  }
}

beforeAll(async () => {
  busy = await createSchedulableOrganization();
  quiet = await createSchedulableOrganization();
  await enableTeam(busy.organization.id, { extraProfessionals: 3 });
  await addProfessional(busy.organization.id, { displayName: "Segundo" });
  await addProfessional(busy.organization.id, { displayName: "Inactivo", active: false });

  await appointmentWithNotifications(busy, [
    { type: "booking_confirmation", status: "sent", attempts: 1 },
    { type: "reminder", status: "sent", attempts: 3 }, // con reintentos
    { type: "booking_received_owner", status: "failed", attempts: 5 },
    { type: "reminder", status: "skipped", attempts: 0 },
    { type: "cancellation", status: "canceled", attempts: 0 },
    { type: "reschedule", status: "pending", attempts: 0 },
  ]);
  await appointmentWithNotifications(busy, [{ type: "booking_confirmation", status: "sent", attempts: 1 }]);
  await appointmentWithNotifications(quiet, [{ type: "booking_confirmation", status: "sent", attempts: 1 }]);
});

afterAll(async () => {
  await busy.cleanup();
  await quiet.cleanup();
});

describe("métricas de consumo por negocio", () => {
  it("cuenta profesionales activos, turnos y correos por estado, tipo y reintentos", async () => {
    const usage = await getUsageByOrganization(range, 1000);
    const row = usage.find((u) => u.organizationId === busy.organization.id)!;
    expect(row).toBeDefined();
    expect(row.activeProfessionals).toBe(2); // el dueño + «Segundo»; el inactivo no cuenta
    expect(row.appointmentsCreated).toBe(2);
    expect(row.emails).toMatchObject({ sent: 3, failed: 1, skipped: 1, pending: 1, canceled: 1, retried: 2 });
    expect(row.emails.byType).toEqual({ booking_confirmation: 2, reminder: 1, booking_received_owner: 1 }); // solo enviados y fallidos
  });

  it("ordena de mayor a menor consumo y aísla a cada negocio", async () => {
    const usage = await getUsageByOrganization(range, 1000);
    const mine = usage.filter((u) => [busy.organization.id, quiet.organization.id].includes(u.organizationId));
    expect(mine.map((u) => u.organizationId)).toEqual([busy.organization.id, quiet.organization.id]);
    expect(mine[1].emails.sent).toBe(1);
    expect(mine[1].appointmentsCreated).toBe(1);
  });

  it("los períodos sin actividad no aparecen y el total suma los negocios", async () => {
    const empty = await getUsageByOrganization({ from: new Date("2000-01-01"), to: new Date("2000-02-01") });
    expect(empty).toEqual([]);
    const usage = await getUsageByOrganization(range, 1000);
    const totals = totalUsage(usage);
    expect(totals.sent).toBeGreaterThanOrEqual(4);
    expect(totals.failed).toBeGreaterThanOrEqual(1);
  });

  it("el consumo diario agrupa por día", async () => {
    const days = await getDailyEmailUsage(range);
    const today = new Date().toISOString().slice(0, 10);
    const row = days.find((d) => d.day === today)!;
    expect(row.sent).toBeGreaterThanOrEqual(4);
    expect(row.failed).toBeGreaterThanOrEqual(1);
  });

  it("el rango mensual va del primer instante del mes al primero del siguiente", () => {
    const r = monthRange(new Date("2026-12-15T10:00:00Z"));
    expect(r.from.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(r.to.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});
