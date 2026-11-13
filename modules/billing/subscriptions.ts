import "server-only";

import type { OrganizationStatus, Plan, SubscriptionStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { offers, pricing } from "@/lib/brand";
import { applyLicensePayment, reconcileLicenseOrders } from "./licenses";
import {
  getAuthorizedPayment,
  getPayment,
  getPreapproval,
  isMercadoPagoConfigured,
  type Preapproval,
} from "./mercadopago";

/** Plan mensual vigente. Se crea la primera vez con el precio de referencia. */
export async function getMonthlyPlan(): Promise<Plan> {
  return db.plan.upsert({
    where: { code: "mensual" },
    update: {},
    create: { code: "mensual", name: offers.monthly, price: pricing.monthly, currency: pricing.currency },
  });
}

const STATUS_MAP: Record<string, SubscriptionStatus> = {
  pending: "pending",
  authorized: "active",
  paused: "paused",
  cancelled: "canceled",
};

/**
 * Lleva el estado local a lo que dice Mercado Pago para una suscripción.
 *
 * Es la única función que cambia el estado comercial de una organización a
 * partir de un pago. Siempre parte del recurso consultado a la API (nunca
 * del cuerpo del webhook) y es idempotente: aplicarla dos veces con el
 * mismo estado no cambia nada.
 */
export async function applyPreapprovalState(preapproval: Preapproval): Promise<"applied" | "ignored"> {
  const status = STATUS_MAP[preapproval.status];
  if (!status) return "ignored";

  const subscription = await db.subscription.findFirst({
    where: {
      OR: [
        { providerSubscriptionId: preapproval.id },
        ...(preapproval.external_reference ? [{ organizationId: preapproval.external_reference }] : []),
      ],
    },
    include: { organization: { select: { status: true } } },
  });
  // Una suscripción que no iniciamos nosotros (o de otra instalación) se ignora.
  if (!subscription) return "ignored";
  if (subscription.providerSubscriptionId && subscription.providerSubscriptionId !== preapproval.id) {
    return "ignored";
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

    await applyPreapprovalState(await getPreapproval(payment.preapproval_id));

    const subscription = await db.subscription.findUnique({
      where: { providerSubscriptionId: payment.preapproval_id },
      include: { organization: { select: { status: true } } },
    });
    if (!subscription) return;

    if (payment.payment?.status === "approved") {
      await db.subscription.update({ where: { id: subscription.id }, data: { lastPaymentAt: new Date() } });
    } else if (payment.payment?.status === "rejected" && subscription.organization.status === "active") {
      await db.$transaction([
        db.subscription.update({ where: { id: subscription.id }, data: { status: "past_due" } }),
        db.organization.update({ where: { id: subscription.organizationId }, data: { status: "past_due" } }),
      ]);
    }
  }

  // Pagos únicos: solo interesan los de una licencia (los cobros de una
  // suscripción también llegan como "payment", y se ignoran acá).
  if (event.type === "payment") {
    await applyLicensePayment(await getPayment(event.resourceId));
  }
  // Otros tipos de evento se registran y nada más.
}

/**
 * Red de seguridad frente a webhooks perdidos: vuelve a consultar en
 * Mercado Pago las suscripciones vivas que no se sincronizan hace rato, y
 * da de baja el acceso de las canceladas cuyo período pago ya terminó.
 */
export async function reconcileSubscriptions(limit = 20): Promise<{ checked: number; errors: number }> {
  const result = { checked: 0, errors: 0 };

  await db.organization.updateMany({
    where: {
      status: { in: ["active", "past_due"] },
      subscription: { status: "canceled", currentPeriodEnd: { lt: new Date() } },
    },
    data: { status: "canceled" },
  });

  if (!isMercadoPagoConfigured()) return result;

  const stale = await db.subscription.findMany({
    where: {
      providerSubscriptionId: { not: null },
      status: { in: ["pending", "active", "paused", "past_due"] },
      updatedAt: { lt: new Date(Date.now() - 6 * 3600000) },
    },
    orderBy: { updatedAt: "asc" },
    take: limit,
    select: { id: true, providerSubscriptionId: true },
  });

  for (const subscription of stale) {
    result.checked++;
    try {
      await applyPreapprovalState(await getPreapproval(subscription.providerSubscriptionId!));
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
