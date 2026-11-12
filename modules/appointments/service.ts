import "server-only";

import { randomBytes } from "node:crypto";
import type { Appointment, AppointmentStatus, Organization, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { toZoned } from "@/lib/time";
import { getAvailability } from "@/modules/availability/queries";
import { findOrCreateCustomer } from "@/modules/customers/service";
import { enqueueAppointmentNotifications } from "@/modules/notifications/enqueue";

export type Actor = "professional" | "customer";

export type AppointmentFailure = {
  ok: false;
  code: "slot_taken" | "unavailable" | "not_found" | "invalid" | "too_late";
  message: string;
};
export type AppointmentResult = { ok: true; appointment: Appointment } | AppointmentFailure;

const fail = (code: AppointmentFailure["code"], message: string): AppointmentFailure => ({
  ok: false,
  code,
  message,
});

const SLOT_TAKEN = fail("slot_taken", "Ese horario acaba de ocuparse. Elegí otro, por favor.");

/**
 * ¿El error viene de la exclusion constraint `appointments_no_overlap`?
 * Es la garantía final contra reservas simultáneas: aunque dos pedidos
 * pasen la validación de disponibilidad al mismo tiempo, PostgreSQL solo
 * deja entrar uno.
 */
export function isOverlapError(error: unknown): boolean {
  const text = error instanceof Error ? `${error.message} ${JSON.stringify(error)}` : String(error);
  return text.includes("appointments_no_overlap") || text.includes("23P01");
}

/**
 * Con varias reservas simultáneas sobre el mismo horario, PostgreSQL puede
 * abortar alguna transacción por deadlock en vez de por la constraint.
 * Es un error transitorio: se reintenta, y en el reintento la constraint
 * ya ve el turno ganador y responde "horario ocupado".
 */
function isTransientConflict(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  const text = error instanceof Error ? error.message : String(error);
  return code === "P2034" || /deadlock|write conflict|40P01|40001/i.test(text);
}

async function withConflictRetry<T>(run: () => Promise<T>, attempts = 4): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (attempt >= attempts || isOverlapError(error) || !isTransientConflict(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25 * attempt + Math.random() * 50));
    }
  }
}

const TX_OPTIONS = { maxWait: 10_000, timeout: 15_000 } as const;

/**
 * Pone en fila las escrituras de agenda de un mismo profesional (lock
 * transaccional de PostgreSQL, se libera solo al terminar la transacción).
 * Así, ante muchas reservas simultáneas, cada una ve el resultado de la
 * anterior y la constraint responde de inmediato, sin deadlocks.
 */
