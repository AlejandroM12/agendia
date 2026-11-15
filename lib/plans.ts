import type { OrganizationStatus } from "@prisma/client";
import { offers, pricing } from "@/lib/brand";
import { teamPlansPublished } from "@/lib/features";

/**
 * Capacidades y límites de los planes: la única definición.
 *
 * Los dos planes comparten TODAS las funcionalidades; lo único que los
 * diferencia es cuántos profesionales activos admiten (y el precio). Todo lo
 * que dependa del plan se consulta acá y se valida en el servidor
 * (modules/team/professionals.ts); la interfaz solo lo muestra.
 *
 * Los importes salen de lib/brand.ts (`pricing`): un solo lugar para el
 * precio de lista. El precio que se COBRA es el de la tabla `plans` (ver
 * modules/billing/catalog.ts, que impide cobrar si difiere del publicado).
 */

export type PlanTier = "profesional" | "equipo";

export const PLAN_CAPABILITIES: Record<
  PlanTier,
  { name: string; licenseName: string; maxActiveProfessionals: number; code: string; monthlyPrice: number; licensePrice: number }
> = {
  // `mensual` es el código histórico del Plan Profesional en la base de datos.
  profesional: { name: offers.monthly, licenseName: offers.licenseProfessional, maxActiveProfessionals: 2, code: "mensual", monthlyPrice: pricing.monthly, licensePrice: pricing.oneTime },
  equipo: { name: offers.team, licenseName: offers.licenseTeam, maxActiveProfessionals: 5, code: "equipo", monthlyPrice: pricing.teamMonthly, licensePrice: pricing.licenseTeam },
};

export const PLAN_TIERS = Object.keys(PLAN_CAPABILITIES) as PlanTier[];

/** Durante la prueba gratuita de 14 días se permiten los mismos cupos que el Plan Profesional. */
export const TRIAL_MAX_PROFESSIONALS = PLAN_CAPABILITIES.profesional.maxActiveProfessionals;

/**
 * Tier de un plan a partir de su código. `mensual` es el código histórico
 * del Plan Profesional; un código desconocido cae en el más restrictivo,
 * nunca en el más generoso.
 */
export function planTierFromCode(code: string | null | undefined): PlanTier {
  return code === PLAN_CAPABILITIES.equipo.code ? "equipo" : "profesional";
}

/**
 * Nombre comercial de la licencia de un nivel. Mientras los planes con equipo no están publicados
 * existe una sola licencia pública: «Licencia independiente».
 */
export function licenseDisplayName(tier: PlanTier): string {
  return teamPlansPublished() ? PLAN_CAPABILITIES[tier].licenseName : offers.license;
}

export function parsePlanTier(value: unknown): PlanTier | null {
  return value === "profesional" || value === "equipo" ? value : null;
}

/**
 * Nivel de una instalación independiente: lo define la licencia comprada
 * (`LICENSE_TIER`), no una suscripción. Sin valor o con uno desconocido es la
 * Licencia Profesional (el más restrictivo).
 */
export function standaloneTier(): PlanTier {
  return parsePlanTier(process.env.LICENSE_TIER) ?? "profesional";
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
 * - Instalación independiente: el de su licencia (`standaloneTier`).
 * - En prueba, o con la cuenta cancelada o suspendida: el de la prueba (2).
 * - Con suscripción: el del plan. **El cupo del Plan Equipo solo rige con un
 *   pago verificado** (`paymentVerified`): haber vuelto de la pantalla de pago
 *   o tener la suscripción autorizada no alcanza. El Plan Profesional tiene el
 *   mismo cupo que la prueba, así que no hay nada que verificar.
 * - `extraProfessionals` suma cupos adicionales en cualquier caso (ampliación pactada).
 */
export function resolveProfessionalLimit(input: {
  standalone: boolean;
  status: OrganizationStatus;
  planCode: string | null | undefined;
  extraProfessionals: number;
  paymentVerified?: boolean;
  licenseTier?: PlanTier;
}): ProfessionalLimit {
  const extra = Math.max(0, Math.trunc(input.extraProfessionals || 0));

  if (input.standalone) {
    const tier = input.licenseTier ?? standaloneTier();
    const base = PLAN_CAPABILITIES[tier].maxActiveProfessionals;
    return { limit: base + extra, base, extra, source: "standalone", tier };
  }
  if (TRIAL_STATUSES.has(input.status) || input.status === "canceled" || input.status === "suspended") {
    return { limit: TRIAL_MAX_PROFESSIONALS + extra, base: TRIAL_MAX_PROFESSIONALS, extra, source: "trial", tier: null };
  }
  let tier = planTierFromCode(input.planCode);
  if (tier === "equipo" && !input.paymentVerified) tier = "profesional";
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
