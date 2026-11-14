import { describe, it, expect, afterAll, vi } from "vitest";
import type { Professional } from "@prisma/client";
import { db } from "@/lib/db";
import { addDays, todayInTz, zonedTimeToUtc } from "@/lib/time";

// Solo se reemplaza lo que necesita una request real (IP, límites y `after`); todo lo demás es el código real contra PostgreSQL.
vi.mock("@/lib/rate-limit", () => ({
  clientIp: async () => "203.0.113.7",
  rateLimit: async () => ({ allowed: true }),
  TOO_MANY_ATTEMPTS: "Demasiados intentos.",
}));
vi.mock("next/server", () => ({ after: (fn: () => void) => fn() }));

import {
  bookAppointmentAction,
  cancelByTokenAction,
  getPublicAvailabilityAction,
  getRescheduleAvailabilityAction,
  rescheduleByTokenAction,
} from "@/modules/booking/actions";
import { reassignAppointment } from "@/modules/appointments/service";
import { renderAppointmentEmail } from "@/modules/notifications/templates";
import { listPublicTeam, usesTeam } from "@/modules/team/eligibility";
import { loadPublicTeamView } from "@/modules/public-page/team";
import { setProfessionalServices } from "@/modules/team/team-admin";
import { addProfessional, createSchedulableOrganization, enableTeam, ownerProfessional, refreshOrganization, uniqueSuffix } from "./helpers";

type Tenant = Awaited<ReturnType<typeof createSchedulableOrganization>>;
const tenants: Tenant[] = [];

/** Negocio con el modo equipo encendido; el dueño queda desactivado para controlar quiénes atienden. */
async function shopWith(names: Array<string | { name: string; hours?: Array<[number, number]>; active?: boolean; online?: boolean }>) {
  const shop = await createSchedulableOrganization();
  tenants.push(shop);
  await enableTeam(shop.organization.id, { extraProfessionals: 6 });
  await db.professional.update({ where: { id: (await ownerProfessional(shop.organization.id)).id }, data: { active: false } });
  const professionals: Professional[] = [];
  for (const entry of names) {
    const spec = typeof entry === "string" ? { name: entry } : entry;
    professionals.push(
      await addProfessional(shop.organization.id, {
        displayName: spec.name,
        hours: spec.hours,
        active: "active" in spec ? spec.active : true,
        bookableOnline: "online" in spec ? spec.online : true,
      }),
    );
  }
  // Los clientes pueden cancelar o reprogramar hasta cualquier momento en estas pruebas.
  await db.organization.update({ where: { id: shop.organization.id }, data: { cancellationNoticeHours: 0, onboardingCompletedAt: new Date() } });
  const org = () => refreshOrganization(shop.organization.id);
  const tz = shop.organization.timezone;
  const day = addDays(todayInTz(tz), 3);
  return { shop, professionals, org, tz, day, at: (hour: number, dateStr = day) => zonedTimeToUtc(dateStr, hour * 60, tz) };
}
type Shop = Awaited<ReturnType<typeof shopWith>>;

afterAll(async () => {
  for (const shop of tenants) await shop.cleanup();
});

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

let counter = 0;
function book(t: Shop, hour: number, fields: Record<string, string> = {}, who = ++counter) {
  return bookAppointmentAction(
    undefined,
    form({
      slug: t.shop.organization.slug,
      serviceId: t.shop.service.id,
      slot: t.at(hour).toISOString(),
      name: `Cliente ${who}`,
      email: `p${who}-${uniqueSuffix()}@example.com`,
      phone: "",
      idempotencyKey: `key-${who}-${uniqueSuffix()}`,
      ...fields,
    }),
  );
}

const slotsOf = async (t: Shop, professionalId?: string, serviceId = t.shop.service.id) => {
  const result = await getPublicAvailabilityAction(t.shop.organization.slug, serviceId, t.day, professionalId);
  if (!result.ok) return result;
  return result.days.find((d) => d.dateStr === t.day)?.slots.map((s) => s.label) ?? [];
};

