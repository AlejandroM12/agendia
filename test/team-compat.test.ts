import { describe, it, expect, afterAll, vi } from "vitest";
import type { Organization } from "@prisma/client";
import { db } from "@/lib/db";
import { addDays, dateStrToDbDate, dbDateToDateStr, todayInTz, zonedTimeToUtc } from "@/lib/time";
import { getAvailability, getTeamAvailability, unionSlots } from "@/modules/availability/queries";
import { computeDaySlots } from "@/modules/availability/slots";
import { registerOrganization } from "@/modules/organizations/register";
import { cleanupOrganization, cleanupUser, createSchedulableOrganization, ownerProfessional, refreshOrganization, uniqueSuffix } from "./helpers";

vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": `198.18.0.${Math.floor(Math.random() * 250) + 1}` }) }));

import { bookAppointmentAction, getPublicAvailabilityAction } from "@/modules/booking/actions";

/**
 * Compatibilidad: un negocio con un único profesional se comporta
 * exactamente como antes de los equipos.
 */

/** Referencia: el algoritmo de disponibilidad ANTERIOR a los equipos (una sola agenda por negocio). */
async function legacyAvailability(org: Organization, durationMinutes: number, fromDateStr: string, days: number) {
  const now = new Date();
  const earliest = new Date(now.getTime() + org.minNoticeMinutes * 60000);
  const lastBookableDay = addDays(todayInTz(org.timezone, now), org.maxAdvanceDays);
  const latest = zonedTimeToUtc(addDays(lastBookableDay, 1), 0, org.timezone);
  const toDateStr = addDays(fromDateStr, days - 1);
  const rangeStart = zonedTimeToUtc(fromDateStr, 0, org.timezone);
  const rangeEnd = zonedTimeToUtc(addDays(toDateStr, 1), 0, org.timezone);

  const [rules, exceptions, appointments] = await Promise.all([
    db.availabilityRule.findMany({ where: { organizationId: org.id }, select: { weekday: true, startMinute: true, endMinute: true } }),
    db.availabilityException.findMany({
      where: { organizationId: org.id, date: { gte: dateStrToDbDate(fromDateStr), lte: dateStrToDbDate(toDateStr) } },
      select: { date: true, startMinute: true, endMinute: true },
    }),
    db.appointment.findMany({
      where: { organizationId: org.id, status: { not: "canceled" }, startsAt: { lt: rangeEnd }, endsAt: { gt: rangeStart } },
      select: { startsAt: true, endsAt: true },
    }),
  ]);
  const busy = appointments.map((a) => ({ start: a.startsAt, end: a.endsAt }));
  return Array.from({ length: days }, (_, i) => {
    const dateStr = addDays(fromDateStr, i);
    return {
      dateStr,
      slots: computeDaySlots({
        dateStr, timeZone: org.timezone, rules,
        exceptions: exceptions.filter((e) => dbDateToDateStr(e.date) === dateStr),
        busy, durationMinutes, slotIntervalMinutes: org.slotIntervalMinutes, bufferMinutes: org.bufferMinutes, earliest, latest,
      }).map((slot) => slot.getTime()),
    };
  });
}

/** Generador pseudoaleatorio determinista: la prueba es reproducible. */
function random(seed: number) {
  let state = seed;
  return () => (state = (state * 1664525 + 1013904223) % 4294967296) / 4294967296;
}

const created: Array<{ cleanup: () => Promise<void> }> = [];
afterAll(async () => {
  for (const item of created) await item.cleanup();
});

