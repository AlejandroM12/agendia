import { describe, it, expect, afterAll, beforeAll, beforeEach, vi } from "vitest";
import type { AppContext } from "@/lib/dal";
import { db } from "@/lib/db";
import { addDays, dateStrToDbDate, todayInTz, zonedTimeToUtc } from "@/lib/time";
import { createSchedulableOrganization } from "./helpers";

/**
 * Aislamiento entre negocios a nivel de server actions.
 *
 * Cada test ejecuta la acción real con la sesión del negocio A (el
 * "atacante") y le pasa identificadores del negocio B (la "víctima"), como
 * haría alguien que manipula los parámetros de una request. La acción no
 * debe leer ni modificar nada de B.
 *
 * Solo se reemplaza la capa que lee la cookie de sesión (lib/dal) y las
 * funciones de Next que necesitan una request en curso.
 */

const session = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("@/lib/dal", () => {
  const context = () => session.current as AppContext;
  return {
    READ_ONLY_MESSAGE: "solo lectura",
    requireContext: async () => context(),
    requireOrganization: async () => context(),
    requireWriteContext: async () =>
      context().canWrite ? { ok: true, context: context() } : { ok: false, message: "solo lectura" },
  };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

import { accountOperationAction, updatePlanPriceAction } from "@/modules/admin/actions";
import {
  cancelAppointmentAction,
  createAppointmentAction,
  loadSlotsAction,
  rescheduleAppointmentAction,
  searchCustomersAction,
  setOutcomeAction,
  updateNotesAction,
} from "@/modules/appointments/actions";
import { createAppointment } from "@/modules/appointments/service";
import { deleteExceptionAction } from "@/modules/availability/actions";
import { deleteCustomerAction, updateCustomerAction } from "@/modules/customers/actions";
import {
  deleteServiceAction,
  moveServiceAction,
  setServiceActiveAction,
  updateServiceAction,
} from "@/modules/services/actions";
import { saveServicesStep } from "@/app/onboarding/actions";

type Tenant = Awaited<ReturnType<typeof createSchedulableOrganization>>;

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

/** Ejecuta una acción que puede terminar en redirect (que acá es una excepción). */
async function run<T>(action: () => Promise<T>): Promise<T | string> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof Error && /^(REDIRECT:|NOT_FOUND)/.test(error.message)) return error.message;
    throw error;
  }
}

