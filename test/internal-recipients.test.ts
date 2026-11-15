import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addDays, todayInTz, zonedTimeToUtc } from "@/lib/time";
import { cancelAppointment, createAppointment, reassignAppointment, rescheduleAppointment } from "@/modules/appointments/service";
import { processDueNotifications } from "@/modules/notifications/process";
import { addProfessional, createSchedulableOrganization, enableTeam, ownerProfessional, refreshOrganization, uniqueSuffix } from "./helpers";

/**
 * A quién se le avisa de un turno dentro del negocio: propietario, administradores
 * autorizados y el profesional asignado con cuenta; sin duplicados y sin tocar a
 * los demás profesionales. Contra PostgreSQL real.
 */

type Tenant = Awaited<ReturnType<typeof createSchedulableOrganization>>;
let t: Tenant;
let ownerPro: Awaited<ReturnType<typeof ownerProfessional>>;
let p1: Awaited<ReturnType<typeof addProfessional>>; // con cuenta
let p2: Awaited<ReturnType<typeof addProfessional>>; // sin cuenta
let p3: Awaited<ReturnType<typeof addProfessional>>; // con cuenta, avisos apagados
let adminId: string;
let p1User: { id: string; email: string };
let p3User: { id: string; email: string };
const users: string[] = [];
let tz: string;
let day: string;

const at = (hour: number) => zonedTimeToUtc(day, hour * 60, tz);

async function memberUser(role: "admin" | "professional", notify: boolean, professionalId?: string) {
  const user = await db.user.create({ data: { email: `m-${uniqueSuffix()}@example.com`, name: role, passwordHash: "x", emailVerifiedAt: new Date() } });
  users.push(user.id);
  await db.membership.create({ data: { organizationId: t.organization.id, userId: user.id, role, notifyBookings: notify } });
  if (professionalId) await db.professional.update({ where: { id: professionalId }, data: { userId: user.id } });
  return user;
}

async function book(professionalId: string, hour: number, actor: "customer" | "professional" = "customer", actorUserId?: string) {
  const result = await createAppointment({
    organization: await refreshOrganization(t.organization.id),
    serviceId: t.service.id,
    startsAt: at(hour),
    customer: { name: "Cliente", email: `c-${uniqueSuffix()}@example.com`, phone: null },
    actor,
    professional: professionalId,
    actorUserId,
  });
  if (!result.ok) throw new Error(result.message);
  return result.appointment;
}

/** Destinatarios de avisos internos pendientes de un turno. */
const internal = async (appointmentId: string) =>
  (await db.notification.findMany({ where: { appointmentId, status: "pending", type: { in: ["booking_received_owner", "reschedule_owner", "cancellation_owner"] } } }))
    .map((n) => n.recipient)
    .sort();

beforeAll(async () => {
  t = await createSchedulableOrganization();
  await enableTeam(t.organization.id, { extraProfessionals: 6 });
  await db.organization.update({ where: { id: t.organization.id }, data: { notifyOwnerOnBooking: true, minNoticeMinutes: 0 } });
  tz = t.organization.timezone;
  day = addDays(todayInTz(tz), 3);
  ownerPro = await ownerProfessional(t.organization.id);
  p1 = await addProfessional(t.organization.id, { displayName: "Con cuenta" });
  p2 = await addProfessional(t.organization.id, { displayName: "Sin cuenta" });
  p3 = await addProfessional(t.organization.id, { displayName: "Avisos apagados" });
  p1User = await memberUser("professional", true, p1.id);
  p3User = await memberUser("professional", false, p3.id);
  adminId = (await memberUser("admin", false)).id;
});

afterAll(async () => {
  await t?.cleanup();
  await db.user.deleteMany({ where: { id: { in: users } } });
});

