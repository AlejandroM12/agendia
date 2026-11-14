import { describe, it, expect, afterAll, beforeAll, vi } from "vitest";
import sharp from "sharp";
import type { AppContext } from "@/lib/dal";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { addDays, todayInTz, zonedTimeToUtc } from "@/lib/time";
import { addProfessional, createSchedulableOrganization, enableTeam, fakeContext, ownerProfessional } from "./helpers";

/**
 * Las acciones de «Equipo» con la sesión de un negocio y, para probar la
 * autorización en el servidor, con un rol que no tiene permisos. Solo se
 * reemplaza la capa que lee la cookie (lib/dal): el chequeo de permisos es el real.
 */

const session = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("@/lib/dal", async () => (await import("./dal-mock")).createDalMock(() => session.current as AppContext));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

import { createAppointment } from "@/modules/appointments/service";
import {
  activateProfessionalAction,
  addBlockAction,
  copyHoursAction,
  createProfessionalAction,
  deactivateProfessionalAction,
  deleteBlockAction,
  moveProfessionalAction,
  reassignAppointmentAction,
  removeProfessionalPhotoAction,
  resolveAppointmentsAction,
  saveProfessionalHoursAction,
  saveProfessionalServicesAction,
  setIsMeAction,
  updateProfessionalAction,
  uploadProfessionalPhotoAction,
} from "@/modules/team/actions";
import { createAppointmentAction } from "@/modules/appointments/actions";
import { createServiceAction } from "@/modules/services/actions";

type Tenant = Awaited<ReturnType<typeof createSchedulableOrganization>>;

const form = (fields: Record<string, string | string[]>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    for (const item of Array.isArray(value) ? value : [value]) data.append(key, item);
  }
  return data;
};

async function actAs(tenant: Tenant, patch: { role?: AppContext["role"]; canWrite?: boolean } = {}) {
  const organization = await db.organization.findUniqueOrThrow({ where: { id: tenant.organization.id } });
  session.current = fakeContext({ userId: tenant.userId, email: tenant.ownerEmail, organization, role: patch.role, canWrite: patch.canWrite ?? true });
}

