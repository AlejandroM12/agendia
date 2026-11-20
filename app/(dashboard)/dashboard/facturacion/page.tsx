import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Check } from "lucide-react";
import { CancelSubscriptionButton, DiscardChangeButton, RefreshPaymentButton } from "@/components/billing/billing-actions";
import { KeepSelectionForm } from "@/components/billing/plan-change-form";
import { PageHeader } from "@/components/dashboard/page-header";
import { Section } from "@/components/dashboard/section";
import { ButtonLink } from "@/components/ui/button-link";
import { db } from "@/lib/db";
import { requirePagePermission } from "@/lib/dal";
import { brand, formatMoney, licenseTerms, offers, trialPolicy } from "@/lib/brand";
import { isStandalone } from "@/lib/deployment";
import { isTeamModeEnabled, teamPlansAvailable } from "@/lib/features";
import { canManageBilling, daysRemainingInTrial, getEffectiveStatus } from "@/lib/organization-access";
import { PLAN_CAPABILITIES, planTierFromCode, type PlanTier } from "@/lib/plans";
import { formatDateLong, toZoned } from "@/lib/time";
import { getSellablePlan } from "@/modules/billing/catalog";
import { canPayOnline } from "@/modules/billing/mercadopago";
import { isLiveSubscription } from "@/modules/billing/plan-change";
import { getCapacityState, rankProfessionalsForCapacity } from "@/modules/team/capacity";
import { getProfessionalQuota } from "@/modules/team/professionals";

export const metadata: Metadata = { title: "Mi plan" };

/** Lo que incluyen los dos planes: es lo mismo; solo cambia la cantidad de profesionales. */
export const INCLUDED_BASE = [
  "Agenda y turnos sin límite",
  "Clientes e historial sin límite",
  "Página de reservas online propia",
  "Confirmaciones y recordatorios por email",
  "WhatsApp manual con mensajes preparados",
  "Hosting y soporte incluidos",
];
/** Lo de equipos solo se nombra si el negocio ya puede usarlo: no se anuncia algo que todavía no está disponible. */
const INCLUDED_TEAM = [
  ...INCLUDED_BASE.slice(0, 2),
  "Una agenda por profesional",
  ...INCLUDED_BASE.slice(2, 5),
  "Cuentas individuales opcionales y permisos configurables",
  ...INCLUDED_BASE.slice(5),
];

