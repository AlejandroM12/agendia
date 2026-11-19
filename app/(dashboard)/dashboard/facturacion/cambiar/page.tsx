import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PlanChangeForm } from "@/components/billing/plan-change-form";
import { PageHeader } from "@/components/dashboard/page-header";
import { requirePagePermission } from "@/lib/dal";
import { brand, formatMoney } from "@/lib/brand";
import { isStandalone } from "@/lib/deployment";
import { teamPlansAvailable } from "@/lib/features";
import { parsePlanTier } from "@/lib/plans";
import { formatDateLong, toZoned } from "@/lib/time";
import { isMercadoPagoConfigured } from "@/modules/billing/mercadopago";
import { previewPlanChange } from "@/modules/billing/plan-change";

export const metadata: Metadata = { title: "Confirmar plan" };

/**
 * Confirmación de contratar o cambiar de plan: muestra plan actual y nuevo, precio, cupos,
 * desde cuándo rige y cuánto se paga. Todo se calcula en el servidor y se vuelve a validar al enviar.
 */
export default async function ChangePlanPage(props: PageProps<"/dashboard/facturacion/cambiar">) {
  if (isStandalone()) notFound();
  const { organization, user, canWrite } = await requirePagePermission("billing.manage");

  const search = await props.searchParams;
  const tier = parsePlanTier(search.plan);
  const timing = search.cuando === "ahora" ? "now" : "period_end";
  if (!tier || (tier === "equipo" && !teamPlansAvailable())) notFound();
  if (!canWrite || !isMercadoPagoConfigured()) redirect("/dashboard/facturacion");

  const preview = await previewPlanChange(organization, tier, new Date(), timing);
  if (preview.kind === "same") redirect("/dashboard/facturacion");
  const date = (d: Date) => formatDateLong(toZoned(d, organization.timezone).dateStr);

  const title =
    preview.kind === "new" ? `Elegir el ${preview.target.name}` : preview.kind === "upgrade" ? "Pasar al Plan Equipo" : "Pasar al Plan Profesional";

  return (
    <>
      <PageHeader title={title} />
      <div className="max-w-xl space-y-6">
        <dl className="grid gap-3 rounded-2xl border border-border bg-card p-5 text-sm" data-testid="change-summary">
          {preview.current && (
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Plan actual</dt>
              <dd className="text-right font-medium">
                {preview.current.name} · {formatMoney(preview.current.price)}/mes · {preview.current.capacity} profesionales
              </dd>
            </div>
          )}
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Plan nuevo</dt>
            <dd className="text-right font-medium">
              {preview.target.name} · {formatMoney(preview.target.price)}/mes · {preview.target.capacity} profesionales
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Rige desde</dt>
            <dd className="text-right font-medium">
              {preview.effectiveAt ? `el ${date(preview.effectiveAt)} (${preview.effective})` : preview.effective}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Pagás hoy</dt>
            <dd className="text-right font-medium">
              {preview.amountToday > 0 ? formatMoney(preview.amountToday) : "Nada: el primer cobro es en la fecha de arriba"}
            </dd>
          </div>
        </dl>

        {preview.kind === "upgrade" && preview.effectiveAt && (
          <nav aria-label="Cuándo pasar al Plan Equipo" className="flex flex-wrap gap-2 text-sm" data-testid="timing">
            <Link href="/dashboard/facturacion/cambiar?plan=equipo" aria-current={timing === "period_end" ? "page" : undefined} className={`rounded-full border px-3 py-1.5 ${timing === "period_end" ? "border-primary bg-accent font-medium" : "border-border"}`}>
              Al terminar mi período (recomendado)
            </Link>
            <Link href="/dashboard/facturacion/cambiar?plan=equipo&cuando=ahora" aria-current={timing === "now" ? "page" : undefined} className={`rounded-full border px-3 py-1.5 ${timing === "now" ? "border-primary bg-accent font-medium" : "border-border"}`}>
              Hoy
            </Link>
          </nav>
        )}
        {preview.kind === "upgrade" && preview.effectiveAt && (
          <p className="text-sm text-muted-foreground">
            Se crea una suscripción nueva en Mercado Pago que empieza a cobrar el {date(preview.effectiveAt)}. Hasta ese día seguís con el Plan Profesional
            que ya pagaste y, al autorizarla, cancelamos la anterior para que no se cobren las dos. Tus {preview.target.capacity} lugares se habilitan con el
            primer cobro aprobado, no antes. No perdés nada de lo abonado.
          </p>
        )}
        {preview.kind === "upgrade" && !preview.effectiveAt && (
          <p className="text-sm text-muted-foreground">
            Se crea una suscripción nueva en Mercado Pago. Tus {preview.target.capacity} lugares se habilitan cuando el pago se confirma, no antes. Cuando eso
            ocurra cancelamos tu suscripción anterior para que no se cobren las dos. <strong>Lo que ya pagaste del Plan Profesional de este período no se
            reintegra automáticamente</strong>: escribinos a {brand.contactEmail} si querés revisarlo.
          </p>
        )}
        {preview.kind === "new" && (
          <p className="text-sm text-muted-foreground">
            Vas a autorizar el débito automático mensual en Mercado Pago. Tu plan se activa cuando Mercado Pago confirme el pago. Podés cancelar
            cuando quieras.
          </p>
        )}

        {preview.reduction && (
          <div className="space-y-3 rounded-2xl border border-warning/40 bg-warning-soft p-5 text-sm" data-testid="reduction-info">
            <p className="font-medium text-warning">
              El Plan Profesional admite {preview.reduction.newLimit} profesionales activos y hoy tenés {preview.reduction.active}.
            </p>
            <p>
              No borramos ni desactivamos a nadie, y tus turnos confirmados no se cancelan. Cuando el nuevo plan empiece a regir, tenés{" "}
              {preview.reduction.graceDays} días para adaptarte (no se puede agregar ni reactivar profesionales). Después, los que no elijas dejan de
              recibir reservas nuevas, pero conservan su historial y sus turnos ya confirmados. Si volvés al Plan Equipo, recuperás todos los lugares.
            </p>
            <p>
              Elegí abajo quiénes siguen recibiendo reservas. Si querés reasignar turnos futuros antes, hacelo desde la{" "}
              <Link href="/dashboard/agenda" className="font-medium underline underline-offset-4">
                agenda
              </Link>
              .
            </p>
          </div>
        )}

        <PlanChangeForm
          tier={tier}
          defaultEmail={user.email}
          submitLabel={
            preview.kind === "downgrade" || preview.effectiveAt
              ? "Confirmar el cambio y autorizar en Mercado Pago"
              : `Continuar a Mercado Pago · ${formatMoney(preview.target.price)} por mes`
          }
          professionals={preview.reduction?.professionals}
          keepLimit={preview.reduction?.newLimit}
          timing={preview.kind === "upgrade" ? timing : undefined}
        />
        <p className="text-sm">
          <Link href="/dashboard/facturacion" className="text-muted-foreground underline underline-offset-4">
            Volver a Mi plan
          </Link>
        </p>
      </div>
    </>
  );
}
