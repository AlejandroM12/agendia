import type { Metadata } from "next";
import { CalendarDays, MessageCircle, ShieldCheck, Smartphone, Users } from "lucide-react";
import { StartDemoForm } from "@/components/demo/start-demo-form";
import { brand } from "@/lib/brand";
import { DEMO } from "@/modules/demo/policy";

export const metadata: Metadata = {
  title: "Probá la demo",
  description: `Probá ${brand.name} en un minuto, sin registrarte: un negocio de ejemplo con agenda, profesionales, página de reservas y avisos por WhatsApp.`,
  robots: { index: true, follow: true },
};

// Lee `?vencida=1`: se renderiza por request (convención del proyecto para páginas con parámetros).
export const instant = false;

const THINGS_TO_TRY = [
  { icon: CalendarDays, title: "La agenda del negocio", text: "Mirá los turnos de hoy y de la semana de tres profesionales, y cargá uno nuevo." },
  { icon: Users, title: "Los profesionales", text: "Cada uno con sus horarios y sus servicios. Sumá uno o cambiá un horario." },
  { icon: Smartphone, title: "La página de reservas", text: "La que ven tus clientes: elegí servicio y profesional, reservá, y reprogramá desde el enlace de tu turno." },
  { icon: MessageCircle, title: "Avisos por WhatsApp (vista previa)", text: "Así le llegarán a tu cliente la confirmación, el recordatorio y los cambios, con botones para confirmar o cancelar. Es una vista previa: el envío automático se activa al conectar tu WhatsApp." },
];

export default async function DemoPage(props: PageProps<"/demo">) {
  const search = await props.searchParams;
  const expired = search.vencida === "1";

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
      <p className="text-sm font-medium text-primary">Demo interactiva</p>
      <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight sm:text-4xl">Probá {brand.name} en un minuto, sin registrarte</h1>
      <p className="mt-4 text-lg text-muted-foreground">
        Te armamos un negocio de ejemplo solo para vos: una barbería con tres profesionales, servicios, clientes y turnos. Tocá lo que quieras: nada es real.
      </p>

      {expired && (
        <p role="status" className="mt-6 rounded-xl bg-secondary px-4 py-3 text-sm">
          Tu demo anterior venció. Podés abrir una nueva cuando quieras.
        </p>
      )}

      <div className="mt-8">
        <StartDemoForm />
      </div>

      <ul className="mt-12 grid gap-4 sm:grid-cols-2">
        {THINGS_TO_TRY.map((item) => (
          <li key={item.title} className="rounded-2xl border border-border bg-card p-5">
            <item.icon className="size-5 text-primary" aria-hidden="true" />
            <h2 className="mt-3 font-semibold">{item.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{item.text}</p>
          </li>
        ))}
      </ul>

      <section className="mt-12 rounded-2xl border border-border bg-secondary/50 p-6">
        <h2 className="flex items-center gap-2 font-semibold">
          <ShieldCheck className="size-5 text-primary" aria-hidden="true" /> Qué tenés que saber
        </h2>
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
          <li>Todos los datos son inventados y solo los ves vos: cada persona recibe su propia demo.</li>
          <li>No se envía ningún mensaje real: ni WhatsApp ni correos, aunque escribas tu email o tu teléfono.</li>
          <li>No hay pagos ni facturación en la demo.</li>
          <li>Se borra sola a las {DEMO.publicTtlHours} horas. Si querés usar {brand.name} de verdad, podés crear tu cuenta cuando quieras.</li>
        </ul>
      </section>
    </div>
  );
}