const run = async (fn: () => Promise<unknown>) => {
  try {
    return await fn();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};

let a: Tenant; // negocio del usuario que actúa
let b: Tenant; // otro negocio
let aOwner: Awaited<ReturnType<typeof ownerProfessional>>;
let aSecond: Awaited<ReturnType<typeof addProfessional>>;
let bOwner: Awaited<ReturnType<typeof ownerProfessional>>;
let tz: string;
let tomorrow: string;

beforeAll(async () => {
  a = await createSchedulableOrganization();
  b = await createSchedulableOrganization();
  await enableTeam(a.organization.id, { extraProfessionals: 3 });
  await enableTeam(b.organization.id, { extraProfessionals: 3 });
  aOwner = await ownerProfessional(a.organization.id);
  aSecond = await addProfessional(a.organization.id, { displayName: "Martín" });
  bOwner = await ownerProfessional(b.organization.id);
  tz = a.organization.timezone;
  tomorrow = addDays(todayInTz(tz), 1);
});

afterAll(async () => {
  await a?.cleanup();
  await b?.cleanup();
});

async function png(size = 400) {
  return new Uint8Array(await sharp({ create: { width: size, height: size, channels: 3, background: "#39c" } }).png().toBuffer());
}

describe("permisos por rol", () => {
  it("el propietario y el administrador pueden gestionar; un rol desconocido no puede nada", () => {
    for (const permission of ["team.manage", "schedule.manage", "appointments.manage", "services.manage", "customers.manage", "customers.contact"] as const) {
      expect(can("owner", permission)).toBe(true);
      expect(can("admin", permission)).toBe(true);
      expect(can("professional", permission)).toBe(false);
      expect(can("", permission)).toBe(false);
      expect(can(null, permission)).toBe(false);
      expect(can(undefined, permission)).toBe(false);
    }
  });

  it("sin permiso, ninguna acción administrativa modifica nada (aunque el usuario esté autenticado)", async () => {
    await actAs(a, { role: "professional" as AppContext["role"] });
    const before = await db.professional.count({ where: { organizationId: a.organization.id } });
    const orderBefore = (await db.professional.findUniqueOrThrow({ where: { id: aSecond.id } })).sortOrder;
    const forbidden = { message: expect.stringContaining("permiso") };

    expect(await run(() => createProfessionalAction(undefined, form({ displayName: "Intruso", color: "#112233" })))).toMatchObject(forbidden);
    expect(await run(() => updateProfessionalAction(aSecond.id, undefined, form({ displayName: "Cambiado", color: "#112233" })))).toMatchObject(forbidden);
    expect(await run(() => saveProfessionalServicesAction(aSecond.id, undefined, form({})))).toMatchObject(forbidden);
    expect(await run(() => deactivateProfessionalAction(aSecond.id))).toMatchObject(forbidden);
    expect(await run(() => activateProfessionalAction(aSecond.id))).toMatchObject(forbidden);
    expect(await run(() => reassignAppointmentAction("x", undefined, form({ professionalId: aSecond.id })))).toMatchObject(forbidden);
    expect(await run(() => resolveAppointmentsAction(aSecond.id, undefined, form({ decision: "cancel" })))).toMatchObject(forbidden);
    expect(await run(() => saveProfessionalHoursAction(aSecond.id, undefined, form({ rules: "[]" })))).toMatchObject(forbidden);
    expect(await run(() => copyHoursAction(aSecond.id, undefined, form({ fromProfessionalId: aOwner.id })))).toMatchObject(forbidden);
    expect(await run(() => addBlockAction(null, undefined, form({ date: tomorrow, fullDay: "on" })))).toMatchObject(forbidden);
    expect(await run(() => uploadProfessionalPhotoAction(aSecond.id, form({})))).toMatchObject({ ok: false, message: expect.stringContaining("permiso") });
    expect(await run(() => removeProfessionalPhotoAction(aSecond.id))).toMatchObject({ ok: false });
    expect(await run(() => createServiceAction(undefined, form({ name: "Nuevo", durationMinutes: "30" })))).toMatchObject(forbidden);
    await moveProfessionalAction(aSecond.id, "up");
    await setIsMeAction(aSecond.id, true);
    await deleteBlockAction(null, "no-existe");

    expect(await db.professional.count({ where: { organizationId: a.organization.id } })).toBe(before);
    const second = await db.professional.findUniqueOrThrow({ where: { id: aSecond.id } });
    expect(second).toMatchObject({ displayName: "Martín", active: true, userId: null, sortOrder: orderBefore });
    expect(await db.service.count({ where: { organizationId: a.organization.id, name: "Nuevo" } })).toBe(0);
  });

  it("en solo lectura tampoco se puede modificar el equipo", async () => {
    await actAs(a, { canWrite: false });
    expect(await run(() => updateProfessionalAction(aSecond.id, undefined, form({ displayName: "Otro", color: "#112233" })))).toMatchObject({ message: "solo lectura" });
    expect((await db.professional.findUniqueOrThrow({ where: { id: aSecond.id } })).displayName).toBe("Martín");
  });
});

describe("gestión del equipo con permiso", () => {
  it("crea un profesional, valida los campos y respeta el cupo", async () => {
    await actAs(a);
    // Campos inválidos: errores por campo y no se crea nada.
    const invalid = await run(() => createProfessionalAction(undefined, form({ displayName: "A", color: "azul" })));
    expect(invalid).toMatchObject({ errors: expect.objectContaining({ displayName: expect.any(Array), color: expect.any(Array) }) });

    const created = await run(() => createProfessionalAction(undefined, form({ displayName: "Diego", description: "Barbero", color: "#aa5500", bookableOnline: "on", isMe: "on" })));
    expect(created).toMatch(/^REDIRECT:\/dashboard\/equipo\/.+/);
    const diego = await db.professional.findFirstOrThrow({ where: { organizationId: a.organization.id, displayName: "Diego" } });
    expect(diego).toMatchObject({ description: "Barbero", color: "#aa5500", bookableOnline: true, active: true, userId: a.userId });
    expect(await db.auditLog.count({ where: { organizationId: a.organization.id, action: "team.professional.create", entityId: diego.id } })).toBe(1);

    // Una prueba admite 2 + 3 extra = 5 activos: el sexto se rechaza.
    await addProfessional(a.organization.id, { displayName: "Cuarto" });
    await addProfessional(a.organization.id, { displayName: "Quinto" });
    const sixth = await run(() => createProfessionalAction(undefined, form({ displayName: "Sexto", color: "#112233" })));
    expect(sixth).toMatchObject({ message: expect.stringContaining("hasta 5 profesionales") });
    expect(await db.professional.count({ where: { organizationId: a.organization.id, displayName: "Sexto" } })).toBe(0);
    await db.professional.deleteMany({ where: { organizationId: a.organization.id, displayName: { in: ["Cuarto", "Quinto", "Diego"] } } });
  });

  it("no crea más de un profesional con el modo equipo apagado, aunque se use la acción directamente", async () => {
    const solo = await createSchedulableOrganization();
    try {
      await actAs(solo);
      const result = await run(() => createProfessionalAction(undefined, form({ displayName: "Segundo", color: "#112233" })));
      expect(result).toMatchObject({ message: expect.stringContaining("todavía no están habilitados") });
      expect(await db.professional.count({ where: { organizationId: solo.organization.id } })).toBe(1);
    } finally {
      await solo.cleanup();
    }
  });

  it("actualiza datos, servicios, horarios, bloqueos y foto del propio negocio", async () => {
    await actAs(a);
    expect(await run(() => updateProfessionalAction(aSecond.id, undefined, form({ displayName: "Martín R.", color: "#334455", bookableOnline: "on" })))).toMatchObject({ ok: true });
    expect(await run(() => saveProfessionalServicesAction(aSecond.id, undefined, form({ serviceId: [a.service.id] })))).toMatchObject({ ok: true });
    expect(await run(() => saveProfessionalHoursAction(aSecond.id, undefined, form({ rules: JSON.stringify([{ weekday: 2, startMinute: 840, endMinute: 1200 }]) })))).toMatchObject({ ok: true });
    expect(await db.availabilityRule.findMany({ where: { professionalId: aSecond.id } })).toMatchObject([{ weekday: 2, startMinute: 840, endMinute: 1200 }]);
    // Franjas superpuestas: rechazadas desde el servidor.
    expect(await run(() => saveProfessionalHoursAction(aSecond.id, undefined, form({ rules: JSON.stringify([{ weekday: 2, startMinute: 540, endMinute: 700 }, { weekday: 2, startMinute: 600, endMinute: 800 }]) })))).toMatchObject({ message: expect.stringContaining("superponen") });
    expect(await db.availabilityRule.count({ where: { professionalId: aSecond.id } })).toBe(1);

    expect(await run(() => addBlockAction(aSecond.id, undefined, form({ date: tomorrow, until: addDays(tomorrow, 2), reason: "Vacaciones" })))).toMatchObject({ ok: true, message: "3 días bloqueados." });
    expect(await run(() => addBlockAction(aSecond.id, undefined, form({ date: addDays(tomorrow, 9), start: "12:00", end: "10:00" })))).toMatchObject({ message: expect.stringContaining("horario válido") });
    expect(await run(() => addBlockAction(null, undefined, form({ date: addDays(tomorrow, 9), start: "12:00", end: "14:00" })))).toMatchObject({ ok: true });

    const uploaded = await run(() => uploadProfessionalPhotoAction(aSecond.id, form({})));
    expect(uploaded).toMatchObject({ ok: false });
    const data = new FormData();
    data.set("file", new File([await png()], "foto.png", { type: "image/png" }));
    expect(await run(() => uploadProfessionalPhotoAction(aSecond.id, data))).toMatchObject({ ok: true });
    expect(await run(() => removeProfessionalPhotoAction(aSecond.id))).toMatchObject({ ok: true });
  });
});

describe("aislamiento entre negocios: identificadores manipulados", () => {
  it("no se puede tocar un profesional de otro negocio por ninguna acción", async () => {
    await actAs(a);
    const before = await db.professional.findUniqueOrThrow({ where: { id: bOwner.id } });
    const rulesBefore = await db.availabilityRule.count({ where: { professionalId: bOwner.id } });
    const notFound = { message: expect.stringContaining("No encontramos") };

    expect(await run(() => updateProfessionalAction(bOwner.id, undefined, form({ displayName: "Hackeado", color: "#000000" })))).toMatchObject(notFound);
    expect(await run(() => saveProfessionalServicesAction(bOwner.id, undefined, form({ serviceId: [a.service.id] })))).toMatchObject(notFound);
    expect(await run(() => deactivateProfessionalAction(bOwner.id))).toMatchObject(notFound);
    expect(await run(() => saveProfessionalHoursAction(bOwner.id, undefined, form({ rules: "[]" })))).toMatchObject(notFound);
    expect(await run(() => copyHoursAction(bOwner.id, undefined, form({ fromProfessionalId: aOwner.id })))).toMatchObject(notFound);
    expect(await run(() => copyHoursAction(aSecond.id, undefined, form({ fromProfessionalId: bOwner.id })))).toMatchObject(notFound);
    expect(await run(() => addBlockAction(bOwner.id, undefined, form({ date: tomorrow, fullDay: "on" })))).toMatchObject(notFound);
    expect(await run(() => uploadProfessionalPhotoAction(bOwner.id, form({})))).toMatchObject({ ok: false });
    const data = new FormData();
    data.set("file", new File([await png()], "foto.png", { type: "image/png" }));
    expect(await run(() => uploadProfessionalPhotoAction(bOwner.id, data))).toMatchObject({ ok: false, message: expect.stringContaining("No encontramos") });
    expect(await run(() => removeProfessionalPhotoAction(bOwner.id))).toMatchObject({ ok: false });
    await moveProfessionalAction(bOwner.id, "down");
    await setIsMeAction(bOwner.id, true);

    expect(await db.professional.findUniqueOrThrow({ where: { id: bOwner.id } })).toMatchObject({
      displayName: before.displayName, active: true, userId: null, sortOrder: before.sortOrder, photoImageId: null,
    });
    expect(await db.availabilityRule.count({ where: { professionalId: bOwner.id } })).toBe(rulesBefore);
    expect(await db.availabilityException.count({ where: { professionalId: bOwner.id } })).toBe(0);
  });

  it("no se puede reasignar, resolver ni borrar bloqueos de otro negocio", async () => {
    const start = zonedTimeToUtc(addDays(tomorrow, 1), 10 * 60, tz);
    const victimAppointment = await createAppointment({
      organization: await db.organization.findUniqueOrThrow({ where: { id: b.organization.id } }),
      serviceId: b.service.id,
      startsAt: start,
      customer: { name: "Cliente B", email: "b@example.com", phone: null },
      actor: "professional",
      professional: bOwner.id,
    });
    expect(victimAppointment.ok).toBe(true);
    const victimBlock = await db.availabilityException.create({
      data: { organizationId: b.organization.id, professionalId: null, date: new Date(`${tomorrow}T00:00:00Z`), startMinute: null, endMinute: null },
    });

    await actAs(a);
    const appointmentId = victimAppointment.ok ? victimAppointment.appointment.id : "";
    expect(await run(() => reassignAppointmentAction(appointmentId, undefined, form({ professionalId: aOwner.id })))).toMatchObject({ message: expect.stringContaining("No encontramos") });
    expect(await run(() => resolveAppointmentsAction(bOwner.id, undefined, form({ decision: "cancel" })))).toMatchObject({ message: expect.stringContaining("No encontramos") });
    await deleteBlockAction(null, victimBlock.id);

    expect((await db.appointment.findUniqueOrThrow({ where: { id: appointmentId } })).professionalId).toBe(bOwner.id);
    expect((await db.appointment.findUniqueOrThrow({ where: { id: appointmentId } })).status).toBe("confirmed");
    expect(await db.availabilityException.count({ where: { id: victimBlock.id } })).toBe(1);
  });

  it("el turno manual con un profesional de otro negocio se rechaza y no crea nada", async () => {
    await actAs(a);
    const result = await run(() =>
      createAppointmentAction(
        undefined,
        form({ serviceId: a.service.id, date: tomorrow, time: "15:00", customerName: "Alguien", professionalId: bOwner.id }),
      ),
    );
    expect(result).toMatchObject({ message: expect.any(String) });
    expect(await db.appointment.count({ where: { organizationId: a.organization.id } })).toBe(0);
    expect(await db.appointment.count({ where: { professionalId: bOwner.id, startsAt: zonedTimeToUtc(tomorrow, 15 * 60, tz) } })).toBe(0);
  });

  it("un servicio ajeno no se puede vincular a un profesional propio", async () => {
    await actAs(a);
    const result = await run(() => saveProfessionalServicesAction(aSecond.id, undefined, form({ serviceId: [b.service.id] })));
    expect(result).toMatchObject({ message: expect.stringContaining("no pertenece") });
    expect(await db.serviceProfessional.count({ where: { serviceId: b.service.id } })).toBe(0);
  });
});

describe("desactivar y reasignar desde las acciones", () => {
  it("exige resolver los turnos y deja la decisión al administrador", async () => {
    await actAs(a);
    const start = zonedTimeToUtc(addDays(tomorrow, 2), 11 * 60, tz);
    const created = await createAppointment({
      organization: await db.organization.findUniqueOrThrow({ where: { id: a.organization.id } }),
      serviceId: a.service.id,
      startsAt: start,
      customer: { name: "Cliente", email: "c@example.com", phone: null },
      actor: "professional",
      professional: aSecond.id,
    });
    const appointmentId = created.ok ? created.appointment.id : "";

    expect(await run(() => deactivateProfessionalAction(aSecond.id))).toMatchObject({ message: expect.stringContaining("turno futuro") });
    expect(await run(() => reassignAppointmentAction(appointmentId, undefined, form({})))).toMatchObject({ message: expect.stringContaining("Elegí") });
    expect(await run(() => resolveAppointmentsAction(aSecond.id, undefined, form({ decision: "reassign" })))).toMatchObject({ message: expect.stringContaining("Elegí") });
    expect(await run(() => resolveAppointmentsAction(aSecond.id, undefined, form({ decision: "otra-cosa" })))).toMatchObject({ message: expect.stringContaining("Elegí") });

    expect(await run(() => reassignAppointmentAction(appointmentId, undefined, form({ professionalId: aOwner.id })))).toMatchObject({ ok: true });
    expect((await db.appointment.findUniqueOrThrow({ where: { id: appointmentId } })).professionalId).toBe(aOwner.id);
    expect(await run(() => deactivateProfessionalAction(aSecond.id))).toMatchObject({ ok: true });
    expect(await run(() => activateProfessionalAction(aSecond.id))).toMatchObject({ ok: true });
  });
});