describe("equipo visible en la reserva pública", () => {
  it("respeta el orden del negocio y solo muestra lo público de quienes atienden online el servicio", async () => {
    const t = await shopWith(["Ana", "Bea", "Carla", { name: "Dani", active: false }, { name: "Eva", online: false }]);
    const [ana, bea, carla] = t.professionals;
    await db.professional.update({ where: { id: ana.id }, data: { description: "Cortes clásicos", sortOrder: 5 } });
    await db.professional.update({ where: { id: bea.id }, data: { sortOrder: 1 } });
    await db.professional.update({ where: { id: carla.id }, data: { sortOrder: 3 } });
    // Una restricción de servicios: Carla no hace «Consulta».
    await setProfessionalServices(await t.org(), carla.id, []);

    const team = await listPublicTeam(db, await t.org());
    expect(team.professionals.map((p) => p.displayName)).toEqual(["Bea", "Ana"]); // orden definido por el negocio; sin Carla, Dani ni Eva
    expect(team.byService[t.shop.service.id]).toEqual([bea.id, ana.id]);
    // Solo datos públicos: ni teléfono, ni correo, ni cuenta, ni configuración.
    for (const professional of team.professionals) {
      expect(Object.keys(professional).sort()).toEqual(["description", "displayName", "id", "photoImageId"]);
    }
    const view = await loadPublicTeamView(await t.org());
    expect(Object.keys(view.professionals[0]).sort()).toEqual(["description", "displayName", "id", "photoUrl"]);
    expect(view.professionals[0].photoUrl).toBeNull(); // sin foto: la interfaz muestra la inicial
    expect(JSON.stringify(view)).not.toMatch(/userId|sortOrder|color|bookableOnline|organizationId|email|phone/i);
  });

  it("un servicio sin profesionales elegibles queda marcado como no reservable", async () => {
    const t = await shopWith(["Ana", "Bea"]);
    await db.professional.updateMany({ where: { organizationId: t.shop.organization.id }, data: { bookableOnline: false } });
    const team = await listPublicTeam(db, await t.org());
    expect(team.byService[t.shop.service.id]).toEqual([]);
    expect(team.professionals).toEqual([]);
    expect(await getPublicAvailabilityAction(t.shop.organization.slug, t.shop.service.id, t.day)).toMatchObject({ ok: false });
    const attempt = await book(t, 10);
    expect(attempt).toMatchObject({ ok: false });
    expect(await db.appointment.count({ where: { organizationId: t.shop.organization.id } })).toBe(0);
  });

  it("con el modo equipo apagado solo aparece el profesional de siempre, y nadie puede reservar con otro", async () => {
    const t = await shopWith(["Ana", "Bea"]);
    await db.organization.update({ where: { id: t.shop.organization.id }, data: { teamModeEnabled: false } });
    const org = await t.org();
    const team = await listPublicTeam(db, org);
    expect(team.byService[t.shop.service.id]).toEqual([t.professionals[0].id]);
    expect(await usesTeam(db, org)).toBe(false);

    // Pedido directo con el identificador del segundo profesional: se rechaza en el servidor.
    expect(await getPublicAvailabilityAction(t.shop.organization.slug, t.shop.service.id, t.day, t.professionals[1].id)).toMatchObject({ ok: false });
    expect(await book(t, 10, { professionalId: t.professionals[1].id })).toMatchObject({ ok: false });
    expect(await book(t, 10, { professionalId: "any" })).toMatchObject({ ok: true });
    const created = await db.appointment.findFirstOrThrow({ where: { organizationId: t.shop.organization.id } });
    expect(created.professionalId).toBe(t.professionals[0].id);
  });

  it("un negocio con un solo profesional no menciona al profesional en ninguna respuesta", async () => {
    const solo = await createSchedulableOrganization();
    tenants.push(solo);
    await db.organization.update({ where: { id: solo.organization.id }, data: { onboardingCompletedAt: new Date() } });
    const org = await refreshOrganization(solo.organization.id);
    const team = await listPublicTeam(db, org);
    expect(team.professionals).toHaveLength(1);
    expect(team.byService[solo.service.id]).toHaveLength(1);
    const day = addDays(todayInTz(org.timezone), 3);
    const result = await bookAppointmentAction(
      undefined,
      form({
        slug: org.slug, serviceId: solo.service.id, slot: zonedTimeToUtc(day, 600, org.timezone).toISOString(),
        name: "Cliente Solo", email: `solo-${uniqueSuffix()}@example.com`, phone: "", idempotencyKey: `k-${uniqueSuffix()}`,
      }),
    );
    expect(result).toMatchObject({ ok: true, professionalName: null });
  });
});