describe("equivalencia con el motor anterior (un solo profesional)", () => {
  it("devuelve exactamente los mismos horarios, antes y después, en escenarios variados", async () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const rnd = random(seed * 977);
      const shop = await createSchedulableOrganization();
      created.push(shop);
      const primary = await ownerProfessional(shop.organization.id);
      const tz = shop.organization.timezone;

      // Horario irregular: cada día, de 0 a 2 franjas (horario cortado, días sin atención).
      await db.availabilityRule.deleteMany({ where: { organizationId: shop.organization.id } });
      for (let weekday = 0; weekday < 7; weekday++) {
        const ranges = Math.floor(rnd() * 3);
        for (let r = 0; r < ranges; r++) {
          const start = (7 + r * 6 + Math.floor(rnd() * 3)) * 60;
          await db.availabilityRule.create({
            data: { organizationId: shop.organization.id, professionalId: primary.id, weekday, startMinute: start, endMinute: start + (3 + Math.floor(rnd() * 3)) * 60 },
          });
        }
      }
      const intervals = [15, 20, 30];
      const org = await db.organization.update({
        where: { id: shop.organization.id },
        data: { slotIntervalMinutes: intervals[seed % 3], bufferMinutes: seed % 2 ? 10 : 0, minNoticeMinutes: seed * 30, maxAdvanceDays: 30 + seed * 5 },
      });

      const today = todayInTz(tz);
      // Bloqueos (generales, como antes): algunos días completos y algunas franjas.
      for (let n = 0; n < 6; n++) {
        const partial = rnd() > 0.4;
        await db.availabilityException.create({
          data: {
            organizationId: org.id, date: dateStrToDbDate(addDays(today, 1 + Math.floor(rnd() * 25))),
            startMinute: partial ? 600 + Math.floor(rnd() * 4) * 30 : null, endMinute: partial ? 780 + Math.floor(rnd() * 4) * 30 : null,
          },
        });
      }
      // Turnos existentes (no superpuestos) de todos los estados.
      for (let n = 0; n < 25; n++) {
        const startsAt = zonedTimeToUtc(addDays(today, Math.floor(rnd() * 28)), (8 + Math.floor(rnd() * 20)) * 30, tz);
        const customer = await db.customer.create({ data: { organizationId: org.id, name: `C${n}` } });
        try {
          await db.appointment.create({
            data: {
              organizationId: org.id, professionalId: primary.id, serviceId: shop.service.id, customerId: customer.id,
              startsAt, endsAt: new Date(startsAt.getTime() + 30 * 60000), manageToken: `legacy-${seed}-${n}-${uniqueSuffix()}`,
              status: rnd() > 0.8 ? "canceled" : "confirmed",
            },
          });
        } catch {
          // un choque aleatorio con otro turno: la restricción lo impide, se descarta
        }
      }

      for (const duration of [15, 30, 45, 60, 90]) {
        const expected = await legacyAvailability(org, duration, today, 40);
        const actual = unionSlots(await getTeamAvailability({ organization: org, professionalIds: [primary.id], durationMinutes: duration, fromDateStr: today, days: 40 }));
        expect(actual.map((d) => ({ dateStr: d.dateStr, slots: d.slots.map((s) => s.getTime()) })), `semilla ${seed}, ${duration} min`).toEqual(expected);
        // También la función con la forma anterior (la usan las pruebas y el código previos).
        const wrapped = await getAvailability({ organization: org, durationMinutes: duration, fromDateStr: today, days: 40 });
        expect(wrapped.map((d) => ({ dateStr: d.dateStr, slots: d.slots.map((s) => s.getTime()) }))).toEqual(expected);
      }
      expect((await legacyAvailability(org, 30, today, 40)).some((d) => d.slots.length > 0)).toBe(true); // el escenario no es vacío
    }
  }, 120_000);
});

describe("datos y flujos anteriores", () => {
  it("el registro crea un único profesional activo con los valores por defecto", async () => {
    const suffix = uniqueSuffix();
    const result = await registerOrganization({ name: "Dueña Sola", email: `solo-${suffix}@example.com`, password: "Contrasena123", emailVerified: true });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const membership = await db.membership.findFirstOrThrow({ where: { userId: result.userId } });
    try {
      const professionals = await db.professional.findMany({ where: { organizationId: membership.organizationId } });
      expect(professionals).toHaveLength(1);
      expect(professionals[0]).toMatchObject({
        displayName: "Dueña Sola", active: true, bookableOnline: true, sortOrder: 0, userId: null, description: null, photoImageId: null,
      });
      const org = await db.organization.findUniqueOrThrow({ where: { id: membership.organizationId } });
      expect(org).toMatchObject({ teamModeEnabled: false, extraProfessionals: 0 });
    } finally {
      await cleanupOrganization(membership.organizationId);
      await cleanupUser(result.userId);
    }
  });

  it("la versión anterior de la app (que inserta horarios sin profesional) sigue funcionando: la base completa el campo", async () => {
    const shop = await createSchedulableOrganization();
    created.push(shop);
    const primary = await ownerProfessional(shop.organization.id);
    // INSERT como lo hacía la versión anterior: sin professionalId.
    await db.$executeRaw`DELETE FROM "availability_rules" WHERE "organizationId" = ${shop.organization.id}`;
    await db.$executeRaw`INSERT INTO "availability_rules" ("id", "organizationId", "weekday", "startMinute", "endMinute") VALUES (gen_random_uuid(), ${shop.organization.id}, 1, 540, 600)`;
    const rule = await db.availabilityRule.findFirstOrThrow({ where: { organizationId: shop.organization.id } });
    expect(rule.professionalId).toBe(primary.id);
  });

  it("los turnos existentes conservan su profesional y quedan como «específicos», sin pedido del cliente", async () => {
    const shop = await createSchedulableOrganization();
    created.push(shop);
    const primary = await ownerProfessional(shop.organization.id);
    const day = addDays(todayInTz(shop.organization.timezone), 2);
    const customer = await db.customer.create({ data: { organizationId: shop.organization.id, name: "Previo" } });
    const startsAt = zonedTimeToUtc(day, 600, shop.organization.timezone);
    // INSERT sin los campos nuevos, como el código anterior.
    await db.$executeRaw`INSERT INTO "appointments" ("id", "organizationId", "professionalId", "serviceId", "customerId", "startsAt", "endsAt", "manageToken", "updatedAt")
      VALUES (gen_random_uuid(), ${shop.organization.id}, ${primary.id}, ${shop.service.id}, ${customer.id}, ${startsAt}, ${new Date(startsAt.getTime() + 1800000)}, ${`previo-${uniqueSuffix()}-xxxxxxxx`}, now())`;
    const stored = await db.appointment.findFirstOrThrow({ where: { organizationId: shop.organization.id } });
    expect(stored).toMatchObject({ professionalId: primary.id, professionalSelection: "specific", requestedProfessionalId: null, idempotencyKey: null });
  });
});

