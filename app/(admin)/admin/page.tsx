import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import type { LicenseOrderStatus, OrganizationStatus } from "@prisma/client";
import { ConfirmButton } from "@/components/form/confirm-button";
import { Logo } from "@/components/brand/logo";
import { Section } from "@/components/dashboard/section";
import { Input } from "@/components/ui/input";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/dal";
import { canAccessPlatformAdmin } from "@/lib/deployment";
import { db } from "@/lib/db";
import { getEffectiveStatus } from "@/lib/organization-access";
import { formatMoney, offers, pricing } from "@/lib/brand";
import { cn } from "@/lib/utils";
import { type AccountOperation, accountOperationAction, alignPlanPricesAction } from "@/modules/admin/actions";
import { priceDiscrepancies } from "@/modules/billing/catalog";
import { teamFeaturesPaused, teamPlansPublished } from "@/lib/features";
import { PLAN_CAPABILITIES, PLAN_TIERS } from "@/lib/plans";
import { detectCredentialsKind, isMercadoPagoConfigured, mercadoPagoMode } from "@/modules/billing/mercadopago";
import { isEmailConfigured } from "@/modules/notifications/email";
import { getDailyEmailUsage, getEmailsByType, getUsageByOrganization, monthRange, totalUsage } from "@/modules/system/usage";

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

