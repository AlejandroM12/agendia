import "server-only";

import { db } from "@/lib/db";
import { isAccountsEnabled, isTeamModeEnabled } from "@/lib/features";
import { getEffectiveStatus } from "@/lib/organization-access";
import { listPrice } from "@/modules/billing/catalog";
import { getCapacityState } from "@/modules/team/capacity";
import { getProfessionalQuota } from "@/modules/team/professionals";
import { monthRange } from "@/modules/system/usage";
import { planTierFromCode } from "@/lib/plans";

/**
 * Vista de un negocio para el panel de la plataforma (AtajoLab): lo necesario para soporte y
 * decisiones comerciales, y nada más. NO incluye contraseñas, tokens ni credenciales, ni datos de
 * clientes, notas ni información clínica: solo conteos, estados y fechas.
 */
export async function getOrganizationAdminView(organizationId: string, now = new Date()) {
  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    include: {
      subscription: { include: { plan: true, pendingPlan: true } },
      memberships: { select: { role: true, user: { select: { email: true } } } },
    },
  });
  if (!organization) return null;

  const range = monthRange(now);
  const [quota, capacity, appointmentsTotal, appointmentsMonth, linkedAccounts, pendingInvitations, byType, failedRecent, paymentIssues] =
    await Promise.all([
      getProfessionalQuota(db, organization),
      getCapacityState(db, organizationId, now),
      db.appointment.count({ where: { organizationId } }),
      db.appointment.count({ where: { organizationId, createdAt: { gte: range.from, lt: range.to } } }),
      db.professional.count({ where: { organizationId, userId: { not: null }, accessRevokedAt: null } }),
      db.invitation.count({ where: { organizationId, status: "pending", expiresAt: { gt: now } } }),
      db.$queryRaw<Array<{ type: string; status: string; total: bigint }>>`
        SELECT "type"::text AS "type", "status"::text AS "status", count(*) AS total
        FROM "notifications"
        WHERE "organizationId" = ${organizationId} AND "createdAt" >= ${range.from} AND "createdAt" < ${range.to}
        GROUP BY 1, 2`,
      db.notification.findMany({
        where: { organizationId, status: "failed", createdAt: { gte: new Date(now.getTime() - 30 * 86400000) } },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { type: true, createdAt: true, lastError: true },
      }),
      db.auditLog.findMany({
        where: { organizationId, action: { startsWith: "subscription." } },
        orderBy: { createdAt: "desc" },
        take: 8,
        select: { action: true, createdAt: true },
      }),
    ]);

  const subscription = organization.subscription;
  const status = getEffectiveStatus(organization);
  const emailsByType: Record<string, { sent: number; failed: number }> = {};
  for (const row of byType) {
    const entry = (emailsByType[row.type] ??= { sent: 0, failed: 0 });
    if (row.status === "sent") entry.sent += Number(row.total);
    if (row.status === "failed") entry.failed += Number(row.total);
  }

  // Qué falta para poder cobrar a este negocio (lenguaje de soporte).
  const billingNeeded: string[] = [];
  if (!subscription && status === "trial") billingNeeded.push("Todavía no contrató: está en prueba.");
  if (!subscription && status !== "trial" && status !== "active") billingNeeded.push("Sin suscripción: necesita elegir un plan.");
  if (subscription?.status === "pending") billingNeeded.push("Suscripción sin primer cobro verificado: pendiente de autorización o de pago en Mercado Pago (la cuenta no cambió).");
  if (subscription?.status === "past_due" || status === "past_due") billingNeeded.push("Cobro rechazado o suscripción pausada.");
  if (subscription?.pendingPlan) billingNeeded.push(`Cambio a ${subscription.pendingPlan.name} sin confirmar el pago.`);
  if (subscription?.retiredProviderSubscriptionId) billingNeeded.push("Hay una suscripción anterior por cancelar en Mercado Pago.");
  if (status === "active" && !subscription) billingNeeded.push("Activa sin suscripción (alta manual).");
  if (subscription && subscription.contractedAmount !== null) {
    const expected = listPrice(planTierFromCode(subscription.plan.code));
    if (subscription.contractedAmount !== expected) {
      billingNeeded.push("Paga un importe distinto del precio de lista actual (se respeta lo contratado).");
    }
  }

  return {
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    createdAt: organization.createdAt,
    status,
    owners: organization.memberships.filter((m) => m.role === "owner").map((m) => m.user.email),
    trial: { startedAt: organization.trialStartedAt, endsAt: organization.trialEndsAt },
    workMode: organization.workMode,
    intendedPlan: organization.intendedPlan,
    plan: subscription
      ? {
          name: subscription.plan.name,
          code: subscription.plan.code,
          subscriptionStatus: subscription.status,
          currentPeriodEnd: subscription.currentPeriodEnd,
          lastPaymentAt: subscription.lastPaymentAt,
          contractedAmount: subscription.contractedAmount,
          pending: subscription.pendingPlan ? { name: subscription.pendingPlan.name, kind: subscription.pendingKind, effectiveAt: subscription.pendingEffectiveAt } : null,
        }
      : null,
    seats: { limit: quota.limit, active: quota.active, available: quota.available, source: quota.source, tier: quota.tier },
    linkedAccounts,
    pendingInvitations,
    features: {
      teamMode: isTeamModeEnabled(organization),
      teamModeFlag: organization.teamModeEnabled,
      accounts: isAccountsEnabled(organization),
      accountsFlag: organization.teamAccountsEnabled,
    },
    capacity: capacity
      ? {
          excess: capacity.excess,
          graceStartedAt: organization.capacityGraceStartedAt,
          graceEndsAt: capacity.graceEndsAt,
          restricting: capacity.restricting,
          restrictedCount: capacity.restrictedIds.length,
        }
      : null,
    appointments: { total: appointmentsTotal, thisMonth: appointmentsMonth },
    emails: {
      byType: emailsByType,
      // Los mensajes de error pueden traer la dirección de un cliente: se quitan antes de mostrarlos.
      recentFailures: failedRecent.map((row) => ({
        type: row.type,
        createdAt: row.createdAt,
        error: (row.lastError ?? "").replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[email]").slice(0, 160),
      })),
    },
    billingNeeded,
    subscriptionEvents: paymentIssues,
  };
}

export type OrganizationAdminView = NonNullable<Awaited<ReturnType<typeof getOrganizationAdminView>>>;
