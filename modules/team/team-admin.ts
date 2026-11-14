import "server-only";

import type { Organization, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { canPerformWriteActions } from "@/lib/organization-access";
import { addDays, dateStrToDbDate, isValidDateStr, toZoned } from "@/lib/time";
import { normalizeHexColor } from "@/lib/theme";
import { getTeamAvailability } from "@/modules/availability/queries";
import { cancelAppointment, reassignAppointment } from "@/modules/appointments/service";
import { PROFESSIONAL_ORDER } from "./eligibility";
import {
  getProfessionalQuota,
  setProfessionalActive,
  type TeamFailure,
  type TeamResult,
  type WeeklyRule,
} from "./professionals";

/**
 * Gestión del equipo (etapa 2): lo que usan las pantallas «Equipo» y
 * «Horarios» para varios profesionales. Todo se valida acá, en el servidor:
 * cada identificador (profesional, servicio, turno, bloqueo) tiene que ser de
 * la organización de la sesión, y la cuenta tiene que poder escribir.
 *
 * Los permisos por rol se piden en la capa de acciones (lib/dal.ts →
 * `requirePermission`); estas funciones no confían en quién las llama para el
 * aislamiento entre negocios.
 */

type Org = Pick<Organization, "id" | "status" | "trialEndsAt" | "readonlyUntil" | "extraProfessionals" | "teamModeEnabled">;

const failure = (code: TeamFailure["code"], message: string, extra: Partial<TeamFailure> = {}): TeamFailure => ({
  ok: false,
  code,
  message,
  ...extra,
});
const READ_ONLY = failure("read_only", "Tu cuenta está en modo de solo lectura.");
const notFoundProfessional = () => failure("not_found", "No encontramos a ese profesional.");

async function lockTeam(tx: Prisma.TransactionClient, organizationId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`team:${organizationId}`}))`;
}

async function audit(
  client: Prisma.TransactionClient | typeof db,
  params: { organizationId: string; userId?: string | null; action: string; entityId: string; metadata?: Prisma.InputJsonValue },
) {
  await client.auditLog.create({
    data: {
      organizationId: params.organizationId,
      userId: params.userId ?? null,
      action: params.action,
      entityType: "professional",
      entityId: params.entityId,
      metadata: params.metadata,
    },
  });
}

/* ------------------------------------------------------------------ */
/* Datos del profesional                                               */
/* ------------------------------------------------------------------ */

export async function updateProfessional(
  organization: Org,
  professionalId: string,
  input: { displayName: string; description?: string | null; color: string; bookableOnline: boolean },
  userId?: string | null,
): Promise<TeamResult<{ id: string }>> {
  if (!canPerformWriteActions(organization)) return READ_ONLY;

  const displayName = input.displayName?.trim() ?? "";
  if (displayName.length < 2 || displayName.length > 80) {
    return failure("invalid", "Ingresá el nombre del profesional (entre 2 y 80 caracteres).");
  }
  const color = normalizeHexColor(input.color);
  if (!color) return failure("invalid", "El color no es válido.");

  const updated = await db.professional.updateMany({
    where: { id: professionalId, organizationId: organization.id },
    data: {
      displayName,
      description: input.description?.trim().slice(0, 300) || null,
      color,
      bookableOnline: input.bookableOnline,
    },
  });
  if (updated.count === 0) return notFoundProfessional();
  await audit(db, { organizationId: organization.id, userId, action: "team.professional.update", entityId: professionalId });
  return { ok: true, value: { id: professionalId } };
}

/** Sube o baja un profesional en el orden de visualización (y de desempate de la asignación). */
export async function moveProfessional(
  organization: Org,
  professionalId: string,
  direction: "up" | "down",
): Promise<TeamResult<{ id: string }>> {
  if (!canPerformWriteActions(organization)) return READ_ONLY;

  return db.$transaction(async (tx) => {
    await lockTeam(tx, organization.id);
    const all = await tx.professional.findMany({
      where: { organizationId: organization.id },
      orderBy: [...PROFESSIONAL_ORDER],
      select: { id: true },
    });
    const index = all.findIndex((p) => p.id === professionalId);
    if (index === -1) return notFoundProfessional();
    const target = direction === "up" ? index - 1 : index + 1;
    if (target >= 0 && target < all.length) {
      [all[index], all[target]] = [all[target], all[index]];
    }
    // Se renumera todo el equipo: el orden queda secuencial y sin empates.
    for (const [position, professional] of all.entries()) {
      await tx.professional.update({ where: { id: professional.id }, data: { sortOrder: position } });
    }
    return { ok: true as const, value: { id: professionalId } };
  });
}

/**
 * Marca (o desmarca) que un profesional es la persona de la cuenta: el
 * propietario que también atiende. Solo se puede vincular a un usuario que
 * sea miembro de ESTE negocio, y cada usuario atiende en un único lugar.
 */
export async function setProfessionalUser(
  organization: Org,
  professionalId: string,
  userId: string | null,
): Promise<TeamResult<{ id: string }>> {
  if (!canPerformWriteActions(organization)) return READ_ONLY;

  return db.$transaction(async (tx) => {
    const professional = await tx.professional.findFirst({
      where: { id: professionalId, organizationId: organization.id },
      select: { id: true },
    });
    if (!professional) return notFoundProfessional();

    if (userId) {
      const member = await tx.membership.findFirst({
        where: { organizationId: organization.id, userId },
        select: { id: true },
      });
      if (!member) return failure("invalid", "Esa persona no pertenece a este negocio.");
      // Una persona atiende en un solo lugar: se suelta el vínculo anterior.
      await tx.professional.updateMany({
        where: { organizationId: organization.id, userId, id: { not: professionalId } },
        data: { userId: null },
      });
    }
    await tx.professional.update({ where: { id: professionalId }, data: { userId } });
    return { ok: true as const, value: { id: professionalId } };
  });
}

/* ------------------------------------------------------------------ */
/* Panorama del equipo                                                 */
/* ------------------------------------------------------------------ */

export type TeamMember = {
  id: string;
  displayName: string;
  description: string | null;
  color: string;
  active: boolean;
  bookableOnline: boolean;
  sortOrder: number;
  photoImageId: string | null;
  userId: string | null;
  /** Turnos confirmados por venir. */
  futureAppointments: number;
  /** Cantidad de franjas horarias semanales cargadas. */
  hoursRules: number;
  /** Servicios que realiza (de los activos del negocio). */
  serviceCount: number;
};

/** Todos los profesionales del negocio (también los desactivados), con lo que las pantallas necesitan mostrar. */
export async function getTeamOverview(organization: Org, now: Date = new Date()) {
  const [professionals, future, rules, services, quota] = await Promise.all([
    db.professional.findMany({
      where: { organizationId: organization.id },
      orderBy: [{ active: "desc" }, ...PROFESSIONAL_ORDER],
      select: {
        id: true, displayName: true, description: true, color: true, active: true, bookableOnline: true,
        sortOrder: true, photoImageId: true, userId: true,
      },
    }),
    db.appointment.groupBy({
      by: ["professionalId"],
      where: { organizationId: organization.id, status: "confirmed", startsAt: { gt: now } },
      _count: { _all: true },
    }),
    db.availabilityRule.groupBy({
      by: ["professionalId"],
      where: { organizationId: organization.id },
      _count: { _all: true },
    }),
    db.service.findMany({
      where: { organizationId: organization.id, active: true },
      select: { id: true, allProfessionals: true, professionals: { select: { professionalId: true } } },
    }),
    getProfessionalQuota(db, organization),
  ]);

  const futureBy = new Map(future.map((row) => [row.professionalId, row._count._all]));
  const rulesBy = new Map(rules.map((row) => [row.professionalId ?? "", row._count._all]));

  const members: TeamMember[] = professionals.map((p) => ({
    ...p,
    futureAppointments: futureBy.get(p.id) ?? 0,
    hoursRules: rulesBy.get(p.id) ?? 0,
    serviceCount: services.filter((s) => s.allProfessionals || s.professionals.some((l) => l.professionalId === p.id)).length,
  }));
  return { members, quota, activeServices: services.length };
}

/** Servicios del negocio con una marca de cuáles realiza el profesional. */
export async function getProfessionalServices(organizationId: string, professionalId: string) {
  const services = await db.service.findMany({
    where: { organizationId },
    orderBy: [{ active: "desc" }, { sortOrder: "asc" }],
    select: {
      id: true, name: true, active: true, allProfessionals: true,
      professionals: { where: { professionalId }, select: { professionalId: true } },
    },
  });
  return services.map((s) => ({
    id: s.id,
    name: s.name,
    active: s.active,
    performs: s.allProfessionals || s.professionals.length > 0,
  }));
}

/**
 * Define qué servicios realiza un profesional. Un servicio «de todos» se
 * convierte en uno restringido (a los demás profesionales del negocio) si se
 * le quita este profesional. No se le puede quitar un servicio del que tenga
 * turnos futuros: primero hay que resolverlos.
 */
export async function setProfessionalServices(
  organization: Org,
  professionalId: string,
  serviceIds: string[],
  now: Date = new Date(),
): Promise<TeamResult<{ servicesWithoutProfessional: string[] }>> {
  if (!canPerformWriteActions(organization)) return READ_ONLY;

  return db.$transaction(async (tx) => {
    await lockTeam(tx, organization.id);
    const professional = await tx.professional.findFirst({
      where: { id: professionalId, organizationId: organization.id },
      select: { id: true },
    });
    if (!professional) return notFoundProfessional();

    const [services, allProfessionals] = await Promise.all([
      tx.service.findMany({
        where: { organizationId: organization.id },
        select: { id: true, name: true, active: true, allProfessionals: true, professionals: { select: { professionalId: true } } },
      }),
      tx.professional.findMany({ where: { organizationId: organization.id }, select: { id: true, active: true } }),
    ]);
    const known = new Set(services.map((s) => s.id));
    const wanted = new Set(serviceIds);
    if ([...wanted].some((id) => !known.has(id))) {
      return failure("invalid", "Alguno de los servicios elegidos no pertenece a este negocio.");
    }

    const without: string[] = [];
    for (const service of services) {
      const linked = new Set(service.professionals.map((l) => l.professionalId));
      const performs = service.allProfessionals || linked.has(professionalId);
      const wants = wanted.has(service.id);

      if (performs && !wants) {
        const future = await tx.appointment.count({
          where: { organizationId: organization.id, professionalId, serviceId: service.id, status: "confirmed", startsAt: { gt: now } },
        });
        if (future > 0) {
          return failure(
            "has_future_appointments",
            `No se puede quitar «${service.name}»: tiene ${future} ${future === 1 ? "turno futuro" : "turnos futuros"} con este profesional. Reasignalos o cancelalos primero.`,
            { futureAppointments: future },
          );
        }
        const remaining = service.allProfessionals
          ? allProfessionals.filter((p) => p.id !== professionalId)
          : allProfessionals.filter((p) => linked.has(p.id) && p.id !== professionalId);
        await tx.serviceProfessional.deleteMany({ where: { organizationId: organization.id, serviceId: service.id } });
        if (remaining.length > 0) {
          await tx.serviceProfessional.createMany({
            data: remaining.map((p) => ({ organizationId: organization.id, serviceId: service.id, professionalId: p.id })),
          });
        }
        await tx.service.update({ where: { id: service.id }, data: { allProfessionals: false } });
        if (service.active && !remaining.some((p) => p.active)) without.push(service.name);
      } else if (!performs && wants) {
        await tx.serviceProfessional.create({
          data: { organizationId: organization.id, serviceId: service.id, professionalId },
        });
      }
    }
    return { ok: true as const, value: { servicesWithoutProfessional: without } };
  });
}

/* ------------------------------------------------------------------ */
/* Horarios y bloqueos                                                 */
/* ------------------------------------------------------------------ */

/** Copia el horario semanal de un profesional a otro (reemplaza el del destino). */
export async function copyProfessionalHours(
  organization: Org,
  fromProfessionalId: string,
  toProfessionalId: string,
): Promise<TeamResult<{ rules: number }>> {
  if (!canPerformWriteActions(organization)) return READ_ONLY;
  if (fromProfessionalId === toProfessionalId) return failure("invalid", "Elegí a otro profesional para copiar sus horarios.");

  const both = await db.professional.findMany({
    where: { organizationId: organization.id, id: { in: [fromProfessionalId, toProfessionalId] } },
    select: { id: true },
  });
  if (both.length !== 2) return notFoundProfessional();

  const source = await db.availabilityRule.findMany({
    where: { organizationId: organization.id, professionalId: fromProfessionalId },
    select: { weekday: true, startMinute: true, endMinute: true },
  });
  if (source.length === 0) return failure("invalid", "Ese profesional todavía no tiene horarios cargados.");

  await db.$transaction([
    db.availabilityRule.deleteMany({ where: { organizationId: organization.id, professionalId: toProfessionalId } }),
    db.availabilityRule.createMany({
      data: source.map((rule) => ({ organizationId: organization.id, professionalId: toProfessionalId, ...rule })),
    }),
  ]);
  return { ok: true, value: { rules: source.length } };
}

const MAX_VACATION_DAYS = 120;

/**
 * Bloquea varios días seguidos (vacaciones, licencia, ausencia). Sin
 * `professionalId` es un cierre general del negocio. Cada día queda como un
 * bloqueo de todo el día, así se puede quitar uno por uno.
 */
export async function createDateRangeBlock(
  organization: Org,
  input: { professionalId: string | null; from: string; to: string; reason: string | null },
  today: string,
): Promise<TeamResult<{ days: number }>> {
  if (!canPerformWriteActions(organization)) return READ_ONLY;
  if (!isValidDateStr(input.from) || !isValidDateStr(input.to)) return failure("invalid", "Elegí las fechas.");
  if (input.from < today) return failure("invalid", "La fecha de inicio ya pasó.");
  if (input.to < input.from) return failure("invalid", "La fecha de fin no puede ser anterior a la de inicio.");

  const dates: string[] = [];
  for (let day = input.from; day <= input.to; day = addDays(day, 1)) {
    dates.push(day);
    if (dates.length > MAX_VACATION_DAYS) return failure("invalid", `Podés bloquear hasta ${MAX_VACATION_DAYS} días seguidos.`);
  }

  if (input.professionalId) {
    const owned = await db.professional.findFirst({
      where: { id: input.professionalId, organizationId: organization.id },
      select: { id: true },
    });
    if (!owned) return notFoundProfessional();
  }
  await db.availabilityException.createMany({
    data: dates.map((date) => ({
      organizationId: organization.id,
      professionalId: input.professionalId,
      date: dateStrToDbDate(date),
      startMinute: null,
      endMinute: null,
      reason: input.reason?.trim().slice(0, 120) || null,
    })),
  });
  return { ok: true, value: { days: dates.length } };
}

/**
 * Quita un bloqueo. `scope` indica desde qué pantalla se pide: un bloqueo
 * individual no se borra desde la lista de cierres generales ni al revés
 * (no alcanza con que el identificador sea del negocio).
 */
export async function deleteAvailabilityException(
  organization: Org,
  exceptionId: string,
  scope: { professionalId: string | null },
): Promise<TeamResult<{ id: string }>> {
  if (!canPerformWriteActions(organization)) return READ_ONLY;
  const removed = await db.availabilityException.deleteMany({
    where: { id: exceptionId, organizationId: organization.id, professionalId: scope.professionalId },
  });
  if (removed.count === 0) return failure("not_found", "No encontramos ese bloqueo.");
  return { ok: true, value: { id: exceptionId } };
}

export type { WeeklyRule };

/* ------------------------------------------------------------------ */
/* Desactivación: turnos futuros                                       */
/* ------------------------------------------------------------------ */

export type AffectedAppointment = {
  id: string;
  startsAt: Date;
  endsAt: Date;
  customerName: string;
  customerHasEmail: boolean;
  serviceName: string;
  /** Profesionales activos que realizan el servicio y tienen ese horario libre. */
  options: Array<{ id: string; displayName: string }>;
};

/**
 * Turnos futuros confirmados de un profesional, con a quién se podrían pasar
 * (activos, que realicen el servicio y con ese horario libre). La
 * disponibilidad se calcula agrupada por día y duración: una consulta por
 * grupo, no una por turno ni por profesional.
 */
export async function listAffectedAppointments(
  organization: Organization,
  professionalId: string,
  now: Date = new Date(),
): Promise<AffectedAppointment[]> {
  const appointments = await db.appointment.findMany({
    where: { organizationId: organization.id, professionalId, status: "confirmed", startsAt: { gt: now } },
    orderBy: { startsAt: "asc" },
    take: 500,
    select: {
      id: true, startsAt: true, endsAt: true, serviceId: true,
      customer: { select: { name: true, email: true } },
      service: { select: { name: true, allProfessionals: true, professionals: { select: { professionalId: true } } } },
    },
  });
  if (appointments.length === 0) return [];

  const others = await db.professional.findMany({
    where: { organizationId: organization.id, active: true, id: { not: professionalId } },
    orderBy: [...PROFESSIONAL_ORDER],
    select: { id: true, displayName: true },
  });

  const groups = new Map<string, { dateStr: string; durationMinutes: number }>();
  for (const a of appointments) {
    const dateStr = toZoned(a.startsAt, organization.timezone).dateStr;
    const durationMinutes = Math.round((a.endsAt.getTime() - a.startsAt.getTime()) / 60000);
    groups.set(`${dateStr}|${durationMinutes}`, { dateStr, durationMinutes });
  }
  const freeByGroup = new Map<string, Map<number, Set<string>>>();
  if (others.length > 0) {
    for (const [key, group] of groups) {
      const [day] = await getTeamAvailability({
        organization: { ...organization, maxAdvanceDays: 730 },
        professionalIds: others.map((o) => o.id),
        durationMinutes: group.durationMinutes,
        fromDateStr: group.dateStr,
        days: 1,
        applyNotice: false,
      });
      freeByGroup.set(key, new Map(day.slots.map((slot) => [slot.start.getTime(), new Set(slot.professionalIds)])));
    }
  }

  return appointments.map((a) => {
    const dateStr = toZoned(a.startsAt, organization.timezone).dateStr;
    const durationMinutes = Math.round((a.endsAt.getTime() - a.startsAt.getTime()) / 60000);
    const free = freeByGroup.get(`${dateStr}|${durationMinutes}`)?.get(a.startsAt.getTime()) ?? new Set<string>();
    const performs = new Set(a.service.professionals.map((l) => l.professionalId));
    return {
      id: a.id,
      startsAt: a.startsAt,
      endsAt: a.endsAt,
      customerName: a.customer.name,
      customerHasEmail: Boolean(a.customer.email),
      serviceName: a.service.name,
      options: others.filter((o) => free.has(o.id) && (a.service.allProfessionals || performs.has(o.id))),
    };
  });
}

export type BulkOutcome = { done: number; failed: Array<{ appointmentId: string; message: string }> };

/**
 * Resuelve turnos futuros de un profesional con una decisión explícita del
 * administrador: pasarlos a otro (`reassign`) o cancelarlos (`cancel`). Cada
 * turno se procesa por separado (misma validación y transacción que una
 * reasignación o cancelación individual): si alguno falla, el resto sigue y
 * el resultado informa cuáles quedaron pendientes.
 */
export async function resolveFutureAppointments(
  organization: Organization,
  professionalId: string,
  decision: { kind: "reassign"; toProfessionalId: string } | { kind: "cancel" },
  userId?: string | null,
  now: Date = new Date(),
): Promise<TeamResult<BulkOutcome>> {
  if (!canPerformWriteActions(organization)) return READ_ONLY;

  const professional = await db.professional.findFirst({
    where: { id: professionalId, organizationId: organization.id },
    select: { id: true },
  });
  if (!professional) return notFoundProfessional();
  if (decision.kind === "reassign" && decision.toProfessionalId === professionalId) {
    return failure("invalid", "Elegí a otro profesional.");
  }

  const pending = await db.appointment.findMany({
    where: { organizationId: organization.id, professionalId, status: "confirmed", startsAt: { gt: now } },
    orderBy: { startsAt: "asc" },
    select: { id: true },
  });

  const outcome: BulkOutcome = { done: 0, failed: [] };
  for (const { id } of pending) {
    const result =
      decision.kind === "reassign"
        ? await reassignAppointment({ organization, appointmentId: id, professionalId: decision.toProfessionalId, userId, now })
        : await cancelAppointment({ organization, appointmentId: id, actor: "professional" });
    if (result.ok) outcome.done++;
    else outcome.failed.push({ appointmentId: id, message: result.message });
  }
  await audit(db, {
    organizationId: organization.id,
    userId,
    action: decision.kind === "reassign" ? "team.professional.reassign_all" : "team.professional.cancel_all",
    entityId: professionalId,
    metadata: { done: outcome.done, failed: outcome.failed.length },
  });
  return { ok: true, value: outcome };
}

/** Desactiva al profesional (los turnos futuros ya tienen que estar resueltos) y deja el registro. */
export async function deactivateProfessional(
  organization: Org,
  professionalId: string,
  userId?: string | null,
  now?: Date,
) {
  const result = await setProfessionalActive(organization, professionalId, false, now);
  if (result.ok) await audit(db, { organizationId: organization.id, userId, action: "team.professional.deactivate", entityId: professionalId });
  return result;
}

export async function activateProfessional(organization: Org, professionalId: string, userId?: string | null) {
  const result = await setProfessionalActive(organization, professionalId, true);
  if (result.ok) await audit(db, { organizationId: organization.id, userId, action: "team.professional.activate", entityId: professionalId });
  return result;
}
