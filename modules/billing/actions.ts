"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireContext } from "@/lib/dal";
import { type ActionState } from "@/lib/action-state";
import { brand } from "@/lib/brand";
import { isStandalone } from "@/lib/deployment";
import { cancelPreapproval, createPreapproval, isMercadoPagoConfigured } from "./mercadopago";
import { applyPreapprovalState, getMonthlyPlan } from "./subscriptions";

/**
 * Inicia la suscripción: crea el débito automático en Mercado Pago y envía
 * al usuario a autorizarlo. La cuenta NO se activa acá: se activa cuando
 * Mercado Pago confirma la autorización (webhook o reconciliación).
 */
export async function startSubscriptionAction(_prev: ActionState): Promise<ActionState> {
  const { organization, user } = await requireContext();
  if (isStandalone()) return { message: "Esta instalación no usa suscripción." };
  if (!isMercadoPagoConfigured()) {
    return { message: "El pago online todavía no está habilitado. Escribinos y activamos tu plan." };
  }
  if (organization.status === "suspended") {
    return { message: "Tu cuenta está suspendida. Escribinos para resolverlo." };
  }

  const plan = await getMonthlyPlan();
  let initPoint: string;
  try {
    const preapproval = await createPreapproval({
      organizationId: organization.id,
      payerEmail: user.email,
      reason: `${brand.name} — ${plan.name}`,
      amount: plan.price,
      currency: plan.currency,
      backUrl: `${brand.url}/dashboard/facturacion?retorno=1`,
    });
    if (!preapproval.init_point) throw new Error("Mercado Pago no devolvió el enlace de pago.");
    initPoint = preapproval.init_point;

    await db.subscription.upsert({
      where: { organizationId: organization.id },
      update: { planId: plan.id, status: "pending", providerSubscriptionId: preapproval.id, canceledAt: null },
      create: {
        organizationId: organization.id,
        planId: plan.id,
        status: "pending",
        providerSubscriptionId: preapproval.id,
      },
    });
  } catch (error) {
    console.error("[billing] no se pudo iniciar la suscripción", error);
    return { message: "No pudimos conectar con Mercado Pago. Probá de nuevo en unos minutos." };
  }

  redirect(initPoint);
}

export async function cancelSubscriptionAction(): Promise<ActionState> {
  const { organization, user } = await requireContext();

  const subscription = await db.subscription.findUnique({ where: { organizationId: organization.id } });
  if (!subscription?.providerSubscriptionId || subscription.status === "canceled") {
    return { message: "No tenés una suscripción activa." };
  }

  try {
    const preapproval = await cancelPreapproval(subscription.providerSubscriptionId);
    await applyPreapprovalState(preapproval);
    await db.auditLog.create({
      data: {
        organizationId: organization.id,
        userId: user.id,
        action: "subscription.canceled_by_user",
        entityType: "subscription",
        entityId: subscription.id,
      },
    });
  } catch (error) {
    console.error("[billing] no se pudo cancelar la suscripción", error);
    return { message: "No pudimos cancelar la suscripción. Probá de nuevo en unos minutos." };
  }

  revalidatePath("/dashboard", "layout");
  return { ok: true, message: "Suscripción cancelada." };
}
