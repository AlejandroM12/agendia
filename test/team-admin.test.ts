import { describe, it, expect, afterAll } from "vitest";
import sharp from "sharp";
import { db } from "@/lib/db";
import { addDays, todayInTz, zonedTimeToUtc } from "@/lib/time";
import { createAppointment, reassignAppointment } from "@/modules/appointments/service";
import { removeProfessionalPhoto, saveProfessionalPhoto } from "@/modules/public-page/images";
import {
  copyProfessionalHours,
  createDateRangeBlock,
  deactivateProfessional,
  deleteAvailabilityException,
  getProfessionalServices,
  getTeamOverview,
  listAffectedAppointments,
  moveProfessional,
  resolveFutureAppointments,
  setProfessionalServices,
  setProfessionalUser,
  updateProfessional,
} from "@/modules/team/team-admin";
import { addProfessional, createSchedulableOrganization, enableTeam, ownerProfessional, refreshOrganization } from "./helpers";

type Tenant = Awaited<ReturnType<typeof createSchedulableOrganization>>;
const tenants: Tenant[] = [];

async function team(names: string[] = ["Lucas", "Martín"]) {
  const shop = await createSchedulableOrganization();
  tenants.push(shop);
  await enableTeam(shop.organization.id, { extraProfessionals: 5 });
  const owner = await ownerProfessional(shop.organization.id);
  await db.professional.update({ where: { id: owner.id }, data: { displayName: names[0] } });
  const others = [];
  for (const name of names.slice(1)) others.push(await addProfessional(shop.organization.id, { displayName: name }));
  const org = () => refreshOrganization(shop.organization.id);
  const tz = shop.organization.timezone;
  const tomorrow = addDays(todayInTz(tz), 1);
  const at = (hour: number, dateStr = tomorrow) => zonedTimeToUtc(dateStr, hour * 60, tz);
  return { shop, owner: { ...owner, displayName: names[0] }, others, org, tz, tomorrow, at };
}

async function book(
  t: Awaited<ReturnType<typeof team>>,
  professionalId: string,
  hour: number,
  email = `c-${Math.random().toString(36).slice(2, 8)}@example.com`,
) {
  const result = await createAppointment({
    organization: await t.org(),
    serviceId: t.shop.service.id,
    startsAt: t.at(hour),
    customer: { name: "Cliente", email, phone: null },
    actor: "professional",
    professional: professionalId,
  });
  if (!result.ok) throw new Error(result.message);
  return result.appointment;
}

afterAll(async () => {
  for (const shop of tenants) await shop.cleanup();
});

async function png(size = 400) {
  return new Uint8Array(await sharp({ create: { width: size, height: size, channels: 3, background: "#7a3" } }).png().toBuffer());
}

