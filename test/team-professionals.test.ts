import { describe, it, expect, afterAll, afterEach, vi } from "vitest";
import type { Organization } from "@prisma/client";
import { db } from "@/lib/db";
import { addDays, dateStrToDbDate, todayInTz, zonedTimeToUtc } from "@/lib/time";
import { createAppointment, cancelAppointment } from "@/modules/appointments/service";
import {
  createAvailabilityException,
  createProfessional,
  getProfessionalQuota,
  saveProfessionalHours,
  setProfessionalActive,
  setServiceProfessionals,
} from "@/modules/team/professionals";
import { addProfessional, createSchedulableOrganization, ownerProfessional, refreshOrganization } from "./helpers";

type Tenant = Awaited<ReturnType<typeof createSchedulableOrganization>>;

const created: Tenant[] = [];
const plansToDelete: string[] = [];

/** Negocio nuevo con el modo equipo encendido y el estado comercial indicado. */
async function teamShop(options: { status?: Organization["status"]; planCode?: string; extra?: number; teamMode?: boolean } = {}) {
  const shop = await createSchedulableOrganization();
  created.push(shop);
  await db.organization.update({
    where: { id: shop.organization.id },
    data: { status: options.status ?? "trial", teamModeEnabled: options.teamMode ?? true, extraProfessionals: options.extra ?? 0 },
  });
  if (options.planCode) {
    let plan = await db.plan.findUnique({ where: { code: options.planCode } });
    if (!plan) {
      plan = await db.plan.create({ data: { code: options.planCode, name: `Plan ${options.planCode} (prueba)`, price: 1 } });
      plansToDelete.push(plan.id);
    }
    await db.subscription.create({ data: { organizationId: shop.organization.id, planId: plan.id, status: "active" } });
  }
  return { shop, org: () => refreshOrganization(shop.organization.id) };
}

afterAll(async () => {
  for (const shop of created) await db.subscription.deleteMany({ where: { organizationId: shop.organization.id } });
  for (const shop of created) await shop.cleanup();
  await db.plan.deleteMany({ where: { id: { in: plansToDelete } } });
});

afterEach(() => vi.unstubAllEnvs());