describe("reserva pública de un negocio con un solo profesional", () => {
  async function singleShop() {
    const shop = await createSchedulableOrganization();
    created.push(shop);
    await db.organization.update({ where: { id: shop.organization.id }, data: { onboardingCompletedAt: new Date() } });
    return { shop, org: await refreshOrganization(shop.organization.id) };
  }

  it("la disponibilidad y la reserva funcionan como siempre, sin elegir profesional", async () => {
    const { shop, org } = await singleShop();
    const availability = await getPublicAvailabilityAction(org.slug, shop.service.id);
    expect(availability.ok).toBe(true);
    if (!availability.ok) return;
    const first = availability.days.find((d) => d.slots.length > 0)!.slots[0];

    const form = new FormData();
    form.set("slug", org.slug);
    form.set("serviceId", shop.service.id);
    form.set("slot", first.iso);
    form.set("name", "Marina Pública");
    form.set("email", `marina-${uniqueSuffix()}@example.com`);
    const booked = await bookAppointmentAction(undefined, form);
    expect(booked).toMatchObject({ ok: true });
    const stored = await db.appointment.findFirstOrThrow({ where: { organizationId: org.id } });
    expect(stored.professionalId).toBe((await ownerProfessional(org.id)).id);
  });

  it("un identificador de profesional enviado por el navegador no abre nada: se valida en el servidor", async () => {
    const { shop, org } = await singleShop();
    const stranger = await createSchedulableOrganization();
    created.push(stranger);
    const foreign = await ownerProfessional(stranger.organization.id);

    for (const professionalId of [foreign.id, "no-existe", "../../etc", "any' OR '1'='1"]) {
      const availability = await getPublicAvailabilityAction(org.slug, shop.service.id, undefined, professionalId);
      expect(availability.ok, professionalId).toBe(false);
    }
    // Sin el modo equipo, ni siquiera un profesional propio adicional se puede elegir.
    const extra = await db.professional.create({ data: { organizationId: org.id, displayName: "Extra", sortOrder: 5 } });
    expect((await getPublicAvailabilityAction(org.slug, shop.service.id, undefined, extra.id)).ok).toBe(false);

    const when = (await getPublicAvailabilityAction(org.slug, shop.service.id))
    expect(when.ok).toBe(true);
    if (!when.ok) return;
    const form = new FormData();
    form.set("slug", org.slug);
    form.set("serviceId", shop.service.id);
    form.set("slot", when.days.find((d) => d.slots.length > 0)!.slots[0].iso);
    form.set("name", "Intruso");
    form.set("email", `intruso-${uniqueSuffix()}@example.com`);
    form.set("professionalId", foreign.id);
    expect(await bookAppointmentAction(undefined, form)).toMatchObject({ ok: false });
    expect(await db.appointment.count({ where: { organizationId: { in: [org.id, stranger.organization.id] } } })).toBe(0);
  });

  it("el mismo formulario enviado dos veces (misma clave) crea una sola reserva", async () => {
    const { shop, org } = await singleShop();
    const availability = await getPublicAvailabilityAction(org.slug, shop.service.id);
    if (!availability.ok) throw new Error("sin disponibilidad");
    const slot = availability.days.find((d) => d.slots.length > 0)!.slots[0].iso;
    const submit = () => {
      const form = new FormData();
      form.set("slug", org.slug);
      form.set("serviceId", shop.service.id);
      form.set("slot", slot);
      form.set("name", "Doble Clic");
      form.set("phone", "11 5555 0000");
      form.set("idempotencyKey", "formulario-unico-1234");
      return bookAppointmentAction(undefined, form);
    };
    const results = await Promise.all([submit(), submit(), submit()]);
    expect(results.every((r) => r?.ok)).toBe(true);
    expect(await db.appointment.count({ where: { organizationId: org.id } })).toBe(1);
  });
});
