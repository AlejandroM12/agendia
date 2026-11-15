import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Organization, Professional } from "@prisma/client";
import { db } from "@/lib/db";
import { addDays, todayInTz, zonedTimeToUtc } from "@/lib/time";
import { createAppointment, rescheduleAppointment } from "@/modules/appointments/service";
import { getProfessionalQuota, setProfessionalActive, createProfessional } from "@/modules/team/professionals";
import { listPublicTeam, resolveEligibleProfessionals } from "@/modules/team/eligibility";
import {
  getCapacityState,
  rankProfessionalsForCapacity,
  rescheduleCap,
  restrictedProfessionalIds,
  setKeepSelection,
  syncCapacityGrace,
} from "@/modules/team/capacity";
import { ensurePlan } from "@/modules/billing/catalog";
import { addProfessional, createSchedulableOrganization, enableTeam, ownerProfessional, refreshOrganization, uniqueSuffix } from "./helpers";

/**
 * Exceso de cupo tras bajar de plan: período de adaptación, restricción de reservas NUEVAS,
 * criterio determinista, conservación de datos y turnos, y recuperación al recontratar.
 * Contra PostgreSQL real.
 */

type Shop = Awaited<ReturnType<typeof createSchedulableOrganization>>;
let shop: Shop;
let organization: Organization;
let owner: Professional;
let others: Professional[];

const DAY = 86400000;
const at = (offsetDays: number, minutes = 600) => zonedTimeToUtc(addDays(todayInTz("America/Argentina/Buenos_Aires"), offsetDays), minutes, organization.timezone);
let n = 0;
const guest = () => ({ name: `Cliente ${++n}`, email: `c${n}-${uniqueSuffix()}@example.com`, phone: null });

/** Negocio ya en Plan Profesional pagado, con 4 profesionales activos (2 de exceso). */
beforeEach(async () => {
  shop = await createSchedulableOrganization();
  const plan = await ensurePlan("profesional");
  await db.organization.update({ where: { id: shop.organization.id }, data: { status: "active" } });
  await db.subscription.create({
    data: { organizationId: shop.organization.id, planId: plan.id, status: "active", lastPaymentAt: new Date(), currentPeriodEnd: new Date(Date.now() + 25 * DAY) },
  });
  await enableTeam(shop.organization.id);
  owner = await ownerProfessional(shop.organization.id);
  others = [];
  for (const name of ["Bea", "Caro", "Dani"]) others.push(await addProfessional(shop.organization.id, { displayName: name }));
  organization = await refreshOrganization(shop.organization.id);
});

afterEach(async () => {
  await db.subscription.deleteMany({ where: { organizationId: shop.organization.id } });
  await db.auditLog.deleteMany({ where: { organizationId: shop.organization.id } });
  await shop.cleanup();
});

const startGrace = async (endsInDays: number) => {
  await db.organization.update({
    where: { id: shop.organization.id },
    data: { capacityGraceStartedAt: new Date(Date.now() - 7 * DAY), capacityGraceEndsAt: new Date(Date.now() + endsInDays * DAY) },
  });
  organization = await refreshOrganization(shop.organization.id);
};

const bookWith = (professional: string, when: Date) =>
  createAppointment({ organization, serviceId: shop.service.id, startsAt: when, customer: guest(), actor: "customer", professional });

