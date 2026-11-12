import type { Metadata } from "next";
import Link from "next/link";
import type { OrganizationStatus } from "@prisma/client";
import { PlanPriceForm } from "@/components/admin/plan-price-form";
import { Logo } from "@/components/brand/logo";
import { Section } from "@/components/dashboard/section";
import { Input } from "@/components/ui/input";
import { db } from "@/lib/db";
import { getEffectiveStatus } from "@/lib/organization-access";
import { cn } from "@/lib/utils";
import { type AccountOperation, accountOperationAction } from "@/modules/admin/actions";
import { isMercadoPagoConfigured } from "@/modules/billing/mercadopago";
import { getMonthlyPlan } from "@/modules/billing/subscriptions";
import { isEmailConfigured } from "@/modules/notifications/email";

export const metadata: Metadata = { title: "Plataforma", robots: { index: false } };

const STATUS_LABEL: Record<OrganizationStatus, string> = {
  trial: "En prueba",
  trial_readonly: "Prueba vencida",
  locked: "Pausada",
  active: "Activa",
  past_due: "Pago pendiente",
  canceled: "Cancelada",
  suspended: "Suspendida",
};

const OPERATIONS: Record<AccountOperation, string> = {
  activate: "Activar",
  deactivate: "Dar de baja",
  extend_trial: "+7 días de prueba",
  suspend: "Suspender",
  reactivate: "Reactivar",
};

function operationsFor(status: OrganizationStatus): AccountOperation[] {
  if (status === "suspended") return ["reactivate"];
  if (status === "active" || status === "past_due") return ["deactivate", "suspend"];
  return ["activate", "extend_trial", "suspend"];
}

const shortDate = (date: Date) => date.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit" });

export default async function AdminPage(props: PageProps<"/admin">) {
  const params = await props.searchParams;
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 80) : "";

  const [organizations, grouped, plan, failedNotifications, failedEvents, audit] = await Promise.all([
    db.organization.findMany({
      where: q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { slug: { contains: q, mode: "insensitive" } },
              { memberships: { some: { user: { email: { contains: q, mode: "insensitive" } } } } },
            ],
          }
        : {},
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        memberships: { take: 1, orderBy: { createdAt: "asc" }, select: { user: { select: { email: true } } } },
        subscription: { select: { status: true, currentPeriodEnd: true } },
        _count: { select: { appointments: true } },
      },
    }),
    db.organization.groupBy({ by: ["status"], _count: true }),
    getMonthlyPlan(),
    db.notification.count({ where: { status: "failed", createdAt: { gte: weekAgo } } }),
    db.paymentEvent.count({ where: { processedAt: null } }),
    db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 15 }),
  ]);

  const total = grouped.reduce((sum, g) => sum + g._count, 0);
  const count = (status: OrganizationStatus) => grouped.find((g) => g.status === status)?._count ?? 0;
  const metrics: Array<[string, number]> = [
    ["Cuentas", total],
    ["En prueba", count("trial")],
    ["Activas", count("active")],
    ["Prueba vencida", count("trial_readonly") + count("locked")],
    ["Pago pendiente", count("past_due")],
  ];

  return (
    <div className="space-y-10">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Logo href="/admin" />
          <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-muted-foreground">Plataforma</span>
        </div>
        <Link href="/dashboard" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
          Ir a mi agenda
        </Link>
      </header>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {metrics.map(([label, value]) => (
          <div key={label} className="rounded-xl border border-border bg-card p-4">
            <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
            <dd className="mt-1 font-display text-3xl font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      <Section title="Estado de las integraciones">
        <ul className="space-y-1.5 text-sm">
          <li>Email (Resend): <strong>{isEmailConfigured() ? "configurado" : "sin configurar"}</strong> · {failedNotifications} avisos fallidos en 7 días</li>
          <li>Mercado Pago: <strong>{isMercadoPagoConfigured() ? "configurado" : "sin configurar"}</strong> · {failedEvents} eventos de pago sin procesar</li>
        </ul>
      </Section>

      <Section title="Cuentas">
        <form role="search" className="mb-4 max-w-sm">
          <Input name="q" type="search" defaultValue={q} placeholder="Buscar por negocio, enlace o email" aria-label="Buscar cuentas" />
        </form>
        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-border text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Negocio</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                <th className="px-4 py-3 font-medium">Alta</th>
                <th className="px-4 py-3 font-medium">Fin de prueba</th>
                <th className="px-4 py-3 text-right font-medium">Turnos</th>
                <th className="px-4 py-3 font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {organizations.map((organization) => {
                const status = getEffectiveStatus(organization);
                return (
                  <tr key={organization.id}>
                    <td className="px-4 py-3">
                      <p className="font-medium">{organization.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {organization.memberships[0]?.user.email} · /{organization.slug}
                        {!organization.onboardingCompletedAt && " · onboarding incompleto"}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "rounded-full px-2.5 py-0.5 text-xs font-medium",
                          status === "active" ? "bg-success-soft text-success" : status === "trial" ? "bg-accent text-accent-foreground" : "bg-warning-soft text-warning",
                        )}
                      >
                        {STATUS_LABEL[status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 tabular-nums">{shortDate(organization.createdAt)}</td>
                    <td className="px-4 py-3 tabular-nums">{shortDate(organization.trialEndsAt)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{organization._count.appointments}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {operationsFor(status).map((operation) => (
                          <form key={operation} action={accountOperationAction.bind(null, organization.id, operation)}>
                            <button className="rounded-md border border-input px-2 py-1 text-xs font-medium hover:bg-muted">
                              {OPERATIONS[operation]}
                            </button>
                          </form>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {organizations.length === 0 && <p className="px-4 py-6 text-sm text-muted-foreground">Sin cuentas para mostrar.</p>}
        </div>
      </Section>

      <Section title="Precio del plan mensual" description="Se usa para las suscripciones que se inicien a partir de ahora.">
        <PlanPriceForm price={plan.price} currency={plan.currency} />
      </Section>

      <Section title="Últimas operaciones registradas">
        <ul className="space-y-1 text-sm text-muted-foreground">
          {audit.map((entry) => (
            <li key={entry.id} className="tabular-nums">
              {entry.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC · <span className="text-foreground">{entry.action}</span>
              {entry.organizationId && ` · org ${entry.organizationId.slice(0, 8)}`}
            </li>
          ))}
          {audit.length === 0 && <li>Sin operaciones todavía.</li>}
        </ul>
      </Section>
    </div>
  );
}
