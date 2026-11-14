import { describe, it, expect, afterAll, beforeAll, beforeEach } from "vitest";
import type { Organization, Professional } from "@prisma/client";
import { db } from "@/lib/db";
import { addDays, todayInTz, zonedTimeToUtc } from "@/lib/time";
import { getTeamAvailability } from "@/modules/availability/queries";
import { cancelAppointment, createAppointment, rescheduleAppointment } from "@/modules/appointments/service";
import { addProfessional, createSchedulableOrganization, enableTeam, ownerProfessional, refreshOrganization, uniqueSuffix } from "./helpers";

/**
 * Asignación automática, concurrencia, idempotencia, reprogramación y
 * cancelación con varios profesionales. Todo contra PostgreSQL real: las
 * garantías son la restricción de exclusión y los locks, no mocks.
 */

type Tenant = Awaited<ReturnType<typeof createSchedulableOrganization>>;

let shop: Tenant;
let organization: Organization;
let a: Professional;
let b: Professional;
let c: Professional;
let serviceId: string;
let day: string;

const at = (minutes: number, dateStr = day) => zonedTimeToUtc(dateStr, minutes, organization.timezone);
const hhmm = (h: number, m = 0) => h * 60 + m;

let counter = 0;
const guest = (n = ++counter) => ({ name: `Cliente ${n}`, email: `c${n}-${uniqueSuffix()}@example.com`, phone: null });

const bookAny = (when: Date, customer = guest(), extra: { professional?: string; idempotencyKey?: string } = {}) =>
  createAppointment({
    organization,
    serviceId,
    startsAt: when,
    customer,
    actor: "customer",
    professional: extra.professional ?? "any",
    idempotencyKey: extra.idempotencyKey,
  });

const appointmentsAt = (when: Date) =>
  db.appointment.findMany({ where: { organizationId: organization.id, startsAt: when, status: { not: "canceled" } } });