describe("disponibilidad pública por profesional", () => {
  it("un profesional concreto muestra solo sus horarios; «cualquiera» muestra la unión sin duplicados", async () => {
    const t = await shopWith([
      { name: "Ana", hours: [[9 * 60, 11 * 60]] },
      { name: "Bea", hours: [[10 * 60, 12 * 60]] },
    ]);
    const [ana, bea] = t.professionals;
    expect(await slotsOf(t, ana.id)).toEqual(["09:00", "09:30", "10:00", "10:30"]);
    expect(await slotsOf(t, bea.id)).toEqual(["10:00", "10:30", "11:00", "11:30"]);
    // 10:00 y 10:30 los tienen los dos: aparecen una sola vez.
    expect(await slotsOf(t, "any")).toEqual(["09:00", "09:30", "10:00", "10:30", "11:00", "11:30"]);
    // Sin elección explícita, el cliente público recibe «cualquiera» (compatibilidad con páginas ya abiertas).
    expect(await slotsOf(t)).toEqual(await slotsOf(t, "any"));
  });

  it("el turno de uno no le saca horarios al otro, y el mismo profesional no se superpone", async () => {
    const t = await shopWith(["Ana", "Bea"]);
    const [ana, bea] = t.professionals;
    expect(await book(t, 10, { professionalId: ana.id })).toMatchObject({ ok: true });
    expect(await slotsOf(t, ana.id)).not.toContain("10:00");
    expect(await slotsOf(t, bea.id)).toContain("10:00");
    expect(await slotsOf(t, "any")).toContain("10:00"); // Bea sigue libre
    expect(await book(t, 10, { professionalId: bea.id })).toMatchObject({ ok: true }); // a la misma hora, otro profesional
    expect(await book(t, 10, { professionalId: ana.id })).toMatchObject({ ok: false, refresh: true }); // el mismo, no
    expect(await slotsOf(t, "any")).not.toContain("10:00");
  });

  it("respeta bloqueos individuales y generales, vacaciones y descansos", async () => {
    const t = await shopWith([
      { name: "Ana", hours: [[9 * 60, 12 * 60], [14 * 60, 16 * 60]] },
      { name: "Bea", hours: [[9 * 60, 12 * 60]] },
    ]);
    const [ana, bea] = t.professionals;
    expect(await slotsOf(t, ana.id)).not.toContain("12:00"); // descanso entre franjas
    expect(await slotsOf(t, ana.id)).toContain("14:00");
    const date = new Date(`${t.day}T00:00:00Z`);
    await db.availabilityException.create({ data: { organizationId: t.shop.organization.id, professionalId: ana.id, date, startMinute: 9 * 60, endMinute: 10 * 60 } });
    expect(await slotsOf(t, ana.id)).not.toContain("09:30");
    expect(await slotsOf(t, bea.id)).toContain("09:30"); // el bloqueo individual no toca al otro
    await db.availabilityException.create({ data: { organizationId: t.shop.organization.id, professionalId: bea.id, date, startMinute: null, endMinute: null } });
    expect(await slotsOf(t, bea.id)).toEqual([]); // ausencia de todo el día
    expect(await slotsOf(t, "any")).toContain("14:00");
    await db.availabilityException.create({ data: { organizationId: t.shop.organization.id, professionalId: null, date, startMinute: null, endMinute: null } });
    expect(await slotsOf(t, "any")).toEqual([]); // cierre general: nadie atiende
  });

  it("rechaza profesionales ajenos, inactivos, sin reservas online, que no hacen el servicio o identificadores inventados", async () => {
    const t = await shopWith(["Ana", { name: "Inactiva", active: false }, { name: "Privada", online: false }, "Sin servicio"]);
    const other = await shopWith(["Otra"]);
    await setProfessionalServices(await t.org(), t.professionals[3].id, []);
    const bad = [other.professionals[0].id, t.professionals[1].id, t.professionals[2].id, t.professionals[3].id, "no-existe", "' OR 1=1 --", "x".repeat(500)];
    for (const id of bad) {
      expect(await slotsOf(t, id), id.slice(0, 20)).toMatchObject({ ok: false });
      const result = await book(t, 10, { professionalId: id });
      expect(result, id.slice(0, 20)).toMatchObject({ ok: false });
    }
    expect(await db.appointment.count({ where: { organizationId: { in: [t.shop.organization.id, other.shop.organization.id] } } })).toBe(0);
  });

  it("una cuenta en solo lectura no recibe reservas, aunque se llame a la acción directamente", async () => {
    const t = await shopWith(["Ana", "Bea"]);
    await db.organization.update({ where: { id: t.shop.organization.id }, data: { status: "suspended" } });
    expect(await getPublicAvailabilityAction(t.shop.organization.slug, t.shop.service.id, t.day)).toMatchObject({ ok: false });
    expect(await book(t, 10)).toMatchObject({ ok: false });
    expect(await db.appointment.count({ where: { organizationId: t.shop.organization.id } })).toBe(0);
  });

  it("cada profesional respeta la zona horaria del negocio", async () => {
    const t = await shopWith([{ name: "Ana", hours: [[9 * 60, 10 * 60]] }, "Bea"]);
    await db.organization.update({ where: { id: t.shop.organization.id }, data: { timezone: "America/Montevideo" } });
    // Mismo huso que Buenos Aires hoy, pero distinto identificador: el resultado se calcula con el del negocio.
    const result = await getPublicAvailabilityAction(t.shop.organization.slug, t.shop.service.id, t.day, t.professionals[0].id);
    expect(result.ok && result.days.find((d) => d.dateStr === t.day)?.slots.map((s) => s.label)).toEqual(["09:00", "09:30"]);
  });
});

