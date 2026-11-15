import "server-only";

import type { Plan } from "@prisma/client";
import { db } from "@/lib/db";
import { pricing } from "@/lib/brand";
import { PLAN_CAPABILITIES, type PlanTier } from "@/lib/plans";

/**
 * Catálogo comercial: de dónde sale cada precio y cuál manda.
 *
 * - PRECIO DE LISTA (lo que se muestra: landing, registro, Mi plan, emails):
 *   `pricing` en lib/brand.ts, que lee PRICE_* al construir/arrancar.
 * - PRECIO CONTRATABLE (lo que se manda a Mercado Pago): la fila de `plans`
 *   (se siembra con el precio de lista; la migración crea el Plan Equipo).
 * - La suscripción NO guarda un importe propio: el que autorizó la persona
 *   vive en Mercado Pago y se verifica al sincronizar (`verifyAuthorizedAmount`).
 *
 * Regla: si el precio contratable difiere del de lista NO se vende (se
 * devuelve un error claro y queda en el log): es preferible no cobrar a
 * cobrar un importe distinto del que se mostró. Las suscripciones vigentes no
 * se tocan nunca: conservan lo que autorizaron.
 */

export function listPrice(tier: PlanTier): number {
  return PLAN_CAPABILITIES[tier].monthlyPrice;
}

/** Devuelve el plan del nivel, creándolo (idempotente) con el precio de lista si no existe. */
export async function ensurePlan(tier: PlanTier): Promise<Plan> {
  const capability = PLAN_CAPABILITIES[tier];
  return db.plan.upsert({
    where: { code: capability.code },
    update: {},
    create: { code: capability.code, name: capability.name, price: listPrice(tier), currency: pricing.currency },
  });
}

export type SellablePlan = { ok: true; plan: Plan } | { ok: false; error: string };

/** Plan listo para venderse: activo y con el precio contratable igual al de lista y en ARS. */
export async function getSellablePlan(tier: PlanTier): Promise<SellablePlan> {
  const plan = await ensurePlan(tier);
  if (!plan.active) return { ok: false, error: "Este plan no está disponible por el momento." };
  if (plan.currency !== pricing.currency || plan.price !== listPrice(tier)) {
    console.error(
      `[billing] el precio contratable de ${plan.code} (${plan.price} ${plan.currency}) no coincide con el publicado (${listPrice(tier)} ${pricing.currency}): no se vende hasta corregirlo`,
    );
    return { ok: false, error: "No pudimos confirmar el precio del plan. Escribinos y lo resolvemos." };
  }
  return { ok: true, plan };
}

/** Discrepancias entre lo publicado y lo contratable, para mostrarlas en /admin. */
export async function priceDiscrepancies(): Promise<Array<{ code: string; stored: number; published: number }>> {
  const result: Array<{ code: string; stored: number; published: number }> = [];
  for (const tier of Object.keys(PLAN_CAPABILITIES) as PlanTier[]) {
    const plan = await db.plan.findUnique({ where: { code: PLAN_CAPABILITIES[tier].code } });
    if (plan && (plan.price !== listPrice(tier) || plan.currency !== pricing.currency)) {
      result.push({ code: plan.code, stored: plan.price, published: listPrice(tier) });
    }
  }
  return result;
}
