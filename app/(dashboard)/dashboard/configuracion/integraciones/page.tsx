import type { Metadata } from "next";
import { PageHeader } from "@/components/dashboard/page-header";
import { Section } from "@/components/dashboard/section";
import { RequestActivationForm, WhatsappSettingsForm } from "@/components/integrations/whatsapp-business-panel";
import { brand } from "@/lib/brand";
import { requirePagePermission } from "@/lib/dal";
import { formatDateTime } from "@/lib/time";
import { getWhatsappView, maskPhone } from "@/modules/whatsapp/views";

export const metadata: Metadata = { title: "Integraciones", robots: { index: false } };
export const instant = false;

const BENEFITS = [
  "Confirmación automática por WhatsApp apenas tu cliente reserva.",
  "Recordatorios antes del turno, con la anticipación que elijas.",
  "Avisos de cancelación y de cambios de horario o de profesional.",
  "Tu cliente confirma su asistencia o cancela con un toque, y reprograma desde un enlace seguro.",
  "Todo desde Agendia, con el historial de cada mensaje y su estado.",
];

const STATUS_LABEL: Record<string, string> = { sent: "Enviado", delivered: "Entregado", read: "Leído", failed: "No se pudo enviar", sending: "Enviando", unknown: "Estado incierto", received: "Recibido" };
const KIND_LABEL: Record<string, string> = { booking_confirmation: "Confirmación", reminder: "Recordatorio", cancellation: "Cancelación", reschedule: "Reprogramación", reply: "Respuesta", test: "Prueba" };

export default async function IntegrationsPage() {
  const { organization, canWrite } = await requirePagePermission("settings.manage");
  const view = await getWhatsappView(organization.id, { messages: 40 });
  const connected = view.exists && view.status === "connected";
  const demo = organization.isDemo;

  return (
    <>
      <PageHeader title="Integraciones" back={{ href: "/dashboard/configuracion", label: "Configuración" }} />

      <Section title="WhatsApp automático" description="Opcional. Es un servicio adicional que se activa a pedido.">
        {!connected || !view.enabled ? (
          <div className="space-y-6">
            <div className="rounded-2xl border border-border bg-card p-5">
              <p className="font-medium">{connected && !view.enabled ? "El WhatsApp automático está pausado." : "Mandá los avisos de tus turnos por WhatsApp, sin hacer nada."}</p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
                {BENEFITS.map((benefit) => (
                  <li key={benefit}>{benefit}</li>
                ))}
              </ul>
              <p className="mt-4 text-sm text-muted-foreground">
                Lo configuramos juntos: nos escribís y lo dejamos funcionando. Los costos y las condiciones se acuerdan con vos. Mientras tanto seguís recibiendo y enviando los avisos por correo, y podés mandar mensajes de WhatsApp a mano desde cada turno.
              </p>
            </div>
            {demo ? (
              <p className="rounded-xl bg-secondary px-4 py-3 text-sm">En la demo podés ver cómo funciona desde «Qué probar» → vista previa de WhatsApp.</p>
            ) : connected ? (
              <p className="text-sm text-muted-foreground">Para reactivarlo escribinos a {brand.contactEmail}.</p>
            ) : (
              <RequestActivationForm disabled={!canWrite} />
            )}
          </div>
        ) : (
          <div className="space-y-8">
            <dl className="rounded-2xl border border-border bg-card px-4 text-sm">
              <div className="flex justify-between gap-4 border-b border-border py-2">
                <dt className="text-muted-foreground">Estado</dt>
                <dd className="font-medium text-success">Activo</dd>
              </div>
              <div className="flex justify-between gap-4 border-b border-border py-2">
                <dt className="text-muted-foreground">Número</dt>
                <dd className="font-medium">{view.displayPhone ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-4 border-b border-border py-2">
                <dt className="text-muted-foreground">Mensajes este mes</dt>
                <dd className="font-medium">{view.usage.used} de {view.monthlyLimit}</dd>
              </div>
              <div className="flex justify-between gap-4 py-2">
                <dt className="text-muted-foreground">Clientes que aceptaron recibirlos</dt>
                <dd className="font-medium">{view.consents.granted}</dd>
              </div>
            </dl>
            {view.usage.used >= view.monthlyLimit && <p className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-destructive">Llegaste al límite de mensajes de este mes: no se envían más hasta el mes que viene. Escribinos si necesitás ampliarlo.</p>}

            <div>
              <h3 className="font-semibold">Qué se envía</h3>
              <p className="mb-3 text-sm text-muted-foreground">Solo se envía a clientes que aceptaron recibir WhatsApp al reservar. Pueden darse de baja respondiendo BAJA.</p>
              <WhatsappSettingsForm settings={view.settings} disabled={!canWrite} />
            </div>

            <div>
              <h3 className="font-semibold">Historial de mensajes</h3>
              {view.messages.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">Todavía no se envió ningún mensaje.</p>
              ) : (
                <ul className="mt-3 divide-y divide-border rounded-2xl border border-border bg-card text-sm">
                  {view.messages.map((message) => (
                    <li key={message.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                      <span>
                        {formatDateTime(message.at, organization.timezone)} · {KIND_LABEL[message.kind] ?? message.kind} · {maskPhone(message.phone)}
                      </span>
                      <span className={message.status === "failed" ? "font-medium text-destructive" : "text-muted-foreground"}>{STATUS_LABEL[message.status] ?? message.status}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Section>
    </>
  );
}