describe("avisos internos a quien corresponde", () => {
  it("una reserva del cliente avisa al propietario y al profesional asignado, y a nadie más", async () => {
    const appointment = await book(p1.id, 10);
    expect(await internal(appointment.id)).toEqual([t.ownerEmail, p1User.email].sort());
    // Los demás profesionales con cuenta no reciben datos de turnos ajenos; el administrador, sin avisos activados, tampoco.
    expect(await internal(appointment.id)).not.toContain(p3User.email);
  });

  it("un profesional sin cuenta no genera avisos propios: queda como siempre (solo el propietario)", async () => {
    const appointment = await book(p2.id, 11);
    expect(await internal(appointment.id)).toEqual([t.ownerEmail]);
  });

  it("el profesional que apagó sus avisos no los recibe", async () => {
    const appointment = await book(p3.id, 12);
    expect(await internal(appointment.id)).toEqual([t.ownerEmail]);
  });

  it("el administrador recibe los avisos del negocio solo si el propietario se los activó", async () => {
    const adminEmail = (await db.user.findUniqueOrThrow({ where: { id: adminId } })).email;
    await db.membership.updateMany({ where: { organizationId: t.organization.id, userId: adminId }, data: { notifyBookings: true } });
    const appointment = await book(p2.id, 13);
    expect(await internal(appointment.id)).toEqual([t.ownerEmail, adminEmail].sort());
    await db.membership.updateMany({ where: { organizationId: t.organization.id, userId: adminId }, data: { notifyBookings: false } });
  });

  it("si el propietario es el profesional asignado recibe un solo aviso, no dos", async () => {
    await db.professional.update({ where: { id: ownerPro.id }, data: { userId: t.userId } });
    const appointment = await book(ownerPro.id, 14);
    expect(await internal(appointment.id)).toEqual([t.ownerEmail]);
    await db.professional.update({ where: { id: ownerPro.id }, data: { userId: null } });
  });

  it("con los avisos del negocio apagados, el propietario no recibe; el profesional asignado sí (es su preferencia)", async () => {
    await db.organization.update({ where: { id: t.organization.id }, data: { notifyOwnerOnBooking: false } });
    const appointment = await book(p1.id, 15);
    expect(await internal(appointment.id)).toEqual([p1User.email]);
    await db.organization.update({ where: { id: t.organization.id }, data: { notifyOwnerOnBooking: true } });
  });

  it("lo que hace el propio profesional en el panel no le genera un aviso a él mismo", async () => {
    const appointment = await book(p1.id, 16, "professional", p1User.id);
    expect(await internal(appointment.id)).toEqual([]); // el propietario solo recibe lo que hacen los clientes
    // Pero si lo agenda el propietario para él, sí se entera.
    const byOwner = await book(p1.id, 17, "professional", t.userId);
    expect(await internal(byOwner.id)).toEqual([p1User.email]);
  });

  it("reprogramar y cancelar avisan a los mismos destinatarios y reemplazan los pendientes (sin duplicados)", async () => {
    const appointment = await book(p1.id, 9);
    const org = await refreshOrganization(t.organization.id);
    const moved = await rescheduleAppointment({ organization: org, appointmentId: appointment.id, startsAt: at(12), actor: "customer" });
    expect(moved.ok).toBe(true);
    const types = (await db.notification.findMany({ where: { appointmentId: appointment.id, status: "pending", type: { in: ["booking_received_owner", "reschedule_owner", "cancellation_owner"] } } })).map((n) => `${n.type}:${n.recipient}`).sort();
    expect(types).toEqual([`reschedule_owner:${t.ownerEmail}`, `reschedule_owner:${p1User.email}`].sort());

    await cancelAppointment({ organization: org, appointmentId: appointment.id, actor: "customer" });
    const canceled = (await db.notification.findMany({ where: { appointmentId: appointment.id, status: "pending", type: { in: ["booking_received_owner", "reschedule_owner", "cancellation_owner"] } } })).map((n) => `${n.type}:${n.recipient}`).sort();
    expect(canceled).toEqual([`cancellation_owner:${t.ownerEmail}`, `cancellation_owner:${p1User.email}`].sort());
  });

  it("al reasignar, el nuevo profesional se entera y el anterior no recibe nada más", async () => {
    const appointment = await book(p2.id, 9);
    const before = await db.notification.count({ where: { appointmentId: appointment.id } });
    const moved = await reassignAppointment({ organization: await refreshOrganization(t.organization.id), appointmentId: appointment.id, professionalId: p1.id, userId: t.userId });
    expect(moved.ok).toBe(true);
    expect(await internal(appointment.id)).toEqual([p1User.email]);
    expect(before).toBeGreaterThan(0);

    // Reasignarlo a otro: el que lo tenía antes (p1) ya no recibe los avisos pendientes nuevos.
    const second = await reassignAppointment({ organization: await refreshOrganization(t.organization.id), appointmentId: appointment.id, professionalId: p3.id, userId: t.userId });
    expect(second.ok).toBe(true);
    expect(await internal(appointment.id)).not.toContain(p1User.email);
  });
});

describe("se revalidan los destinatarios al enviar", () => {
  it("un aviso interno pendiente no sale si el destinatario perdió el acceso o apagó sus avisos", async () => {
    const appointment = await book(p1.id, 9);
    const pending = await db.notification.findMany({ where: { appointmentId: appointment.id, status: "pending", recipient: p1User.email } });
    expect(pending).toHaveLength(1);
    // Se revoca su acceso antes de que el worker procese el aviso.
    await db.membership.deleteMany({ where: { organizationId: t.organization.id, userId: p1User.id } });
    await db.notification.updateMany({ where: { id: pending[0].id }, data: { scheduledFor: new Date(Date.now() - 1000) } });

    const summary = await processDueNotifications(200);
    expect(summary.sent).toBe(0);
    expect((await db.notification.findUniqueOrThrow({ where: { id: pending[0].id } })).status).toBe("canceled");

    // Restaura para no afectar otras pruebas.
    await db.membership.create({ data: { organizationId: t.organization.id, userId: p1User.id, role: "professional" } });
    await db.professional.update({ where: { id: p1.id }, data: { userId: p1User.id } });
  });

  it("revocar el acceso cancela los avisos internos que estaban por salir hacia esa cuenta", async () => {
    const { revokeProfessionalAccess } = await import("@/modules/team/invitations");
    const appointment = await book(p1.id, 11);
    expect(await internal(appointment.id)).toContain(p1User.email);
    const result = await revokeProfessionalAccess(t.organization, { id: t.userId, name: "Dueña" }, p1.id);
    expect(result.ok).toBe(true);
    expect(await internal(appointment.id)).not.toContain(p1User.email);
  });
});
