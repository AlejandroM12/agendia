import "server-only";

import { randomBytes } from "node:crypto";
import type { Appointment, AppointmentStatus, Organization, Prisma, ProfessionalSelection } from "@prisma/client";
import { db } from "@/lib/db";
import { toZoned } from "@/lib/time";
import { getTeamAvailability } from "@/modules/availability/queries";
import { dayBoundsUtc } from "@/modules/availability/slots";
import { findOrCreateCustomer } from "@/modules/customers/service";
import { enqueueAppointmentNotifications } from "@/modules/notifications/enqueue";
import {
  countActiveAppointmentsByProfessional,
  orderByLoad,
  resolveEligibleProfessionals,
  type EligibleResult,
  type ProfessionalChoice,
  type TeamProfessional,
} from "@/modules/team/eligibility";

export type Actor = "professional" | "customer";

export type AppointmentFailure = {
  ok: false;
  code: "slot_taken" | "unavailable" | "not_found" | "invalid" | "too_late";
  message: string;
};
export type AppointmentResult =
  | {
      ok: true;
      appointment: Appointment;
      /** Se devolvió un turno que ya existía (reintento o doble envío con la misma clave). */
      replayed?: boolean;
      /** Al reprogramar, el profesional que tenía antes si cambió. */
      previousProfessionalId?: string;
    }
  | AppointmentFailure;

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
 * deja entrar uno por profesional.
 */
export function isOverlapError(error: unknown): boolean {
  const text = error instanceof Error ? `${error.message} ${JSON.stringify(error)}` : String(error);
  return text.includes("appointments_no_overlap") || text.includes("23P01");
}

/** ¿Violación de la clave única de idempotencia (el mismo envío ya creó un turno)? */
export function isIdempotencyConflict(error: unknown): boolean {
  const text = error instanceof Error ? `${error.message} ${JSON.stringify(error)}` : String(error);
  return (
    (text.includes("23505") || text.includes("P2002") || /unique constraint/i.test(text)) &&
    /idempotencyKey/i.test(text)
  );
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
 *
 * Regla de orden que evita deadlocks: una transacción toma, como máximo, el
 * lock de UN profesional y después, si hace falta, el de un cliente. Nunca
 * dos profesionales a la vez (la asignación automática prueba candidatos
 * uno por vez, cada uno en su propia transacción).
 */
async function lockProfessionalAgenda(tx: Prisma.TransactionClient, professionalId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${professionalId}))`;
}

async function lockCustomer(tx: Prisma.TransactionClient, customerId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`customer:${customerId}`}))`;
}

function newManageToken(): string {
  return randomBytes(24).toString("base64url");
}

/** Claves de idempotencia válidas: cortas y sin caracteres raros. Las demás se ignoran. */
function normalizeIdempotencyKey(key: string | null | undefined): string | null {
  return typeof key === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(key) ? key : null;
}

function eligibilityFailure(
  reason: Extract<EligibleResult, { ok: false }>["reason"],
  audience: "public" | "internal",
): AppointmentFailure {
  switch (reason) {
    case "service_not_found":
      return fail("not_found", "El servicio ya no está disponible.");
    case "professional_unavailable":
      return fail("unavailable", "Ese profesional ya no está disponible para este servicio. Elegí otro, por favor.");
    case "choice_required":
      return fail("invalid", "Elegí un profesional.");
    case "none_eligible":
      return audience === "public"
        ? fail("unavailable", "Este negocio no está tomando reservas online para este servicio en este momento.")
        : fail("unavailable", "No hay profesionales activos que realicen este servicio.");
  }
}