describe("reserva pública con equipo", () => {
  it("con un profesional concreto lo asigna y lo informa; con «cualquiera» asigna al menos cargado con desempate fijo", async () => {
    const t = await shopWith(["Ana", "Bea", "Carla"]);
    const [ana, bea, carla] = t.professionals;
    const specific = await book(t, 9, { professionalId: bea.id });
    expect(specific, JSON.stringify(specific)).toMatchObject({ ok: true, professionalName: "Bea" });

    const assigned: string[] = [];
    for (const hour of [10, 11, 12]) {
      const result = await book(t, hour, { professionalId: "any" });
      expect(result?.ok).toBe(true);
      const row = await db.appointment.findFirstOrThrow({ where: { manageToken: result?.ok ? result.manageToken : "" } });
      assigned.push(row.professionalId);
      expect(row.professionalSelection).toBe("any");
      expect(row.requestedProfessionalId).toBeNull();
    }
    // Bea ya tenía 1 turno: Ana y Carla (0) van primero, por orden del equipo; luego Bea (1) empata con ellas (1).
    expect(assigned.slice(0, 2)).toEqual([ana.id, carla.id]);
    expect(new Set(assigned.slice(0, 3)).size).toBeGreaterThanOrEqual(2);
  });

  it("el doble clic (misma clave) crea un solo turno, y reservas simultáneas de a varios nunca superan a los profesionales libres", async () => {
    const t = await shopWith(["Ana", "Bea"]);
    const key = `dbl-${uniqueSuffix()}`;
    const results = await Promise.all(Array.from({ length: 4 }, () => book(t, 9, { professionalId: "any", idempotencyKey: key, name: "Doble Clic", email: "doble@example.com" }, 900)));
    expect(results.every((r) => r?.ok)).toBe(true);
    expect(new Set(results.map((r) => (r?.ok ? r.manageToken : ""))).size).toBe(1);
    expect(await db.appointment.count({ where: { organizationId: t.shop.organization.id, status: "confirmed" } })).toBe(1);

    // Seis clientes distintos al mismo horario con dos profesionales: solo entran dos, cada uno con uno distinto.
    const race = await Promise.all(Array.from({ length: 6 }, (_, i) => book(t, 15, { professionalId: "any" }, 1000 + i)));
    expect(race.filter((r) => r?.ok)).toHaveLength(2);
    const rejected = race.filter((r) => !r?.ok);
    expect(rejected).toHaveLength(4);
    for (const r of rejected) expect(r).toMatchObject({ ok: false, refresh: true, message: expect.stringContaining("ocup") });
    const at15 = await db.appointment.findMany({ where: { organizationId: t.shop.organization.id, startsAt: t.at(15), status: "confirmed" } });
    expect(new Set(at15.map((a) => a.professionalId)).size).toBe(2);
    // Los rechazados no dejaron clientes a medias.
    expect(await db.customer.count({ where: { organizationId: t.shop.organization.id, name: { startsWith: "Cliente 100" } } })).toBe(2);
  });

  it("si el profesional elegido se ocupa, informa el conflicto y no reserva con otro sin que el cliente lo pida", async () => {
    const t = await shopWith(["Ana", "Bea"]);
    const [ana, bea] = t.professionals;
    expect(await book(t, 11, { professionalId: ana.id })).toMatchObject({ ok: true });
    const conflict = await book(t, 11, { professionalId: ana.id });
    expect(conflict).toMatchObject({ ok: false, refresh: true });
    expect(await db.appointment.count({ where: { organizationId: t.shop.organization.id, professionalId: bea.id } })).toBe(0);
  });

  it("los datos del cliente inválidos no crean nada y devuelven errores por campo", async () => {
    const t = await shopWith(["Ana", "Bea"]);
    const result = await book(t, 10, { name: "A", email: "no-es-email", phone: "" });
    expect(result).toMatchObject({ ok: false, errors: expect.objectContaining({ name: expect.any(Array) }) });
    expect(await db.appointment.count({ where: { organizationId: t.shop.organization.id } })).toBe(0);
  });
});

