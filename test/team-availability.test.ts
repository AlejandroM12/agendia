import { describe, it, expect, afterAll, beforeAll } from "vitest";
import type { Organization, Professional } from "@prisma/client";
import { db } from "@/lib/db";
import { addDays, dateStrToDbDate, todayInTz, zonedTimeToUtc } from "@/lib/time";
import { getTeamAvailability, unionSlots } from "@/modules/availability/queries";
import { createAppointment } from "@/modules/appointments/service";
import { resolveEligibleProfessionals } from "@/modules/team/eligibility";
import { addProfessional, createSchedulableOrganization, enableTeam, ownerProfessional, refreshOrganization } from "./helpers";

/**
 * Disponibilidad por profesional contra PostgreSQL real. Barbería de ejemplo:
 * Lucas (cortes y barba), Martín (cortes, barba y coloración) y Diego (solo cortes).
 */

type Tenant = Awaited<ReturnType<typeof createSchedulableOrganization>>;

let shop: Tenant;
let organization: Organization;
let lucas: Professional;
let martin: Professional;
let diego: Professional;
let corte: { id: string };
let coloracion: { id: string };
let day: string;

const at = (minutes: number, dateStr = day) => zonedTimeToUtc(dateStr, minutes, organization.timezone);
const hhmm = (h: number, m = 0) => h * 60 + m;

async function slotsOf(professionalIds: string[], serviceMinutes = 30, from = day, days = 1) {
  return getTeamAvailability({ organization, professionalIds, durationMinutes: serviceMinutes, fromDateStr: from, days });
}
const startsOf = (result: Awaited<ReturnType<typeof slotsOf>>) => result[0].slots.map((s) => s.start.getTime());

async function book(professional: string | "any", serviceId: string, startsAt: Date, who: number, actor: "customer" | "professional" = "customer") {
  return createAppointment({
    organization,
    serviceId,
    startsAt,
    customer: { name: `Cliente ${who}`, email: `cliente${who}-${Date.now()}@example.com`, phone: null },
    actor,
    professional,
  });
}

beforeAll(async () => {
  shop = await createSchedulableOrganization();
  // El dueño solo administra: su profesional se desactiva (no atiende, no ocupa cupo).
  await enableTeam(shop.organization.id, { extraProfessionals: 2 });
  await db.professional.update({ where: { id: (await ownerProfessional(shop.organization.id)).id }, data: { active: false } });
  // Atienden hasta las 20:00 (la barbería abre a la tarde-noche).
  const hours: Array<[number, number]> = [[hhmm(9), hhmm(20)]];
  lucas = await addProfessional(shop.organization.id, { displayName: "Lucas", hours });
  martin = await addProfessional(shop.organization.id, { displayName: "Martín", hours });
  diego = await addProfessional(shop.organization.id, { displayName: "Diego", hours });
  organization = await refreshOrganization(shop.organization.id);

  corte = shop.service; // «Consulta», 30 min: hace de «Corte»
  await db.service.update({ where: { id: corte.id }, data: { name: "Corte" } });
  coloracion = await db.service.create({
    data: { organizationId: organization.id, name: "Coloración", durationMinutes: 60, price: 5000, allProfessionals: false },
  });
  await db.serviceProfessional.create({ data: { organizationId: organization.id, serviceId: coloracion.id, professionalId: martin.id } });

  day = addDays(todayInTz(organization.timezone), 3);
});

afterAll(async () => {
  await shop.cleanup();
});

