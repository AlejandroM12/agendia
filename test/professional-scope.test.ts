import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import type { AppContext } from "@/lib/app-context";
import { db } from "@/lib/db";
import { addDays, todayInTz, zonedTimeToUtc } from "@/lib/time";

/**
 * Lo que una cuenta de profesional puede ver y hacer, ejercitando las acciones
 * reales con identidades reales (contexto armado con lib/app-context.ts) contra
 * PostgreSQL. Solo se reemplaza la lectura de la sesión.
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

import { cancelAppointmentAction, createAppointmentAction, loadSlotsAction, rescheduleAppointmentAction, searchCustomersAction, setOutcomeAction, updateNotesAction } from "@/modules/appointments/actions";
import { startSubscriptionAction } from "@/modules/billing/actions";
import { createServiceAction } from "@/modules/services/actions";
import { addBlockAction, createProfessionalAction, deactivateProfessionalAction, deleteBlockAction, reassignAppointmentAction, saveProfessionalHoursAction } from "@/modules/team/actions";
import { inviteAdminAction, inviteProfessionalAction, savePermissionsAction } from "@/modules/team/access-actions";
import { appointmentScope, customerScope, findAppointmentFor, findCustomerFor } from "@/modules/access/scope";
import { createAppointment } from "@/modules/appointments/service";
import { addProfessional, createSchedulableOrganization, enableTeam, fakeContext, ownerProfessional, refreshOrganization } from "./helpers";

type Tenant = Awaited<ReturnType<typeof createSchedulableOrganization>>;

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};
const run = async (fn: () => Promise<unknown>) => {
  try {
    return await fn();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};

let t: Tenant;
let p1: Awaited<ReturnType<typeof addProfessional>>;
let p2: Awaited<ReturnType<typeof addProfessional>>;
let tz: string;
let day: string;
let own: { id: string; customerId: string };
let theirs: { id: string; customerId: string };

const at = (hour: number, d = day) => zonedTimeToUtc(d, hour * 60, tz);

async function actAs(role: "owner" | "admin" | "professional", professional: typeof p1 | null = null) {
  const organization = await refreshOrganization(t.organization.id);
  const row = professional ? await db.professional.findUniqueOrThrow({ where: { id: professional.id } }) : null;
  session.current = fakeContext({
    userId: t.userId,
    email: t.ownerEmail,
    organization,
    role,
    professional: row ? { id: row.id, displayName: row.displayName, active: row.active, permissionOverrides: row.permissionOverrides } : null,
  });
}

async function book(professionalId: string, hour: number, name: string) {
  const result = await createAppointment({
    organization: await refreshOrganization(t.organization.id),
    serviceId: t.service.id,
    startsAt: at(hour),
    customer: { name, email: `${name.toLowerCase().replace(/\W/g, "")}@example.com`, phone: `11${Math.floor(10000000 + Math.random() * 89999999)}` },
    actor: "professional",
    professional: professionalId,
  });
  if (!result.ok) throw new Error(result.message);
  return { id: result.appointment.id, customerId: result.appointment.customerId };
}

beforeAll(async () => {
  t = await createSchedulableOrganization();
  await enableTeam(t.organization.id, { extraProfessionals: 4 });
  await db.professional.update({ where: { id: (await ownerProfessional(t.organization.id)).id }, data: { active: false } });
  p1 = await addProfessional(t.organization.id, { displayName: "Propia" });
  p2 = await addProfessional(t.organization.id, { displayName: "Compañera" });
  tz = t.organization.timezone;
  day = addDays(todayInTz(tz), 3);
  own = await book(p1.id, 10, "Cliente Propio");
  theirs = await book(p2.id, 10, "Cliente Ajeno");
});

afterAll(async () => {
  await t?.cleanup();
});

describe("alcance de turnos y clientes", () => {
  it("el profesional solo alcanza sus turnos y a los clientes que tienen turnos con él", async () => {
    await actAs("professional", p1);
    const ctx = session.current as AppContext;
    expect(await findAppointmentFor(ctx, own.id)).not.toBeNull();
    expect(await findAppointmentFor(ctx, theirs.id)).toBeNull();
    expect(await findCustomerFor(ctx, own.customerId)).not.toBeNull();
    expect(await findCustomerFor(ctx, theirs.customerId)).toBeNull(); // un identificador no alcanza
    expect(await db.appointment.count({ where: appointmentScope(ctx) })).toBe(1);
    expect(await db.customer.count({ where: customerScope(ctx) })).toBe(1);

    await actAs("owner");
    const owner = session.current as AppContext;
    expect(await db.appointment.count({ where: appointmentScope(owner) })).toBe(2);
    expect(await findCustomerFor(owner, theirs.customerId)).not.toBeNull();
    expect(await findAppointmentFor(owner, "00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("una cuenta de profesional sin perfil vinculado no ve nada", async () => {
    await actAs("professional", null);
    const ctx = session.current as AppContext;
    expect(await db.appointment.count({ where: appointmentScope(ctx) })).toBe(0);
    expect(await db.customer.count({ where: customerScope(ctx) })).toBe(0);
  });

  it("la búsqueda de clientes y la disponibilidad se limitan a lo propio, pida lo que pida el navegador", async () => {
    await actAs("professional", p1);
    expect((await searchCustomersAction("Cliente")).map((c) => c.id)).toEqual([own.customerId]);
    expect(await searchCustomersAction("Ajeno")).toEqual([]);
    // Pedir los horarios de la compañera devuelve los de la propia agenda (10:00 está ocupado en la de p1).
    const slots = await loadSlotsAction(t.service.id, day, undefined, p2.id);
    expect(slots.map((s) => s.label)).not.toContain("10:00");
    expect(slots.length).toBeGreaterThan(0);

    await actAs("owner");
    expect((await searchCustomersAction("Cliente")).length).toBe(2);
  });
});

describe("acciones sobre turnos", () => {
  it("crear: siempre en su agenda, aunque el formulario pida otro profesional o cliente ajeno", async () => {
    await actAs("professional", p1);
    const forced = await run(() => createAppointmentAction(undefined, form({ serviceId: t.service.id, date: day, time: "12:00", customerName: "Nueva Persona", professionalId: p2.id })));
    expect(forced).toMatch(/^REDIRECT:/);
    const created = await db.appointment.findFirstOrThrow({ where: { organizationId: t.organization.id, startsAt: at(12) } });
    expect(created.professionalId).toBe(p1.id);

    const foreignCustomer = await run(() => createAppointmentAction(undefined, form({ serviceId: t.service.id, date: day, time: "13:00", customerId: theirs.customerId })));
    expect(foreignCustomer).toMatchObject({ message: expect.stringContaining("cliente") });
    expect(await db.appointment.count({ where: { organizationId: t.organization.id, startsAt: at(13) } })).toBe(0);
  });

  it("crear está permitido por defecto y se puede quitar; sin permiso no hace nada", async () => {
    await db.organization.update({ where: { id: t.organization.id }, data: { professionalPermissions: { createAppointments: false } } });
    await actAs("professional", p1);
    expect(await run(() => createAppointmentAction(undefined, form({ serviceId: t.service.id, date: day, time: "14:00", customerName: "Otra Persona" })))).toMatchObject({ message: expect.stringContaining("permiso") });
    expect(await db.appointment.count({ where: { organizationId: t.organization.id, startsAt: at(14) } })).toBe(0);
    await db.organization.update({ where: { id: t.organization.id }, data: { professionalPermissions: Prisma.DbNull } });
  });

  it("reprogramar: sus turnos sí (por defecto), los de la compañera no; no puede pasarse el turno a otro", async () => {
    await actAs("professional", p1);
    expect(await run(() => rescheduleAppointmentAction(theirs.id, undefined, form({ date: day, time: "15:00" })))).toMatchObject({ message: expect.stringContaining("No encontramos") });
    expect((await db.appointment.findUniqueOrThrow({ where: { id: theirs.id } })).startsAt.getTime()).toBe(at(10).getTime());

    const moved = await run(() => rescheduleAppointmentAction(own.id, undefined, form({ date: day, time: "16:00", professionalId: p2.id })));
    expect(moved).toMatch(/^REDIRECT:/);
    const row = await db.appointment.findUniqueOrThrow({ where: { id: own.id } });
    expect(row.startsAt.getTime()).toBe(at(16).getTime());
    expect(row.professionalId).toBe(p1.id); // el identificador del formulario se ignora
  });

  it("cancelar requiere autorización del propietario; con ella, solo sus turnos", async () => {
    await actAs("professional", p1);
    expect(await run(() => cancelAppointmentAction(own.id))).toMatchObject({ message: expect.stringContaining("permiso") });
    expect((await db.appointment.findUniqueOrThrow({ where: { id: own.id } })).status).toBe("confirmed");

    await db.organization.update({ where: { id: t.organization.id }, data: { professionalPermissions: { cancelAppointments: true } } });
    await actAs("professional", p1);
    expect(await run(() => cancelAppointmentAction(theirs.id))).toMatchObject({ message: expect.stringContaining("No encontramos") });
    expect((await db.appointment.findUniqueOrThrow({ where: { id: theirs.id } })).status).toBe("confirmed");
    expect(await run(() => cancelAppointmentAction(own.id))).toMatchObject({ ok: true });
    expect((await db.appointment.findUniqueOrThrow({ where: { id: own.id } })).status).toBe("canceled");
    await db.organization.update({ where: { id: t.organization.id }, data: { professionalPermissions: Prisma.DbNull } });
    await db.appointment.update({ where: { id: own.id }, data: { status: "confirmed" } });
  });

  it("marcar atendido o ausente: solo los propios; las notas internas son del negocio", async () => {
    await actAs("professional", p1);
    await setOutcomeAction(theirs.id, "completed");
    expect((await db.appointment.findUniqueOrThrow({ where: { id: theirs.id } })).status).toBe("confirmed");
    await setOutcomeAction(own.id, "no_show");
    expect((await db.appointment.findUniqueOrThrow({ where: { id: own.id } })).status).toBe("no_show");
    await setOutcomeAction(own.id, "confirmed");

    expect(await run(() => updateNotesAction(own.id, undefined, form({ notes: "x" })))).toMatchObject({ message: expect.stringContaining("permiso") });
    await actAs("owner");
    expect(await run(() => updateNotesAction(own.id, undefined, form({ notes: "nota del negocio" })))).toMatchObject({ ok: true });
  });

  it("reasignar, crear profesionales, desactivar, invitar y cambiar permisos están vedados al profesional", async () => {
    await actAs("professional", p1);
    const denied = { message: expect.stringContaining("permiso") };
    expect(await run(() => reassignAppointmentAction(own.id, undefined, form({ professionalId: p2.id })))).toMatchObject(denied);
    expect(await run(() => createProfessionalAction(undefined, form({ displayName: "Intruso", color: "#112233" })))).toMatchObject(denied);
    expect(await run(() => deactivateProfessionalAction(p2.id))).toMatchObject(denied);
    expect(await run(() => inviteProfessionalAction(p2.id, undefined, form({ email: "x@example.com" })))).toMatchObject(denied);
    expect(await run(() => inviteAdminAction(undefined, form({ email: "x@example.com" })))).toMatchObject(denied);
    expect(await run(() => savePermissionsAction(undefined, form({ cancelAppointments: "on" })))).toMatchObject(denied);
    expect(await run(() => createServiceAction(undefined, form({ name: "Nuevo", durationMinutes: "30" })))).toMatchObject(denied);
    expect(await run(() => startSubscriptionAction(undefined, form({})))).toMatchObject(denied);
    expect((await db.appointment.findUniqueOrThrow({ where: { id: own.id } })).professionalId).toBe(p1.id);
    expect(await db.organization.findUniqueOrThrow({ where: { id: t.organization.id } })).toMatchObject({ professionalPermissions: null });
  });
});

describe("horarios y bloqueos propios", () => {
  it("bloqueos: los propios sí; los de la compañera y los generales no; no cancelan turnos existentes", async () => {
    await actAs("professional", p1);
    const blockDay = addDays(day, 1);
    expect(await run(() => addBlockAction(p1.id, undefined, form({ date: day, fullDay: "on", reason: "Trámite" })))).toMatchObject({ ok: true });
    expect((await db.appointment.findUniqueOrThrow({ where: { id: own.id } })).status).toBe("confirmed"); // el bloqueo no toca turnos
    expect(await run(() => addBlockAction(p2.id, undefined, form({ date: blockDay, fullDay: "on" })))).toMatchObject({ message: expect.stringContaining("permiso") });
    expect(await run(() => addBlockAction(null, undefined, form({ date: blockDay, fullDay: "on" })))).toMatchObject({ message: expect.stringContaining("permiso") });
    expect(await db.availabilityException.count({ where: { organizationId: t.organization.id, date: new Date(`${blockDay}T00:00:00Z`) } })).toBe(0);

    const mine = await db.availabilityException.findFirstOrThrow({ where: { professionalId: p1.id } });
    const other = await db.availabilityException.create({ data: { organizationId: t.organization.id, professionalId: p2.id, date: new Date(`${blockDay}T00:00:00Z`), startMinute: null, endMinute: null } });
    await deleteBlockAction(p2.id, other.id);
    expect(await db.availabilityException.count({ where: { id: other.id } })).toBe(1);
    await deleteBlockAction(p1.id, other.id); // el identificador de otro profesional no se borra por esta vía
    expect(await db.availabilityException.count({ where: { id: other.id } })).toBe(1);
    await deleteBlockAction(p1.id, mine.id);
    expect(await db.availabilityException.count({ where: { id: mine.id } })).toBe(0);
  });

  it("modificar horarios requiere autorización, y solo vale para la propia agenda", async () => {
    const rules = JSON.stringify([{ weekday: 2, startMinute: 600, endMinute: 900 }]);
    await actAs("professional", p1);
    expect(await run(() => saveProfessionalHoursAction(p1.id, undefined, form({ rules })))).toMatchObject({ message: expect.stringContaining("permiso") });

    await db.professional.update({ where: { id: p1.id }, data: { permissionOverrides: { manageHours: true } } });
    await actAs("professional", p1);
    expect(await run(() => saveProfessionalHoursAction(p1.id, undefined, form({ rules })))).toMatchObject({ ok: true });
    expect(await db.availabilityRule.count({ where: { professionalId: p1.id } })).toBe(1);
    const others = await db.availabilityRule.count({ where: { professionalId: p2.id } });
    expect(await run(() => saveProfessionalHoursAction(p2.id, undefined, form({ rules })))).toMatchObject({ message: expect.stringContaining("permiso") });
    expect(await db.availabilityRule.count({ where: { professionalId: p2.id } })).toBe(others);
    await db.professional.update({ where: { id: p1.id }, data: { permissionOverrides: Prisma.DbNull } });
  });
});

describe("administrador y propietario", () => {
  it("el administrador opera pero no cobra, no da permisos ni nombra administradores", async () => {
    await actAs("admin");
    const denied = { message: expect.stringContaining("permiso") };
    expect(await run(() => startSubscriptionAction(undefined, form({})))).toMatchObject(denied);
    expect(await run(() => savePermissionsAction(undefined, form({ cancelAppointments: "on" })))).toMatchObject(denied);
    expect(await run(() => inviteAdminAction(undefined, form({ email: "x@example.com" })))).toMatchObject(denied);
    // Sí gestiona turnos, servicios y profesionales.
    expect(await run(() => rescheduleAppointmentAction(theirs.id, undefined, form({ date: day, time: "17:00" })))).toMatch(/^REDIRECT:/);
    expect(await run(() => createServiceAction(undefined, form({ name: "Servicio del admin", durationMinutes: "30" })))).toMatch(/^REDIRECT:|ok/);
  });

  it("el propietario sí cambia los permisos, y queda registrado", async () => {
    await actAs("owner");
    expect(await run(() => savePermissionsAction(undefined, form({ cancelAppointments: "on", createAppointments: "on" })))).toMatchObject({ ok: true });
    const org = await db.organization.findUniqueOrThrow({ where: { id: t.organization.id } });
    expect(org.professionalPermissions).toMatchObject({ cancelAppointments: true, createAppointments: true, manageHours: false });
    expect(await db.auditLog.count({ where: { organizationId: t.organization.id, action: "team.permissions.update" } })).toBe(1);
    await db.organization.update({ where: { id: t.organization.id }, data: { professionalPermissions: Prisma.DbNull } });
  });
});