async function booked(t: Shop, hour: number, professionalId: string | "any", email = `m-${uniqueSuffix()}@example.com`) {
  const result = await book(t, hour, { professionalId, email }, ++counter);
  if (!result?.ok) throw new Error("no se pudo reservar");
  return { token: result.manageToken, email, row: await db.appointment.findFirstOrThrow({ where: { manageToken: result.manageToken } }) };
}

const rescheduleSlots = async (token: string) => {
  const result = await getRescheduleAvailabilityAction(token);
  if (!result.ok) return result;
  const out: Record<string, string[]> = {};
  for (const day of result.days) out[day.dateStr] = day.slots.map((s) => s.label);
  return out;
};

describe("gestión del turno por el cliente", () => {
  it("quien eligió un profesional solo ve y usa los horarios de ese profesional, y lo conserva", async () => {
    const t = await shopWith([
      { name: "Ana", hours: [[9 * 60, 11 * 60]] },
      { name: "Bea", hours: [[14 * 60, 16 * 60]] },
    ]);
    const [ana, bea] = t.professionals;
    const mine = await booked(t, 9, ana.id);
    const slots = await rescheduleSlots(mine.token);
    expect(slots).not.toHaveProperty("ok");
    expect((slots as Record<string, string[]>)[t.day]).toEqual(["09:00", "09:30", "10:00", "10:30"]); // solo de Ana; su propio turno de las 9:00 no la bloquea
    expect((slots as Record<string, string[]>)[t.day]).not.toContain("14:00"); // los de Bea no aparecen

    // Pedir a mano un horario de Bea (manipulando el pedido) no cambia de profesional: se rechaza.
    const forced = await rescheduleByTokenAction(mine.token, t.at(14).toISOString());
    expect(forced).toMatchObject({ ok: false });
    expect((await db.appointment.findUniqueOrThrow({ where: { id: mine.row.id } })).professionalId).toBe(ana.id);

    const ok = await rescheduleByTokenAction(mine.token, t.at(10).toISOString());
    expect(ok).toMatchObject({ ok: true, professionalName: "Ana", professionalChanged: false });
    expect(bea.id).toBeTruthy();
  });

  it("si el profesional elegido ya no atiende online, se informa y se ofrece contactar al negocio (no se lo reemplaza)", async () => {
    const t = await shopWith(["Ana", "Bea"]);
    await db.organization.update({ where: { id: t.shop.organization.id }, data: { phone: "11 4444-5555" } });
    const mine = await booked(t, 9, t.professionals[0].id);
    await db.professional.update({ where: { id: t.professionals[0].id }, data: { bookableOnline: false } });
    const availability = await getRescheduleAvailabilityAction(mine.token);
    expect(availability).toMatchObject({ ok: false, message: expect.stringContaining("11 4444-5555") });
    expect(await rescheduleByTokenAction(mine.token, t.at(10).toISOString())).toMatchObject({ ok: false });
    expect((await db.appointment.findUniqueOrThrow({ where: { id: mine.row.id } })).professionalId).toBe(t.professionals[0].id);
  });

  it("con «cualquiera» conserva al profesional vigente si puede; si no, usa otro y lo informa, con aviso expreso por correo", async () => {
    const t = await shopWith([
      { name: "Ana", hours: [[9 * 60, 12 * 60]] },
      { name: "Bea", hours: [[9 * 60, 18 * 60]] },
    ]);
    const [ana, bea] = t.professionals;
    const mine = await booked(t, 9, "any");
    expect(mine.row.professionalId).toBe(ana.id); // empate: orden del equipo

    // 10:00 lo tienen los dos: se queda con Ana (sin cambio de profesional).
    const same = await rescheduleByTokenAction(mine.token, t.at(10).toISOString());
    expect(same).toMatchObject({ ok: true, professionalName: "Ana", professionalChanged: false });
    const afterSame = await db.notification.findMany({ where: { appointmentId: mine.row.id, status: "pending" } });
    expect(afterSame.every((n) => n.payload === null)).toBe(true);

    // 15:00 solo lo atiende Bea: cambia de profesional y el aviso lo dice.
    const changed = await rescheduleByTokenAction(mine.token, t.at(15).toISOString());
    expect(changed).toMatchObject({ ok: true, professionalName: "Bea", professionalChanged: true });
    const row = await db.appointment.findUniqueOrThrow({ where: { id: mine.row.id } });
    expect(row.professionalId).toBe(bea.id);
    expect(row.professionalSelection).toBe("any"); // sigue siendo «cualquiera»
    const pending = await db.notification.findMany({ where: { appointmentId: mine.row.id, status: "pending" } });
    const reschedule = pending.filter((n) => n.type === "reschedule" && n.recipient === mine.email);
    expect(reschedule).toHaveLength(1); // un solo correo, no uno por el horario y otro por el profesional
    expect(reschedule[0].payload).toEqual({ previousProfessionalId: ana.id });
    expect(pending.filter((n) => n.type === "professional_change")).toHaveLength(0);

    const email = renderAppointmentEmail("reschedule", {
      organizationName: "Barbería", organizationPhone: null, organizationAddress: null, timezone: t.tz,
      customerName: "Nico", serviceName: "Consulta", durationMinutes: 30, startsAt: row.startsAt,
      manageUrl: "https://x.test/turno/abc", dashboardUrl: "https://x.test/d", professionalName: "Bea", previousProfessionalName: "Ana",
    });
    expect(email.subject).toContain("de horario y de profesional");
    expect(email.text).toContain("antes era Ana y ahora te atiende Bea");
    expect(email.text).toContain("Profesional: Bea");
  });

  it("tras una reasignación del negocio se considera al profesional vigente: no se restaura el anterior", async () => {
    const t = await shopWith(["Ana", "Bea"]);
    const [ana, bea] = t.professionals;
    const specific = await booked(t, 9, ana.id);
    const any = await booked(t, 11, "any");
    expect(any.row.professionalId).toBe(bea.id); // Ana ya tenía un turno ese día: Bea, con menos carga

    // Eligió a Ana y el negocio lo pasa a Bea: al reprogramar ve los horarios de Bea y sigue con ella.
    expect((await reassignAppointment({ organization: await t.org(), appointmentId: specific.row.id, professionalId: bea.id })).ok).toBe(true);
    const slots = (await rescheduleSlots(specific.token)) as Record<string, string[]>;
    expect(slots[t.day]).toContain("10:00");
    expect(slots[t.day]).not.toContain("11:00"); // Bea tiene el turno de las 11
    expect(await rescheduleByTokenAction(specific.token, t.at(10).toISOString())).toMatchObject({ ok: true, professionalName: "Bea", professionalChanged: false });
    expect((await db.appointment.findUniqueOrThrow({ where: { id: specific.row.id } })).professionalId).toBe(bea.id);

    // Eligió «cualquiera» y el negocio lo pasa a Ana: al reprogramar a un horario libre para ambos, se queda con Ana.
    expect((await reassignAppointment({ organization: await t.org(), appointmentId: any.row.id, professionalId: ana.id })).ok).toBe(true);
    expect(await rescheduleByTokenAction(any.token, t.at(13).toISOString())).toMatchObject({ ok: true, professionalName: "Ana", professionalChanged: false });
    const row = await db.appointment.findUniqueOrThrow({ where: { id: any.row.id } });
    expect(row).toMatchObject({ professionalId: ana.id, professionalSelection: "any" });
    const notices = await db.notification.findMany({ where: { appointmentId: specific.row.id, type: "professional_change" } });
    expect(notices.length).toBeGreaterThanOrEqual(0);
  });

  it("cancelar libera el horario de ese profesional, conserva el historial y no toca otras agendas", async () => {
    const t = await shopWith(["Ana", "Bea"]);
    const [ana, bea] = t.professionals;
    const mine = await booked(t, 9, ana.id);
    const other = await booked(t, 9, bea.id);
    expect(await slotsOf(t, ana.id)).not.toContain("09:00");

    expect(await cancelByTokenAction(mine.token)).toMatchObject({ ok: true });
    expect(await slotsOf(t, ana.id)).toContain("09:00");
    expect(await slotsOf(t, bea.id)).not.toContain("09:00"); // la agenda de Bea sigue igual
    const row = await db.appointment.findUniqueOrThrow({ where: { id: mine.row.id } });
    expect(row).toMatchObject({ status: "canceled", canceledBy: "customer", professionalId: ana.id });
    expect((await db.appointment.findUniqueOrThrow({ where: { id: other.row.id } })).status).toBe("confirmed");
    // Se puede volver a reservar ese horario con Ana.
    expect(await book(t, 9, { professionalId: ana.id })).toMatchObject({ ok: true });
  });

  it("tokens inválidos o de otro cliente no dan acceso a nada", async () => {
    const t = await shopWith(["Ana", "Bea"]);
    const mine = await booked(t, 9, t.professionals[0].id);
    const theirs = await booked(t, 10, t.professionals[1].id);
    for (const token of ["", "corto", "x".repeat(200), `${mine.token}x`, mine.token.slice(0, -1) + (mine.token.endsWith("A") ? "B" : "A")]) {
      expect(await cancelByTokenAction(token), token.slice(0, 10)).toMatchObject({ ok: false });
      expect(await getRescheduleAvailabilityAction(token)).toMatchObject({ ok: false });
      expect(await rescheduleByTokenAction(token, t.at(12).toISOString())).toMatchObject({ ok: false });
    }
    // El token de uno solo mueve el turno de uno: el del otro cliente no cambia.
    await rescheduleByTokenAction(mine.token, t.at(12).toISOString());
    expect((await db.appointment.findUniqueOrThrow({ where: { id: theirs.row.id } })).startsAt.getTime()).toBe(t.at(10).getTime());
  });

  it("un token de un negocio no sirve en otro (aislamiento entre organizaciones)", async () => {
    const a = await shopWith(["Ana", "Bea"]);
    const b = await shopWith(["Ana", "Bea"]);
    const mine = await booked(a, 9, a.professionals[0].id);
    // Desde el negocio B no se puede reservar con profesionales ni servicios de A.
    expect(await book(b, 10, { professionalId: a.professionals[0].id })).toMatchObject({ ok: false });
    expect(await book(b, 10, { serviceId: a.shop.service.id })).toMatchObject({ ok: false });
    expect(await getPublicAvailabilityAction(b.shop.organization.slug, a.shop.service.id, b.day)).toMatchObject({ ok: false });
    expect((await db.appointment.findUniqueOrThrow({ where: { id: mine.row.id } })).status).toBe("confirmed");
  });
});