const LICENSE_STATUS_LABEL: Record<LicenseOrderStatus, string> = {
  pending: "Sin pago confirmado",
  paid: "Pagada",
  rejected: "Pago rechazado",
  refunded: "Devuelta",
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
  // Siempre con datos del momento: nada de esta página se prerenderiza.
  await connection();
  // Defensa en profundidad: el layout no se reevalúa al navegar entre páginas.
  const { user: viewer } = await requireContext();
  if (!canAccessPlatformAdmin(viewer)) notFound();
  const params = await props.searchParams;
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 80) : "";

  const range = monthRange();
  const mpMode = mercadoPagoMode();
  const mpKind = isMercadoPagoConfigured() ? await detectCredentialsKind() : "unknown";
  const mpMismatch = (mpMode === "live" && mpKind === "test") || (mpMode === "test" && mpKind === "live");
  const mpStatus = !isMercadoPagoConfigured()
    ? "sin configurar o sin modo declarado (el pago online está apagado)"
    : mpMismatch
      ? `¡MODO ${mpMode?.toUpperCase()} pero las credenciales son de ${mpKind === "test" ? "PRUEBA" : "PRODUCCIÓN"}! No se crean cobros`
      : mpMode === "live"
        ? "configurado (PRODUCCIÓN)"
        : "configurado en MODO PRUEBA (solo cuentas autorizadas)";
  const [organizations, grouped, discrepancies, failedNotifications, failedEvents, audit, licenseOrders, usage, dailyEmails, emailTypes] = await Promise.all([
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
        memberships: { where: { role: "owner" }, take: 1, orderBy: { createdAt: "asc" }, select: { user: { select: { email: true } } } },
        subscription: { select: { status: true, currentPeriodEnd: true } },
        _count: { select: { appointments: true } },
      },
    }),
    db.organization.groupBy({ by: ["status"], _count: true }),
    priceDiscrepancies(),
    db.notification.count({ where: { status: "failed", createdAt: { gte: weekAgo } } }),
    db.paymentEvent.count({ where: { processedAt: null } }),
    db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 15 }),
    db.licenseOrder.findMany({ orderBy: { createdAt: "desc" }, take: 30 }),
    getUsageByOrganization(range, 15),
    getDailyEmailUsage(range),
    getEmailsByType(range),
  ]);
  const usageTotals = totalUsage(usage);

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
          <li>
            Mercado Pago: <strong>{mpStatus}</strong> · {failedEvents} eventos de pago sin procesar
          </li>
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
                      <p className="font-medium">
                        <Link href={`/admin/negocios/${organization.id}`} className="underline-offset-4 hover:underline">
                          {organization.name}
                        </Link>
                      </p>
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

      <Section
        title="Catálogo comercial y funciones"
        description="Una sola fuente de precios: lib/brand.ts (PRICE_* al construir). El precio contratable de cada plan (tabla plans) tiene que coincidir; si no, ese plan no se vende. Las suscripciones vigentes conservan lo que autorizaron."
      >
        <ul className="space-y-1.5 text-sm" data-testid="catalog">
          {PLAN_TIERS.map((tier) => (
            <li key={tier}>
              {PLAN_CAPABILITIES[tier].name}: <strong>{formatMoney(PLAN_CAPABILITIES[tier].monthlyPrice)}</strong> por mes · hasta {PLAN_CAPABILITIES[tier].maxActiveProfessionals} profesionales ·{" "}
              {PLAN_CAPABILITIES[tier].licenseName} {formatMoney(PLAN_CAPABILITIES[tier].licensePrice)}
            </li>
          ))}
          <li>
            Publicación de los planes con equipo: <strong>{teamPlansPublished() ? "ENCENDIDA" : "apagada"}</strong>
            {teamFeaturesPaused() && " · pausa de emergencia ACTIVA"}
          </li>
        </ul>
        {discrepancies.length > 0 ? (
          <div className="mt-3 rounded-xl bg-warning-soft p-3 text-sm text-warning" data-testid="price-discrepancy">
            <p className="font-medium">Hay precios contratables distintos de los publicados:</p>
            <ul className="mt-1 list-disc pl-5">
              {discrepancies.map((d) => (
                <li key={d.code}>
                  {d.code}: en la base {formatMoney(d.stored)}, publicado {formatMoney(d.published)}
                </li>
              ))}
            </ul>
            <div className="mt-3">
              <ConfirmButton variant="outline" action={alignPlanPricesAction} confirmMessage="¿Alinear los precios de la base con los publicados? Queda registrado.">
                Alinear con los publicados
              </ConfirmButton>
            </div>
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">Los precios contratables coinciden con los publicados.</p>
        )}
      </Section>

      <Section
        title="Consumo del mes"
        description="Correos y turnos por negocio en el mes en curso (UTC). Los correos son el único costo variable (Resend); un correo fallido o reintentado cuenta como consumo."
      >
        <p className="mb-3 text-sm text-muted-foreground">
          Total: <strong className="text-foreground">{usageTotals.sent}</strong> correos enviados ·{" "}
          <strong className="text-foreground">{usageTotals.failed}</strong> fallidos ·{" "}
          <strong className="text-foreground">{usageTotals.retried}</strong> con reintentos ·{" "}
          <strong className="text-foreground">{usageTotals.appointments}</strong> turnos creados
          {dailyEmails.length > 0 && (
            <>
              {" "}
              · último día con envíos: {dailyEmails[dailyEmails.length - 1].day} ({dailyEmails[dailyEmails.length - 1].sent})
            </>
          )}
        </p>
        {emailTypes.length > 0 && (
          <ul className="mb-4 flex flex-wrap gap-2 text-xs" data-testid="emails-by-type">
            {emailTypes.map((row) => (
              <li key={row.type} className="rounded-full border border-border bg-card px-3 py-1">
                {row.type} <span className="text-muted-foreground">({row.audience})</span>: <strong>{row.sent}</strong>
                {row.failed > 0 && <span className="text-warning"> · {row.failed} fallidos</span>}
              </li>
            ))}
          </ul>
        )}
        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="w-full min-w-[800px] text-left text-sm">
            <thead className="border-b border-border text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Negocio</th>
                <th className="px-4 py-3 text-right font-medium">Profesionales activos</th>
                <th className="px-4 py-3 text-right font-medium">Turnos</th>
                <th className="px-4 py-3 text-right font-medium">Correos enviados</th>
                <th className="px-4 py-3 text-right font-medium">Fallidos</th>
                <th className="px-4 py-3 text-right font-medium">Reintentos</th>
                <th className="px-4 py-3 text-right font-medium">Avisos internos</th>
                <th className="px-4 py-3 text-right font-medium">Invitaciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {usage.map((row) => (
                <tr key={row.organizationId}>
                  <td className="px-4 py-3">
                    <p className="font-medium">{row.name}</p>
                    <p className="text-xs text-muted-foreground">/{row.slug}</p>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{row.activeProfessionals}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{row.appointmentsCreated}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{row.emails.sent}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{row.emails.failed}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{row.emails.retried}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{row.internalNotices}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{row.invitationEmails}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {usage.length === 0 && <p className="px-4 py-6 text-sm text-muted-foreground">Todavía no hay consumo este mes.</p>}
        </div>
      </Section>

      <Section
        title={offers.license}
        description={`Precios publicados: ${formatMoney(pricing.oneTime)} (Profesional, PRICE_ONE_TIME) y ${formatMoney(pricing.licenseTeam)} (Equipo, PRICE_LICENSE_TEAM; solo se vende con los planes con equipo publicados). Una orden pasa a «Pagada» solo cuando Mercado Pago confirma el pago; después hay que crear la instalación (docs/DEPLOYMENT.md).`}
      >
        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-border text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Negocio</th>
                <th className="px-4 py-3 font-medium">Contacto</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                <th className="px-4 py-3 font-medium">Fecha</th>
                <th className="px-4 py-3 text-right font-medium">Importe</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {licenseOrders.map((order) => (
                <tr key={order.id}>
                  <td className="px-4 py-3">
                    <p className="font-medium">{order.businessName}</p>
                    <p className="text-xs text-muted-foreground">orden {order.id.slice(0, 8)} · nivel {order.tier}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p>{order.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {order.email}
                      {order.phone && ` · ${order.phone}`}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-0.5 text-xs font-medium",
                        order.status === "paid" ? "bg-success-soft text-success" : "bg-warning-soft text-warning",
                      )}
                    >
                      {LICENSE_STATUS_LABEL[order.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 tabular-nums">{shortDate(order.paidAt ?? order.createdAt)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatMoney(order.amount, order.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {licenseOrders.length === 0 && <p className="px-4 py-6 text-sm text-muted-foreground">Todavía no hay compras de licencia.</p>}
        </div>
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
