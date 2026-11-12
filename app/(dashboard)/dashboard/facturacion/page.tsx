import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Check } from "lucide-react";
import { CancelSubscriptionButton, SubscribeButton } from "@/components/billing/billing-actions";
import { PageHeader } from "@/components/dashboard/page-header";
import { Section } from "@/components/dashboard/section";
import { db } from "@/lib/db";
import { requireOrganization } from "@/lib/dal";
import { brand, formatMoney, pricing, trialPolicy } from "@/lib/brand";
import { isStandalone } from "@/lib/deployment";
import { daysRemainingInTrial, getEffectiveStatus } from "@/lib/organization-access";
import { formatDateLong, toZoned } from "@/lib/time";
import { isMercadoPagoConfigured } from "@/modules/billing/mercadopago";
import { getMonthlyPlan } from "@/modules/billing/subscriptions";

export const metadata: Metadata = { title: "Mi plan" };

const INCLUDED = [
  "Agenda y turnos sin límite",
  "Página de reservas online propia",
  "Clientes e historial",
  "Confirmaciones y recordatorios por email",
  "Actualizaciones y soporte",
];

export default async function BillingPage(props: PageProps<"/dashboard/facturacion">) {
  if (isStandalone()) notFound();

  const { organization, user } = await requireOrganization();
  const [plan, subscription] = await Promise.all([
    getMonthlyPlan(),
    db.subscription.findUnique({ where: { organizationId: organization.id } }),
  ]);

  const tz = organization.timezone;
  const status = getEffectiveStatus(organization);
  const paymentsReady = isMercadoPagoConfigured();
  const returned = (await props.searchParams).retorno === "1";
  const date = (d: Date) => formatDateLong(toZoned(d, tz).dateStr);
  const price = formatMoney(plan.price, plan.currency);
  const subscriptionLive = subscription && subscription.status !== "canceled" && status === "active";

  const headline: Record<string, { title: string; body: string }> = {
    trial: {
      title: `Prueba gratuita · ${daysRemainingInTrial(organization)} ${daysRemainingInTrial(organization) === 1 ? "día restante" : "días restantes"}`,
      body: `Tenés acceso completo hasta el ${date(organization.trialEndsAt)}. Después, tu cuenta pasa a solo lectura durante ${trialPolicy.readonlyGraceDays} días: podés ver todo, pero no crear ni modificar turnos. Nunca borramos tus datos.`,
    },
    trial_readonly: {
      title: "Tu prueba gratuita terminó",
      body: "Tu cuenta está en solo lectura: tus turnos y clientes siguen ahí, pero no podés crear ni modificar turnos, y tu página no recibe reservas. Al activar el plan recuperás todo al instante.",
    },
    locked: {
      title: "Tu cuenta está pausada",
      body: "Tus datos siguen guardados. Al activar el plan volvés a usar tu agenda como siempre.",
    },
    active: {
      title: "Plan activo",
      body: subscription?.status === "canceled" && subscription.currentPeriodEnd
        ? `Cancelaste la suscripción: conservás el acceso hasta el ${date(subscription.currentPeriodEnd)}.`
        : subscription?.currentPeriodEnd
          ? `Próximo cobro: ${date(subscription.currentPeriodEnd)}.`
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
  const canSubscribe = !subscriptionLive && status !== "suspended";

  return (
    <>
      <PageHeader title="Mi plan" />

      <div className="rounded-2xl border border-border bg-card p-5">
        <p className="font-display text-xl font-semibold">{current.title}</p>
        <p className="mt-2 text-sm text-muted-foreground">{current.body}</p>
        {returned && subscription?.status === "pending" && (
          <p className="mt-3 rounded-lg bg-secondary px-3 py-2 text-sm">
            Estamos esperando la confirmación de Mercado Pago. Puede demorar unos minutos; esta página se actualiza sola al
            recargarla.
          </p>
        )}
      </div>

      <div className="mt-10 space-y-10">
        <Section title="Plan mensual">
          <div className="rounded-2xl border border-border bg-card p-5">
            <p>
              <span className="font-display text-4xl font-semibold">{price}</span>
              <span className="text-muted-foreground"> / mes</span>
            </p>
            <ul className="mt-4 space-y-2 text-sm">
              {INCLUDED.map((item) => (
                <li key={item} className="flex items-center gap-2">
                  <Check className="size-4 text-primary" aria-hidden="true" /> {item}
                </li>
              ))}
            </ul>

            <div className="mt-6">
              {subscriptionLive ? (
                <CancelSubscriptionButton />
              ) : !canSubscribe ? null : paymentsReady ? (
                <SubscribeButton label={`Suscribirme por ${price} al mes`} defaultEmail={user.email} />
              ) : (
                <div className="rounded-xl bg-secondary p-4 text-sm">
                  <p className="font-medium">El pago online todavía no está habilitado.</p>
                  <p className="mt-1 text-muted-foreground">
                    Para activar tu plan escribinos a{" "}
                    <a href={`mailto:${brand.contactEmail}?subject=${encodeURIComponent(`Activar plan de ${organization.name}`)}`} className="font-medium text-primary underline underline-offset-4">
                      {brand.contactEmail}
                    </a>{" "}
                    y lo resolvemos en el día.
                  </p>
                </div>
              )}
            </div>
          </div>
        </Section>

        <Section title="¿Preferís un pago único?">
          <p className="max-w-prose text-sm text-muted-foreground">
            También ofrecemos una licencia de uso con instalación independiente por{" "}
            <span className="font-medium text-foreground">{formatMoney(pricing.oneTime)}</span> (pago único): {brand.name}{" "}
            instalado en tu propia infraestructura, con tu base de datos. Consultanos a{" "}
            <a href={`mailto:${brand.contactEmail}`} className="font-medium text-primary underline underline-offset-4">
              {brand.contactEmail}
            </a>
            .
          </p>
        </Section>
      </div>
    </>
  );
}