describe("datos y orden de los profesionales", () => {
  it("edita nombre, descripción, color y reservas online; rechaza datos inválidos y profesionales ajenos", async () => {
    const t = await team();
    const other = await team();
    const ok = await updateProfessional(await t.org(), t.others[0].id, {
      displayName: "  Martín R.  ", description: "Barbero", color: "#112233", bookableOnline: false,
    });
    expect(ok.ok).toBe(true);
    expect(await db.professional.findUniqueOrThrow({ where: { id: t.others[0].id } })).toMatchObject({
      displayName: "Martín R.", description: "Barbero", color: "#112233", bookableOnline: false,
    });

    const base = { displayName: "X", description: null, color: "#112233", bookableOnline: true };
    expect(await updateProfessional(await t.org(), t.others[0].id, { ...base, displayName: "M" })).toMatchObject({ ok: false, code: "invalid" });
    expect(await updateProfessional(await t.org(), t.others[0].id, { ...base, displayName: "Martín", color: "rojo" })).toMatchObject({ ok: false, code: "invalid" });
    // Un identificador de otro negocio no modifica nada.
    expect(await updateProfessional(await t.org(), other.others[0].id, { ...base, displayName: "Hackeado" })).toMatchObject({ ok: false, code: "not_found" });
    expect((await db.professional.findUniqueOrThrow({ where: { id: other.others[0].id } })).displayName).toBe("Martín");
  });

  it("no deja editar si la cuenta está en solo lectura", async () => {
    const t = await team();
    await db.organization.update({ where: { id: t.shop.organization.id }, data: { status: "suspended" } });
    const result = await updateProfessional(await t.org(), t.others[0].id, {
      displayName: "Nuevo", description: null, color: "#112233", bookableOnline: true,
    });
    expect(result).toMatchObject({ ok: false, code: "read_only" });
  });

  it("sube y baja profesionales con un orden secuencial, solo dentro del negocio", async () => {
    const t = await team(["Lucas", "Martín", "Diego"]);
    const [martin, diego] = t.others;
    await moveProfessional(await t.org(), diego.id, "up");
    const order = async () =>
      (await getTeamOverview(await t.org())).members.map((m) => `${m.displayName}:${m.sortOrder}`);
    expect(await order()).toEqual(["Lucas:0", "Diego:1", "Martín:2"]);
    // En los extremos no pasa nada.
    await moveProfessional(await t.org(), t.owner.id, "up");
    expect(await order()).toEqual(["Lucas:0", "Diego:1", "Martín:2"]);
    expect(await moveProfessional(await t.org(), (await team()).owner.id, "down")).toMatchObject({ ok: false, code: "not_found" });
    expect(martin.id).toBeTruthy();
  });

  it("identifica al propietario que atiende, solo con un miembro del negocio", async () => {
    const t = await team();
    const outsider = await team();
    expect((await setProfessionalUser(await t.org(), t.owner.id, t.shop.userId)).ok).toBe(true);
    expect((await db.professional.findUniqueOrThrow({ where: { id: t.owner.id } })).userId).toBe(t.shop.userId);

    // Una persona de otro negocio no se puede vincular.
    expect(await setProfessionalUser(await t.org(), t.others[0].id, outsider.shop.userId)).toMatchObject({ ok: false, code: "invalid" });
    // Una persona atiende en un solo lugar: se traslada el vínculo.
    expect((await setProfessionalUser(await t.org(), t.others[0].id, t.shop.userId)).ok).toBe(true);
    expect((await db.professional.findUniqueOrThrow({ where: { id: t.owner.id } })).userId).toBeNull();
    // Y se puede soltar.
    expect((await setProfessionalUser(await t.org(), t.others[0].id, null)).ok).toBe(true);
  });
});

describe("servicios por profesional", () => {
  it("quitar un servicio lo restringe a los demás; agregarlo lo vuelve a habilitar", async () => {
    const t = await team(["Lucas", "Martín", "Diego"]);
    const [martin, diego] = t.others;
    const extra = await db.service.create({ data: { organizationId: t.shop.organization.id, name: "Barba", durationMinutes: 30 } });

    const removed = await setProfessionalServices(await t.org(), martin.id, [t.shop.service.id]);
    expect(removed.ok).toBe(true);
    const martinServices = await getProfessionalServices(t.shop.organization.id, martin.id);
    expect(martinServices.find((s) => s.id === extra.id)?.performs).toBe(false);
    expect(martinServices.find((s) => s.id === t.shop.service.id)?.performs).toBe(true);
    // Los demás siguen haciendo Barba.
    expect((await getProfessionalServices(t.shop.organization.id, diego.id)).find((s) => s.id === extra.id)?.performs).toBe(true);
    expect((await getProfessionalServices(t.shop.organization.id, t.owner.id)).find((s) => s.id === extra.id)?.performs).toBe(true);

    await setProfessionalServices(await t.org(), martin.id, [t.shop.service.id, extra.id]);
    expect((await getProfessionalServices(t.shop.organization.id, martin.id)).find((s) => s.id === extra.id)?.performs).toBe(true);
  });

  it("avisa cuando un servicio queda sin ningún profesional activo", async () => {
    const t = await team(["Lucas"]);
    const result = await setProfessionalServices(await t.org(), t.owner.id, []);
    expect(result.ok && result.value.servicesWithoutProfessional).toEqual(["Consulta"]);
  });

  it("no deja quitar un servicio con turnos futuros ni usar servicios de otro negocio", async () => {
    const t = await team();
    const stranger = await team();
    await book(t, t.others[0].id, 10);
    const blocked = await setProfessionalServices(await t.org(), t.others[0].id, []);
    expect(blocked).toMatchObject({ ok: false, code: "has_future_appointments" });
    expect((await getProfessionalServices(t.shop.organization.id, t.others[0].id))[0].performs).toBe(true);

    const foreign = await setProfessionalServices(await t.org(), t.others[0].id, [stranger.shop.service.id]);
    expect(foreign).toMatchObject({ ok: false, code: "invalid" });
  });
});

