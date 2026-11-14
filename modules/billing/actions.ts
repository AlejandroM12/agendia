"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireContext } from "@/lib/dal";
import { FORBIDDEN_MESSAGE } from "@/lib/permissions";
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
export async function startSubscriptionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireContext();
  // Solo el propietario contrata o cancela: ni un administrador ni un profesional.
  if (!context.permissions.has("billing.manage")) return { message: FORBIDDEN_MESSAGE };
  const { organization, user } = context;
  if (isStandalone()) return { message: "Esta instalación no usa suscripción." };
  if (!isMercadoPagoConfigured()) {
    return { message: "El pago online todavía no está habilitado. Escribinos y activamos tu plan." };
  }
  if (organization.status === "suspended") {
    return { message: "Tu cuenta está suspendida. Escribinos para resolverlo." };
  }

  // Mercado Pago exige que el pagador ingrese con este mismo email: puede no
  // ser el de la cuenta de Agendia.
  const payerEmail = z.email().safeParse(String(formData.get("payerEmail") ?? user.email).trim().toLowerCase());
  if (!payerEmail.success) return { message: "Ingresá el email de tu cuenta de Mercado Pago." };

  const plan = await getMonthlyPlan();
  let initPoint: string;
  try {
    const preapproval = await createPreapproval({
      organizationId: organization.id,
      payerEmail: payerEmail.data,
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
  const context = await requireContext();
  if (!context.permissions.has("billing.manage")) return { message: FORBIDDEN_MESSAGE };
  const { organization, user } = context;

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