describe("período de adaptación", () => {
  it("empieza al detectar el exceso, dura 7 días y no toca a nadie", async () => {
    expect(await syncCapacityGrace(shop.organization.id)).toBe("started");
    const after = await refreshOrganization(shop.organization.id);
    expect((after.capacityGraceEndsAt!.getTime() - after.capacityGraceStartedAt!.getTime()) / DAY).toBeCloseTo(7, 5);
    expect(await db.professional.count({ where: { organizationId: shop.organization.id, active: true } })).toBe(4);
    expect(await syncCapacityGrace(shop.organization.id)).toBe("running"); // idempotente
    expect(await db.auditLog.count({ where: { organizationId: shop.organization.id, action: "capacity.grace_started" } })).toBe(1);
  });

  it("se puede configurar la duración", async () => {
    process.env.CAPACITY_GRACE_DAYS = "3";
    try {
      await syncCapacityGrace(shop.organization.id);
      const after = await refreshOrganization(shop.organization.id);
      expect((after.capacityGraceEndsAt!.getTime() - after.capacityGraceStartedAt!.getTime()) / DAY).toBeCloseTo(3, 5);
    } finally {
      delete process.env.CAPACITY_GRACE_DAYS;
    }
  });

  it("mientras dura no se restringe nada, pero no se puede agregar ni reactivar", async () => {
    await startGrace(3);
    expect((await restrictedProfessionalIds(db, shop.organization.id)).size).toBe(0);
    expect((await listPublicTeam(db, organization)).professionals).toHaveLength(4);
    expect(await createProfessional(organization, { displayName: "Otro" })).toMatchObject({ ok: false, code: "quota_exceeded" });
    await db.professional.update({ where: { id: others[2].id }, data: { active: false } });
    expect(await setProfessionalActive(organization, others[2].id, true)).toMatchObject({ ok: false, code: "quota_exceeded" });
  });

  it("si el exceso desaparece (se desactivan profesionales) el período se cierra", async () => {
    await syncCapacityGrace(shop.organization.id);
    await db.professional.updateMany({ where: { id: { in: [others[1].id, others[2].id] } }, data: { active: false } });
    expect(await syncCapacityGrace(shop.organization.id)).toBe("recovered");
    expect((await refreshOrganization(shop.organization.id)).capacityGraceEndsAt).toBeNull();
  });
});