describe("horarios y bloqueos", () => {
  it("copia el horario de otro profesional sin tocar los demás", async () => {
    const t = await team(["Lucas", "Martín", "Diego"]);
    const [martin, diego] = t.others;
    await db.availabilityRule.deleteMany({ where: { professionalId: martin.id } });
    await db.availabilityRule.create({
      data: { organizationId: t.shop.organization.id, professionalId: martin.id, weekday: 2, startMinute: 14 * 60, endMinute: 20 * 60 },
    });
    const before = await db.availabilityRule.count({ where: { professionalId: diego.id } });

    const copied = await copyProfessionalHours(await t.org(), martin.id, t.owner.id);
    expect(copied).toMatchObject({ ok: true, value: { rules: 1 } });
    expect(await db.availabilityRule.findMany({ where: { professionalId: t.owner.id } })).toMatchObject([
      { weekday: 2, startMinute: 14 * 60, endMinute: 20 * 60 },
    ]);
    expect(await db.availabilityRule.count({ where: { professionalId: diego.id } })).toBe(before);

    expect(await copyProfessionalHours(await t.org(), martin.id, martin.id)).toMatchObject({ ok: false, code: "invalid" });
    const stranger = await team();
    expect(await copyProfessionalHours(await t.org(), stranger.owner.id, t.owner.id)).toMatchObject({ ok: false, code: "not_found" });
    expect(await db.availabilityRule.count({ where: { professionalId: t.owner.id } })).toBe(1);
  });

  it("bloquea varios días para un profesional, o para todo el negocio, con límites", async () => {
    const t = await team();
    const today = todayInTz(t.tz);
    const from = addDays(today, 2);
    const individual = await createDateRangeBlock(await t.org(), { professionalId: t.others[0].id, from, to: addDays(from, 4), reason: "Vacaciones" }, today);
    expect(individual).toMatchObject({ ok: true, value: { days: 5 } });
    expect(await db.availabilityException.count({ where: { professionalId: t.others[0].id } })).toBe(5);

    const general = await createDateRangeBlock(await t.org(), { professionalId: null, from, to: from, reason: "Feriado" }, today);
    expect(general.ok).toBe(true);
    expect(await db.availabilityException.count({ where: { organizationId: t.shop.organization.id, professionalId: null } })).toBe(1);

    expect(await createDateRangeBlock(await t.org(), { professionalId: null, from: addDays(today, -1), to: today, reason: null }, today)).toMatchObject({ ok: false, code: "invalid" });
    expect(await createDateRangeBlock(await t.org(), { professionalId: null, from, to: addDays(from, -1), reason: null }, today)).toMatchObject({ ok: false, code: "invalid" });
    expect(await createDateRangeBlock(await t.org(), { professionalId: null, from, to: addDays(from, 400), reason: null }, today)).toMatchObject({ ok: false, code: "invalid" });
    const stranger = await team();
    expect(await createDateRangeBlock(await t.org(), { professionalId: stranger.owner.id, from, to: from, reason: null }, today)).toMatchObject({ ok: false, code: "not_found" });
  });

  it("un bloqueo individual solo se borra desde su profesional, y uno general desde los cierres generales", async () => {
    const t = await team();
    const today = todayInTz(t.tz);
    const day = addDays(today, 3);
    await createDateRangeBlock(await t.org(), { professionalId: t.others[0].id, from: day, to: day, reason: null }, today);
    await createDateRangeBlock(await t.org(), { professionalId: null, from: day, to: day, reason: null }, today);
    const individual = await db.availabilityException.findFirstOrThrow({ where: { professionalId: t.others[0].id } });
    const general = await db.availabilityException.findFirstOrThrow({ where: { organizationId: t.shop.organization.id, professionalId: null } });

    expect(await deleteAvailabilityException(await t.org(), individual.id, { professionalId: null })).toMatchObject({ ok: false, code: "not_found" });
    expect(await deleteAvailabilityException(await t.org(), general.id, { professionalId: t.others[0].id })).toMatchObject({ ok: false, code: "not_found" });
    expect(await deleteAvailabilityException(await t.org(), individual.id, { professionalId: t.others[0].id })).toMatchObject({ ok: true });
    expect(await deleteAvailabilityException(await t.org(), general.id, { professionalId: null })).toMatchObject({ ok: true });
  });
});

