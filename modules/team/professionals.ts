import "server-only";

import type { Organization, Prisma, PrismaClient, Professional } from "@prisma/client";
import { db } from "@/lib/db";
import { isTeamModeEnabled } from "@/lib/features";
import { canPerformWriteActions } from "@/lib/organization-access";
import { isStandalone } from "@/lib/deployment";
import {
  evaluateProfessionalQuota,
  resolveProfessionalLimit,
  type ProfessionalQuota,
} from "@/lib/plans";
import { normalizeHexColor, DEFAULT_THEME } from "@/lib/theme";

type Client = PrismaClient | Prisma.TransactionClient;
type OrgRef = Pick<Organization, "id" | "status" | "extraProfessionals" | "teamModeEnabled">;
/** Lo que hace falta para escribir: el estado comercial decide si la cuenta puede modificar datos. */
type WritableOrg = Pick<Organization, "id" | "status" | "trialEndsAt" | "readonlyUntil">;
type TeamOrg = OrgRef & WritableOrg;

/**
 * Gestión de profesionales (capa de servicio; la pantalla «Equipo» llega en
 * la etapa 2). Todo se valida acá, en el servidor:
 *
 * - el profesional, el servicio y los bloqueos deben ser de la organización
 *   del que llama (las claves foráneas compuestas de la base son la segunda barrera);
 * - los cupos del plan se verifican al crear y al reactivar, dentro de una
 *   transacción con un lock por organización: dos altas simultáneas nunca
 *   superan el límite;
 * - el modo equipo apagado impide tener más de un profesional;
 * - un profesional con turnos futuros no se puede desactivar sin resolverlos.
 */

export type TeamFailure = {
  ok: false;
  code: "team_disabled" | "quota_exceeded" | "read_only" | "not_found" | "has_future_appointments" | "invalid";
  message: string;
  quota?: ProfessionalQuota;
  futureAppointments?: number;
};
export type TeamResult<T> = { ok: true; value: T } | TeamFailure;

const failure = (code: TeamFailure["code"], message: string, extra: Partial<TeamFailure> = {}): TeamFailure => ({
  ok: false,
  code,
  message,
  ...extra,
});

const READ_ONLY = failure("read_only", "Tu cuenta está en modo de solo lectura.");
const TEAM_DISABLED = failure(
  "team_disabled",
  "Los equipos con varios profesionales todavía no están habilitados para tu negocio.",
);

