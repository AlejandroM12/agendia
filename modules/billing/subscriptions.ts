import "server-only";

import type { OrganizationStatus, Plan, Prisma, Subscription, SubscriptionStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { applyLicensePayment, reconcileLicenseOrders } from "./licenses";
import { ensurePlan } from "./catalog";
import {
  cancelPreapproval,
  getAuthorizedPayment,
  getPayment,
  getPreapproval,
  isMercadoPagoConfigured,
  type AuthorizedPayment,
  type Preapproval,
} from "./mercadopago";
import { syncCapacityGrace } from "@/modules/team/capacity";

/** Plan Profesional (código histórico `mensual`). Se crea la primera vez con el precio de lista. */
export const getMonthlyPlan = (): Promise<Plan> => ensurePlan("profesional");

const STATUS_MAP: Record<string, SubscriptionStatus> = {
  pending: "pending",
  authorized: "active",
  paused: "paused",
  cancelled: "canceled",
};

export type ApplyResult = "applied" | "ignored" | "rejected";

type SubscriptionWithPlans = Subscription & {
  plan: Plan;
  pendingPlan: Plan | null;
  organization: { status: OrganizationStatus };
};

const WITH_PLANS = {
  plan: true,
  pendingPlan: true,
  organization: { select: { status: true } },
} as const;

async function audit(organizationId: string, action: string, entityId: string, metadata: Prisma.InputJsonObject = {}) {
  await db.auditLog.create({ data: { organizationId, action, entityType: "subscription", entityId, metadata } });
}

/**
 * ¿Mercado Pago cobra lo que enviamos? Compara importe y moneda del recurso consultado contra lo
 * contratado (suscripción vigente: el importe guardado al crearla; cambio pendiente: el precio
 * del plan nuevo). Sin `auto_recurring` en la respuesta no se puede verificar: no se aplica.
 */
function amountMatches(
  autoRecurring: Preapproval["auto_recurring"],
  expected: { amount: number | null; currency: string | null },
): boolean {
  if (expected.amount === null) return true; // suscripción anterior a esta verificación
  if (!autoRecurring) return false;
  return autoRecurring.transaction_amount === expected.amount && autoRecurring.currency_id === (expected.currency ?? "ARS");
}

/** El pago de cobro recurrente, ¿coincide en importe y moneda con lo contratado? Sin datos: no se afirma. */
function paymentAmountMatches(payment: AuthorizedPayment, expected: { amount: number | null; currency: string | null }): boolean {
  if (expected.amount === null) return true;
  if (payment.transaction_amount == null) return false;
  return payment.transaction_amount === expected.amount && (payment.currency_id ?? expected.currency) === expected.currency;
}

/**
 * Lleva el estado local a lo que dice Mercado Pago para una suscripción.
 *
 * Es la única función que cambia el estado comercial de una organización a
 * partir de una suscripción. Siempre parte del recurso consultado a la API (nunca
 * del cuerpo del webhook ni de lo que traiga el navegador) y es idempotente.
 *
 * Verificaciones: la suscripción debe ser una que iniciamos nosotros (por id), su
 * `external_reference` debe ser la organización dueña, y el importe y la moneda deben ser
 * los contratados; si algo no coincide NO se aplica y queda registrado en la auditoría.
 *
 * La suscripción de un CAMBIO DE PLAN pendiente solo registra su estado: no cambia plan,
 * cupos ni estado de la cuenta hasta que se verifica un pago (`promotePendingPlan`).
 */
export async function applyPreapprovalState(preapproval: Preapproval): Promise<ApplyResult> {
  const status = STATUS_MAP[preapproval.status];
  if (!status) return "ignored";

  const subscription = (await db.subscription.findFirst({
    where: { OR: [{ providerSubscriptionId: preapproval.id }, { pendingProviderSubscriptionId: preapproval.id }] },
    include: WITH_PLANS,
  })) as SubscriptionWithPlans | null;
  // Una suscripción que no iniciamos nosotros (o de otra instalación) se ignora.
  if (!subscription) return "ignored";

  if (preapproval.external_reference && preapproval.external_reference !== subscription.organizationId) {
    await audit(subscription.organizationId, "subscription.rejected_wrong_organization", subscription.id, { providerId: preapproval.id });
    return "rejected";
  }

  const isPending = subscription.pendingProviderSubscriptionId === preapproval.id;
  const expected = isPending
    ? { amount: subscription.pendingPlan?.price ?? null, currency: subscription.pendingPlan?.currency ?? null }
    : { amount: subscription.contractedAmount, currency: subscription.contractedCurrency };
  if (!amountMatches(preapproval.auto_recurring, expected)) {
    await audit(subscription.organizationId, "subscription.rejected_amount_mismatch", subscription.id, {
      providerId: preapproval.id,
      expected: expected.amount,
      received: preapproval.auto_recurring?.transaction_amount ?? null,
    });
    return "rejected";
  }

  if (isPending) {
    if (status === "canceled") {
      // La persona no completó (o canceló) el cambio: se descarta sin tocar la suscripción vigente.
      await db.subscription.updateMany({
        where: { id: subscription.id, pendingProviderSubscriptionId: preapproval.id },
        data: { pendingPlanId: null, pendingProviderSubscriptionId: null, pendingKind: null, pendingEffectiveAt: null },
      });
      await audit(subscription.organizationId, "subscription.change_discarded", subscription.id, { providerStatus: preapproval.status });
    } else if (status === "active" && subscription.pendingKind === "downgrade") {
      // Bajar de plan: la suscripción nueva ya está autorizada, así que la de mayor importe se
      // cancela ahora (antes de su próximo cobro). El acceso ya pago sigue hasta fin de período.
      await retireProviderSubscription(subscription.id, subscription.providerSubscriptionId);
    }
    return "applied";
  }

  const nextPayment = preapproval.next_payment_date ? new Date(preapproval.next_payment_date) : null;
  const currentPeriodEnd =
    nextPayment && !Number.isNaN(nextPayment.getTime()) ? nextPayment : subscription.currentPeriodEnd;

  const current = subscription.organization.status;
  let organizationStatus: OrganizationStatus = current;
  if (current !== "suspended") {
    if (status === "active") organizationStatus = "active";
    else if (status === "paused") organizationStatus = "past_due";
    else if (status === "canceled" && (current === "active" || current === "past_due")) {
      // Lo ya pagado se respeta: el acceso sigue hasta el fin del período.
      organizationStatus = currentPeriodEnd && currentPeriodEnd > new Date() ? current : "canceled";
    }
  }

  await db.$transaction([
    db.subscription.update({
      where: { id: subscription.id },
      data: {
        status,
        providerSubscriptionId: preapproval.id,
        currentPeriodEnd,
        canceledAt: status === "canceled" ? (subscription.canceledAt ?? new Date()) : null,
      },
    }),
    db.organization.update({
      where: { id: subscription.organizationId },
      data: { status: organizationStatus },
    }),
    db.auditLog.create({
      data: {
        organizationId: subscription.organizationId,
        action: "subscription.synced",
        entityType: "subscription",
        entityId: subscription.id,
        metadata: { providerStatus: preapproval.status, status, organizationStatus },
      },
    }),
  ]);
  return "applied";
}

/** Marca la suscripción de Mercado Pago anterior para cancelarla, e intenta cancelarla ya. */
async function retireProviderSubscription(subscriptionId: string, providerId: string | null): Promise<void> {
  if (!providerId) return;
  await db.subscription.updateMany({
    where: { id: subscriptionId, retiredProviderSubscriptionId: null },
    data: { retiredProviderSubscriptionId: providerId },
  });
  await cancelRetiredSubscriptions(subscriptionId);
}

/**
 * Cancela en Mercado Pago las suscripciones reemplazadas tras un cambio de plan. Si falla, queda
 * marcada y el worker la reintenta: así no se pierde la baja ni se cobra dos veces sin que se note.
 */
export async function cancelRetiredSubscriptions(onlyId?: string): Promise<{ canceled: number; errors: number }> {
  const result = { canceled: 0, errors: 0 };
  if (!isMercadoPagoConfigured()) return result;
  const rows = await db.subscription.findMany({
    where: { retiredProviderSubscriptionId: { not: null }, ...(onlyId ? { id: onlyId } : {}) },
    select: { id: true, organizationId: true, retiredProviderSubscriptionId: true },
    take: 20,
  });
  for (const row of rows) {
    try {
      await cancelPreapproval(row.retiredProviderSubscriptionId!);
      await db.subscription.update({ where: { id: row.id }, data: { retiredProviderSubscriptionId: null } });
      await audit(row.organizationId, "subscription.previous_canceled", row.id, { providerId: row.retiredProviderSubscriptionId });
      result.canceled++;
    } catch (error) {
      result.errors++;
      console.error("[billing] no se pudo cancelar la suscripción anterior", row.id, error);
    }
  }
  return result;
}

/**
 * Hace efectivo el plan de una suscripción en cambio: se llama SOLO cuando Mercado Pago confirma
 * que la suscripción nueva está autorizada y su primer cobro fue aprobado. Es atómica e
 * idempotente (si ya se promovió, no hace nada). Inicia el período de adaptación si hay exceso.
 */
export async function promotePendingPlan(subscriptionId: string, pendingProviderId: string, paidAt: Date): Promise<boolean> {
  const subscription = await db.subscription.findUnique({ where: { id: subscriptionId }, include: { pendingPlan: true } });
  if (!subscription || subscription.pendingProviderSubscriptionId !== pendingProviderId || !subscription.pendingPlan) return false;

  const preapproval = await getPreapproval(pendingProviderId);
  if (preapproval.status !== "authorized") return false;
  if (preapproval.external_reference && preapproval.external_reference !== subscription.organizationId) return false;
  const plan = subscription.pendingPlan;
  if (!amountMatches(preapproval.auto_recurring, { amount: plan.price, currency: plan.currency })) return false;

  const previous = subscription.providerSubscriptionId;
  const nextPayment = preapproval.next_payment_date ? new Date(preapproval.next_payment_date) : null;
  const claimed = await db.$transaction(async (tx) => {
    const { count } = await tx.subscription.updateMany({
      where: { id: subscriptionId, pendingProviderSubscriptionId: pendingProviderId },
      data: {
        planId: plan.id,
        status: "active",
        providerSubscriptionId: pendingProviderId,
        contractedAmount: plan.price,
        contractedCurrency: plan.currency,
        lastPaymentAt: paidAt,
        currentPeriodEnd: nextPayment && !Number.isNaN(nextPayment.getTime()) ? nextPayment : subscription.currentPeriodEnd,
        canceledAt: null,
        pendingPlanId: null,
        pendingProviderSubscriptionId: null,
        pendingKind: null,
        pendingEffectiveAt: null,
        retiredProviderSubscriptionId: previous && previous !== pendingProviderId ? previous : subscription.retiredProviderSubscriptionId,
      },
    });
    if (count === 0) return false;
    await tx.organization.updateMany({
      where: { id: subscription.organizationId, status: { not: "suspended" } },
      data: { status: "active" },
    });
    await tx.auditLog.create({
      data: {
        organizationId: subscription.organizationId,
        action: "subscription.plan_changed",
        entityType: "subscription",
        entityId: subscriptionId,
        metadata: { fromPlanId: subscription.planId, toPlanId: plan.id, kind: subscription.pendingKind },
      },
    });
    return true;
  });
  if (!claimed) return false;

  await cancelRetiredSubscriptions(subscriptionId);
  await syncCapacityGrace(subscription.organizationId);
  return true;
}

/** Procesa un evento de webhook ya validado y registrado. */
export async function processPaymentEvent(event: { type: string; resourceId: string | null }): Promise<void> {
  if (!event.resourceId) return;

  if (event.type === "subscription_preapproval") {
    await applyPreapprovalState(await getPreapproval(event.resourceId));
    return;
  }

  if (event.type === "subscription_authorized_payment") {
    const payment = await getAuthorizedPayment(event.resourceId);
    if (!payment.preapproval_id) return;
    await applyAuthorizedPayment(payment);
    return;
  }

  // Pagos únicos: solo interesan los de una licencia (los cobros de una
  // suscripción también llegan como "payment", y se ignoran acá).
  if (event.type === "payment") {
    await applyLicensePayment(await getPayment(event.resourceId));
  }
  // Otros tipos de evento se registran y nada más.
}

/**
 * Aplica un cobro de suscripción consultado a la API. Un pago aprobado verificado (importe y
 * moneda) es lo que habilita los cupos del Plan Equipo y lo que hace efectivo un cambio de plan.
 * Los eventos duplicados o desordenados son inofensivos: el estado siempre sale del recurso.
 */
export async function applyAuthorizedPayment(payment: AuthorizedPayment): Promise<void> {
  const preapprovalId = payment.preapproval_id;
  if (!preapprovalId) return;

  await applyPreapprovalState(await getPreapproval(preapprovalId));

  const subscription = (await db.subscription.findFirst({
    where: { OR: [{ providerSubscriptionId: preapprovalId }, { pendingProviderSubscriptionId: preapprovalId }] },
    include: WITH_PLANS,
  })) as SubscriptionWithPlans | null;
  if (!subscription) return;

  const isPending = subscription.pendingProviderSubscriptionId === preapprovalId;
  const expected = isPending
    ? { amount: subscription.pendingPlan?.price ?? null, currency: subscription.pendingPlan?.currency ?? null }
    : { amount: subscription.contractedAmount, currency: subscription.contractedCurrency };
  const paymentStatus = payment.payment?.status;

  if (paymentStatus === "approved") {
    if (!paymentAmountMatches(payment, expected)) {
      await audit(subscription.organizationId, "subscription.rejected_payment_amount", subscription.id, {
        providerId: preapprovalId,
        expected: expected.amount,
        received: payment.transaction_amount ?? null,
      });
      return;
    }
    if (isPending) {
      await promotePendingPlan(subscription.id, preapprovalId, new Date());
    } else {
      await db.subscription.update({ where: { id: subscription.id }, data: { lastPaymentAt: new Date() } });
      await syncCapacityGrace(subscription.organizationId);
    }
  } else if (paymentStatus === "rejected" && !isPending && subscription.organization.status === "active") {
    await db.$transaction([
      db.subscription.update({ where: { id: subscription.id }, data: { status: "past_due" } }),
      db.organization.update({ where: { id: subscription.organizationId }, data: { status: "past_due" } }),
    ]);
  } else if (paymentStatus === "refunded" || paymentStatus === "charged_back") {
    // Un reintegro o contracargo no cambia el acceso automáticamente (es una decisión comercial):
    // queda registrado para que se revise desde /admin.
    await audit(subscription.organizationId, "subscription.payment_reversed", subscription.id, { providerId: preapprovalId, status: paymentStatus });
  }
}

/**
 * Red de seguridad frente a webhooks perdidos: vuelve a consultar en
 * Mercado Pago las suscripciones vivas (y los cambios de plan pendientes) que no se
 * sincronizan hace rato, reintenta las bajas pendientes y da de baja el acceso de las
 * canceladas cuyo período pago ya terminó.
 */
export async function reconcileSubscriptions(limit = 20): Promise<{ checked: number; errors: number }> {
  const result = { checked: 0, errors: 0 };

  await db.organization.updateMany({
    where: {
      status: { in: ["active", "past_due"] },
      subscription: { status: "canceled", currentPeriodEnd: { lt: new Date() }, pendingProviderSubscriptionId: null },
    },
    data: { status: "canceled" },
  });

  if (!isMercadoPagoConfigured()) return result;

  const retired = await cancelRetiredSubscriptions();
  result.errors += retired.errors;

  const stale = await db.subscription.findMany({
    where: {
      OR: [
        { providerSubscriptionId: { not: null }, status: { in: ["pending", "active", "paused", "past_due"] } },
        { pendingProviderSubscriptionId: { not: null } },
      ],
      updatedAt: { lt: new Date(Date.now() - 6 * 3600000) },
    },
    orderBy: { updatedAt: "asc" },
    take: limit,
    select: { id: true, providerSubscriptionId: true, pendingProviderSubscriptionId: true },
  });

  for (const subscription of stale) {
    result.checked++;
    try {
      if (subscription.providerSubscriptionId) await applyPreapprovalState(await getPreapproval(subscription.providerSubscriptionId));
      if (subscription.pendingProviderSubscriptionId) {
        // Se actualiza el estado de la suscripción nueva, pero el cambio de plan NO se hace efectivo
        // desde acá: exige un cobro aprobado (evento subscription_authorized_payment). Si ese evento
        // se perdiera, queda pendiente y visible en /admin hasta validarlo (docs/MERCADOPAGO.md §5).
        await applyPreapprovalState(await getPreapproval(subscription.pendingProviderSubscriptionId));
      }
      // Marca la revisión aunque no haya habido cambios.
      await db.subscription.update({ where: { id: subscription.id }, data: { updatedAt: new Date() } });
    } catch (error) {
      result.errors++;
      console.error("[billing] no se pudo reconciliar la suscripción", subscription.id, error);
    }
  }

  const licenses = await reconcileLicenseOrders();
  result.checked += licenses.checked;
  result.errors += licenses.errors;
  return result;
}