describe("aislamiento entre negocios en las server actions", () => {
  let attacker: Tenant;
  let victim: Tenant;
  let victimCustomerId: string;
  let victimAppointmentId: string;
  let victimExceptionId: string;
  let tomorrow: string;

  function actAs(tenant: Tenant, overrides: Partial<AppContext> = {}) {
    session.current = {
      user: { id: tenant.userId, email: tenant.ownerEmail, name: "Owner Test", isPlatformAdmin: false },
      organization: tenant.organization,
      role: "owner",
      canWrite: true,
      ...overrides,
    } satisfies AppContext;
  }

  const victimAppointment = () => db.appointment.findUniqueOrThrow({ where: { id: victimAppointmentId } });

  beforeAll(async () => {
    attacker = await createSchedulableOrganization();
    victim = await createSchedulableOrganization();
    tomorrow = addDays(todayInTz(victim.organization.timezone), 1);

    const booked = await createAppointment({
      organization: victim.organization,
      serviceId: victim.service.id,
      startsAt: zonedTimeToUtc(tomorrow, 10 * 60, victim.organization.timezone),
      customer: { name: "Victoria Privada", email: "victoria.privada@example.com", phone: "1144445555" },
      actor: "professional",
      notes: "nota privada",
    });
    if (!booked.ok) throw new Error("setup");
    victimAppointmentId = booked.appointment.id;
    victimCustomerId = booked.appointment.customerId;

    const exception = await db.availabilityException.create({
      data: { organizationId: victim.organization.id, date: dateStrToDbDate(addDays(tomorrow, 5)) },
    });
    victimExceptionId = exception.id;
  });

  afterAll(async () => {
    await db.auditLog.deleteMany({
      where: { organizationId: { in: [attacker.organization.id, victim.organization.id] } },
    });
    await attacker.cleanup();
    await victim.cleanup();
  });

  beforeEach(() => actAs(attacker));

  describe("servicios", () => {
    it("no puede editar, desactivar, reordenar ni borrar un servicio ajeno", async () => {
      const update = await run(() =>
        updateServiceAction(victim.service.id, undefined, form({ name: "Hackeado", durationMinutes: "5", price: "1" })),
      );
      expect(update).toMatchObject({ message: expect.stringContaining("No encontramos") });

      await setServiceActiveAction(victim.service.id, false);
      await moveServiceAction(victim.service.id, "down");
      await run(() => deleteServiceAction(victim.service.id));

      const service = await db.service.findUniqueOrThrow({ where: { id: victim.service.id } });
      expect(service).toMatchObject({ name: "Consulta", durationMinutes: 30, active: true, price: 1000 });
    });
  });

  describe("clientes", () => {
    it("no puede editar ni borrar un cliente ajeno", async () => {
      const update = await run(() =>
        updateCustomerAction(victimCustomerId, undefined, form({ name: "Otro Nombre", email: "", phone: "", notes: "" })),
      );
      expect(update).toMatchObject({ message: expect.stringContaining("No encontramos") });
      await run(() => deleteCustomerAction(victimCustomerId));

      const customer = await db.customer.findUniqueOrThrow({ where: { id: victimCustomerId } });
      expect(customer).toMatchObject({ name: "Victoria Privada", email: "victoria.privada@example.com" });
    });

    it("la búsqueda de clientes no devuelve clientes de otro negocio", async () => {
      expect(await searchCustomersAction("Victoria")).toEqual([]);
      expect(await searchCustomersAction("victoria.privada@example.com")).toEqual([]);
      expect(await searchCustomersAction("1144445555")).toEqual([]);

      actAs(victim);
      expect(await searchCustomersAction("Victoria")).toHaveLength(1);
    });
  });

  describe("turnos", () => {
    it("no puede cancelar, reprogramar, cerrar ni anotar un turno ajeno", async () => {
      const before = await victimAppointment();

      expect(await cancelAppointmentAction(victimAppointmentId)).toMatchObject({
        message: expect.stringContaining("No encontramos"),
      });
      expect(
        await run(() =>
          rescheduleAppointmentAction(victimAppointmentId, undefined, form({ date: tomorrow, time: "16:00" })),
        ),
      ).toMatchObject({ message: expect.stringContaining("No encontramos") });
      await setOutcomeAction(victimAppointmentId, "no_show");
      await updateNotesAction(victimAppointmentId, undefined, form({ notes: "pisada" }));

      const after = await victimAppointment();
      expect(after.status).toBe("confirmed");
      expect(after.startsAt.getTime()).toBe(before.startsAt.getTime());
      expect(after.notes).toBe("nota privada");
      expect(after.canceledAt).toBeNull();
    });

    it("no puede agendar usando el servicio o el cliente de otro negocio", async () => {
      const withForeignService = await run(() =>
        createAppointmentAction(
          undefined,
          form({ serviceId: victim.service.id, date: tomorrow, time: "12:00", customerName: "Alguien" }),
        ),
      );
      expect(withForeignService).toMatchObject({ message: expect.any(String) });

      const withForeignCustomer = await run(() =>
        createAppointmentAction(
          undefined,
          form({ serviceId: attacker.service.id, date: tomorrow, time: "12:00", customerId: victimCustomerId }),
        ),
      );
      expect(withForeignCustomer).toMatchObject({ message: expect.stringContaining("cliente") });

      expect(await db.appointment.count({ where: { organizationId: attacker.organization.id } })).toBe(0);
      expect(await db.appointment.count({ where: { customerId: victimCustomerId } })).toBe(1);
    });

    it("no puede consultar la disponibilidad interna de un servicio ajeno", async () => {
      expect(await loadSlotsAction(victim.service.id, tomorrow)).toEqual([]);
      // Ni usar un turno ajeno para "liberar" su horario en el cálculo.
      const own = await loadSlotsAction(attacker.service.id, tomorrow, victimAppointmentId);
      expect(own.length).toBeGreaterThan(0);
    });
  });

  describe("disponibilidad", () => {
    it("no puede borrar un bloqueo ajeno", async () => {
      await deleteExceptionAction(victimExceptionId);
      expect(await db.availabilityException.count({ where: { id: victimExceptionId } })).toBe(1);
    });
  });

  describe("panel de plataforma", () => {
    it("un usuario común no puede operar cuentas ni cambiar precios (ni siquiera la propia)", async () => {
      expect(await run(() => accountOperationAction(victim.organization.id, "suspend"))).toBe("NOT_FOUND");
      expect(await run(() => accountOperationAction(attacker.organization.id, "activate"))).toBe("NOT_FOUND");
      expect(await run(() => updatePlanPriceAction(undefined, form({ price: "1" })))).toBe("NOT_FOUND");

      const [victimOrg, attackerOrg] = await Promise.all([
        db.organization.findUniqueOrThrow({ where: { id: victim.organization.id } }),
        db.organization.findUniqueOrThrow({ where: { id: attacker.organization.id } }),
      ]);
      expect(victimOrg.status).toBe("trial");
      expect(attackerOrg.status).toBe("trial");
    });

    it("con el permiso de plataforma sí puede, y queda registrado en la auditoría", async () => {
      actAs(attacker, {
        user: { id: attacker.userId, email: attacker.ownerEmail, name: "Admin", isPlatformAdmin: true },
      });
      await accountOperationAction(victim.organization.id, "suspend");
      expect((await db.organization.findUniqueOrThrow({ where: { id: victim.organization.id } })).status).toBe("suspended");

      const entry = await db.auditLog.findFirst({
        where: { organizationId: victim.organization.id, action: "admin.account.suspend" },
      });
      expect(entry?.userId).toBe(attacker.userId);

      await accountOperationAction(victim.organization.id, "reactivate");
      expect((await db.organization.findUniqueOrThrow({ where: { id: victim.organization.id } })).status).toBe("trial");
    });

    it("en una instalación independiente el panel no existe ni para un administrador", async () => {
      vi.stubEnv("DEPLOYMENT_MODE", "standalone");
      try {
        actAs(attacker, {
          user: { id: attacker.userId, email: attacker.ownerEmail, name: "Admin", isPlatformAdmin: true },
        });
        expect(await run(() => accountOperationAction(victim.organization.id, "suspend"))).toBe("NOT_FOUND");
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });

  describe("cuenta en solo lectura", () => {
    it("las acciones de escritura se rechazan en el servidor", async () => {
      actAs(attacker, { canWrite: false });

      expect(
        await run(() =>
          createAppointmentAction(
            undefined,
            form({ serviceId: attacker.service.id, date: tomorrow, time: "12:00", customerName: "Cliente" }),
          ),
        ),
      ).toEqual({ message: "solo lectura" });
      expect(
        await run(() => updateServiceAction(attacker.service.id, undefined, form({ name: "Nuevo", durationMinutes: "60" }))),
      ).toEqual({ message: "solo lectura" });
      await setServiceActiveAction(attacker.service.id, false);

      const service = await db.service.findUniqueOrThrow({ where: { id: attacker.service.id } });
      expect(service).toMatchObject({ name: "Consulta", active: true });
      expect(await db.appointment.count({ where: { organizationId: attacker.organization.id } })).toBe(0);
    });
  });

  describe("onboarding", () => {
    it("reenviar un paso con el onboarding ya terminado no reemplaza los servicios", async () => {
      const organization = await db.organization.update({
        where: { id: attacker.organization.id },
        data: { onboardingCompletedAt: new Date() },
      });
      actAs({ ...attacker, organization });

      const result = await run(() =>
        saveServicesStep(undefined, form({ services: JSON.stringify([{ name: "Otro", durationMinutes: 15, price: null }]) })),
      );
      expect(result).toBe("REDIRECT:/dashboard");

      const services = await db.service.findMany({ where: { organizationId: attacker.organization.id } });
      expect(services.map((s) => s.name)).toEqual(["Consulta"]);
    });
  });
});
