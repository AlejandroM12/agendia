import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import { getProfessionalQuota } from "./professionals";

type Client = PrismaClient | Prisma.TransactionClient;

/**
 * Exceso de cupo tras bajar de plan (Equipo → Profesional) y período de adaptación.
 *
 * POLÍTICA (documentada en docs/COMMERCIAL.md §6; el texto que ve el propietario sale de
 * `describeCapacityPolicy`):
 *
 * 1. Nunca se borra ni se desactiva nada solo, ni se cancela ningún turno. Los perfiles,
 *    cuentas, membresías, clientes e historial se conservan.
 * 2. Cuando el plan efectivo admite menos profesionales activos de los que hay, empieza un
 *    período de adaptación (`capacityGraceDays`, 7 días por defecto) desde ese momento.
 *    Durante el período todo sigue funcionando; no se pueden agregar ni reactivar profesionales.
 * 3. Terminado el período, los profesionales excedentes dejan de recibir reservas NUEVAS
 *    (página pública, asignación automática y turnos cargados en la agenda). Quiénes
 *    quedan lo decide el propietario (`keepBookable`); sin elección, un criterio fijo
 *    que prioriza la continuidad: (a) quien está vinculado a una cuenta de propietario,
 *    (b) quien tiene más turnos futuros confirmados, (c) el orden del equipo.
 * 4. Los profesionales excedentes siguen atendiendo y gestionando los turnos ya confirmados
 *    según sus permisos. Se pueden reprogramar, pero no más allá de `RESCHEDULE_HORIZON_DAYS`
 *    desde el fin del período (así no se usa la reprogramación para eludir el límite).
 * 5. Recontratar el Plan Equipo (con pago verificado) devuelve el cupo completo: el exceso
 *    desaparece y el período se cierra solo.
 */

export const RESCHEDULE_HORIZON_DAYS = 30;

export const capacityGraceDays = (): number => {
  const configured = Number(process.env.CAPACITY_GRACE_DAYS ?? 7);
  return Number.isFinite(configured) && configured >= 0 ? Math.trunc(configured) : 7;
};

const DAY_MS = 24 * 3600000;

export type CapacityState = {
  limit: number;
  active: number;
  excess: number;
  graceEndsAt: Date | null;
  /** Ya pasó el período: los excedentes no reciben reservas nuevas. */
  restricting: boolean;
  restrictedIds: string[];
  keepIds: string[];
};

type OrgForCapacity = {
  id: string;
  status: Parameters<typeof getProfessionalQuota>[1]["status"];
  extraProfessionals: number;
  teamModeEnabled: boolean;
  capacityGraceStartedAt: Date | null;
  capacityGraceEndsAt: Date | null;
};

const CAPACITY_SELECT = {
  id: true,
  status: true,
  extraProfessionals: true,
  teamModeEnabled: true,
  capacityGraceStartedAt: true,
  capacityGraceEndsAt: true,
} as const;

/**
 * Orden de prioridad para decidir quiénes siguen recibiendo reservas: primero los que el
 * propietario marcó (`keepBookable = true`), luego los que no marcó nada según el criterio
 * de continuidad, y al final los que pidió dejar fuera. Determinista.
 */
export async function rankProfessionalsForCapacity(client: Client, organizationId: string, now = new Date()) {
  const [professionals, ownerLinks, future] = await Promise.all([
    client.professional.findMany({
      where: { organizationId, active: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }], // = PROFESSIONAL_ORDER (eligibility.ts)
      select: { id: true, displayName: true, keepBookable: true, userId: true },
    }),
    client.membership.findMany({ where: { organizationId, role: "owner" }, select: { userId: true } }),
    client.appointment.groupBy({
      by: ["professionalId"],
      where: { organizationId, status: "confirmed", startsAt: { gt: now } },
      _count: { _all: true },
    }),
  ]);
  const owners = new Set(ownerLinks.map((link) => link.userId));
  const futureCount = new Map(future.map((row) => [row.professionalId, row._count._all]));
  const bucket = (p: { keepBookable: boolean | null }) => (p.keepBookable === true ? 0 : p.keepBookable === null ? 1 : 2);

  return professionals
    .map((p, index) => ({
      ...p,
      index,
      isOwner: p.userId !== null && owners.has(p.userId),
      future: futureCount.get(p.id) ?? 0,
    }))
    .sort(
      (a, b) =>
        bucket(a) - bucket(b) ||
        (bucket(a) === 1 ? Number(b.isOwner) - Number(a.isOwner) || b.future - a.future : 0) ||
        a.index - b.index,
    );
}

export async function getCapacityState(client: Client, organizationId: string, now = new Date()): Promise<CapacityState | null> {
  const organization = await client.organization.findUnique({ where: { id: organizationId }, select: CAPACITY_SELECT });
  if (!organization) return null;
  return capacityStateFor(client, organization, now);
}

async function capacityStateFor(client: Client, organization: OrgForCapacity, now: Date): Promise<CapacityState> {
  const quota = await getProfessionalQuota(client, organization);
  const excess = Math.max(0, quota.active - quota.limit);
  const restricting = excess > 0 && organization.capacityGraceEndsAt !== null && organization.capacityGraceEndsAt <= now;
  let restrictedIds: string[] = [];
  let keepIds: string[] = [];
  if (excess > 0) {
    const ranked = await rankProfessionalsForCapacity(client, organization.id, now);
    keepIds = ranked.slice(0, quota.limit).map((p) => p.id);
    restrictedIds = ranked.slice(quota.limit).map((p) => p.id);
  }
  return {
    limit: quota.limit,
    active: quota.active,
    excess,
    graceEndsAt: excess > 0 ? organization.capacityGraceEndsAt : null,
    restricting,
    restrictedIds: restricting ? restrictedIds : [],
    keepIds,
  };
}