/** Serializa las altas y reactivaciones de un negocio: es lo que hace seguro el límite de cupos. */
async function lockTeam(tx: Prisma.TransactionClient, organizationId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`team:${organizationId}`}))`;
}

/** Cupos de profesionales del negocio según su plan (o prueba, o instalación independiente). */
export async function getProfessionalQuota(client: Client, organization: OrgRef): Promise<ProfessionalQuota> {
  const [active, subscription] = await Promise.all([
    client.professional.count({ where: { organizationId: organization.id, active: true } }),
    client.subscription.findUnique({
      where: { organizationId: organization.id },
      select: { plan: { select: { code: true } } },
    }),
  ]);
  const limit = resolveProfessionalLimit({
    standalone: isStandalone(),
    status: organization.status,
    planCode: subscription?.plan.code,
    extraProfessionals: organization.extraProfessionals,
  });
  return evaluateProfessionalQuota(limit, active);
}

export type NewProfessional = {
  displayName: string;
  description?: string | null;
  color?: string;
  bookableOnline?: boolean;
  /** `false` crea el profesional ya desactivado (no ocupa cupo). */
  active?: boolean;
};

export async function createProfessional(
  organization: TeamOrg,
  input: NewProfessional,
): Promise<TeamResult<Professional>> {
  if (!canPerformWriteActions(organization)) return READ_ONLY;

  const displayName = input.displayName?.trim() ?? "";
  if (displayName.length < 2 || displayName.length > 80) {
    return failure("invalid", "Ingresá el nombre del profesional (entre 2 y 80 caracteres).");
  }
  const color = input.color === undefined ? DEFAULT_THEME.primary : normalizeHexColor(input.color);
  if (!color) return failure("invalid", "El color no es válido.");
  const description = input.description?.trim().slice(0, 300) || null;
  const active = input.active ?? true;

  return db.$transaction(async (tx) => {
    await lockTeam(tx, organization.id);

    const existing = await tx.professional.count({ where: { organizationId: organization.id } });
    if (existing >= 1 && !isTeamModeEnabled(organization)) return TEAM_DISABLED;

    if (active) {
      const quota = await getProfessionalQuota(tx, organization);
      if (!quota.canAdd) {
        return failure(
          "quota_exceeded",
          `Tu plan admite hasta ${quota.limit} profesionales activos y ya los tenés. Desactivá uno o cambiá de plan.`,
          { quota },
        );
      }
    }

    const last = await tx.professional.aggregate({
      where: { organizationId: organization.id },
      _max: { sortOrder: true },
    });
    const professional = await tx.professional.create({
      data: {
        organizationId: organization.id,
        displayName,
        description,
        color,
        bookableOnline: input.bookableOnline ?? true,
        active,
        sortOrder: (last._max.sortOrder ?? -1) + 1,
      },
    });
    return { ok: true as const, value: professional };
  });
}

/**
 * Activa o desactiva un profesional.
 * - Activar respeta el cupo del plan (y el modo equipo).
 * - Desactivar exige que no tenga turnos futuros confirmados: hay que
 *   reasignarlos o cancelarlos antes. El historial nunca se borra.
 */
export async function setProfessionalActive(
  organization: TeamOrg,
  professionalId: string,
  active: boolean,
  now: Date = new Date(),
): Promise<TeamResult<Professional>> {
  if (!canPerformWriteActions(organization)) return READ_ONLY;

  return db.$transaction(async (tx) => {
    await lockTeam(tx, organization.id);

    const professional = await tx.professional.findFirst({
      where: { id: professionalId, organizationId: organization.id },
    });
    if (!professional) return failure("not_found", "No encontramos a ese profesional.");
    if (professional.active === active) return { ok: true as const, value: professional };

    if (active) {
      const othersActive = await tx.professional.count({ where: { organizationId: organization.id, active: true } });
      if (othersActive >= 1 && !isTeamModeEnabled(organization)) return TEAM_DISABLED;
      const quota = await getProfessionalQuota(tx, organization);
      if (!quota.canAdd) {
        return failure(
          "quota_exceeded",
          `Tu plan admite hasta ${quota.limit} profesionales activos y ya los tenés. Desactivá uno o cambiá de plan.`,
          { quota },
        );
      }
    } else {
      const future = await tx.appointment.count({
        where: { organizationId: organization.id, professionalId, status: "confirmed", startsAt: { gt: now } },
      });
      if (future > 0) {
        return failure(
          "has_future_appointments",
          `Tiene ${future} ${future === 1 ? "turno futuro" : "turnos futuros"}. Reasignalos o cancelalos antes de desactivarlo.`,
          { futureAppointments: future },
        );
      }
    }

    const updated = await tx.professional.update({ where: { id: professional.id }, data: { active } });
    return { ok: true as const, value: updated };
  });
}

/**
 * Qué profesionales realizan un servicio: `"all"` (todos los activos) o una
 * lista concreta. Todos los identificadores se verifican contra la
 * organización antes de escribir nada.
 */
export async function setServiceProfessionals(
  organization: WritableOrg,
  serviceId: string,
  selection: "all" | string[],
): Promise<TeamResult<{ allProfessionals: boolean; professionalIds: string[] }>> {
  if (!canPerformWriteActions(organization)) return READ_ONLY;

  const service = await db.service.findFirst({ where: { id: serviceId, organizationId: organization.id }, select: { id: true } });
  if (!service) return failure("not_found", "No encontramos ese servicio.");

  if (selection === "all") {
    await db.$transaction([
      db.serviceProfessional.deleteMany({ where: { organizationId: organization.id, serviceId } }),
      db.service.update({ where: { id: serviceId }, data: { allProfessionals: true } }),
    ]);
    return { ok: true, value: { allProfessionals: true, professionalIds: [] } };
  }

  const ids = [...new Set(selection)];
  if (ids.length === 0) return failure("invalid", "Elegí al menos un profesional para este servicio.");
  const owned = await db.professional.count({ where: { organizationId: organization.id, id: { in: ids } } });
  if (owned !== ids.length) return failure("invalid", "Alguno de los profesionales elegidos no pertenece a este negocio.");

  await db.$transaction([
    db.serviceProfessional.deleteMany({ where: { organizationId: organization.id, serviceId } }),
    db.serviceProfessional.createMany({
      data: ids.map((professionalId) => ({ organizationId: organization.id, serviceId, professionalId })),
    }),
    db.service.update({ where: { id: serviceId }, data: { allProfessionals: false } }),
  ]);
  return { ok: true, value: { allProfessionals: false, professionalIds: ids } };
}

export type WeeklyRule = { weekday: number; startMinute: number; endMinute: number };

/** Reemplaza el horario semanal de UN profesional; los de los demás no se tocan. */
export async function saveProfessionalHours(
  organization: WritableOrg,
  professionalId: string,
  rules: WeeklyRule[],
  extra: Prisma.PrismaPromise<unknown>[] = [],
): Promise<TeamResult<{ rules: number }>> {
  if (!canPerformWriteActions(organization)) return READ_ONLY;

  const professional = await db.professional.findFirst({
    where: { id: professionalId, organizationId: organization.id },
    select: { id: true },
  });
  if (!professional) return failure("not_found", "No encontramos a ese profesional.");

  await db.$transaction([
    db.availabilityRule.deleteMany({ where: { organizationId: organization.id, professionalId } }),
    db.availabilityRule.createMany({
      data: rules.map((rule) => ({ organizationId: organization.id, professionalId, ...rule })),
    }),
    ...extra,
  ]);
  return { ok: true, value: { rules: rules.length } };
}

/**
 * Crea un bloqueo. Sin `professionalId` es un bloqueo general (feriado,
 * cierre) que afecta a todos; con uno, solo a ese profesional.
 */
export async function createAvailabilityException(
  organization: WritableOrg,
  input: {
    professionalId: string | null;
    date: Date;
    startMinute: number | null;
    endMinute: number | null;
    reason: string | null;
  },
): Promise<TeamResult<{ id: string }>> {
  if (!canPerformWriteActions(organization)) return READ_ONLY;

  if (input.professionalId) {
    const professional = await db.professional.findFirst({
      where: { id: input.professionalId, organizationId: organization.id },
      select: { id: true },
    });
    if (!professional) return failure("not_found", "No encontramos a ese profesional.");
  }
  const created = await db.availabilityException.create({
    data: {
      organizationId: organization.id,
      professionalId: input.professionalId,
      date: input.date,
      startMinute: input.startMinute,
      endMinute: input.endMinute,
      reason: input.reason,
    },
    select: { id: true },
  });
  return { ok: true, value: created };
}
