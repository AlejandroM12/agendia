import "server-only";

import type { Organization, Subscription } from "@prisma/client";
import { db } from "@/lib/db";
import { brand } from "@/lib/brand";
import { PLAN_CAPABILITIES, planTierFromCode, type PlanTier } from "@/lib/plans";
import { getSellablePlan } from "./catalog";
import { cancelPreapproval, createPreapproval } from "./mercadopago";
import { rankProfessionalsForCapacity, setKeepSelection } from "@/modules/team/capacity";

/**
 * Contratar y cambiar de plan con Mercado Pago.
 *
 * Estrategia (docs/MERCADOPAGO.md §4). No se asume que Mercado Pago permita modificar el importe
 * de una suscripción autorizada ni prorratear: cada plan es SU PROPIA suscripción, y el cambio se
 * hace efectivo solo cuando la nueva está autorizada y su primer cobro aprobado (verificado contra
 * la API, nunca por volver de la pantalla de pago):
 *
 *  - Contratar (sin suscripción vigente): suscripción nueva del plan elegido.
 *  - Profesional → Equipo: suscripción Equipo nueva con cobro inmediato. Recién con el primer cobro
 *    aprobado pasa a regir el Plan Equipo (y sus 5 cupos) y se cancela la del Profesional. No se
 *    reintegra ni prorratea automáticamente lo ya pagado de ese mes (decisión comercial pendiente).
 *  - Equipo → Profesional: suscripción Profesional nueva con primer cobro diferido al fin del
 *    período ya pago. Al autorizarse se cancela la del Equipo (antes de su próximo cobro), así que
 *    no hay doble cobro y el Equipo rige hasta el último día pago. Al cobrarse la primera cuota del
 *    Profesional rige el cupo de 2 y empieza el período de adaptación.
 */

export type ChangeKind = "new" | "upgrade" | "downgrade" | "same";

/**
 * Cuándo rige el plan nuevo en un cambio. `period_end` (predeterminado y recomendado): al terminar el
 * período ya pago, sin cobro adicional hoy y sin perder lo abonado. `now`: solo para Profesional → Equipo,
 * cobra el Equipo completo desde hoy y lo ya pagado del Profesional NO se reintegra solo (docs/MERCADOPAGO.md §4).
 */
export type ChangeTiming = "period_end" | "now";

export function isDeferredChange(
  kind: ChangeKind,
  timing: ChangeTiming,
  subscription: Pick<Subscription, "currentPeriodEnd"> | null,
  now: Date,
): boolean {
  if (kind === "downgrade") return true;
  return kind === "upgrade" && timing === "period_end" && Boolean(subscription?.currentPeriodEnd && subscription.currentPeriodEnd > now);
}

type SubscriptionState = Pick<
  Subscription,
  "status" | "lastPaymentAt" | "currentPeriodEnd" | "pendingProviderSubscriptionId" | "pendingKind" | "pendingEffectiveAt" | "planId"
> & { plan: { code: string; price: number } };

/** ¿La organización tiene hoy una suscripción vigente (activa o en mora)? Una cancelada con período pago no cuenta como vigente para cambiar. */
export function isLiveSubscription(subscription: Pick<Subscription, "status"> | null | undefined): boolean {
  return subscription?.status === "active" || subscription?.status === "past_due";
}

export function changeKind(subscription: SubscriptionState | null, target: PlanTier): ChangeKind {
  if (!isLiveSubscription(subscription)) return "new";
  const current = planTierFromCode(subscription!.plan.code);
  if (current === target) return "same";
  return target === "equipo" ? "upgrade" : "downgrade";
}

