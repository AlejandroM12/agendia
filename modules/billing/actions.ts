"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireContext } from "@/lib/dal";
import { FORBIDDEN_MESSAGE } from "@/lib/permissions";
import { type ActionState } from "@/lib/action-state";
import { isStandalone } from "@/lib/deployment";
import { canManageBilling } from "@/lib/organization-access";
import { parsePlanTier } from "@/lib/plans";
import { teamPlansAvailable } from "@/lib/features";
import { cancelPreapproval, canPayOnline } from "./mercadopago";
import { discardPendingChange, startPlanChange } from "./plan-change";
import { reconcileOrganization } from "./subscriptions";
import { rateLimit, TOO_MANY_ATTEMPTS } from "@/lib/rate-limit";
import { applyPreapprovalState } from "./subscriptions";

/**
 * Contrata un plan o pide un cambio de plan: crea la suscripción en Mercado Pago y envía a la
 * persona a autorizarla. NADA se activa acá: ni la cuenta ni los cupos del Plan Equipo. Se activan
 * cuando Mercado Pago confirma la autorización y un cobro aprobado (webhook), nunca por volver de
 * la pantalla de pago. Ver modules/billing/plan-change.ts.
 */
export async function startSubscriptionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireContext();
  // Solo el propietario contrata o cancela: ni un administrador ni un profesional.
  if (!context.permissions.has("billing.manage")) return { message: FORBIDDEN_MESSAGE };
  const { organization, user } = context;
  if (isStandalone()) return { message: "Esta instalación no usa suscripción." };
  // Se valida en el servidor, no solo ocultando botones: una cuenta suspendida no contrata aunque invoque la acción.
  if (!canManageBilling(organization)) return { message: "Tu cuenta está suspendida. Escribinos para resolverlo." };
  if (!canPayOnline(user.email)) {
    return { message: "El pago online todavía no está habilitado. Escribinos y activamos tu plan." };
  }
  // Los límites no se confían a lo que mande el navegador: el nivel debe ser uno conocido.
  const tier = parsePlanTier(formData.get("tier") ?? "profesional");
  if (!tier) return { message: "Elegí un plan válido." };
  if (tier === "equipo" && !teamPlansAvailable()) return { message: "Ese plan todavía no está disponible." };

  // Mercado Pago exige que el pagador ingrese con este mismo email: puede no
  // ser el de la cuenta de Agendia.
  const payerEmail = z.email().safeParse(String(formData.get("payerEmail") ?? user.email).trim().toLowerCase());
  if (!payerEmail.success) return { message: "Ingresá el email de tu cuenta de Mercado Pago." };

  const keepIds = formData.getAll("keep").map(String);
  const result = await startPlanChange({
    organization,
    userId: user.id,
    tier,
    payerEmail: payerEmail.data,
    keepIds: formData.has("keepSelection") ? keepIds : undefined,
    timing: formData.get("timing") === "now" ? "now" : "period_end",
  });
  if (!result.ok) return { message: result.message };

  redirect(result.checkoutUrl);
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

  // Si había un cambio de plan en curso, se descarta junto con la suscripción.
  await discardPendingChange(organization.id, user.id).catch(() => undefined);

  revalidatePath("/dashboard", "layout");
  return { ok: true, message: "Suscripción cancelada." };
}

/**
 * El propietario pide verificar ahora su pago (ya pagó y todavía no ve su plan). Consulta a Mercado Pago por la misma vía que el
 * webhook y la conciliación, con límite de pedidos. Lo que cambia sale de la verificación, no de este pedido.
 */
export async function refreshPaymentStatusAction(): Promise<ActionState> {
  const context = await requireContext();
  if (!context.permissions.has("billing.manage")) return { message: FORBIDDEN_MESSAGE };
  const { organization } = context;
  if (!canManageBilling(organization)) return { message: "Tu cuenta está suspendida. Escribinos para resolverlo." };
  if (!(await rateLimit(`payment-refresh:${organization.id}`, 6, 600)).allowed) return { message: TOO_MANY_ATTEMPTS };
  try {
    const { checked } = await reconcileOrganization(organization.id);
    revalidatePath("/dashboard", "layout");
    return { ok: true, message: checked ? "Listo, verificamos tu pago con Mercado Pago. Si ya está confirmado, tu plan se actualizó." : "No hay un pago para verificar." };
  } catch (error) {
    console.error("[billing] no se pudo verificar el pago", error);
    return { message: "No pudimos consultar a Mercado Pago. Probá de nuevo en unos minutos." };
  }
}

/** Descarta un cambio de plan pedido (sin tocar la suscripción vigente). */
export async function discardPlanChangeAction(): Promise<ActionState> {
  const context = await requireContext();
  if (!context.permissions.has("billing.manage")) return { message: FORBIDDEN_MESSAGE };
  const discarded = await discardPendingChange(context.organization.id, context.user.id);
  revalidatePath("/dashboard/facturacion");
  return discarded ? { ok: true, message: "Cambio de plan descartado." } : { message: "No hay un cambio de plan en curso." };
}