describe("cupos por plan", () => {
  it("la prueba gratuita admite hasta 2 profesionales activos", async () => {
    const { shop, org } = await teamShop({ status: "trial" });
    // El dueño ya es el profesional 1; se suma el 2 y el 3 se rechaza.
    expect((await createProfessional(await org(), { displayName: "Segundo" })).ok).toBe(true);
    const third = await createProfessional(await org(), { displayName: "Tercero" });
    expect(third).toMatchObject({ ok: false, code: "quota_exceeded" });
    expect(third.ok === false && third.quota).toMatchObject({ limit: 2, active: 2, available: 0, source: "trial" });
    expect(await db.professional.count({ where: { organizationId: shop.organization.id } })).toBe(2);
  });

  it("el Plan Profesional (código histórico «mensual») admite 2 y el Plan Equipo 5", async () => {
    const pro = await teamShop({ status: "active", planCode: "mensual" });
    expect((await getProfessionalQuota(db, await pro.org())).limit).toBe(2);

    const team = await teamShop({ status: "active", planCode: "equipo" });
    const quota = await getProfessionalQuota(db, await team.org());
    expect(quota).toMatchObject({ limit: 5, tier: "equipo", active: 1, available: 4 });
    for (const name of ["B", "C", "D", "E"]) expect((await createProfessional(await team.org(), { displayName: `Pro ${name}` })).ok).toBe(true);
    expect(await createProfessional(await team.org(), { displayName: "Sexto" })).toMatchObject({ ok: false, code: "quota_exceeded" });
  });

  it("una cuenta que administra pero no atiende no consume cupo; si el dueño atiende, sí", async () => {
    const { shop, org } = await teamShop({ status: "active", planCode: "mensual" });
    // El dueño atiende: su profesional ocupa 1 de 2.
    expect((await getProfessionalQuota(db, await org())).active).toBe(1);
    // El dueño pasa a administrar solamente: se desactiva su profesional y el cupo queda libre.
    const owner = await ownerProfessional(shop.organization.id);
    expect((await setProfessionalActive(await org(), owner.id, false)).ok).toBe(true);
    expect(await getProfessionalQuota(db, await org())).toMatchObject({ active: 0, available: 2 });
    // Dos profesionales + el administrador (que no cuenta): entran los dos.
    expect((await createProfessional(await org(), { displayName: "Uno" })).ok).toBe(true);
    expect((await createProfessional(await org(), { displayName: "Dos" })).ok).toBe(true);
    expect(await createProfessional(await org(), { displayName: "Tres" })).toMatchObject({ ok: false, code: "quota_exceeded" });
  });

  it("los profesionales desactivados no consumen cupo y reactivar respeta el límite", async () => {
    const { shop, org } = await teamShop({ status: "active", planCode: "mensual" });
    const second = await createProfessional(await org(), { displayName: "Segundo" });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect((await getProfessionalQuota(db, await org())).active).toBe(2);

    expect((await setProfessionalActive(await org(), second.value.id, false)).ok).toBe(true);
    expect(await getProfessionalQuota(db, await org())).toMatchObject({ active: 1, available: 1 });

    // Un tercero ocupa el cupo liberado; ahora reactivar al segundo supera el plan.
    expect((await createProfessional(await org(), { displayName: "Tercero" })).ok).toBe(true);
    const reactivation = await setProfessionalActive(await org(), second.value.id, true);
    expect(reactivation).toMatchObject({ ok: false, code: "quota_exceeded" });
    expect((await db.professional.findUniqueOrThrow({ where: { id: second.value.id } })).active).toBe(false);

    // Crear un profesional ya desactivado no usa cupo.
    expect((await createProfessional(await org(), { displayName: "Archivado", active: false })).ok).toBe(true);
    expect(await db.professional.count({ where: { organizationId: shop.organization.id } })).toBe(4);
  });

  it("los cupos adicionales (ampliaciones futuras) suman al plan", async () => {
    const { org } = await teamShop({ status: "active", planCode: "mensual", extra: 2 });
    expect((await getProfessionalQuota(db, await org())).limit).toBe(4);
  });

  it("operaciones simultáneas de alta no superan el límite", async () => {
    const { shop, org } = await teamShop({ status: "active", planCode: "mensual" }); // límite 2, ya hay 1
    const current = await org();
    const attempts = await Promise.all(Array.from({ length: 10 }, (_, i) => createProfessional(current, { displayName: `Concurrente ${i}` })));
    expect(attempts.filter((r) => r.ok)).toHaveLength(1);
    expect(attempts.filter((r) => !r.ok && r.code === "quota_exceeded")).toHaveLength(9);
    expect(await db.professional.count({ where: { organizationId: shop.organization.id, active: true } })).toBe(2);
  });

  it("reactivaciones simultáneas tampoco superan el límite", async () => {
    const { shop, org } = await teamShop({ status: "active", planCode: "mensual" });
    const archived = await Promise.all(Array.from({ length: 5 }, (_, i) => addProfessional(shop.organization.id, { displayName: `Archivado ${i}`, active: false })));
    const current = await org();
    const attempts = await Promise.all(archived.map((p) => setProfessionalActive(current, p.id, true)));
    expect(attempts.filter((r) => r.ok)).toHaveLength(1); // límite 2, ya había 1 activo
    expect(await db.professional.count({ where: { organizationId: shop.organization.id, active: true } })).toBe(2);
  });
});

