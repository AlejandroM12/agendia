import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { ConfirmButton } from "@/components/form/confirm-button";
import { Section } from "@/components/dashboard/section";
import { formatMoney } from "@/lib/brand";
import { requireContext } from "@/lib/dal";
import { canAccessPlatformAdmin } from "@/lib/deployment";
import { setOrganizationFeatureAction, reconcileOrganizationAction } from "@/modules/admin/actions";
import { getOrganizationAdminView } from "@/modules/admin/overview";
import { WhatsappAdminPanel } from "@/components/admin/whatsapp-admin-panel";
import { getWhatsappView } from "@/modules/whatsapp/views";
import { TEMPLATES, WHATSAPP_KINDS } from "@/modules/whatsapp/templates";

export const metadata: Metadata = { title: "Negocio · Plataforma", robots: { index: false } };

const fmt = (date: Date | null | undefined) => (date ? date.toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" }) : "—");
const yesNo = (value: boolean) => (value ? "Sí" : "No");

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border py-2 text-sm last:border-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  );
}

export default async function AdminOrganizationPage(props: PageProps<"/admin/negocios/[id]">) {
  await connection();
  // El layout también lo exige, pero un layout no se vuelve a evaluar al navegar entre páginas: la página
  // verifica el permiso por su cuenta antes de leer nada.
  const { user } = await requireContext();
  if (!canAccessPlatformAdmin(user)) notFound();
  const { id } = await props.params;
  const view = await getOrganizationAdminView(id);
  if (!view) notFound();
  const whatsapp = await getWhatsappView(id, { messages: 25 });

  return (
    <div className="space-y-10" data-testid="admin-org">
      <header>
        <Link href="/admin" className="text-sm text-muted-foreground underline underline-offset-4">
          ← Plataforma
        </Link>
        <h1 className="mt-2 font-display text-3xl font-semibold">{view.name}</h1>
        <p className="text-sm text-muted-foreground">
          /{view.slug} · {view.owners.join(", ") || "sin propietario"} · alta {fmt(view.createdAt)}
        </p>
      </header>

      <Section title="Plan y suscripción">
        <dl className="rounded-2xl border border-border bg-card px-4">
          <Row label="Estado de la cuenta">{view.status}</Row>
          <Row label="Plan">{view.plan ? `${view.plan.name} (${view.plan.subscriptionStatus})` : "Sin suscripción"}</Row>
          {view.plan && <Row label="Importe contratado">{view.plan.contractedAmount === null ? "no registrado" : formatMoney(view.plan.contractedAmount)}</Row>}
          {view.plan && <Row label="Fin del período / último cobro">{fmt(view.plan.currentPeriodEnd)} / {fmt(view.plan.lastPaymentAt)}</Row>}
          {view.plan?.pending && (
            <Row label="Cambio pendiente">
              {view.plan.pending.name} ({view.plan.pending.kind}){view.plan.pending.effectiveAt ? ` desde ${fmt(view.plan.pending.effectiveAt)}` : ""}
            </Row>
          )}
          <Row label="Prueba">{fmt(view.trial.startedAt)} → {fmt(view.trial.endsAt)}</Row>
          <Row label="Intención de plan al registrarse">{view.intendedPlan ?? "—"}</Row>
        </dl>
        {view.billingNeeded.length > 0 && (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-warning" data-testid="billing-needed">
            {view.billingNeeded.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}
        <div className="mt-4">
          <ConfirmButton variant="outline" action={reconcileOrganizationAction.bind(null, view.id)} confirmMessage="¿Conciliar con Mercado Pago? Solo consulta y aplica el estado real.">
            Conciliar suscripción
          </ConfirmButton>
        </div>
      </Section>

      <Section title="WhatsApp automático">
        <dl className="mb-6 rounded-2xl border border-border bg-card px-4" data-testid="whatsapp-state">
          <Row label="Estado">{whatsapp.exists ? (whatsapp.enabled ? "ACTIVO" : "Desactivado") : "Sin conexión"} · conexión: {whatsapp.status}</Row>
          {whatsapp.statusDetail && <Row label="Detalle">{whatsapp.statusDetail}</Row>}
          <Row label="Número / nombre verificado">{whatsapp.displayPhone ?? "—"} / {whatsapp.verifiedName ?? "—"}</Row>
          <Row label="Calidad del número">{whatsapp.qualityRating ?? "—"}</Row>
          <Row label="Plantillas">{WHATSAPP_KINDS.map((kind) => `${TEMPLATES[kind].name}: ${whatsapp.templates[kind] ?? "sin sincronizar"}`).join(" · ")}</Row>
          <Row label="Consumo del mes">{whatsapp.usage.used} de {whatsapp.monthlyLimit} mensajes ({whatsapp.usage.failed} fallidos)</Row>
          <Row label="Consentimientos">{whatsapp.consents.granted} vigentes · {whatsapp.consents.revoked} dados de baja</Row>
        </dl>
        <WhatsappAdminPanel
          organizationId={id}
          exists={whatsapp.exists}
          enabled={whatsapp.enabled}
          status={whatsapp.status}
          phoneNumberId={whatsapp.phoneNumberId}
          wabaId={whatsapp.wabaId}
          templateLanguage={whatsapp.templateLanguage}
          credentialsHint={whatsapp.credentialsHint}
          hasVerifyToken={whatsapp.hasVerifyToken}
          settings={whatsapp.settings}
          monthlyLimit={whatsapp.monthlyLimit}
          testRecipients={whatsapp.testRecipients}
          webhookUrl={whatsapp.webhookUrl}
        />
        <h3 className="mt-8 font-semibold">Últimos mensajes y errores</h3>
        {whatsapp.messages.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Todavía no hay mensajes.</p>
        ) : (
          <ul className="mt-2 divide-y divide-border rounded-2xl border border-border bg-card text-sm">
            {whatsapp.messages.map((message) => (
              <li key={message.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                <span>
                  {fmt(message.at)} · {message.direction === "outbound" ? "→" : "←"} {message.kind}
                  {message.isTest ? " (prueba)" : ""} · …{message.phone?.slice(-4) ?? "—"}
                </span>
                <span className={message.status === "failed" || message.status === "unknown" ? "font-medium text-destructive" : "text-muted-foreground"}>
                  {message.status}
                  {message.errorMessage ? ` — ${message.errorMessage}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Equipo y cupos">
        <dl className="rounded-2xl border border-border bg-card px-4">
          <Row label="Profesionales activos / cupos">
            {view.seats.active} / {view.seats.limit} ({view.seats.available} disponibles · {view.seats.source}
            {view.seats.tier ? ` · ${view.seats.tier}` : ""})
          </Row>
          <Row label="Cuentas individuales vinculadas">{view.linkedAccounts} (+ {view.pendingInvitations} invitaciones pendientes)</Row>
          <Row label="Modo equipo">{yesNo(view.features.teamMode)}{view.features.teamModeFlag ? " (habilitado para este negocio)" : ""}</Row>
          <Row label="Cuentas individuales">{yesNo(view.features.accounts)}{view.features.accountsFlag ? " (habilitadas para este negocio)" : ""}</Row>
          <Row label="¿Cómo trabaja?">{view.workMode ?? "—"}</Row>
          <Row label="Exceso de cupo">
            {view.capacity && view.capacity.excess > 0
              ? `${view.capacity.excess} de más · adaptación hasta ${fmt(view.capacity.graceEndsAt)}${view.capacity.restricting ? ` · restringidos: ${view.capacity.restrictedCount}` : ""}`
              : "Sin exceso"}
          </Row>
        </dl>
        <div className="mt-4 flex flex-wrap gap-2">
          <ConfirmButton variant="outline" action={setOrganizationFeatureAction.bind(null, view.id, "team", !view.features.teamModeFlag)} confirmMessage="¿Cambiar el modo equipo de este negocio? Queda registrado. No borra nada.">
            {view.features.teamModeFlag ? "Apagar modo equipo" : "Habilitar modo equipo"}
          </ConfirmButton>
          <ConfirmButton variant="outline" action={setOrganizationFeatureAction.bind(null, view.id, "accounts", !view.features.accountsFlag)} confirmMessage="¿Cambiar las cuentas individuales de este negocio? Queda registrado.">
            {view.features.accountsFlag ? "Apagar cuentas individuales" : "Habilitar cuentas individuales"}
          </ConfirmButton>
        </div>
      </Section>

      <Section title="Actividad y correos del mes">
        <dl className="rounded-2xl border border-border bg-card px-4">
          <Row label="Turnos (total / este mes)">{view.appointments.total} / {view.appointments.thisMonth}</Row>
          {Object.entries(view.emails.byType).map(([type, count]) => (
            <Row key={type} label={type}>
              {count.sent} enviados{count.failed ? ` · ${count.failed} fallidos` : ""}
            </Row>
          ))}
        </dl>
        {view.emails.recentFailures.length > 0 && (
          <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
            {view.emails.recentFailures.map((failure) => (
              <li key={`${failure.type}-${failure.createdAt.toISOString()}`}>
                {fmt(failure.createdAt)} · {failure.type} · {failure.error || "sin detalle"}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Eventos de suscripción recientes">
        <ul className="space-y-1 text-sm text-muted-foreground">
          {view.subscriptionEvents.map((event) => (
            <li key={`${event.action}-${event.createdAt.toISOString()}`} className="tabular-nums">
              {fmt(event.createdAt)} · {event.action}
            </li>
          ))}
          {view.subscriptionEvents.length === 0 && <li>Sin eventos.</li>}
        </ul>
      </Section>
    </div>
  );
}