export default async function BillingPage(props: PageProps<"/dashboard/facturacion">) {
  if (isStandalone()) notFound();

  const { organization, user, canWrite } = await requirePagePermission("billing.manage");
  const subscription = await db.subscription.findUnique({
    where: { organizationId: organization.id },
    include: { plan: true, pendingPlan: true },
  });

  const tz = organization.timezone;
  const status = getEffectiveStatus(organization);
  const paymentsReady = canPayOnline(user.email);
  const returned = (await props.searchParams).retorno === "1";
  const date = (d: Date) => formatDateLong(toZoned(d, tz).dateStr);
  const live = isLiveSubscription(subscription) && status !== "suspended";
  // Primer contrato todavía sin un cobro aprobado y verificado: no hay plan pago, y se explica por qué y qué se puede hacer.
  const awaitingFirstPayment = Boolean(subscription && subscription.status === "pending" && subscription.providerSubscriptionId && !subscription.pendingProviderSubscriptionId);
  const firstPaymentRejected = awaitingFirstPayment && subscription?.lastChargeStatus === "rejected";
  const currentTier: PlanTier | null = live ? planTierFromCode(subscription!.plan.code) : null;
  const showTeamPlan = teamPlansAvailable() || currentTier === "equipo";
  const teamEnabled = isTeamModeEnabled(organization) || showTeamPlan;

  const [quota, capacity] = await Promise.all([
    getProfessionalQuota(db, organization),
    getCapacityState(db, organization.id),
  ]);
  const ranked = capacity && capacity.excess > 0 ? await rankProfessionalsForCapacity(db, organization.id) : [];
  const keepIds = new Set(capacity?.keepIds ?? []);

  const trialDays = daysRemainingInTrial(organization);
  const headline: Record<string, { title: string; body: string }> = {
    trial: {
      title: `Prueba gratuita · ${trialDays} ${trialDays === 1 ? "día restante" : "días restantes"}`,
      body: `Tenés acceso completo hasta el ${date(organization.trialEndsAt)}${teamEnabled ? `, con hasta ${quota.limit} profesionales activos` : ""}. No se cobra nada automáticamente. Si no contratás, tu cuenta pasa a solo lectura durante ${trialPolicy.readonlyGraceDays} días: podés ver todo, pero no crear ni modificar turnos. Nunca borramos tus datos.`,
    },
    trial_readonly: {
      title: "Tu prueba gratuita terminó",
      body: "Tu cuenta está en solo lectura: tus turnos y clientes siguen ahí, pero no podés crear ni modificar turnos, y tu página no recibe reservas. Al elegir un plan recuperás todo al instante.",
    },
    locked: {
      title: "Tu cuenta está pausada",
      body: "Tus datos siguen guardados. Al elegir un plan volvés a usar tu agenda como siempre.",
    },
    active: {
      title: subscription?.status === "canceled" ? "Plan cancelado" : "Plan activo",
      body: subscription?.status === "canceled" && subscription.currentPeriodEnd
        ? `Cancelaste la suscripción: conservás el acceso hasta el ${date(subscription.currentPeriodEnd)}.`
        : "Tu cuenta tiene acceso completo.",
    },
    past_due: {
      title: "Hay un problema con tu pago",
      body: "No pudimos cobrar tu suscripción. Revisá tu medio de pago en Mercado Pago para no perder el acceso.",
    },
    canceled: {
      title: "Suscripción cancelada",
      body: "Tu cuenta está en solo lectura. Podés volver a suscribirte cuando quieras, sin perder nada.",
    },
    suspended: {
      title: "Cuenta suspendida",
      body: `Escribinos a ${brand.contactEmail} para resolverlo.`,
    },
  };
  const current = headline[status];

  const contactBlock = (
    <div className="rounded-xl bg-secondary p-4 text-sm">
      <p className="font-medium">El pago online todavía no está habilitado.</p>
      <p className="mt-1 text-muted-foreground">
        Para activar tu plan escribinos a{" "}
        <a
          href={`mailto:${brand.contactEmail}?subject=${encodeURIComponent(`Activar plan de ${organization.name}`)}`}
          className="font-medium text-primary underline underline-offset-4"
        >
          {brand.contactEmail}
        </a>{" "}
        y lo resolvemos en el día.
      </p>
    </div>
  );

  const tiers: PlanTier[] = showTeamPlan ? ["profesional", "equipo"] : ["profesional"];
  const sellable = Object.fromEntries(await Promise.all(tiers.map(async (tier) => [tier, (await getSellablePlan(tier)).ok] as const)));

  return (
    <>
      <PageHeader title="Mi plan" />

      <div className="rounded-2xl border border-border bg-card p-5" data-testid="plan-status">
        <p className="font-display text-xl font-semibold">{current.title}</p>
        <p className="mt-2 text-sm text-muted-foreground">{current.body}</p>
        {returned && (subscription?.status === "pending" || subscription?.pendingProviderSubscriptionId) && (
          <p className="mt-3 rounded-lg bg-secondary px-3 py-2 text-sm">
            Estamos esperando la confirmación de Mercado Pago. Puede demorar unos minutos; tu plan no cambia hasta que el
            pago esté confirmado. Esta página se actualiza al recargarla.
          </p>
        )}
        {live && subscription && (
          <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2" data-testid="plan-details">
            <div>
              <dt className="text-muted-foreground">Plan</dt>
              <dd className="font-medium">{subscription.plan.name}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Precio</dt>
              <dd className="font-medium">{formatMoney(subscription.contractedAmount ?? subscription.plan.price, subscription.contractedCurrency ?? subscription.plan.currency)} por mes</dd>
            </div>
            {subscription.currentPeriodEnd && (
              <>
                <div>
                  <dt className="text-muted-foreground">Próxima renovación</dt>
                  <dd className="font-medium">{date(subscription.currentPeriodEnd)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Próximo cobro</dt>
                  <dd className="font-medium">{formatMoney(subscription.contractedAmount ?? subscription.plan.price, subscription.contractedCurrency ?? subscription.plan.currency)}</dd>
                </div>
              </>
            )}
          </dl>
        )}
      </div>

      {teamEnabled && (
      <div className="mt-6 rounded-2xl border border-border bg-card p-5" data-testid="seat-usage">
        <p className="font-medium">
          Estás utilizando {quota.active} de {quota.limit} profesionales
        </p>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-secondary" role="presentation">
          <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, (quota.active / Math.max(1, quota.limit)) * 100)}%` }} />
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {quota.overLimit
            ? "Tenés más profesionales activos de los que admite tu plan."
            : `${quota.available} ${quota.available === 1 ? "lugar disponible" : "lugares disponibles"}. `}
          Solo cuentan los profesionales activos: quien administra pero no atiende, y las cuentas individuales, no ocupan lugar.
        </p>
        {showTeamPlan && currentTier !== "equipo" && quota.available === 0 && !quota.overLimit && (
          <p className="mt-2 text-sm">
            Necesitás más espacio. Con el {PLAN_CAPABILITIES.equipo.name} podés administrar hasta{" "}
            {PLAN_CAPABILITIES.equipo.maxActiveProfessionals} profesionales.
          </p>
        )}
      </div>
      )}

      {capacity && capacity.excess > 0 && (
        <div className="mt-6 rounded-2xl border border-warning/40 bg-warning-soft p-5" data-testid="capacity-excess">
          <p className="font-medium text-warning">Tu plan admite {capacity.limit} profesionales activos y tenés {capacity.active}</p>
          <p className="mt-2 text-sm">
            No borramos ni desactivamos nada, y tus turnos confirmados no se tocan.{" "}
            {capacity.restricting
              ? "El período de adaptación terminó: los profesionales que no están elegidos dejaron de recibir reservas nuevas, pero conservan su historial y sus turnos ya confirmados."
              : capacity.graceEndsAt
                ? `Tenés tiempo hasta el ${date(capacity.graceEndsAt)} para elegir quiénes siguen recibiendo reservas nuevas. Si no elegís, seguimos este criterio: quien atiende por la cuenta del propietario, luego quien tiene más turnos futuros, luego el orden del equipo.`
                : "Elegí quiénes siguen recibiendo reservas nuevas."}
          </p>
          {canWrite && (
            <div className="mt-4">
              <KeepSelectionForm
                limit={capacity.limit}
                professionals={ranked.map((p) => ({ id: p.id, name: p.displayName, futureAppointments: p.future, keep: keepIds.has(p.id) }))}
              />
            </div>
          )}
          <p className="mt-3 text-sm">
            También podés <Link href="/dashboard/equipo" className="font-medium underline underline-offset-4">desactivar a alguien</Link> (hay que resolver antes
            sus turnos futuros){showTeamPlan && " o volver al Plan Equipo"}.
          </p>
        </div>
      )}

      {awaitingFirstPayment && (
        <div className="mt-6 rounded-2xl border border-border bg-card p-5" data-testid="first-payment">
          <p className="font-medium">{firstPaymentRejected ? "No pudimos cobrar tu primer pago" : "Esperando la confirmación de tu primer pago"}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {firstPaymentRejected
              ? "Mercado Pago rechazó el cobro. Tu plan todavía no se activó y tu cuenta sigue como estaba."
              : "Tu plan se activa cuando Mercado Pago confirme el primer cobro: autorizar la suscripción no alcanza. Tu cuenta sigue como estaba hasta entonces y no perdés los días de prueba que te queden."}
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
            {!firstPaymentRejected && <li>Si ya pagaste, tocá «Verificar mi pago ahora»: puede demorar unos minutos en llegar.</li>}
            <li>
              Podés elegir el plan de nuevo (abajo), por ejemplo con otro medio de pago: reemplaza este intento y no se cobra dos veces.
            </li>
            <li>
              O escribinos a{" "}
              <a href={`mailto:${brand.contactEmail}?subject=${encodeURIComponent(`Pago de ${organization.name}`)}`} className="font-medium underline underline-offset-4">
                {brand.contactEmail}
              </a>
              .
            </li>
          </ul>
          {!firstPaymentRejected && canManageBilling(organization) && paymentsReady && (
            <div className="mt-4">
              <RefreshPaymentButton />
            </div>
          )}
        </div>
      )}

      {subscription?.pendingPlan && (
        <div className="mt-6 rounded-2xl border border-border bg-card p-5" data-testid="pending-change">
          <p className="font-medium">Cambio a {subscription.pendingPlan.name} en curso</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {subscription.pendingEffectiveAt
              ? `Pasa a regir el ${date(subscription.pendingEffectiveAt)}, cuando termina el período que ya pagaste.`
              : "Pasa a regir cuando Mercado Pago confirme el pago. Hasta entonces tu plan y tus lugares no cambian."}
          </p>
          <div className="mt-3">
            <DiscardChangeButton />
          </div>
        </div>
      )}

      <div className="mt-10 space-y-10">
        <Section title="Planes" description={showTeamPlan ? "Los dos planes incluyen lo mismo. Solo cambia cuántos profesionales activos podés tener." : undefined}>
          <div className="grid gap-4 sm:grid-cols-2">
            {tiers.map((tier) => {
              const capability = PLAN_CAPABILITIES[tier];
              const isCurrent = currentTier === tier;
              const kind = !currentTier ? "new" : tier === "equipo" ? "upgrade" : "downgrade";
              return (
                <div key={tier} className="rounded-2xl border border-border bg-card p-5" data-testid={`plan-${tier}`}>
                  <p className="font-medium">{capability.name}</p>
                  <p className="mt-1">
                    <span className="font-display text-4xl font-semibold">{formatMoney(capability.monthlyPrice)}</span>
                    <span className="text-muted-foreground"> / mes</span>
                  </p>
                  {teamEnabled && <p className="mt-2 text-sm text-muted-foreground">Hasta {capability.maxActiveProfessionals} profesionales activos</p>}
                  <div className="mt-4">
                    {isCurrent ? (
                      <p className="text-sm font-medium text-primary">Tu plan actual</p>
                    ) : !canManageBilling(organization) ? null : !paymentsReady || !sellable[tier] ? (
                      contactBlock
                    ) : (
                      <ButtonLink href={`/dashboard/facturacion/cambiar?plan=${tier}`} variant={kind === "downgrade" ? "outline" : "default"}>
                        {kind === "new" ? `Elegir ${capability.name}` : kind === "upgrade" ? "Pasar al Plan Equipo" : "Pasar al Plan Profesional"}
                      </ButtonLink>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <ul className="mt-5 grid gap-2 text-sm sm:grid-cols-2">
            {(teamEnabled ? INCLUDED_TEAM : INCLUDED_BASE).map((item) => (
              <li key={item} className="flex items-center gap-2">
                <Check className="size-4 text-primary" aria-hidden="true" /> {item}
              </li>
            ))}
          </ul>
          {live && (
            <div className="mt-6">
              <CancelSubscriptionButton />
              <p className="mt-2 text-xs text-muted-foreground">
                Cancelás cuando quieras: conservás el acceso hasta el final del período ya pago y no borramos tus datos.
              </p>
            </div>
          )}
        </Section>

        <Section title={offers.license}>
          <p className="max-w-prose text-sm text-muted-foreground">
            También podés tener {brand.name} con una licencia de uso permanente (pago único): instalación independiente,
            con instalación, configuración y {licenseTerms.includedServiceMonths} meses de hosting, dominio y soporte
            incluidos.{" "}
            <Link href="/licencia" className="font-medium text-primary underline underline-offset-4">
              Ver condiciones
            </Link>
            .
          </p>
        </Section>
      </div>
      <p className="sr-only">{user.email}</p>
    </>
  );
}