describe("modo equipo apagado y cuentas sin permiso de escritura", () => {
  it("con el modo equipo apagado no se puede tener un segundo profesional", async () => {
    const { org } = await teamShop({ teamMode: false });
    expect(await createProfessional(await org(), { displayName: "Segundo" })).toMatchObject({ ok: false, code: "team_disabled" });
  });

  it("TEAM_MODE_ENABLED=1 lo enciende para toda la instalación", async () => {
    const { org } = await teamShop({ teamMode: false });
    vi.stubEnv("TEAM_MODE_ENABLED", "1");
    expect((await createProfessional(await org(), { displayName: "Segundo" })).ok).toBe(true);
  });

  it("una cuenta en solo lectura no puede crear, activar ni modificar nada del equipo", async () => {
    const { shop, org } = await teamShop();
    await db.organization.update({ where: { id: shop.organization.id }, data: { status: "trial_readonly", trialEndsAt: new Date(Date.now() - 86400000) } });
    const readonly = await org();
    expect(await createProfessional(readonly, { displayName: "X Y" })).toMatchObject({ ok: false, code: "read_only" });
    const owner = await ownerProfessional(shop.organization.id);
    expect(await setProfessionalActive(readonly, owner.id, false)).toMatchObject({ ok: false, code: "read_only" });
    expect(await saveProfessionalHours(readonly, owner.id, [])).toMatchObject({ ok: false, code: "read_only" });
  });

  it("valida el nombre y el color del profesional", async () => {
    const { org } = await teamShop({ extra: 3 });
    expect(await createProfessional(await org(), { displayName: " " })).toMatchObject({ ok: false, code: "invalid" });
    expect(await createProfessional(await org(), { displayName: "Ana", color: "red; background:url(x)" })).toMatchObject({ ok: false, code: "invalid" });
    const ok = await createProfessional(await org(), { displayName: "  Ana  ", color: "#ABC", description: "  Barbera  " });
    expect(ok.ok && ok.value).toMatchObject({ displayName: "Ana", color: "#aabbcc", description: "Barbera" });
  });
});

describe("desactivar profesionales", () => {
  it("no se puede desactivar con turnos futuros; resueltos, sí, y el historial se conserva", async () => {
    const { shop, org } = await teamShop({ extra: 1 });
    const second = await createProfessional(await org(), { displayName: "Segundo" });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const day = addDays(todayInTz(shop.organization.timezone), 3);
    await db.availabilityRule.createMany({
      data: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ organizationId: shop.organization.id, professionalId: second.value.id, weekday, startMinute: 540, endMinute: 1080 })),
    });
    const booked = await createAppointment({
      organization: await org(), serviceId: shop.service.id, startsAt: zonedTimeToUtc(day, 600, shop.organization.timezone),
      customer: { name: "Cliente", email: null, phone: "1155550000" }, actor: "professional", professional: second.value.id,
    });
    expect(booked.ok).toBe(true);
    if (!booked.ok) return;

    const blocked = await setProfessionalActive(await org(), second.value.id, false);
    expect(blocked).toMatchObject({ ok: false, code: "has_future_appointments", futureAppointments: 1 });
    expect((await db.professional.findUniqueOrThrow({ where: { id: second.value.id } })).active).toBe(true);

    await cancelAppointment({ organization: await org(), appointmentId: booked.appointment.id, actor: "professional" });
    expect((await setProfessionalActive(await org(), second.value.id, false)).ok).toBe(true);
    // El turno cancelado sigue en el historial, con su profesional.
    expect(await db.appointment.findUniqueOrThrow({ where: { id: booked.appointment.id } })).toMatchObject({ status: "canceled", professionalId: second.value.id });
    // Un profesional con historial no se puede borrar (la base lo impide).
    await expect(db.professional.delete({ where: { id: second.value.id } })).rejects.toThrow();
  });
});

