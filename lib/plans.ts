import type { OrganizationStatus } from "@prisma/client";

/**
 * Capacidades y límites de los planes: la única definición.
 *
 * Todo lo que dependa del plan (cupos de profesionales hoy; otras
 * capacidades mañana) se consulta acá y se valida en el servidor
 * (modules/team/professionals.ts). Nada de esto toca precios,
 * suscripciones ni Mercado Pago: son capacidades, no condiciones de cobro.
 *
 * Sin dependencias del servidor: lo puede importar también la interfaz para
 * mostrar cupos, pero la validación que cuenta es la del backend.
 */

export type PlanTier = "profesional" | "equipo";

export const PLAN_CAPABILITIES: Record<PlanTier, { name: string; maxActiveProfessionals: number }> = {
  profesional: { name: "Plan Profesional", maxActiveProfessionals: 2 },
  equipo: { name: "Plan Equipo", maxActiveProfessionals: 5 },
};

/** Durante la prueba gratuita de 7 días se permiten los mismos cupos que el Plan Profesional. */
export const TRIAL_MAX_PROFESSIONALS = PLAN_CAPABILITIES.profesional.maxActiveProfessionals;

/**
 * Instalación independiente. Provisorio: las condiciones comerciales del
 * modo standalone todavía no están definidas; se usa el cupo del Plan
 * Profesional y se puede ampliar con `Organization.extraProfessionals`.
 */
export const STANDALONE_MAX_PROFESSIONALS = PLAN_CAPABILITIES.profesional.maxActiveProfessionals;

/**
 * Tier de un plan a partir de su código. `mensual` es el código histórico
 * del plan único actual (hoy «Plan Profesional»); un código desconocido cae
 * en el más restrictivo, nunca en el más generoso.
 */
export function planTierFromCode(code: string | null | undefined): PlanTier {
  return code === "equipo" ? "equipo" : "profesional";
}

export type ProfessionalLimit = {
  /** Cupos totales de profesionales activos (base + adicionales). */
  limit: number;
  base: number;
  extra: number;
  source: "trial" | "plan" | "standalone";
  tier: PlanTier | null;
};

const TRIAL_STATUSES: ReadonlySet<OrganizationStatus> = new Set(["trial", "trial_readonly", "locked"]);

/**
 * Cuántos profesionales activos admite un negocio.
 *
 * - Instalación independiente: cupo propio (`STANDALONE_MAX_PROFESSIONALS`).
 * - En prueba: `TRIAL_MAX_PROFESSIONALS`.
 * - Con plan: el del tier (una activación manual sin suscripción cuenta como Plan Profesional).
 * - `extraProfessionals` suma cupos adicionales en cualquier caso (futuras ampliaciones).
 */
export function resolveProfessionalLimit(input: {
  standalone: boolean;
  status: OrganizationStatus;
  planCode: string | null | undefined;
  extraProfessionals: number;
}): ProfessionalLimit {
  const extra = Math.max(0, Math.trunc(input.extraProfessionals || 0));

  if (input.standalone) {
    return { limit: STANDALONE_MAX_PROFESSIONALS + extra, base: STANDALONE_MAX_PROFESSIONALS, extra, source: "standalone", tier: null };
  }
  if (TRIAL_STATUSES.has(input.status)) {
    return { limit: TRIAL_MAX_PROFESSIONALS + extra, base: TRIAL_MAX_PROFESSIONALS, extra, source: "trial", tier: null };
  }
  const tier = planTierFromCode(input.planCode);
  const base = PLAN_CAPABILITIES[tier].maxActiveProfessionals;
  return { limit: base + extra, base, extra, source: "plan", tier };
}

export type ProfessionalQuota = ProfessionalLimit & {
  active: number;
  available: number;
  /** Hay más profesionales activos que cupos (por ejemplo, tras bajar de plan). */
  overLimit: boolean;
  /** ¿Se puede crear o reactivar uno más? */
  canAdd: boolean;
};

export function evaluateProfessionalQuota(limit: ProfessionalLimit, active: number): ProfessionalQuota {
  return {
    ...limit,
    active,
    available: Math.max(0, limit.limit - active),
    overLimit: active > limit.limit,
    canAdd: active < limit.limit,
  };
}

/**
 * Política de una reducción de plan (diseño; la reducción de plan en sí
 * llega con la integración comercial). Nunca se borra ni se desactiva nada
 * automáticamente: los profesionales, sus turnos y su historial se
 * conservan. Mientras haya más profesionales activos que cupos no se puede
 * crear ni reactivar ninguno, y es el administrador quien elige a quién
 * desactivar (el flujo de desactivación exige resolver antes sus turnos
 * futuros). Ver docs/MULTI_PROFESSIONAL.md §6.
 */
export function describePlanReduction(active: number, newLimit: number) {
  const excess = Math.max(0, active - newLimit);
  return {
    excess,
    deletesAnything: false as const,
    blocksNewAndReactivation: excess > 0 || active >= newLimit,
    adminMustDeactivate: excess,
  };
}