describe("turnos simultáneos entre profesionales", () => {
  it("a las 18:00 uno ocupado y los otros dos disponibles: cada cliente puede elegir al suyo", async () => {
    // Martín tiene un turno a las 18:00.
    const taken = await book(martin.id, corte.id, at(hhmm(18)), 1, "professional");
    expect(taken.ok).toBe(true);

    const [evening] = await slotsOf([lucas.id, martin.id, diego.id]);
    const peak = evening.slots.find((s) => s.start.getTime() === at(hhmm(18)).getTime())!;
    expect(peak.professionalIds).toEqual([lucas.id, diego.id]); // Martín no está

    const withLucas = await book(lucas.id, corte.id, at(hhmm(18)), 2);
    const withDiego = await book(diego.id, corte.id, at(hhmm(18)), 3);
    expect(withLucas.ok && withDiego.ok).toBe(true);
    expect(withLucas.ok && withLucas.appointment.professionalId).toBe(lucas.id);
    expect(withDiego.ok && withDiego.appointment.professionalId).toBe(diego.id);

    // Tres turnos a la misma hora, con tres profesionales distintos.
    const simultaneous = await db.appointment.findMany({ where: { organizationId: organization.id, startsAt: at(hhmm(18)) } });
    expect(simultaneous).toHaveLength(3);
    expect(new Set(simultaneous.map((a) => a.professionalId)).size).toBe(3);

    // Y ya no queda nadie libre a esa hora: el horario deja de ofrecerse.
    const [after] = await slotsOf([lucas.id, martin.id, diego.id]);
    expect(after.slots.some((s) => s.start.getTime() === at(hhmm(18)).getTime())).toBe(false);
  });

  it("el mismo profesional no puede tener turnos superpuestos, ni siquiera parcialmente", async () => {
    const first = await book(lucas.id, corte.id, at(hhmm(10)), 10);
    expect(first.ok).toBe(true);
    const sameSlot = await book(lucas.id, corte.id, at(hhmm(10)), 11);
    const partial = await book(lucas.id, corte.id, at(hhmm(10, 15)), 12, "professional");
    expect(sameSlot).toMatchObject({ ok: false });
    expect(partial).toMatchObject({ ok: false, code: "slot_taken" });
  });

  it("un profesional ocupado no elimina la disponibilidad de otro", async () => {
    const [afterLucas] = await slotsOf([lucas.id]);
    const [afterDiego] = await slotsOf([diego.id]);
    const ten = at(hhmm(10)).getTime();
    expect(afterLucas.slots.some((s) => s.start.getTime() === ten)).toBe(false); // Lucas ocupado a las 10:00
    expect(afterDiego.slots.some((s) => s.start.getTime() === ten)).toBe(true); // Diego sigue libre
  });
});

describe("selección de profesional y «cualquiera»", () => {
  it("un profesional específico devuelve únicamente sus horarios", async () => {
    const own = await db.professional.create({
      data: { organizationId: organization.id, displayName: "Solo mañanas", sortOrder: 9 },
    });
    await db.availabilityRule.createMany({
      data: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        organizationId: organization.id, professionalId: own.id, weekday, startMinute: hhmm(8), endMinute: hhmm(9),
      })),
    });
    const [result] = await slotsOf([own.id]);
    expect(result.slots.map((s) => s.start.getTime())).toEqual([at(hhmm(8)).getTime(), at(hhmm(8, 30)).getTime()]);
    expect(result.slots.every((s) => s.professionalIds.length === 1 && s.professionalIds[0] === own.id)).toBe(true);
    await db.availabilityRule.deleteMany({ where: { professionalId: own.id } });
    await db.professional.delete({ where: { id: own.id } });
  });

  it("«cualquiera» devuelve la unión de horarios, cada uno una sola vez, con quién está libre", async () => {
    const [result] = await slotsOf([lucas.id, martin.id, diego.id]);
    const times = result.slots.map((s) => s.start.getTime());
    expect(new Set(times).size).toBe(times.length); // sin duplicados
    expect([...times].sort((a, b) => a - b)).toEqual(times); // ordenados

    // Lucas ocupado a las 10:00: ese horario se ofrece, con Martín y Diego.
    const ten = result.slots.find((s) => s.start.getTime() === at(hhmm(10)).getTime())!;
    expect(ten.professionalIds).toEqual([martin.id, diego.id]);
    // Cada profesional aparece solo en horarios que realmente tiene libres.
    const lucasOnly = await slotsOf([lucas.id]);
    for (const slot of result.slots) {
      expect(slot.professionalIds.includes(lucas.id)).toBe(startsOf(lucasOnly).includes(slot.start.getTime()));
    }
    // La unión se puede aplanar para mostrar en la página pública.
    expect(unionSlots([result])[0].slots).toHaveLength(times.length);
  });

  it("un servicio restringido solo ofrece a los profesionales elegibles", async () => {
    const eligible = await resolveEligibleProfessionals(db, { organization, serviceId: coloracion.id, audience: "public", choice: "any" });
    expect(eligible.ok && eligible.professionals.map((p) => p.id)).toEqual([martin.id]);

    const forLucas = await resolveEligibleProfessionals(db, { organization, serviceId: coloracion.id, audience: "public", choice: lucas.id });
    expect(forLucas).toEqual({ ok: false, reason: "professional_unavailable" });

    const forCorte = await resolveEligibleProfessionals(db, { organization, serviceId: corte.id, audience: "public", choice: "any" });
    expect(forCorte.ok && forCorte.professionals.map((p) => p.id)).toEqual([lucas.id, martin.id, diego.id]);

    // Reservar coloración con otro profesional se rechaza en el servidor.
    const denied = await book(lucas.id, coloracion.id, at(hhmm(15)), 20);
    expect(denied).toMatchObject({ ok: false, code: "unavailable" });
    const allowed = await book("any", coloracion.id, at(hhmm(15)), 21);
    expect(allowed.ok && allowed.appointment.professionalId).toBe(martin.id);
  });

  it("los profesionales inactivos no están disponibles", async () => {
    const ghost = await addProfessional(organization.id, { displayName: "Inactivo", active: false });
    const pool = await resolveEligibleProfessionals(db, { organization, serviceId: corte.id, audience: "internal", choice: "any" });
    expect(pool.ok && pool.professionals.some((p) => p.id === ghost.id)).toBe(false);
    const direct = await resolveEligibleProfessionals(db, { organization, serviceId: corte.id, audience: "internal", choice: ghost.id });
    expect(direct).toEqual({ ok: false, reason: "professional_unavailable" });
    // Y el dueño desactivado tampoco atiende.
    const owner = await ownerProfessional(organization.id);
    expect(pool.ok && pool.professionals.some((p) => p.id === owner.id)).toBe(false);
  });

  it("los deshabilitados para reservas online no aparecen en el flujo público, pero sí en la agenda interna", async () => {
    const hidden = await addProfessional(organization.id, { displayName: "Solo agenda", bookableOnline: false });
    const publicPool = await resolveEligibleProfessionals(db, { organization, serviceId: corte.id, audience: "public", choice: "any" });
    const internalPool = await resolveEligibleProfessionals(db, { organization, serviceId: corte.id, audience: "internal", choice: "any" });
    expect(publicPool.ok && publicPool.professionals.some((p) => p.id === hidden.id)).toBe(false);
    expect(internalPool.ok && internalPool.professionals.some((p) => p.id === hidden.id)).toBe(true);
    const publicBooking = await book(hidden.id, corte.id, at(hhmm(11)), 30);
    expect(publicBooking).toMatchObject({ ok: false, code: "unavailable" });
    const internalBooking = await book(hidden.id, corte.id, at(hhmm(11)), 31, "professional");
    expect(internalBooking.ok).toBe(true);
  });

  it("sin elegir profesional: la reserva pública es «cualquiera»; la agenda interna debe elegir", async () => {
    const publicDefault = await resolveEligibleProfessionals(db, { organization, serviceId: corte.id, audience: "public" });
    expect(publicDefault).toMatchObject({ ok: true, selection: "any" });
    const internalDefault = await resolveEligibleProfessionals(db, { organization, serviceId: corte.id, audience: "internal" });
    expect(internalDefault).toEqual({ ok: false, reason: "choice_required" });
  });
});