describe("restricción de reservas nuevas", () => {
  it("terminado el período, los excedentes no reciben reservas nuevas (ni públicas ni internas) y los demás sí", async () => {
    await startGrace(-1);
    const state = (await getCapacityState(db, shop.organization.id))!;
    expect(state).toMatchObject({ limit: 2, active: 4, excess: 2, restricting: true });
    expect(state.restrictedIds).toHaveLength(2);
    const restricted = state.restrictedIds[0];
    const kept = state.keepIds[0];

    const team = await listPublicTeam(db, organization);
    expect(team.professionals.map((p) => p.id).sort()).toEqual([...state.keepIds].sort());

    for (const audience of ["public", "internal"] as const) {
      const eligible = await resolveEligibleProfessionals(db, { organization, serviceId: shop.service.id, audience, choice: restricted });
      expect(eligible).toMatchObject({ ok: false, reason: "professional_unavailable" });
    }
    expect((await bookWith(restricted, at(3))).ok).toBe(false);
    expect((await bookWith(kept, at(3))).ok).toBe(true);
    // «Cualquiera» nunca asigna a un restringido.
    const any = await bookWith("any", at(4));
    expect(any.ok && state.keepIds.includes(any.appointment.professionalId)).toBe(true);
  });

  it("nada se borra ni se cancela: perfiles, membresías y turnos confirmados quedan intactos", async () => {
    // Turnos confirmados antes de la restricción, con todos los profesionales.
    const booked = [];
    for (const [i, p] of [owner, ...others].entries()) {
      const r = await bookWith(p.id, at(5 + i));
      expect(r.ok).toBe(true);
      booked.push(r.ok ? r.appointment.id : "");
    }
    await startGrace(-1);
    expect(await db.professional.count({ where: { organizationId: shop.organization.id } })).toBe(4);
    expect(await db.professional.count({ where: { organizationId: shop.organization.id, active: true } })).toBe(4);
    expect(await db.appointment.count({ where: { id: { in: booked }, status: "confirmed" } })).toBe(4);
    expect(await db.membership.count({ where: { organizationId: shop.organization.id } })).toBe(1);
  });

  it("el propietario elige quiénes siguen: su selección manda sobre el criterio automático", async () => {
    await startGrace(-1);
    expect(await setKeepSelection(shop.organization.id, [others[1].id, others[2].id])).toEqual({ ok: true });
    const state = (await getCapacityState(db, shop.organization.id))!;
    expect([...state.keepIds].sort()).toEqual([others[1].id, others[2].id].sort());
    expect((await bookWith(others[1].id, at(3))).ok).toBe(true);
    expect((await bookWith(owner.id, at(3))).ok).toBe(false);
  });

  it("no acepta elegir más que el cupo ni profesionales de otro negocio", async () => {
    expect(await setKeepSelection(shop.organization.id, [owner.id, others[0].id, others[1].id])).toMatchObject({ ok: false });
    const foreign = await createSchedulableOrganization();
    try {
      const alien = await ownerProfessional(foreign.organization.id);
      expect(await setKeepSelection(shop.organization.id, [alien.id])).toMatchObject({ ok: false });
    } finally {
      await foreign.cleanup();
    }
  });

  it("sin elección usa un criterio fijo: quien está vinculado al propietario, luego más turnos futuros, luego el orden del equipo", async () => {
    await db.professional.update({ where: { id: owner.id }, data: { userId: shop.userId } });
    expect((await bookWith(others[2].id, at(3))).ok).toBe(true);
    expect((await bookWith(others[2].id, at(4))).ok).toBe(true);
    expect((await bookWith(others[1].id, at(3))).ok).toBe(true);
    const ranking = (await rankProfessionalsForCapacity(db, shop.organization.id)).map((p) => p.displayName);
    // Propietario primero; después Dani (2 turnos), Caro (1), Bea (0).
    expect(ranking).toEqual([owner.displayName, "Dani", "Caro", "Bea"]);
    // Determinista: repetirlo da lo mismo.
    expect((await rankProfessionalsForCapacity(db, shop.organization.id)).map((p) => p.displayName)).toEqual(ranking);
  });

  it("recontratar el Plan Equipo (pago verificado) devuelve el cupo completo", async () => {
    await startGrace(-1);
    const team = await ensurePlan("equipo");
    await db.subscription.update({ where: { organizationId: shop.organization.id }, data: { planId: team.id } });
    expect((await getProfessionalQuota(db, organization)).limit).toBe(5);
    expect((await restrictedProfessionalIds(db, shop.organization.id)).size).toBe(0);
    expect(await syncCapacityGrace(shop.organization.id)).toBe("recovered");
    expect((await listPublicTeam(db, organization)).professionals).toHaveLength(4);
  });
});

describe("reprogramar sin eludir el límite", () => {
  it("un excedente puede reprogramar sus turnos ya confirmados, pero no más allá del horizonte", async () => {
    const booked = await bookWith(others[2].id, at(3));
    expect(booked.ok).toBe(true);
    const appointment = booked.ok ? booked.appointment : (null as never);
    await startGrace(-1);
    await setKeepSelection(shop.organization.id, [owner.id, others[0].id]);
    expect((await restrictedProfessionalIds(db, shop.organization.id)).has(others[2].id)).toBe(true);

    const cap = (await rescheduleCap(db, shop.organization.id, appointment))!;
    expect(cap.getTime()).toBeGreaterThan(Date.now() + 25 * DAY);

    const near = await rescheduleAppointment({ organization, appointmentId: appointment.id, startsAt: at(6), actor: "professional" });
    expect(near.ok).toBe(true);
    const far = await rescheduleAppointment({ organization, appointmentId: appointment.id, startsAt: at(60), actor: "professional" });
    expect(far).toMatchObject({ ok: false });
    expect((await db.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).status).toBe("confirmed");
  });

  it("un profesional que sigue dentro del cupo no tiene tope", async () => {
    const booked = await bookWith(owner.id, at(3));
    await startGrace(-1);
    await setKeepSelection(shop.organization.id, [owner.id, others[0].id]);
    expect(await rescheduleCap(db, shop.organization.id, booked.ok ? booked.appointment : (null as never))).toBeNull();
  });
});
