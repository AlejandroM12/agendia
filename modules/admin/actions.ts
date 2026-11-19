"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import type { OrganizationStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { requireContext } from "@/lib/dal";
import { type ActionState } from "@/lib/action-state";
import { canAccessPlatformAdmin } from "@/lib/deployment";
import { PLAN_CAPABILITIES, PLAN_TIERS } from "@/lib/plans";
import { pricing } from "@/lib/brand";
import { ensurePlan, listPrice } from "@/modules/billing/catalog";
import { getPreapproval, isMercadoPagoConfigured } from "@/modules/billing/mercadopago";
import { applyPreapprovalState } from "@/modules/billing/subscriptions";
import { syncCapacityGrace } from "@/modules/team/capacity";
import { recordAudit } from "@/lib/audit";
import { createDemoWorkspace } from "@/modules/demo/workspace";
import { DEMO } from "@/modules/demo/policy";
import { normalizePhone } from "@/modules/whatsapp/consent";

/** Toda acción del panel vuelve a verificar el permiso: el layout no alcanza. */
async function requirePlatformAdmin() {
  const context = await requireContext();
  if (!canAccessPlatformAdmin(context.user)) notFound();
  return context;
}

export type AccountOperation = "suspend" | "reactivate" | "activate" | "deactivate" | "extend_trial";

export async function accountOperationAction(organizationId: string, operation: AccountOperation): Promise<void> {
  const admin = await requirePlatformAdmin();

  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    include: { subscription: { select: { status: true } } },
  });
  if (!organization) return;

  const now = new Date();
  let data: { status: OrganizationStatus; trialEndsAt?: Date; readonlyUntil?: Date | null };

  switch (operation) {
    case "suspend":
      data = { status: "suspended" };
      break;
    case "activate": // alta manual (por ejemplo, un pago por transferencia)
      data = { status: "active" };
      break;
    case "deactivate":
      data = { status: "canceled" };
      break;
    case "extend_trial": {
      const base = organization.trialEndsAt > now ? organization.trialEndsAt : now;
      data = { status: "trial", trialEndsAt: new Date(base.getTime() + 7 * 24 * 3600000), readonlyUntil: null };
      break;
    }
    case "reactivate":
      data =
        organization.subscription?.status === "active"
          ? { status: "active" }
          : organization.trialEndsAt > now
            ? { status: "trial" }
            : { status: "trial_readonly" };
      break;
  }

  await db.$transaction([
    db.organization.update({ where: { id: organizationId }, data }),
    db.auditLog.create({
      data: {
        organizationId,
        userId: admin.user.id,
        action: `admin.account.${operation}`,
        entityType: "organization",
        entityId: organizationId,
        metadata: { previousStatus: organization.status, newStatus: data.status },
      },
    }),
  ]);
  revalidatePath("/admin");
}

/**
 * Alinea el precio contratable de cada plan (tabla `plans`) con el precio de lista publicado
 * (PRICE_* en la configuración). No hay un campo libre de precio: el precio se decide en un solo lugar
 * (lib/brand.ts) y esto solo corrige una diferencia. No toca las suscripciones vigentes, que conservan
 * el importe que autorizaron.
 */
export async function alignPlanPricesAction(): Promise<ActionState> {
  const admin = await requirePlatformAdmin();
  const changes: Array<{ code: string; from: number; to: number }> = [];
  for (const tier of PLAN_TIERS) {
    const plan = await ensurePlan(tier);
    const target = listPrice(tier);
    if (plan.price === target && plan.currency === pricing.currency) continue;
    await db.$transaction([
      db.plan.update({ where: { id: plan.id }, data: { price: target, currency: pricing.currency } }),
      db.auditLog.create({
        data: {
          userId: admin.user.id,
          action: "admin.plan.price_aligned",
          entityType: "plan",
          entityId: plan.id,
          metadata: { code: PLAN_CAPABILITIES[tier].code, previousPrice: plan.price, newPrice: target },
        },
      }),
    ]);
    changes.push({ code: plan.code, from: plan.price, to: target });
  }
  revalidatePath("/admin");
  return { ok: true, message: changes.length ? `Precios alineados: ${changes.map((c) => `${c.code} ${c.from} → ${c.to}`).join(", ")}.` : "Los precios ya coinciden con los publicados." };
}

export type OrganizationFeature = "team" | "accounts";

/**
 * Habilita o deshabilita una función de equipo para UN negocio (piloto controlado). No borra datos:
 * apagar el modo equipo no elimina profesionales ni turnos (el negocio vuelve a verse con el primero).
 * Queda registrado quién lo hizo, cuándo y el valor anterior.
 */