export type PlanChangePreview = {
  kind: ChangeKind;
  current: { name: string; price: number; capacity: number } | null;
  target: { tier: PlanTier; name: string; price: number; capacity: number };
  /** Importe que se cobra al autorizar (0 si el primer cobro es diferido). */
  amountToday: number;
  /** Cuándo empieza a regir el plan nuevo, en lenguaje claro. */
  effective: "al aprobarse el pago" | "al finalizar el período ya pago";
  effectiveAt: Date | null;
  /** Solo en una baja: lo que el propietario tiene que ver antes de confirmar. */
  reduction: null | {
    newLimit: number;
    active: number;
    excess: number;
    graceDays: number;
    professionals: Array<{ id: string; name: string; futureAppointments: number; keep: boolean }>;
  };
};

export async function previewPlanChange(
  organization: Pick<Organization, "id" | "status" | "extraProfessionals" | "teamModeEnabled">,
  target: PlanTier,
  now: Date = new Date(),
  timing: ChangeTiming = "period_end",
): Promise<PlanChangePreview> {
  const subscription = await db.subscription.findUnique({ where: { organizationId: organization.id }, include: { plan: true } });
  const kind = changeKind(subscription, target);
  const capability = PLAN_CAPABILITIES[target];
  const currentTier = kind === "new" || !subscription ? null : planTierFromCode(subscription.plan.code);
  const deferred = isDeferredChange(kind, timing, subscription, now);

  let reduction: PlanChangePreview["reduction"] = null;
  if (kind === "downgrade") {
    const ranked = await rankProfessionalsForCapacity(db, organization.id, now);
    const keep = new Set(ranked.slice(0, capability.maxActiveProfessionals).map((p) => p.id));
    reduction = {
      newLimit: capability.maxActiveProfessionals,
      active: ranked.length,
      excess: Math.max(0, ranked.length - capability.maxActiveProfessionals),
      graceDays: Number(process.env.CAPACITY_GRACE_DAYS ?? 7),
      professionals: ranked.map((p) => ({ id: p.id, name: p.displayName, futureAppointments: p.future, keep: keep.has(p.id) })),
    };
  }

  return {
    kind,
    current: currentTier
      ? { name: PLAN_CAPABILITIES[currentTier].name, price: PLAN_CAPABILITIES[currentTier].monthlyPrice, capacity: PLAN_CAPABILITIES[currentTier].maxActiveProfessionals }
      : null,
    target: { tier: target, name: capability.name, price: capability.monthlyPrice, capacity: capability.maxActiveProfessionals },
    amountToday: deferred ? 0 : capability.monthlyPrice,
    effective: deferred ? "al finalizar el período ya pago" : "al aprobarse el pago",
    effectiveAt: deferred ? (subscription?.currentPeriodEnd ?? null) : null,
    reduction,
  };
}

export type StartResult = { ok: true; checkoutUrl: string } | { ok: false; message: string };