describe("servicios, horarios y bloqueos: aislamiento entre organizaciones", () => {
  it("asigna servicios solo a profesionales de la misma organización", async () => {
    const mine = await teamShop({ extra: 2 });
    const theirs = await teamShop({ extra: 2 });
    const myPro = await ownerProfessional(mine.shop.organization.id);
    const theirPro = await ownerProfessional(theirs.shop.organization.id);

    const mixed = await setServiceProfessionals(await mine.org(), mine.shop.service.id, [myPro.id, theirPro.id]);
    expect(mixed).toMatchObject({ ok: false, code: "invalid" });
    const foreignService = await setServiceProfessionals(await mine.org(), theirs.shop.service.id, [myPro.id]);
    expect(foreignService).toMatchObject({ ok: false, code: "not_found" });
    expect(await db.serviceProfessional.count({ where: { OR: [{ serviceId: mine.shop.service.id }, { serviceId: theirs.shop.service.id }] } })).toBe(0);

    expect((await setServiceProfessionals(await mine.org(), mine.shop.service.id, [myPro.id])).ok).toBe(true);
    expect(await db.service.findUniqueOrThrow({ where: { id: mine.shop.service.id } })).toMatchObject({ allProfessionals: false });
    expect(await setServiceProfessionals(await mine.org(), mine.shop.service.id, [])).toMatchObject({ ok: false, code: "invalid" });
    expect((await setServiceProfessionals(await mine.org(), mine.shop.service.id, "all")).ok).toBe(true);
    expect(await db.serviceProfessional.count({ where: { serviceId: mine.shop.service.id } })).toBe(0);
    expect(await db.service.findUniqueOrThrow({ where: { id: mine.shop.service.id } })).toMatchObject({ allProfessionals: true });
  });

  it("guardar los horarios de un profesional no toca los de los demás; no se puede editar a uno ajeno", async () => {
    const mine = await teamShop({ extra: 2 });
    const theirs = await teamShop();
    const first = await ownerProfessional(mine.shop.organization.id);
    const second = await addProfessional(mine.shop.organization.id, { displayName: "Otro", hours: [[600, 700]] });
    const theirPro = await ownerProfessional(theirs.shop.organization.id);
    const theirRulesBefore = await db.availabilityRule.count({ where: { professionalId: theirPro.id } });

    const saved = await saveProfessionalHours(await mine.org(), first.id, [{ weekday: 1, startMinute: 480, endMinute: 720 }]);
    expect(saved).toMatchObject({ ok: true, value: { rules: 1 } });
    expect(await db.availabilityRule.count({ where: { professionalId: first.id } })).toBe(1);
    expect(await db.availabilityRule.count({ where: { professionalId: second.id } })).toBe(7); // intactos

    const foreign = await saveProfessionalHours(await mine.org(), theirPro.id, []);
    expect(foreign).toMatchObject({ ok: false, code: "not_found" });
    expect(await db.availabilityRule.count({ where: { professionalId: theirPro.id } })).toBe(theirRulesBefore);
  });

  it("los bloqueos individuales exigen un profesional propio; los generales no llevan profesional", async () => {
    const mine = await teamShop();
    const theirs = await teamShop();
    const theirPro = await ownerProfessional(theirs.shop.organization.id);
    const date = dateStrToDbDate(addDays(todayInTz(mine.shop.organization.timezone), 5));
    const base = { date, startMinute: null, endMinute: null, reason: "Prueba" };

    expect(await createAvailabilityException(await mine.org(), { ...base, professionalId: theirPro.id })).toMatchObject({ ok: false, code: "not_found" });
    expect((await createAvailabilityException(await mine.org(), { ...base, professionalId: null })).ok).toBe(true);
    const own = await ownerProfessional(mine.shop.organization.id);
    expect((await createAvailabilityException(await mine.org(), { ...base, professionalId: own.id })).ok).toBe(true);
    expect(await db.availabilityException.count({ where: { organizationId: mine.shop.organization.id } })).toBe(2);
  });

  it("la base de datos también rechaza vínculos entre organizaciones (claves foráneas compuestas)", async () => {
    const mine = await teamShop();
    const theirs = await teamShop();
    const theirPro = await ownerProfessional(theirs.shop.organization.id);
    const myOrg = mine.shop.organization.id;
    const day = dateStrToDbDate(addDays(todayInTz("America/Argentina/Buenos_Aires"), 4));

    // Un horario, un bloqueo y un vínculo servicio-profesional de MI negocio apuntando a un profesional AJENO.
    await expect(db.availabilityRule.create({ data: { organizationId: myOrg, professionalId: theirPro.id, weekday: 1, startMinute: 0, endMinute: 60 } })).rejects.toThrow();
    await expect(db.availabilityException.create({ data: { organizationId: myOrg, professionalId: theirPro.id, date: day } })).rejects.toThrow();
    await expect(db.serviceProfessional.create({ data: { organizationId: myOrg, serviceId: mine.shop.service.id, professionalId: theirPro.id } })).rejects.toThrow();
    // Un turno de mi negocio con un profesional ajeno.
    const customer = await db.customer.create({ data: { organizationId: myOrg, name: "Cruzado" } });
    await expect(
      db.appointment.create({
        data: {
          organizationId: myOrg, professionalId: theirPro.id, serviceId: mine.shop.service.id, customerId: customer.id,
          startsAt: new Date(Date.now() + 86400000), endsAt: new Date(Date.now() + 90000000), manageToken: `cruzado-${Date.now()}-xxxxxxxxxxxx`,
        },
      }),
    ).rejects.toThrow();
  });
});