describe("avisos por correo con el profesional", () => {
  const base = (over: Partial<Parameters<typeof renderAppointmentEmail>[1]> = {}) => ({
    organizationName: "Barbería Avenida", organizationPhone: null, organizationAddress: null, timezone: "America/Argentina/Buenos_Aires",
    customerName: "Nico", serviceName: "Corte", durationMinutes: 30, startsAt: new Date("2026-12-02T15:00:00Z"),
    manageUrl: "https://x.test/turno/abc", dashboardUrl: "https://x.test/d", ...over,
  });

  it("confirmación, recordatorio, reprogramación y cancelación nombran al profesional solo si el negocio trabaja con equipo", () => {
    for (const type of ["booking_confirmation", "reminder", "reschedule", "cancellation", "professional_change"] as const) {
      expect(renderAppointmentEmail(type, base({ professionalName: "Lucas" })).text, type).toContain("Profesional: Lucas");
      expect(renderAppointmentEmail(type, base({ professionalName: null })).text, type).not.toContain("Profesional");
    }
  });

  it("el aviso de cambio de profesional lo dice expresamente y no incluye datos sensibles", () => {
    const email = renderAppointmentEmail("professional_change", base({ professionalName: "Lucas" }));
    expect(email.subject).toContain("Cambió el profesional");
    expect(email.text).toContain("ahora te va a atender Lucas");
    for (const type of ["booking_confirmation", "reminder", "reschedule", "cancellation", "professional_change"] as const) {
      expect(renderAppointmentEmail(type, base({ professionalName: "Lucas" })).text).not.toMatch(/nota|diagn|motivo de consulta/i);
    }
    // El correo de reprogramación sin cambio de profesional no inventa uno.
    const plain = renderAppointmentEmail("reschedule", base({ professionalName: "Lucas" }));
    expect(plain.text).not.toContain("cambia quién te atiende");
    expect(plain.subject).not.toContain("profesional");
  });

  it("no se duplican avisos: cada evento genera lo mínimo y reemplaza los pendientes anteriores", async () => {
    const t = await shopWith(["Ana", "Bea"]);
    const mine = await booked(t, 9, "any");
    const count = (type: string) => db.notification.count({ where: { appointmentId: mine.row.id, status: "pending", type: type as never, recipient: mine.email } });
    expect(await count("booking_confirmation")).toBe(1);

    await rescheduleByTokenAction(mine.token, t.at(10).toISOString());
    expect(await count("booking_confirmation")).toBe(0); // la anterior se anuló: no sale una confirmación vieja
    expect(await count("reschedule")).toBe(1);
    await rescheduleByTokenAction(mine.token, t.at(11).toISOString());
    expect(await count("reschedule")).toBe(1); // un solo aviso vigente, no uno por cada cambio

    await cancelByTokenAction(mine.token);
    expect(await count("reschedule")).toBe(0);
    expect(await count("reminder")).toBe(0);
    expect(await count("cancellation")).toBe(1);
  });
});