describe("reasignación y desactivación", () => {
  it("reasigna un turno futuro al mismo horario, avisa al cliente y deja registro", async () => {
    const t = await team();
    const appointment = await book(t, t.owner.id, 10);

    const result = await reassignAppointment({ organization: await t.org(), appointmentId: appointment.id, professionalId: t.others[0].id, userId: t.shop.userId });
    expect(result).toMatchObject({ ok: true, previousProfessionalId: t.owner.id });
    const moved = await db.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    expect(moved).toMatchObject({ professionalId: t.others[0].id, professionalSelection: "specific", requestedProfessionalId: t.others[0].id, status: "confirmed" });
    expect(moved.startsAt.getTime()).toBe(appointment.startsAt.getTime());

    const notices = await db.notification.findMany({ where: { appointmentId: appointment.id, status: "pending" } });
    expect(notices.map((n) => n.type)).toContain("professional_change");
    const entry = await db.auditLog.findFirst({ where: { organizationId: t.shop.organization.id, action: "team.appointment.reassign", entityId: appointment.id } });
    expect(entry?.metadata).toMatchObject({ from: t.owner.id, to: t.others[0].id });
  });

  it("no reasigna si el otro profesional está ocupado, no hace el servicio, está inactivo o es de otro negocio", async () => {
    const t = await team(["Lucas", "Martín", "Diego"]);
    const [martin, diego] = t.others;
    const appointment = await book(t, t.owner.id, 10);
    await book(t, martin.id, 10);

    expect(await reassignAppointment({ organization: await t.org(), appointmentId: appointment.id, professionalId: martin.id })).toMatchObject({ ok: false, code: "unavailable" });

    await setProfessionalServices(await t.org(), diego.id, []);
    expect(await reassignAppointment({ organization: await t.org(), appointmentId: appointment.id, professionalId: diego.id })).toMatchObject({ ok: false, code: "unavailable" });

    await db.professional.update({ where: { id: martin.id }, data: { active: false } });
    expect(await reassignAppointment({ organization: await t.org(), appointmentId: appointment.id, professionalId: martin.id })).toMatchObject({ ok: false });

    const stranger = await team();
    expect(await reassignAppointment({ organization: await t.org(), appointmentId: appointment.id, professionalId: stranger.owner.id })).toMatchObject({ ok: false });
    expect(await reassignAppointment({ organization: await stranger.org(), appointmentId: appointment.id, professionalId: stranger.owner.id })).toMatchObject({ ok: false, code: "not_found" });
    expect((await db.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).professionalId).toBe(t.owner.id);
  });

  it("respeta los bloqueos del profesional destino y no toca turnos pasados ni cancelados", async () => {
    const t = await team();
    const appointment = await book(t, t.owner.id, 10);
    await db.availabilityException.create({
      data: { organizationId: t.shop.organization.id, professionalId: t.others[0].id, date: new Date(`${t.tomorrow}T00:00:00Z`), startMinute: null, endMinute: null },
    });
    expect(await reassignAppointment({ organization: await t.org(), appointmentId: appointment.id, professionalId: t.others[0].id })).toMatchObject({ ok: false, code: "unavailable" });

    await db.appointment.update({ where: { id: appointment.id }, data: { status: "canceled" } });
    expect(await reassignAppointment({ organization: await t.org(), appointmentId: appointment.id, professionalId: t.others[0].id })).toMatchObject({ ok: false, code: "invalid" });

    const past = await db.appointment.create({
      data: {
        organizationId: t.shop.organization.id, professionalId: t.owner.id, serviceId: t.shop.service.id,
        customerId: appointment.customerId, startsAt: new Date(Date.now() - 86_400_000), endsAt: new Date(Date.now() - 86_400_000 + 1_800_000),
        manageToken: `past-${Math.random()}`,
      },
    });
    expect(await reassignAppointment({ organization: await t.org(), appointmentId: past.id, professionalId: t.others[0].id })).toMatchObject({ ok: false, code: "invalid" });
  });

  it("lista los turnos afectados con a quién se pueden pasar", async () => {
    const t = await team(["Lucas", "Martín", "Diego"]);
    const [martin, diego] = t.others;
    const a10 = await book(t, t.owner.id, 10);
    const a11 = await book(t, t.owner.id, 11);
    await book(t, martin.id, 10); // Martín ocupado a las 10

    const affected = await listAffectedAppointments(await t.org(), t.owner.id);
    expect(affected.map((a) => a.id)).toEqual([a10.id, a11.id]);
    expect(affected[0].options.map((o) => o.id)).toEqual([diego.id]);
    expect(affected[1].options.map((o) => o.id).sort()).toEqual([martin.id, diego.id].sort());
  });

  it("no se puede desactivar con turnos futuros; resueltos, sí, y el historial queda", async () => {
    const t = await team();
    const appointment = await book(t, t.others[0].id, 10);
    expect(await deactivateProfessional(await t.org(), t.others[0].id)).toMatchObject({ ok: false, code: "has_future_appointments", futureAppointments: 1 });

    const bulk = await resolveFutureAppointments(await t.org(), t.others[0].id, { kind: "reassign", toProfessionalId: t.owner.id }, t.shop.userId);
    expect(bulk).toMatchObject({ ok: true, value: { done: 1, failed: [] } });
    expect((await db.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).professionalId).toBe(t.owner.id);

    expect((await deactivateProfessional(await t.org(), t.others[0].id, t.shop.userId)).ok).toBe(true);
    // El profesional y su historial siguen en la base.
    expect(await db.professional.count({ where: { id: t.others[0].id, active: false } })).toBe(1);
    expect(await db.auditLog.count({ where: { organizationId: t.shop.organization.id, action: "team.professional.deactivate" } })).toBe(1);
  });

  it("al resolver varios turnos informa los que no se pudieron pasar y no pierde ninguno", async () => {
    const t = await team();
    const a10 = await book(t, t.others[0].id, 10);
    const a11 = await book(t, t.others[0].id, 11);
    await book(t, t.owner.id, 10); // el destino está ocupado a las 10

    const bulk = await resolveFutureAppointments(await t.org(), t.others[0].id, { kind: "reassign", toProfessionalId: t.owner.id });
    expect(bulk.ok && bulk.value.done).toBe(1);
    expect(bulk.ok && bulk.value.failed).toMatchObject([{ appointmentId: a10.id }]);
    expect((await db.appointment.findUniqueOrThrow({ where: { id: a10.id } })).professionalId).toBe(t.others[0].id);
    expect((await db.appointment.findUniqueOrThrow({ where: { id: a11.id } })).professionalId).toBe(t.owner.id);
    // Con uno sin resolver, sigue sin poder desactivarse.
    expect(await deactivateProfessional(await t.org(), t.others[0].id)).toMatchObject({ ok: false, code: "has_future_appointments" });
  });

  it("cancelar los turnos es una decisión explícita: se cancelan con aviso y quedan en el historial", async () => {
    const t = await team();
    const appointment = await book(t, t.others[0].id, 10, "cliente@example.com");
    const bulk = await resolveFutureAppointments(await t.org(), t.others[0].id, { kind: "cancel" }, t.shop.userId);
    expect(bulk).toMatchObject({ ok: true, value: { done: 1, failed: [] } });
    expect(await db.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).toMatchObject({ status: "canceled", canceledBy: "professional" });
    expect((await db.notification.findMany({ where: { appointmentId: appointment.id } })).map((n) => n.type)).toContain("cancellation");
    expect((await deactivateProfessional(await t.org(), t.others[0].id)).ok).toBe(true);
  });

  it("no resuelve turnos de un profesional ajeno ni pasa turnos a uno de otro negocio", async () => {
    const t = await team();
    const stranger = await team();
    const appointment = await book(t, t.others[0].id, 10);
    expect(await resolveFutureAppointments(await stranger.org(), t.others[0].id, { kind: "cancel" })).toMatchObject({ ok: false, code: "not_found" });
    const bulk = await resolveFutureAppointments(await t.org(), t.others[0].id, { kind: "reassign", toProfessionalId: stranger.owner.id });
    expect(bulk.ok && bulk.value.done).toBe(0);
    expect((await db.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).professionalId).toBe(t.others[0].id);
  });
});