describe("bloqueos, duraciones y reglas de reserva", () => {
  it("un bloqueo individual afecta solo a ese profesional; uno general, a todos", async () => {
    const date = addDays(day, 5);
    const individual = await db.availabilityException.create({
      data: { organizationId: organization.id, professionalId: diego.id, date: dateStrToDbDate(date), startMinute: null, endMinute: null, reason: "Vacaciones" },
    });
    const ids = [lucas.id, martin.id, diego.id];
    const [withBlock] = await getTeamAvailability({ organization, professionalIds: ids, durationMinutes: 30, fromDateStr: date, days: 1 });
    expect(withBlock.slots.every((s) => !s.professionalIds.includes(diego.id))).toBe(true);
    expect(withBlock.slots.some((s) => s.professionalIds.includes(lucas.id))).toBe(true);
    expect(withBlock.slots.some((s) => s.professionalIds.includes(martin.id))).toBe(true);

    await db.availabilityException.delete({ where: { id: individual.id } });
    const general = await db.availabilityException.create({
      data: { organizationId: organization.id, professionalId: null, date: dateStrToDbDate(date), startMinute: hhmm(12), endMinute: hhmm(14), reason: "Feriado" },
    });
    const [withGeneral] = await getTeamAvailability({ organization, professionalIds: ids, durationMinutes: 30, fromDateStr: date, days: 1 });
    const noon = withGeneral.slots.filter((s) => s.start >= at(hhmm(12), date) && s.start < at(hhmm(14), date));
    expect(noon).toHaveLength(0); // nadie atiende en el bloqueo general
    expect(withGeneral.slots.some((s) => s.start.getTime() === at(hhmm(11, 30), date).getTime())).toBe(true);
    await db.availabilityException.delete({ where: { id: general.id } });
  });

  it("respeta duración, descanso entre turnos, anticipación mínima, horizonte y zona horaria", async () => {
    const date = addDays(day, 2);
    // Duración: un servicio de 60 minutos no ofrece el último tramo de 30 (se atiende hasta las 20:00).
    const [sixty] = await getTeamAvailability({ organization, professionalIds: [lucas.id], durationMinutes: 60, fromDateStr: date, days: 1 });
    expect(sixty.slots.at(-1)!.start.getTime()).toBe(at(hhmm(19), date).getTime());

    // Zona horaria: 09:00 de Buenos Aires = 12:00 UTC.
    expect(sixty.slots[0].start.toISOString().slice(11, 16)).toBe("12:00");

    // Descanso entre turnos: con 15 min, un turno de 10:00–10:30 bloquea hasta las 10:45 SOLO a ese profesional.
    await db.organization.update({ where: { id: organization.id }, data: { bufferMinutes: 15 } });
    const buffered = await refreshOrganization(organization.id);
    const first = await createAppointment({
      organization: buffered, serviceId: corte.id, startsAt: at(hhmm(14), date),
      customer: { name: "Con descanso", email: null, phone: "1155550000" }, actor: "professional", professional: lucas.id,
    });
    expect(first.ok).toBe(true);
    const [lucasDay] = await getTeamAvailability({ organization: buffered, professionalIds: [lucas.id], durationMinutes: 30, fromDateStr: date, days: 1 });
    const [diegoDay] = await getTeamAvailability({ organization: buffered, professionalIds: [diego.id], durationMinutes: 30, fromDateStr: date, days: 1 });
    const lucasTimes = lucasDay.slots.map((s) => s.start.getTime());
    expect(lucasTimes).not.toContain(at(hhmm(14, 30), date).getTime()); // dentro del descanso
    expect(lucasTimes).toContain(at(hhmm(15), date).getTime());
    expect(diegoDay.slots.map((s) => s.start.getTime())).toContain(at(hhmm(14, 30), date).getTime());
    await db.organization.update({ where: { id: organization.id }, data: { bufferMinutes: 0 } });

    // Anticipación mínima y horizonte máximo.
    const strict = { ...organization, minNoticeMinutes: 60 * 24 * 10, maxAdvanceDays: 60 };
    const [tooSoon] = await getTeamAvailability({ organization: strict, professionalIds: [lucas.id], durationMinutes: 30, fromDateStr: day, days: 1 });
    expect(tooSoon.slots).toHaveLength(0);
    const far = addDays(todayInTz(organization.timezone), 61);
    const [tooFar] = await getTeamAvailability({ organization, professionalIds: [lucas.id], durationMinutes: 30, fromDateStr: far, days: 1 });
    expect(tooFar.slots).toHaveLength(0);
  });
});