/** Profesionales (de los candidatos) que realmente tienen libre ese horario, según la disponibilidad. */
async function freeProfessionalsAt(params: {
  organization: Organization;
  candidates: TeamProfessional[];
  durationMinutes: number;
  startsAt: Date;
  ignoreAppointmentId?: string;
  /** Agenda interna: sin anticipación mínima ni límite de días hacia adelante (igual que `loadSlotsAction`). */
  internal?: boolean;
}): Promise<TeamProfessional[]> {
  const { dateStr } = toZoned(params.startsAt, params.organization.timezone);
  const [day] = await getTeamAvailability({
    organization: params.internal ? { ...params.organization, maxAdvanceDays: 730 } : params.organization,
    applyNotice: !params.internal,
    professionalIds: params.candidates.map((p) => p.id),
    durationMinutes: params.durationMinutes,
    fromDateStr: dateStr,
    days: 1,
    ignoreAppointmentId: params.ignoreAppointmentId,
  });
  const free = new Set(day.slots.find((slot) => slot.start.getTime() === params.startsAt.getTime())?.professionalIds ?? []);
  return params.candidates.filter((p) => free.has(p.id));
}

/**
 * Orden de intento para la asignación automática: el menos cargado ese día
 * primero y, a igual carga, el orden del equipo. Con una elección concreta
 * o un solo candidato no hay nada que ordenar. `preferred` (reprogramación)
 * pasa al frente si está entre los candidatos.
 */
async function rankCandidates(params: {
  organization: Organization;
  candidates: TeamProfessional[];
  selection: ProfessionalSelection;
  startsAt: Date;
  preferredId?: string;
}): Promise<TeamProfessional[]> {
  let ranked = params.candidates;
  if (params.selection === "any" && ranked.length > 1) {
    const { dateStr } = toZoned(params.startsAt, params.organization.timezone);
    const { start, end } = dayBoundsUtc(dateStr, params.organization.timezone);
    const load = await countActiveAppointmentsByProfessional(db, {
      organizationId: params.organization.id,
      professionalIds: ranked.map((p) => p.id),
      dayStart: start,
      dayEnd: end,
    });
    ranked = orderByLoad(ranked, load);
  }
  if (params.preferredId) {
    const preferred = ranked.find((p) => p.id === params.preferredId);
    if (preferred) ranked = [preferred, ...ranked.filter((p) => p.id !== preferred.id)];
  }
  return ranked;
}

/**
 * Prueba a los candidatos de a uno, cada uno en su propia transacción (con
 * el lock de ese profesional). El primero que entra gana; si el horario ya
 * no está libre para uno, se pasa al siguiente. Si ninguno entra, el
 * horario se ocupó.
 */
async function firstThatFits<T>(
  candidates: TeamProfessional[],
  run: (professional: TeamProfessional) => Promise<T>,
): Promise<{ ok: true; value: T; professional: TeamProfessional } | { ok: false }> {
  for (const professional of candidates) {
    try {
      const value = await withConflictRetry(() => run(professional));
      return { ok: true, value, professional };
    } catch (error) {
      if (isOverlapError(error) || isTransientConflict(error)) continue;
      throw error;
    }
  }
  return { ok: false };
}

/**
 * Crea un turno.
 *
 * - La reserva pública (`actor: "customer"`) exige que el horario sea uno de
 *   los ofrecidos por la disponibilidad real **del profesional** (o de al
 *   menos uno, con «cualquiera»); la agenda interna deja agendar fuera del
 *   horario habitual, pero en ningún caso hay turnos superpuestos de un
 *   mismo profesional. Dos profesionales sí pueden atender a la vez.
 * - `professional`: un identificador, `"any"` (asignación automática) o
 *   nada. Se valida siempre en el servidor: debe ser un profesional activo
 *   de ESTA organización que realice el servicio (y, en público, que
 *   acepte reservas online).
 * - `idempotencyKey`: un reintento o doble envío con la misma clave devuelve
 *   el turno ya creado en lugar de crear otro.
 */