describe("fotos de profesionales", () => {
  it("guarda una foto cuadrada optimizada, la reemplaza sin dejar huérfanas y se puede quitar", async () => {
    const t = await team();
    const first = await saveProfessionalPhoto(t.shop.organization.id, t.others[0].id, await png(900));
    expect(first.ok).toBe(true);
    const stored = await db.organizationImage.findUniqueOrThrow({ where: { id: first.ok ? first.id : "" } });
    expect(stored).toMatchObject({ kind: "professional", contentType: "image/webp", width: 512, height: 512 });

    const second = await saveProfessionalPhoto(t.shop.organization.id, t.others[0].id, await png(300));
    expect(second.ok).toBe(true);
    expect(await db.organizationImage.count({ where: { organizationId: t.shop.organization.id, kind: "professional" } })).toBe(1);
    expect((await db.professional.findUniqueOrThrow({ where: { id: t.others[0].id } })).photoImageId).toBe(second.ok ? second.id : "");

    expect(await removeProfessionalPhoto(t.shop.organization.id, t.others[0].id)).toBe(true);
    expect(await db.organizationImage.count({ where: { organizationId: t.shop.organization.id, kind: "professional" } })).toBe(0);
    expect((await db.professional.findUniqueOrThrow({ where: { id: t.others[0].id } })).photoImageId).toBeNull();
  });

  it("cada profesional puede tener su foto, y el logo y la portada siguen siendo únicos", async () => {
    const t = await team();
    await saveProfessionalPhoto(t.shop.organization.id, t.owner.id, await png());
    await saveProfessionalPhoto(t.shop.organization.id, t.others[0].id, await png());
    expect(await db.organizationImage.count({ where: { organizationId: t.shop.organization.id, kind: "professional" } })).toBe(2);

    const data = { organizationId: t.shop.organization.id, kind: "logo" as const, contentType: "image/webp", width: 1, height: 1, bytes: new Uint8Array([1]) };
    await db.organizationImage.create({ data });
    await expect(db.organizationImage.create({ data })).rejects.toThrow();
  });

  it("valida el contenido: rechaza formatos no admitidos, archivos falsos, imágenes chicas y profesionales ajenos", async () => {
    const t = await team();
    const stranger = await team();
    const id = t.others[0].id;
    expect(await saveProfessionalPhoto(t.shop.organization.id, id, new Uint8Array())).toMatchObject({ ok: false });
    expect(await saveProfessionalPhoto(t.shop.organization.id, id, new TextEncoder().encode("<svg onload=alert(1)></svg>"))).toMatchObject({ ok: false, message: expect.stringContaining("Formato") });
    // Cabecera de PNG con contenido que no lo es.
    const fake = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    expect(await saveProfessionalPhoto(t.shop.organization.id, id, fake)).toMatchObject({ ok: false });
    expect(await saveProfessionalPhoto(t.shop.organization.id, id, await png(50))).toMatchObject({ ok: false, message: expect.stringContaining("muy chica") });
    expect(await saveProfessionalPhoto(t.shop.organization.id, id, new Uint8Array(9 * 1024 * 1024))).toMatchObject({ ok: false });
    // Un profesional de otro negocio no recibe la foto.
    expect(await saveProfessionalPhoto(t.shop.organization.id, stranger.owner.id, await png())).toMatchObject({ ok: false });
    expect(await removeProfessionalPhoto(t.shop.organization.id, stranger.owner.id)).toBe(false);
    expect(await db.organizationImage.count({ where: { organizationId: { in: [t.shop.organization.id, stranger.shop.organization.id] }, kind: "professional" } })).toBe(0);
  });
});

describe("panorama del equipo", () => {
  it("cuenta turnos futuros, horarios y servicios por profesional, incluidos los desactivados", async () => {
    const t = await team(["Lucas", "Martín", "Diego"]);
    await book(t, t.others[0].id, 10);
    await db.professional.update({ where: { id: t.others[1].id }, data: { active: false } });
    const { members, quota } = await getTeamOverview(await t.org());
    expect(members.map((m) => [m.displayName, m.active, m.futureAppointments])).toEqual([
      ["Lucas", true, 0],
      ["Martín", true, 1],
      ["Diego", false, 0],
    ]);
    expect(members.every((m) => m.serviceCount === 1 && m.hoursRules === 7)).toBe(true);
    expect(quota.active).toBe(2);
  });
});
