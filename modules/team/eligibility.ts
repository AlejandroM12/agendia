import "server-only";

import type { Organization, Prisma, PrismaClient } from "@prisma/client";
import { isTeamModeEnabled } from "@/lib/features";

type Client = PrismaClient | Prisma.TransactionClient;
type OrgRef = Pick<Organization, "id" | "teamModeEnabled">;

export type TeamProfessional = {
  id: string;
  displayName: string;
  color: string;
  sortOrder: number;
  bookableOnline: boolean;
  description: string | null;
  photoImageId: string | null;
  createdAt: Date;
};

const PROFESSIONAL_SELECT = {
  id: true,
  displayName: true,
  color: true,
  sortOrder: true,
  bookableOnline: true,
  description: true,
  photoImageId: true,
  createdAt: true,
} as const;

/** Orden único de los profesionales: visualización y, a igual carga, desempate de la asignación automática. */
export const PROFESSIONAL_ORDER = [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }] as const;

/** Profesionales activos del negocio, en orden. Siempre acotado a la organización. */
export async function listActiveProfessionals(client: Client, organizationId: string): Promise<TeamProfessional[]> {
  return client.professional.findMany({
    where: { organizationId, active: true },
    orderBy: [...PROFESSIONAL_ORDER],
    select: PROFESSIONAL_SELECT,
  });
}

/**
 * El profesional «de siempre» del negocio: el primero activo. Con el modo
 * equipo apagado es el único que se considera. Si el negocio nunca tuvo un
 * profesional (no debería pasar: el registro crea uno) se crea ahora, como
 * hacía la aplicación al recibir el primer turno.
 */
export async function getOrCreatePrimaryProfessional(client: Client, organization: Pick<Organization, "id" | "name">) {
  const existing = await client.professional.findFirst({
    where: { organizationId: organization.id, active: true },
    orderBy: [...PROFESSIONAL_ORDER],
    select: PROFESSIONAL_SELECT,
  });
  if (existing) return existing;

  // Solo se crea si el negocio no tiene NINGÚN profesional; si los tiene a
  // todos inactivos, no se inventa uno nuevo (ocuparía un cupo sin que nadie lo pida).
  const any = await client.professional.count({ where: { organizationId: organization.id } });
  if (any > 0) return null;
  return client.professional.create({
    data: { organizationId: organization.id, displayName: organization.name },
    select: PROFESSIONAL_SELECT,
  });
}

export type ProfessionalChoice = string | "any" | null | undefined;

export type EligibleResult =
  | { ok: true; professionals: TeamProfessional[]; selection: "specific" | "any"; requestedProfessionalId: string | null }
  | { ok: false; reason: "service_not_found" | "professional_unavailable" | "none_eligible" | "choice_required" };

/**
 * Profesionales que pueden atender un servicio, según quién pregunta.
 *
 * - Siempre: activos y de la organización (la consulta está acotada por
 *   `organizationId`, así que un identificador de otro negocio no devuelve nada).
 * - Servicio restringido: solo los vinculados a él; si no, todos.
 * - Público: además, habilitados para reservas online.
 * - Modo equipo apagado: solo el profesional «de siempre».
 *
 * `choice`: un identificador (profesional concreto), `"any"` (cualquiera) o
 * nada. Sin elección y con varios elegibles, el cliente público recibe
 * «cualquiera» (compatibilidad con páginas abiertas antes de actualizar) y
 * la agenda interna debe elegir uno explícitamente.
 */
export async function resolveEligibleProfessionals(
  client: Client,
  params: {
    organization: OrgRef;
    serviceId: string;
    audience: "public" | "internal";
    choice?: ProfessionalChoice;
  },
): Promise<EligibleResult> {
  const { organization, audience } = params;

  const service = await client.service.findFirst({
    where: { id: params.serviceId, organizationId: organization.id },
    select: { allProfessionals: true, professionals: { select: { professionalId: true } } },
  });
  if (!service) return { ok: false, reason: "service_not_found" };

  const active = await listActiveProfessionals(client, organization.id);
  const linked = new Set(service.professionals.map((link) => link.professionalId));
  let pool = active.filter((p) => service.allProfessionals || linked.has(p.id));
  if (audience === "public") pool = pool.filter((p) => p.bookableOnline);
  if (!isTeamModeEnabled(organization)) pool = pool.filter((p) => p.id === active[0]?.id);

  if (pool.length === 0) return { ok: false, reason: "none_eligible" };

  const choice = params.choice ?? null;
  if (choice && choice !== "any") {
    const chosen = pool.find((p) => p.id === choice);
    if (!chosen) return { ok: false, reason: "professional_unavailable" };
    return { ok: true, professionals: [chosen], selection: "specific", requestedProfessionalId: chosen.id };
  }

  if (choice === "any") return { ok: true, professionals: pool, selection: "any", requestedProfessionalId: null };

  if (pool.length === 1) return { ok: true, professionals: pool, selection: "specific", requestedProfessionalId: null };
  if (audience === "public") return { ok: true, professionals: pool, selection: "any", requestedProfessionalId: null };
  return { ok: false, reason: "choice_required" };
}

/**
 * Cuántos turnos activos tiene cada profesional el día local indicado: es
 * el criterio de la asignación automática (el menos cargado primero).
 */
export async function countActiveAppointmentsByProfessional(
  client: Client,
  params: { organizationId: string; professionalIds: string[]; dayStart: Date; dayEnd: Date },
): Promise<Map<string, number>> {
  const rows = await client.appointment.groupBy({
    by: ["professionalId"],
    where: {
      organizationId: params.organizationId,
      professionalId: { in: params.professionalIds },
      status: { not: "canceled" },
      startsAt: { gte: params.dayStart, lt: params.dayEnd },
    },
    _count: { _all: true },
  });
  return new Map(rows.map((row) => [row.professionalId, row._count._all]));
}

/**
 * Ordena candidatos para la asignación automática: menos turnos ese día
 * primero y, a igualdad, el orden del equipo (sortOrder, alta, id). El
 * criterio es determinista: la misma situación siempre da el mismo resultado.
 * `candidates` debe venir ya en el orden del equipo (así lo entrega
 * `resolveEligibleProfessionals`); el orden estable de `sort` conserva ese desempate.
 */
export function orderByLoad<T extends { id: string }>(candidates: T[], load: Map<string, number>): T[] {
  return [...candidates].sort((a, b) => (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0));
}

/**
 * Profesionales cuyos horarios cuentan para el negocio: todos los activos
 * con el modo equipo encendido, solo el «de siempre» con el modo apagado.
 */
export async function schedulingProfessionalIds(client: Client, organization: OrgRef): Promise<string[]> {
  const active = await listActiveProfessionals(client, organization.id);
  return (isTeamModeEnabled(organization) ? active : active.slice(0, 1)).map((p) => p.id);
}

/** Id del profesional «de siempre» (el primero activo), o `null`. */
export async function primaryProfessionalId(client: Client, organizationId: string): Promise<string | null> {
  const first = await client.professional.findFirst({
    where: { organizationId, active: true },
    orderBy: [...PROFESSIONAL_ORDER],
    select: { id: true },
  });
  return first?.id ?? null;
}