export async function createAppointment(params: {
  organization: Organization;
  serviceId: string;
  startsAt: Date;
  customer: { id: string } | { name: string; email: string | null; phone: string | null };
  actor: Actor;
  notes?: string | null;
  professional?: ProfessionalChoice;
  idempotencyKey?: string | null;
}): Promise<AppointmentResult> {
  const { organization, actor } = params;
  const audience = actor === "customer" ? "public" : "internal";
  const idempotencyKey = normalizeIdempotencyKey(params.idempotencyKey);

  if (Number.isNaN(params.startsAt.getTime())) return fail("invalid", "La fecha u hora no es válida.");

  const service = await db.service.findFirst({
    where: {
      id: params.serviceId,
      organizationId: organization.id,
      ...(actor === "customer" ? { active: true } : {}),
    },
  });
  if (!service) return fail("not_found", "El servicio ya no está disponible.");

  if (idempotencyKey) {
    const replay = await db.appointment.findUnique({
      where: { organizationId_idempotencyKey: { organizationId: organization.id, idempotencyKey } },
    });
    if (replay) return replayResult(replay, params.serviceId, params.startsAt);
  }

  const eligible = await resolveEligibleProfessionals(db, {
    organization,
    serviceId: service.id,
    audience,
    choice: params.professional,
  });
  if (!eligible.ok) return eligibilityFailure(eligible.reason, audience);

  let candidates = eligible.professionals;
  if (actor === "customer") {
    candidates = await freeProfessionalsAt({
      organization,
      candidates,
      durationMinutes: service.durationMinutes,
      startsAt: params.startsAt,
    });
    if (candidates.length === 0) {
      return fail("unavailable", "Ese horario ya no está disponible. Elegí otro, por favor.");
    }
  }
  candidates = await rankCandidates({
    organization,
    candidates,
    selection: eligible.selection,
    startsAt: params.startsAt,
  });

  const endsAt = new Date(params.startsAt.getTime() + service.durationMinutes * 60000);

  try {
    const placed = await firstThatFits(candidates, (professional) =>
      db.$transaction(async (tx) => {
        await lockProfessionalAgenda(tx, professional.id);

        let customer;
        if ("id" in params.customer) {
          customer = await tx.customer.findFirst({
            where: { id: params.customer.id, organizationId: organization.id },
          });
          if (!customer) throw new Error("CUSTOMER_NOT_FOUND");
        } else {
          customer = await findOrCreateCustomer(tx, organization.id, params.customer, {
            completeMissingContact: actor === "professional",
          });
        }

        // Con clave de idempotencia: si ese envío ya creó un turno (otra solicitud
        // simultánea lo hizo mientras esperábamos el lock), se devuelve ese turno.
        if (idempotencyKey) {
          const existing = await tx.appointment.findUnique({
            where: { organizationId_idempotencyKey: { organizationId: organization.id, idempotencyKey } },
          });
          if (existing) return { appointment: existing, replayed: true as const };
        }

        // Sin clave de idempotencia, un segundo envío idéntico del mismo cliente
        // (mismo servicio, horario y pedido de profesional) devuelve el primero.
        // Se serializa por cliente: dos pestañas no pueden crear dos turnos.
        if (actor === "customer" && !idempotencyKey) {
          await lockCustomer(tx, customer.id);
          const duplicate = await tx.appointment.findFirst({
            where: {
              organizationId: organization.id,
              customerId: customer.id,
              serviceId: service.id,
              startsAt: params.startsAt,
              status: { not: "canceled" },
              professionalSelection: eligible.selection,
              requestedProfessionalId: eligible.requestedProfessionalId,
            },
          });
          if (duplicate) return { appointment: duplicate, replayed: true as const };
        }

        const created = await tx.appointment.create({
          data: {
            organizationId: organization.id,
            professionalId: professional.id,
            requestedProfessionalId: eligible.requestedProfessionalId,
            professionalSelection: eligible.selection,
            idempotencyKey,
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

        return { appointment: created, replayed: false as const };
      }, TX_OPTIONS),
    );

    if (!placed.ok) {
      // Si ningún candidato entró porque OTRA solicitud con la misma clave ya creó el turno, es un reintento.
      if (idempotencyKey) {
        const replay = await db.appointment.findUnique({
          where: { organizationId_idempotencyKey: { organizationId: organization.id, idempotencyKey } },
        });
        if (replay) return replayResult(replay, params.serviceId, params.startsAt);
      }
      return SLOT_TAKEN;
    }
    if (placed.value.replayed && idempotencyKey) {
      return replayResult(placed.value.appointment, params.serviceId, params.startsAt);
    }
    return { ok: true, appointment: placed.value.appointment, ...(placed.value.replayed ? { replayed: true } : {}) };
  } catch (error) {
    if (idempotencyKey && isIdempotencyConflict(error)) {
      const replay = await db.appointment.findUnique({
        where: { organizationId_idempotencyKey: { organizationId: organization.id, idempotencyKey } },
      });
      if (replay) return replayResult(replay, params.serviceId, params.startsAt);
    }
    if (error instanceof Error && error.message === "CUSTOMER_NOT_FOUND") {
      return fail("not_found", "No encontramos ese cliente.");
    }
    throw error;
  }
}

function replayResult(existing: Appointment, serviceId: string, startsAt: Date): AppointmentResult {
  if (existing.status === "canceled") {
    return fail("invalid", "Esa reserva ya se canceló. Actualizá la página para reservar de nuevo.");
  }
  // Una clave reutilizada para otro turno distinto no devuelve el primero por error.
  if (existing.serviceId !== serviceId || existing.startsAt.getTime() !== startsAt.getTime()) {
    return fail("invalid", "No pudimos procesar la reserva. Actualizá la página e intentá de nuevo.");
  }
  return { ok: true, appointment: existing, replayed: true };
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

/**
 * Reprograma un turno.
 *
 * - Cliente que eligió un profesional concreto: se mantiene ese profesional.
 * - Cliente que eligió «cualquiera»: se intenta conservar al asignado y, si
 *   no está libre en el nuevo horario, se asigna otro elegible libre. Si el
 *   profesional cambió, el resultado trae `previousProfessionalId`.
 * - Agenda interna: conserva al profesional salvo que se indique
 *   `professional` (reasignación); no exige estar dentro del horario habitual.
 */
export async function rescheduleAppointment(params: {
  organization: Organization;
  appointmentId: string;
  startsAt: Date;
  actor: Actor;
  professional?: ProfessionalChoice;
}): Promise<AppointmentResult> {
  const { organization, actor } = params;
  if (Number.isNaN(params.startsAt.getTime())) return fail("invalid", "La fecha u hora no es válida.");

  const current = await findOwnedAppointment(organization.id, params.appointmentId);
  if (!current) return fail("not_found", "No encontramos ese turno.");
  if (current.status !== "confirmed") return fail("invalid", "Solo se pueden reprogramar turnos confirmados.");

  const durationMinutes = Math.round((current.endsAt.getTime() - current.startsAt.getTime()) / 60000);

  let candidates: TeamProfessional[];
  let selection: ProfessionalSelection = current.professionalSelection;

  if (actor === "customer") {
    if (customerDeadlinePassed(organization, current.startsAt)) {
      return fail("too_late", "Ya no es posible reprogramar este turno online. Comunicate con el negocio.");
    }
    // Elegido por el cliente: se mantiene. «Cualquiera»: cualquiera elegible.
    const choice: ProfessionalChoice =
      current.professionalSelection === "any" ? "any" : (current.requestedProfessionalId ?? current.professionalId);
    const eligible = await resolveEligibleProfessionals(db, {
      organization,
      serviceId: current.serviceId,
      audience: "public",
      choice,
    });
    if (!eligible.ok) {
      return fail("unavailable", "Este turno ya no se puede reprogramar online. Comunicate con el negocio.");
    }
    candidates = await freeProfessionalsAt({
      organization,
      candidates: eligible.professionals,
      durationMinutes,
      startsAt: params.startsAt,
      ignoreAppointmentId: current.id,
    });
    if (candidates.length === 0) {
      return fail("unavailable", "Ese horario ya no está disponible. Elegí otro, por favor.");
    }
  } else if (params.professional) {
    const eligible = await resolveEligibleProfessionals(db, {
      organization,
      serviceId: current.serviceId,
      audience: "internal",
      choice: params.professional,
    });
    if (!eligible.ok) return eligibilityFailure(eligible.reason, "internal");
    candidates = eligible.professionals;
    selection = eligible.selection;
  } else {
    const keep = await db.professional.findFirst({
      where: { id: current.professionalId, organizationId: organization.id },
      select: {
        id: true, displayName: true, color: true, sortOrder: true, bookableOnline: true,
        description: true, photoImageId: true, createdAt: true,
      },
    });
    if (!keep) return fail("not_found", "No encontramos ese turno.");
    candidates = [keep];
  }

  const ranked = await rankCandidates({
    organization,
    candidates,
    selection,
    startsAt: params.startsAt,
    preferredId: current.professionalId,
  });

  try {
    const placed = await firstThatFits(ranked, (professional) =>
      db.$transaction(async (tx) => {
        await lockProfessionalAgenda(tx, professional.id);
        const updated = await tx.appointment.update({
          where: { id: current.id },
          data: {
            professionalId: professional.id,
            ...(params.professional && actor === "professional"
              ? { professionalSelection: selection, requestedProfessionalId: selection === "specific" ? professional.id : null }
              : {}),
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
      }, TX_OPTIONS),
    );
    if (!placed.ok) return SLOT_TAKEN;
    return {
      ok: true,
      appointment: placed.value,
      ...(placed.value.professionalId !== current.professionalId ? { previousProfessionalId: current.professionalId } : {}),
    };
  } catch (error) {
    if (isOverlapError(error) || isTransientConflict(error)) return SLOT_TAKEN;
    throw error;
  }
}

/**
 * Pasa un turno futuro a otro profesional, en el mismo día y horario.
 *
 * Es una decisión explícita del administrador: nunca se reasigna solo. Se
 * valida en el servidor que el turno sea de este negocio y esté confirmado y
 * por venir (el historial no se toca), que el profesional destino esté
 * activo y realice el servicio, y que tenga ese horario libre (atiende ese
 * día, sin bloqueos ni otro turno). Se avisa al cliente por correo.
 */
export async function reassignAppointment(params: {
  organization: Organization;
  appointmentId: string;
  professionalId: string;
  userId?: string | null;
  now?: Date;
}): Promise<AppointmentResult> {
  const { organization } = params;
  const now = params.now ?? new Date();

  const current = await findOwnedAppointment(organization.id, params.appointmentId);
  if (!current) return fail("not_found", "No encontramos ese turno.");
  if (current.status !== "confirmed") return fail("invalid", "Solo se pueden reasignar turnos confirmados.");
  if (current.startsAt.getTime() <= now.getTime()) return fail("invalid", "Este turno ya pasó: no se reasigna.");
  if (current.professionalId === params.professionalId) return { ok: true, appointment: current };

  const eligible = await resolveEligibleProfessionals(db, {
    organization,
    serviceId: current.serviceId,
    audience: "internal",
    choice: params.professionalId,
  });
  if (!eligible.ok) {
    return fail("unavailable", "Ese profesional no está activo o no realiza este servicio.");
  }

  const durationMinutes = Math.round((current.endsAt.getTime() - current.startsAt.getTime()) / 60000);
  const free = await freeProfessionalsAt({
    organization,
    candidates: eligible.professionals,
    durationMinutes,
    startsAt: current.startsAt,
    ignoreAppointmentId: current.id,
    internal: true,
  });
  if (free.length === 0) {
    return fail("unavailable", `${eligible.professionals[0].displayName} no tiene libre ese horario.`);
  }

  try {
    const placed = await firstThatFits(free, (professional) =>
      db.$transaction(async (tx) => {
        await lockProfessionalAgenda(tx, professional.id);
        const updated = await tx.appointment.update({
          where: { id: current.id },
          data: { professionalId: professional.id, professionalSelection: "specific", requestedProfessionalId: professional.id },
        });
        await enqueueAppointmentNotifications(tx, {
          event: "reassigned",
          actor: "professional",
          appointment: updated,
          customerEmail: current.customer.email,
          settings: organization,
        });
        await tx.auditLog.create({
          data: {
            organizationId: organization.id,
            userId: params.userId ?? null,
            action: "team.appointment.reassign",
            entityType: "appointment",
            entityId: current.id,
            metadata: { from: current.professionalId, to: professional.id },
          },
        });
        return updated;
      }, TX_OPTIONS),
    );
    if (!placed.ok) return fail("slot_taken", "Ese profesional acaba de ocupar ese horario.");
    return { ok: true, appointment: placed.value, previousProfessionalId: current.professionalId };
  } catch (error) {
    if (isOverlapError(error) || isTransientConflict(error)) {
      return fail("slot_taken", "Ese profesional acaba de ocupar ese horario.");
    }
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