/** Profesionales que hoy NO reciben reservas nuevas por exceso de cupo (vacío casi siempre). */
export async function restrictedProfessionalIds(client: Client, organizationId: string, now = new Date()): Promise<Set<string>> {
  const organization = await client.organization.findUnique({ where: { id: organizationId }, select: CAPACITY_SELECT });
  // Camino rápido: sin período de adaptación vencido no hay restricción.
  if (!organization?.capacityGraceEndsAt || organization.capacityGraceEndsAt > now) return new Set();
  return new Set((await capacityStateFor(client, organization, now)).restrictedIds);
}

/**
 * Límite hasta el cual un profesional restringido puede reprogramar un turno ya confirmado:
 * el más tardío entre la fecha original del turno y el fin del período + horizonte.
 * `null` = sin límite (el profesional no está restringido).
 */
export async function rescheduleCap(
  client: Client,
  organizationId: string,
  appointment: { professionalId: string; startsAt: Date },
  now = new Date(),
): Promise<Date | null> {
  const organization = await client.organization.findUnique({ where: { id: organizationId }, select: CAPACITY_SELECT });
  if (!organization?.capacityGraceEndsAt || organization.capacityGraceEndsAt > now) return null;
  const state = await capacityStateFor(client, organization, now);
  if (!state.restrictedIds.includes(appointment.professionalId)) return null;
  const horizon = new Date(organization.capacityGraceEndsAt.getTime() + RESCHEDULE_HORIZON_DAYS * DAY_MS);
  return horizon > appointment.startsAt ? horizon : appointment.startsAt;
}

export type CapacitySync = "none" | "started" | "recovered" | "running";

/**
 * Pone al día el período de adaptación: lo inicia si hay exceso y todavía no hay uno, lo
 * cierra si el exceso desapareció (se desactivaron profesionales, o se recontrató el Plan
 * Equipo). Idempotente y seguro de ejecutar en paralelo.
 */
export async function syncCapacityGrace(organizationId: string, now = new Date()): Promise<CapacitySync> {
  const organization = await db.organization.findUnique({ where: { id: organizationId }, select: CAPACITY_SELECT });
  if (!organization) return "none";
  const quota = await getProfessionalQuota(db, organization);
  const over = quota.active > quota.limit;

  if (over && !organization.capacityGraceStartedAt) {
    const endsAt = new Date(now.getTime() + capacityGraceDays() * DAY_MS);
    const { count } = await db.organization.updateMany({
      where: { id: organizationId, capacityGraceStartedAt: null },
      data: { capacityGraceStartedAt: now, capacityGraceEndsAt: endsAt },
    });
    if (count === 0) return "running";
    await db.auditLog.create({
      data: {
        organizationId,
        action: "capacity.grace_started",
        entityType: "organization",
        entityId: organizationId,
        metadata: { limit: quota.limit, active: quota.active, endsAt: endsAt.toISOString() },
      },
    });
    return "started";
  }
  if (!over && organization.capacityGraceStartedAt) {
    await db.organization.update({
      where: { id: organizationId },
      data: { capacityGraceStartedAt: null, capacityGraceEndsAt: null },
    });
    await db.auditLog.create({
      data: { organizationId, action: "capacity.recovered", entityType: "organization", entityId: organizationId },
    });
    return "recovered";
  }
  return over ? "running" : "none";
}

/** Organizaciones que pueden tener exceso: más de 2 activos (el mínimo de cualquier plan) o con período abierto. */
export async function organizationsToSyncCapacity(): Promise<string[]> {
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT o."id" FROM "organizations" o
    WHERE o."capacityGraceStartedAt" IS NOT NULL
       OR (SELECT count(*) FROM "professionals" p WHERE p."organizationId" = o."id" AND p."active") > 2
  `;
  return rows.map((row) => row.id);
}

/**
 * El propietario elige quiénes siguen recibiendo reservas. `keepIds` deben ser profesionales
 * activos del negocio y no más que el cupo; el resto queda marcado como "no" (nulo = sin elegir).
 */
export async function setKeepSelection(
  organizationId: string,
  keepIds: string[],
): Promise<{ ok: true } | { ok: false; message: string }> {
  const organization = await db.organization.findUnique({ where: { id: organizationId }, select: CAPACITY_SELECT });
  if (!organization) return { ok: false, message: "No encontramos el negocio." };
  const quota = await getProfessionalQuota(db, organization);
  const unique = [...new Set(keepIds)];
  if (unique.length > quota.limit) {
    return { ok: false, message: `Tu plan admite ${quota.limit} profesionales activos: elegí hasta ${quota.limit}.` };
  }
  const owned = await db.professional.count({ where: { organizationId, active: true, id: { in: unique } } });
  if (owned !== unique.length) return { ok: false, message: "Alguno de los profesionales elegidos no está activo en este negocio." };

  await db.$transaction([
    db.professional.updateMany({ where: { organizationId, active: true, id: { in: unique } }, data: { keepBookable: true } }),
    db.professional.updateMany({ where: { organizationId, active: true, id: { notIn: unique } }, data: { keepBookable: false } }),
    db.auditLog.create({
      data: {
        organizationId,
        action: "capacity.selection_saved",
        entityType: "organization",
        entityId: organizationId,
        metadata: { keepCount: unique.length },
      },
    }),
  ]);
  return { ok: true };
}