/** Nadie tiene dos turnos superpuestos (se verifica en SQL, independiente del código de la app). */
async function expectNoOverlaps() {
  const overlaps = await db.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*) AS n FROM "appointments" x JOIN "appointments" y
      ON x."professionalId" = y."professionalId" AND x."id" < y."id"
     AND x."status" <> 'canceled' AND y."status" <> 'canceled'
     AND x."startsAt" < y."endsAt" AND y."startsAt" < x."endsAt"
    WHERE x."organizationId" = ${organization.id}`;
  expect(Number(overlaps[0].n)).toBe(0);
}

beforeAll(async () => {
  shop = await createSchedulableOrganization();
  await enableTeam(shop.organization.id, { extraProfessionals: 3 });
  await db.professional.update({ where: { id: (await ownerProfessional(shop.organization.id)).id }, data: { active: false } });
  a = await addProfessional(shop.organization.id, { displayName: "Ana" });
  b = await addProfessional(shop.organization.id, { displayName: "Bruno" });
  c = await addProfessional(shop.organization.id, { displayName: "Carla" });
  organization = await refreshOrganization(shop.organization.id);
  serviceId = shop.service.id;
});

beforeEach(() => {
  day = addDays(todayInTz("America/Argentina/Buenos_Aires"), 2 + (counter % 40));
  counter += 7; // cada prueba usa su propio día para no pisarse
});

afterAll(async () => {
  await shop.cleanup();
});

describe("asignación automática", () => {
  it("asigna al profesional con menos turnos ese día y desempata por el orden del equipo", async () => {
    // Todos en 0: gana el primero del equipo (Ana).
    const first = await bookAny(at(hhmm(9)));
    expect(first.ok && first.appointment.professionalId).toBe(a.id);
    // Ana tiene 1; Bruno y Carla 0: gana Bruno (desempate por orden).
    const second = await bookAny(at(hhmm(10)));
    expect(second.ok && second.appointment.professionalId).toBe(b.id);
    const third = await bookAny(at(hhmm(11)));
    expect(third.ok && third.appointment.professionalId).toBe(c.id);
    // Cargas 1-1-1: vuelve a Ana.
    const fourth = await bookAny(at(hhmm(12)));
    expect(fourth.ok && fourth.appointment.professionalId).toBe(a.id);

    // Si Ana y Bruno tienen más turnos, gana Carla aunque esté última.
    for (const hour of [13, 14]) await createAppointment({ organization, serviceId, startsAt: at(hhmm(hour)), customer: guest(), actor: "professional", professional: a.id });
    await createAppointment({ organization, serviceId, startsAt: at(hhmm(15)), customer: guest(), actor: "professional", professional: b.id });
    const loads = await db.appointment.groupBy({ by: ["professionalId"], where: { organizationId: organization.id, startsAt: { gte: at(0), lt: at(1440) } }, _count: true });
    const byPro = Object.fromEntries(loads.map((l) => [l.professionalId, l._count]));
    expect(byPro[c.id]).toBeLessThan(byPro[a.id]);
    const next = await bookAny(at(hhmm(16)));
    expect(next.ok && next.appointment.professionalId).toBe(c.id);
  });

  it("guarda qué pidió el cliente y a quién se asignó", async () => {
    const any = await bookAny(at(hhmm(9)));
    expect(any.ok && any.appointment).toMatchObject({ professionalSelection: "any", requestedProfessionalId: null });
    const specific = await bookAny(at(hhmm(9)), guest(), { professional: c.id });
    expect(specific.ok && specific.appointment).toMatchObject({ professionalSelection: "specific", requestedProfessionalId: c.id, professionalId: c.id });
  });

  it("revalida al confirmar: un horario que ya no tiene a nadie libre se rechaza", async () => {
    for (const pro of [a, b, c]) {
      const taken = await createAppointment({ organization, serviceId, startsAt: at(hhmm(10)), customer: guest(), actor: "professional", professional: pro.id });
      expect(taken.ok).toBe(true);
    }
    const rejected = await bookAny(at(hhmm(10)));
    expect(rejected).toMatchObject({ ok: false, code: "unavailable" });
    const rejectedSpecific = await bookAny(at(hhmm(10)), guest(), { professional: a.id });
    expect(rejectedSpecific).toMatchObject({ ok: false });
    expect(await appointmentsAt(at(hhmm(10)))).toHaveLength(3);
  });
});

describe("concurrencia", () => {
  it("muchas reservas «cualquiera» del mismo horario se reparten entre los profesionales y ninguna se superpone", async () => {
    const attempts = await Promise.all(Array.from({ length: 12 }, () => bookAny(at(hhmm(11)))));
    const ok = attempts.filter((r) => r.ok);
    const rejected = attempts.filter((r) => !r.ok);
    expect(ok).toHaveLength(3); // exactamente un turno por profesional
    expect(rejected).toHaveLength(9);
    expect(rejected.every((r) => !r.ok && (r.code === "slot_taken" || r.code === "unavailable"))).toBe(true);
    const placed = await appointmentsAt(at(hhmm(11)));
    expect(new Set(placed.map((p) => p.professionalId))).toEqual(new Set([a.id, b.id, c.id]));
    await expectNoOverlaps();
  });

  it("si el candidato elegido se ocupa en el medio, se prueba con otro profesional elegible", async () => {
    // Carreras de 3 a la vez: todas calculan el mismo candidato inicial (Ana) y las que pierden pasan al siguiente.
    const attempts = await Promise.all(Array.from({ length: 3 }, () => bookAny(at(hhmm(12)))));
    expect(attempts.every((r) => r.ok)).toBe(true);
    const professionals = attempts.map((r) => (r.ok ? r.appointment.professionalId : ""));
    expect(new Set(professionals).size).toBe(3);
  });

  it("reservas simultáneas del mismo profesional: entra exactamente una", async () => {
    const attempts = await Promise.all(Array.from({ length: 10 }, () => bookAny(at(hhmm(13)), guest(), { professional: b.id })));
    expect(attempts.filter((r) => r.ok)).toHaveLength(1);
    expect((await appointmentsAt(at(hhmm(13)))).filter((p) => p.professionalId === b.id)).toHaveLength(1);
    await expectNoOverlaps();
  });

  it("reservas simultáneas de clientes distintos con profesionales distintos entran todas (no se bloquean entre sí)", async () => {
    const attempts = await Promise.all([a, b, c].map((pro) => bookAny(at(hhmm(14)), guest(), { professional: pro.id })));
    expect(attempts.every((r) => r.ok)).toBe(true);
    expect(await appointmentsAt(at(hhmm(14)))).toHaveLength(3);
  });

  it("una reserva que pierde la carrera no deja datos a medias (ni el cliente nuevo)", async () => {
    await createAppointment({ organization, serviceId, startsAt: at(hhmm(15)), customer: guest(), actor: "professional", professional: a.id });
    const customersBefore = await db.customer.count({ where: { organizationId: organization.id } });
    const appointmentsBefore = await db.appointment.count({ where: { organizationId: organization.id } });
    const notificationsBefore = await db.notification.count({ where: { organizationId: organization.id } });

    // Agenda interna: no verifica disponibilidad, así que choca recién contra la restricción de la base.
    const lost = await createAppointment({
      organization, serviceId, startsAt: at(hhmm(15)), customer: { name: "Perdedor", email: "perdedor@example.com", phone: null },
      actor: "professional", professional: a.id,
    });
    expect(lost).toMatchObject({ ok: false, code: "slot_taken" });
    expect(await db.customer.count({ where: { organizationId: organization.id } })).toBe(customersBefore);
    expect(await db.appointment.count({ where: { organizationId: organization.id } })).toBe(appointmentsBefore);
    expect(await db.notification.count({ where: { organizationId: organization.id } })).toBe(notificationsBefore);
  });
});

describe("duplicados por reintento o doble envío", () => {
  it("la misma clave devuelve la misma reserva, también con muchos envíos simultáneos", async () => {
    const customer = guest();
    const key = `key-${uniqueSuffix()}`;
    const attempts = await Promise.all(Array.from({ length: 6 }, () => bookAny(at(hhmm(9)), customer, { idempotencyKey: key })));
    expect(attempts.every((r) => r.ok)).toBe(true);
    const ids = new Set(attempts.map((r) => (r.ok ? r.appointment.id : "")));
    expect(ids.size).toBe(1);
    expect(await appointmentsAt(at(hhmm(9)))).toHaveLength(1);
    // Un reintento posterior (la página se recargó y reenvió) también devuelve el mismo turno.
    const later = await bookAny(at(hhmm(9)), customer, { idempotencyKey: key });
    expect(later.ok && later.replayed).toBe(true);
  });

  it("una clave reutilizada para OTRO horario no devuelve el turno equivocado", async () => {
    const key = `reuse-${uniqueSuffix()}`;
    const first = await bookAny(at(hhmm(10)), guest(), { idempotencyKey: key });
    expect(first.ok).toBe(true);
    const other = await bookAny(at(hhmm(11)), guest(), { idempotencyKey: key });
    expect(other).toMatchObject({ ok: false, code: "invalid" });
  });

  it("sin clave, un doble envío idéntico del mismo cliente no crea dos turnos", async () => {
    const customer = guest();
    const attempts = await Promise.all(Array.from({ length: 5 }, () => bookAny(at(hhmm(12)), customer)));
    expect(attempts.every((r) => r.ok)).toBe(true);
    expect(await appointmentsAt(at(hhmm(12)))).toHaveLength(1);
  });

  it("clientes distintos a la misma hora (con la misma clave de otro formulario no) sí reservan simultáneamente", async () => {
    const attempts = await Promise.all([1, 2, 3].map((n) => bookAny(at(hhmm(13)), guest(n + 100), { idempotencyKey: `form-${n}-${uniqueSuffix()}` })));
    expect(attempts.every((r) => r.ok)).toBe(true);
    expect(await appointmentsAt(at(hhmm(13)))).toHaveLength(3);
  });

  it("una reserva cancelada con la misma clave no se «revive» al reenviar", async () => {
    const key = `cancel-${uniqueSuffix()}`;
    const created = await bookAny(at(hhmm(14)), guest(), { idempotencyKey: key });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await cancelAppointment({ organization, appointmentId: created.appointment.id, actor: "customer" });
    const again = await bookAny(at(hhmm(14)), guest(), { idempotencyKey: key });
    expect(again).toMatchObject({ ok: false, code: "invalid" });
  });
});

describe("reprogramación y cancelación", () => {
  it("el cliente que eligió un profesional lo conserva; si no está libre, no se lo cambia", async () => {
    const created = await bookAny(at(hhmm(9)), guest(), { professional: b.id });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    // Bruno ocupado a las 10:00.
    await createAppointment({ organization, serviceId, startsAt: at(hhmm(10)), customer: guest(), actor: "professional", professional: b.id });

    const blocked = await rescheduleAppointment({ organization, appointmentId: created.appointment.id, startsAt: at(hhmm(10)), actor: "customer" });
    expect(blocked).toMatchObject({ ok: false, code: "unavailable" });

    const moved = await rescheduleAppointment({ organization, appointmentId: created.appointment.id, startsAt: at(hhmm(16)), actor: "customer" });
    expect(moved.ok && moved.appointment.professionalId).toBe(b.id);
    expect(moved.ok && moved.previousProfessionalId).toBeUndefined();
  });

  it("con «cualquiera» se conserva al asignado cuando está libre y se reasigna cuando no", async () => {
    const created = await bookAny(at(hhmm(9)));
    expect(created.ok && created.appointment.professionalId).toBe(a.id);
    if (!created.ok) return;

    // Ana libre a las 11:00: se queda con Ana.
    const keep = await rescheduleAppointment({ organization, appointmentId: created.appointment.id, startsAt: at(hhmm(11)), actor: "customer" });
    expect(keep.ok && keep.appointment.professionalId).toBe(a.id);
    expect(keep.ok && keep.previousProfessionalId).toBeUndefined();

    // Ana ocupada a las 12:00: se reasigna a otro elegible libre y se informa el cambio.
    await createAppointment({ organization, serviceId, startsAt: at(hhmm(12)), customer: guest(), actor: "professional", professional: a.id });
    const reassigned = await rescheduleAppointment({ organization, appointmentId: created.appointment.id, startsAt: at(hhmm(12)), actor: "customer" });
    expect(reassigned.ok).toBe(true);
    if (!reassigned.ok) return;
    expect([b.id, c.id]).toContain(reassigned.appointment.professionalId);
    expect(reassigned.previousProfessionalId).toBe(a.id);
    // Sigue siendo una reserva «cualquiera».
    expect(reassigned.appointment.professionalSelection).toBe("any");
    await expectNoOverlaps();
  });

  it("la agenda interna puede reasignar el turno a otro profesional", async () => {
    const created = await bookAny(at(hhmm(9)), guest(), { professional: a.id });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const moved = await rescheduleAppointment({
      organization, appointmentId: created.appointment.id, startsAt: at(hhmm(9)), actor: "professional", professional: c.id,
    });
    expect(moved.ok && moved.appointment.professionalId).toBe(c.id);
    expect(moved.ok && moved.previousProfessionalId).toBe(a.id);
    // El historial de lo que pidió el cliente se conserva; el asignado cambió.
    const stored = await db.appointment.findUniqueOrThrow({ where: { id: created.appointment.id } });
    expect(stored.professionalId).toBe(c.id);
  });

  it("cancelar libera el horario de ESE profesional y conserva el historial", async () => {
    const created = await bookAny(at(hhmm(9)), guest(), { professional: b.id });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const ids = [a.id, b.id, c.id];
    const slot = async () => (await getTeamAvailability({ organization, professionalIds: ids, durationMinutes: 30, fromDateStr: day, days: 1 }))[0].slots.find((s) => s.start.getTime() === at(hhmm(9)).getTime())!;
    expect((await slot()).professionalIds).toEqual([a.id, c.id]);

    const canceled = await cancelAppointment({ organization, appointmentId: created.appointment.id, actor: "customer" });
    expect(canceled.ok).toBe(true);
    expect((await slot()).professionalIds).toEqual([a.id, b.id, c.id]);

    const history = await db.appointment.findUniqueOrThrow({ where: { id: created.appointment.id } });
    expect(history).toMatchObject({ status: "canceled", professionalId: b.id, canceledBy: "customer" });
    // El horario se puede volver a tomar.
    expect((await bookAny(at(hhmm(9)), guest(), { professional: b.id })).ok).toBe(true);
  });

  it("la agenda interna exige elegir profesional cuando hay varios, y rechaza uno ajeno", async () => {
    const missing = await createAppointment({ organization, serviceId, startsAt: at(hhmm(9)), customer: guest(), actor: "professional" });
    expect(missing).toMatchObject({ ok: false, code: "invalid" });

    const stranger = await createSchedulableOrganization();
    try {
      const foreign = await ownerProfessional(stranger.organization.id);
      const denied = await createAppointment({ organization, serviceId, startsAt: at(hhmm(9)), customer: guest(), actor: "professional", professional: foreign.id });
      expect(denied).toMatchObject({ ok: false, code: "unavailable" });
      expect(await db.appointment.count({ where: { professionalId: foreign.id } })).toBe(0);
    } finally {
      await stranger.cleanup();
    }
  });
});