export async function startPlanChange(params: {
  organization: Pick<Organization, "id" | "status" | "name">;
  userId: string;
  tier: PlanTier;
  payerEmail: string;
  /** Solo en una baja: profesionales que siguen recibiendo reservas. */
  keepIds?: string[];
  /** Solo en Profesional → Equipo: ver `ChangeTiming`. Por defecto, al terminar el período ya pago. */
  timing?: ChangeTiming;
  now?: Date;
}): Promise<StartResult> {
  const { organization, tier } = params;
  const now = params.now ?? new Date();
  if (organization.status === "suspended") return { ok: false, message: "Tu cuenta está suspendida. Escribinos para resolverlo." };

  const sellable = await getSellablePlan(tier);
  if (!sellable.ok) return { ok: false, message: sellable.error };
  const plan = sellable.plan;

  const subscription = await db.subscription.findUnique({ where: { organizationId: organization.id }, include: { plan: true } });
  const kind = changeKind(subscription, tier);
  if (kind === "same") return { ok: false, message: `Ya estás en el ${plan.name}.` };

  if (kind === "downgrade") {
    if (!subscription?.currentPeriodEnd) return { ok: false, message: "Todavía no podemos programar la baja: falta confirmar tu próximo vencimiento." };
    if (params.keepIds) {
      const saved = await setKeepSelection(organization.id, params.keepIds);
      if (!saved.ok) return { ok: false, message: saved.message };
    }
  }

  // Un cambio abandonado se reemplaza: su suscripción sin autorizar se cancela para no dejar rastros.
  if (subscription?.pendingProviderSubscriptionId) {
    await cancelPreapproval(subscription.pendingProviderSubscriptionId).catch((error) =>
      console.error("[billing] no se pudo cancelar el cambio anterior", error),
    );
  }

  const deferred = isDeferredChange(kind, params.timing ?? "period_end", subscription, now);
  const startDate = deferred && subscription?.currentPeriodEnd && subscription.currentPeriodEnd > now ? subscription.currentPeriodEnd : undefined;
  let checkoutUrl: string;
  try {
    const preapproval = await createPreapproval({
      organizationId: organization.id,
      payerEmail: params.payerEmail,
      reason: `${brand.name} — ${plan.name}`,
      amount: plan.price,
      currency: plan.currency,
      backUrl: `${brand.url}/dashboard/facturacion?retorno=1`,
      startDate,
    });
    if (!preapproval.init_point) throw new Error("Mercado Pago no devolvió el enlace de pago.");
    checkoutUrl = preapproval.init_point;

    if (kind === "new") {
      await db.subscription.upsert({
        where: { organizationId: organization.id },
        update: {
          planId: plan.id,
          status: "pending",
          providerSubscriptionId: preapproval.id,
          canceledAt: null,
          lastPaymentAt: null,
          contractedAmount: plan.price,
          contractedCurrency: plan.currency,
          pendingPlanId: null,
          pendingProviderSubscriptionId: null,
          pendingKind: null,
          pendingEffectiveAt: null,
          // Una suscripción anterior sin cancelar se da de baja cuando la nueva se autorice.
          retiredProviderSubscriptionId: subscription?.providerSubscriptionId && subscription.status !== "canceled" ? subscription.providerSubscriptionId : null,
        },
        create: {
          organizationId: organization.id,
          planId: plan.id,
          status: "pending",
          providerSubscriptionId: preapproval.id,
          contractedAmount: plan.price,
          contractedCurrency: plan.currency,
        },
      });
    } else {
      await db.subscription.update({
        where: { organizationId: organization.id },
        data: {
          pendingPlanId: plan.id,
          pendingProviderSubscriptionId: preapproval.id,
          pendingKind: kind,
          pendingEffectiveAt: startDate ?? null,
        },
      });
    }
    await db.auditLog.create({
      data: {
        organizationId: organization.id,
        userId: params.userId,
        action: kind === "new" ? "subscription.started" : `subscription.change_requested`,
        entityType: "subscription",
        entityId: subscription?.id ?? organization.id,
        metadata: { kind, tier, amount: plan.price, currency: plan.currency },
      },
    });
  } catch (error) {
    console.error("[billing] no se pudo iniciar el cambio de plan", error);
    return { ok: false, message: "No pudimos conectar con Mercado Pago. Probá de nuevo en unos minutos." };
  }
  return { ok: true, checkoutUrl };
}

/** Cancela el cambio de plan pendiente (la suscripción vigente no se toca). */
export async function discardPendingChange(organizationId: string, userId: string): Promise<boolean> {
  const subscription = await db.subscription.findUnique({ where: { organizationId } });
  if (!subscription?.pendingProviderSubscriptionId) return false;
  await cancelPreapproval(subscription.pendingProviderSubscriptionId).catch((error) =>
    console.error("[billing] no se pudo cancelar el cambio pendiente", error),
  );
  await db.subscription.update({
    where: { id: subscription.id },
    data: { pendingPlanId: null, pendingProviderSubscriptionId: null, pendingKind: null, pendingEffectiveAt: null },
  });
  await db.auditLog.create({
    data: { organizationId, userId, action: "subscription.change_discarded_by_user", entityType: "subscription", entityId: subscription.id },
  });
  return true;
}