async function lockProfessionalAgenda(tx: Prisma.TransactionClient, professionalId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${professionalId}))`;
}

function newManageToken(): string {
  return randomBytes(24).toString("base64url");
}

async function isSlotOffered(params: {
  organization: Organization;
  durationMinutes: number;
  startsAt: Date;
  ignoreAppointmentId?: string;
}): Promise<boolean> {
  const { dateStr } = toZoned(params.startsAt, params.organization.timezone);
  const [day] = await getAvailability({
    organization: params.organization,
    durationMinutes: params.durationMinutes,
    fromDateStr: dateStr,
    days: 1,
    ignoreAppointmentId: params.ignoreAppointmentId,
  });
  return day.slots.some((slot) => slot.getTime() === params.startsAt.getTime());
}

async function getOrCreateProfessional(organization: Organization) {
  const existing = await db.professional.findFirst({
    where: { organizationId: organization.id, active: true },
    orderBy: { createdAt: "asc" },
  });
  if (existing) return existing;
  return db.professional.create({
    data: { organizationId: organization.id, displayName: organization.name },
  });
}

/**
 * Crea un turno. La reserva pública (`actor: "customer"`) exige que el
 * horario sea uno de los ofrecidos por la disponibilidad real; la agenda
 * interna deja al profesional agendar fuera de su horario habitual, pero
 * en ningún caso se permiten turnos superpuestos.
 */
export async function createAppointment(params: {
  organization: Organization;
  serviceId: string;
  startsAt: Date;
  customer: { id: string } | { name: string; email: string | null; phone: string | null };
  actor: Actor;
  notes?: string | null;
}): Promise<AppointmentResult> {
  const { organization, actor } = params;

  if (Number.isNaN(params.startsAt.getTime())) return fail("invalid", "La fecha u hora no es válida.");

  const service = await db.service.findFirst({
    where: {
      id: params.serviceId,
      organizationId: organization.id,
      ...(actor === "customer" ? { active: true } : {}),
    },
  });
  if (!service) return fail("not_found", "El servicio ya no está disponible.");

  if (actor === "customer") {
    const offered = await isSlotOffered({
      organization,
      durationMinutes: service.durationMinutes,
      startsAt: params.startsAt,
    });
    if (!offered) return fail("unavailable", "Ese horario ya no está disponible. Elegí otro, por favor.");
  }

  const professional = await getOrCreateProfessional(organization);
  const endsAt = new Date(params.startsAt.getTime() + service.durationMinutes * 60000);

  try {
    const appointment = await withConflictRetry(() => db.$transaction(async (tx) => {
      await lockProfessionalAgenda(tx, professional.id);
      let customer;
      if ("id" in params.customer) {
        customer = await tx.customer.findFirst({
          where: { id: params.customer.id, organizationId: organization.id },
        });
        if (!customer) throw new Error("CUSTOMER_NOT_FOUND");
      } else {
        customer = await findOrCreateCustomer(tx, organization.id, params.customer);
      }

      const created = await tx.appointment.create({
        data: {
          organizationId: organization.id,
          professionalId: professional.id,
          serviceId: service.id,
          customerId: customer.id,
          startsAt: params.startsAt,
          endsAt,
          source: actor === "customer" ? "public_booking" : "manual",
          manageToken: newManageToken(),
          notes: params.notes?.trim() || null,
          price: service.price,
        },
      });

      await enqueueAppointmentNotifications(tx, {
        event: "created",
        actor,
        appointment: created,
        customerEmail: customer.email,
        settings: organization,
      });

      return created;
    }, TX_OPTIONS));
    return { ok: true, appointment };
  } catch (error) {
    // Si tras los reintentos sigue habiendo conflicto, otro pedido ganó el horario.
    if (isOverlapError(error) || isTransientConflict(error)) return SLOT_TAKEN;
    if (error instanceof Error && error.message === "CUSTOMER_NOT_FOUND") {
      return fail("not_found", "No encontramos ese cliente.");
    }
    throw error;
  }
}

async function findOwnedAppointment(organizationId: string, appointmentId: string) {
  return db.appointment.findFirst({
    where: { id: appointmentId, organizationId },
    include: { customer: true },
  });
}

function customerDeadlinePassed(organization: Organization, startsAt: Date): boolean {
  return startsAt.getTime() - Date.now() < organization.cancellationNoticeHours * 3600000;
}

export async function rescheduleAppointment(params: {
  organization: Organization;
  appointmentId: string;
  startsAt: Date;
  actor: Actor;
}): Promise<AppointmentResult> {
  const { organization, actor } = params;
  if (Number.isNaN(params.startsAt.getTime())) return fail("invalid", "La fecha u hora no es válida.");

  const current = await findOwnedAppointment(organization.id, params.appointmentId);
  if (!current) return fail("not_found", "No encontramos ese turno.");
  if (current.status !== "confirmed") return fail("invalid", "Solo se pueden reprogramar turnos confirmados.");

  const durationMinutes = Math.round((current.endsAt.getTime() - current.startsAt.getTime()) / 60000);

  if (actor === "customer") {
    if (customerDeadlinePassed(organization, current.startsAt)) {
      return fail("too_late", "Ya no es posible reprogramar este turno online. Comunicate con el negocio.");
    }
    const offered = await isSlotOffered({
      organization,
      durationMinutes,
      startsAt: params.startsAt,
      ignoreAppointmentId: current.id,
    });
    if (!offered) return fail("unavailable", "Ese horario ya no está disponible. Elegí otro, por favor.");
  }

  try {
    const appointment = await withConflictRetry(() => db.$transaction(async (tx) => {
      await lockProfessionalAgenda(tx, current.professionalId);
      const updated = await tx.appointment.update({
        where: { id: current.id },
        data: {
          startsAt: params.startsAt,
          endsAt: new Date(params.startsAt.getTime() + durationMinutes * 60000),
        },
      });
      await enqueueAppointmentNotifications(tx, {
        event: "rescheduled",
        actor,
        appointment: updated,
        customerEmail: current.customer.email,
        settings: organization,
      });
      return updated;
    }, TX_OPTIONS));
    return { ok: true, appointment };
  } catch (error) {
    if (isOverlapError(error) || isTransientConflict(error)) return SLOT_TAKEN;
    throw error;
  }
}

export async function cancelAppointment(params: {
  organization: Organization;
  appointmentId: string;
  actor: Actor;
}): Promise<AppointmentResult> {
  const { organization, actor } = params;

  const current = await findOwnedAppointment(organization.id, params.appointmentId);
  if (!current) return fail("not_found", "No encontramos ese turno.");
  if (current.status === "canceled") return { ok: true, appointment: current };
  if (current.status !== "confirmed") return fail("invalid", "Este turno ya no se puede cancelar.");

  if (actor === "customer" && customerDeadlinePassed(organization, current.startsAt)) {
    return fail("too_late", "Ya no es posible cancelar este turno online. Comunicate con el negocio.");
  }

  const appointment = await db.$transaction(async (tx) => {
    const updated = await tx.appointment.update({
      where: { id: current.id },
      data: { status: "canceled", canceledAt: new Date(), canceledBy: actor },
    });
    await enqueueAppointmentNotifications(tx, {
      event: "canceled",
      actor,
      appointment: updated,
      customerEmail: current.customer.email,
      settings: organization,
    });
    return updated;
  });
  return { ok: true, appointment };
}

/** Marca un turno como completado, ausente, o lo devuelve a confirmado. */
export async function setAppointmentOutcome(params: {
  organizationId: string;
  appointmentId: string;
  status: Extract<AppointmentStatus, "confirmed" | "completed" | "no_show">;
}): Promise<AppointmentResult> {
  const current = await db.appointment.findFirst({
    where: { id: params.appointmentId, organizationId: params.organizationId },
  });
  if (!current) return fail("not_found", "No encontramos ese turno.");
  if (current.status === "canceled") return fail("invalid", "Un turno cancelado no se puede modificar.");

  const appointment = await db.appointment.update({
    where: { id: current.id },
    data: { status: params.status },
  });
  return { ok: true, appointment };
}