describe("modo equipo apagado y aislamiento entre organizaciones", () => {
  it("con el modo equipo apagado solo se considera al profesional de siempre, aunque haya más", async () => {
    const solo = await createSchedulableOrganization();
    try {
      await addProfessional(solo.organization.id, { displayName: "Extra (no debería contar)" });
      const org = await refreshOrganization(solo.organization.id);
      expect(org.teamModeEnabled).toBe(false);
      const primary = await ownerProfessional(org.id);
      const pool = await resolveEligibleProfessionals(db, { organization: org, serviceId: solo.service.id, audience: "public", choice: "any" });
      expect(pool.ok && pool.professionals.map((p) => p.id)).toEqual([primary.id]);
      const other = await db.professional.findFirstOrThrow({ where: { organizationId: org.id, displayName: { startsWith: "Extra" } } });
      const chosen = await resolveEligibleProfessionals(db, { organization: org, serviceId: solo.service.id, audience: "public", choice: other.id });
      expect(chosen).toEqual({ ok: false, reason: "professional_unavailable" });
    } finally {
      await solo.cleanup();
    }
  });

  it("no se puede consultar la disponibilidad ni reservar con un profesional de otra organización", async () => {
    const stranger = await createSchedulableOrganization();
    try {
      const strangerPro = await ownerProfessional(stranger.organization.id);
      // Consultar disponibilidad de MI negocio con el profesional ajeno: no trae nada (las consultas están acotadas por organización).
      const [none] = await getTeamAvailability({ organization, professionalIds: [strangerPro.id], durationMinutes: 30, fromDateStr: day, days: 1 });
      expect(none.slots).toHaveLength(0);
      // Elegirlo como profesional de mi negocio se rechaza.
      const choice = await resolveEligibleProfessionals(db, { organization, serviceId: corte.id, audience: "public", choice: strangerPro.id });
      expect(choice).toEqual({ ok: false, reason: "professional_unavailable" });
      const booking = await book(strangerPro.id, corte.id, at(hhmm(16)), 40);
      expect(booking).toMatchObject({ ok: false, code: "unavailable" });
      // Un servicio de otra organización tampoco existe para mi negocio.
      const foreignService = await resolveEligibleProfessionals(db, { organization, serviceId: stranger.service.id, audience: "public", choice: "any" });
      expect(foreignService).toEqual({ ok: false, reason: "service_not_found" });
      expect(await db.appointment.count({ where: { professionalId: strangerPro.id } })).toBe(0);
    } finally {
      await stranger.cleanup();
    }
  });
});
