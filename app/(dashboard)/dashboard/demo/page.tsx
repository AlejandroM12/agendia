import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/dashboard/page-header";
import { RestartDemoButton, SendReminderNowButton } from "@/components/demo/demo-controls";
import { WhatsappPhone, type PreviewMessage } from "@/components/demo/whatsapp-phone";
import { requireOrganization } from "@/lib/dal";
import { db } from "@/lib/db";
import { formatDateTime, formatTime } from "@/lib/time";
import { renderWhatsappMessage, whatsappKindOf, WHATSAPP_KIND_LABEL } from "@/modules/whatsapp/templates";

export const metadata: Metadata = { title: "Demo", robots: { index: false } };
export const instant = false;

const TRY = [
  { href: "/dashboard/agenda", title: "Mirá la agenda", text: "Los turnos de los tres profesionales, hoy y esta semana." },
  { href: "/dashboard/turnos/nuevo", title: "Cargá un turno", text: "Como lo harías por teléfono o por WhatsApp." },
  { href: "/dashboard/equipo", title: "Gestioná el equipo", text: "Horarios, servicios y agenda de cada profesional." },
  { href: "/dashboard/disponibilidad", title: "Reglas de reserva", text: "Anticipación mínima y límite para cancelar o reprogramar." },
];

export default async function DemoCenterPage() {
  const { organization } = await requireOrganization();
  if (!organization.isDemo) notFound();
  const tz = organization.timezone;

  const [notifications, upcoming] = await Promise.all([
    db.notification.findMany({
      // Solo los avisos que ya les «tocaba» salir (los recordatorios futuros aparecen al llegar su hora o con «Enviar recordatorio»).
      where: {
        organizationId: organization.id,
        status: { not: "canceled" },
        scheduledFor: { lte: new Date() },
        type: { in: ["booking_confirmation", "reminder", "cancellation", "reschedule", "professional_change"] },
      },
      orderBy: { createdAt: "desc" },
      take: 14,
      include: { appointment: { include: { customer: true, service: true, professional: { select: { displayName: true } } } } },
    }),
    db.appointment.findMany({
      where: { organizationId: organization.id, status: "confirmed", startsAt: { gt: new Date() } },
      orderBy: { startsAt: "asc" },
      take: 6,
      include: { customer: { select: { name: true } }, service: { select: { name: true } } },
    }),
  ]);

  const messages: PreviewMessage[] = notifications.flatMap((notification) => {
    const kind = whatsappKindOf(notification.type);
    const appointment = notification.appointment;
    if (!kind || !appointment) return [];
    const rendered = renderWhatsappMessage(kind, {
      customerFirstName: appointment.customer.name.split(" ")[0],
      organizationName: organization.name,
      serviceName: appointment.service.name,
      when: `${formatDateTime(appointment.startsAt, tz)}`,
      professionalName: appointment.professional.displayName,
    });
    return [
      {
        id: notification.id,
        label: WHATSAPP_KIND_LABEL[kind],
        customer: appointment.customer.name,
        time: formatTime(notification.createdAt, tz),
        body: rendered.body,
        buttons: rendered.buttons,
        token: appointment.manageToken,
        confirmed: Boolean(appointment.attendanceConfirmedAt),
        canceled: appointment.status === "canceled",
      },
    ];
  });

  return (
    <>
      <PageHeader title="Tu demo" description="Una barbería de ejemplo con tres profesionales. Todo es ficticio y solo lo ves vos." />

      <section className="grid gap-3 sm:grid-cols-2">
        {TRY.map((item) => (
          <Link key={item.href} href={item.href} className="rounded-2xl border border-border bg-card p-4 transition-colors hover:bg-muted/50">
            <p className="font-semibold">{item.title}</p>
            <p className="mt-1 text-sm text-muted-foreground">{item.text}</p>
          </Link>
        ))}
        <a href={`/${organization.slug}`} target="_blank" rel="noopener noreferrer" className="rounded-2xl border border-primary bg-card p-4 transition-colors hover:bg-muted/50 sm:col-span-2">
          <p className="font-semibold">Reservá como si fueras un cliente</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Abrí la página pública, elegí servicio y profesional y reservá. El aviso aparece abajo, y desde el enlace de tu turno podés reprogramar o cancelar.
          </p>
        </a>
      </section>

      <section className="mt-10">
        <h2 className="font-display text-xl font-semibold">Avisos automáticos por WhatsApp</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Así le llegan los mensajes a tus clientes cuando conectás tu WhatsApp. Esta es una vista previa: <strong>no se envía nada a ningún teléfono</strong>.
          Los botones funcionan: confirmar asistencia y cancelar actúan sobre el turno de la demo.
        </p>

        {upcoming.length > 0 && (
          <div className="mt-4 rounded-2xl border border-border bg-card p-4">
            <p className="text-sm font-medium">Probá un recordatorio ahora</p>
            <p className="mt-0.5 text-xs text-muted-foreground">En la realidad sale solo, el tiempo que vos elijas antes del turno.</p>
            <ul className="mt-3 space-y-2">
              {upcoming.map((appointment) => (
                <li key={appointment.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate">
                    {appointment.customer.name} · {appointment.service.name} · {formatDateTime(appointment.startsAt, tz)}
                  </span>
                  <SendReminderNowButton appointmentId={appointment.id} />
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-6">
          <WhatsappPhone messages={messages} />
        </div>
      </section>

      {organization.demoKind === "public" && (
        <section className="mt-10 border-t border-border pt-6">
          <RestartDemoButton />
        </section>
      )}
    </>
  );
}