export async function setOrganizationFeatureAction(organizationId: string, feature: OrganizationFeature, enabled: boolean): Promise<void> {
  const admin = await requirePlatformAdmin();
  const organization = await db.organization.findUnique({ where: { id: organizationId }, select: { teamModeEnabled: true, teamAccountsEnabled: true } });
  if (!organization) return;

  const field = feature === "team" ? "teamModeEnabled" : "teamAccountsEnabled";
  const previous = organization[field];
  // Las cuentas individuales requieren el modo equipo: no se enciende una sin la otra.
  const data: { teamModeEnabled?: boolean; teamAccountsEnabled?: boolean } =
    feature === "team" && !enabled ? { teamModeEnabled: false, teamAccountsEnabled: false } : feature === "accounts" && enabled ? { teamAccountsEnabled: true, teamModeEnabled: true } : { [field]: enabled };
  await db.$transaction([
    db.organization.update({ where: { id: organizationId }, data }),
    db.auditLog.create({
      data: {
        organizationId,
        userId: admin.user.id,
        action: `admin.feature.${feature}.${enabled ? "enabled" : "disabled"}`,
        entityType: "organization",
        entityId: organizationId,
        metadata: { previous, next: enabled },
      },
    }),
  ]);
  revalidatePath(`/admin/negocios/${organizationId}`);
  revalidatePath("/admin");
}

/**
 * Diagnóstico y conciliación de UN negocio: vuelve a consultar en Mercado Pago el estado de su suscripción
 * (y del cambio de plan pendiente) y recalcula el exceso de cupo. Solo lee de Mercado Pago y aplica las
 * mismas reglas verificadas que el webhook; nunca habilita un cambio de plan sin un cobro aprobado.
 */
export async function reconcileOrganizationAction(organizationId: string): Promise<ActionState> {
  const admin = await requirePlatformAdmin();
  const subscription = await db.subscription.findUnique({ where: { organizationId } });
  const results: string[] = [];
  if (subscription && isMercadoPagoConfigured()) {
    for (const id of [subscription.providerSubscriptionId, subscription.pendingProviderSubscriptionId]) {
      if (!id) continue;
      try {
        results.push(`${await applyPreapprovalState(await getPreapproval(id))}`);
      } catch {
        results.push("error");
      }
    }
  } else {
    results.push(subscription ? "Mercado Pago sin configurar" : "sin suscripción");
  }
  const capacity = await syncCapacityGrace(organizationId);
  await db.auditLog.create({
    data: {
      organizationId,
      userId: admin.user.id,
      action: "admin.reconcile",
      entityType: "organization",
      entityId: organizationId,
      metadata: { results, capacity },
    },
  });
  revalidatePath(`/admin/negocios/${organizationId}`);
  return { ok: true, message: `Conciliación: ${results.join(", ")} · cupos: ${capacity}.` };
}

/**
 * Demostración SUPERVISADA: un negocio de demo para mostrar el producto en vivo, con avisos reales solo hacia los
 * destinatarios que se autoricen acá (por ejemplo, tu propio correo). Cualquier otro destinatario se simula, como en
 * la demo pública. Las credenciales se muestran UNA vez, en esta respuesta: no se guardan en ningún lado.
 */
export async function createSupervisedDemoAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requirePlatformAdmin();
  // Autorizados a recibir avisos REALES: correos y/o teléfonos (estos se guardan normalizados, solo dígitos).
  const raw = String(formData.get("recipients") ?? "")
    .split(/[,;\n]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  const recipients: string[] = [];
  const invalid: string[] = [];
  for (const value of raw) {
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) recipients.push(value.toLowerCase());
    else {
      const phone = normalizePhone(value, "America/Argentina/Buenos_Aires");
      if (phone) recipients.push(phone);
      else invalid.push(value);
    }
  }
  if (recipients.length === 0 || recipients.length > 8 || invalid.length > 0) {
    return { message: "Ingresá de 1 a 8 correos o teléfonos válidos (con característica), separados por coma o espacio." };
  }

  const demo = await createDemoWorkspace({ kind: "supervised", allowedRecipients: recipients });
  await recordAudit({
    organizationId: demo.organizationId,
    userId: admin.user.id,
    action: "demo.supervised.created",
    entityType: "organization",
    entityId: demo.organizationId,
    metadata: { recipients: recipients.length },
  });
  revalidatePath("/admin");
  return {
    ok: true,
    message: `Demo supervisada lista (dura ${DEMO.supervisedTtlHours} h). Ingresá en /login con ${demo.email} y la contraseña ${demo.password}. Los avisos reales salen solo a: ${recipients.join(", ")}. Anotá estos datos ahora: no se vuelven a mostrar.`,
  };
}
