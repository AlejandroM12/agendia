"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import type { OrganizationStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { requireContext } from "@/lib/dal";
import { type ActionState } from "@/lib/action-state";
import { canAccessPlatformAdmin } from "@/lib/deployment";
import { getMonthlyPlan } from "@/modules/billing/subscriptions";

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

export async function updatePlanPriceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requirePlatformAdmin();

  const price = Number(String(formData.get("price") ?? "").replace(/[^\d]/g, ""));
  if (!Number.isInteger(price) || price < 1 || price > 100_000_000) {
    return { message: "Ingresá un precio válido." };
  }

  const plan = await getMonthlyPlan();
  await db.$transaction([
    db.plan.update({ where: { id: plan.id }, data: { price } }),
    db.auditLog.create({
      data: {
        userId: admin.user.id,
        action: "admin.plan.price_updated",
        entityType: "plan",
        entityId: plan.id,
        metadata: { previousPrice: plan.price, newPrice: price },
      },
    }),
  ]);
  revalidatePath("/admin");
  return { ok: true, message: "Precio actualizado. Aplica a las suscripciones nuevas." };
}
