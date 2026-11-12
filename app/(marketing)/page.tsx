import { BellRing, CalendarDays, Clock, Link2, MessageCircle, Repeat, ShieldCheck, Smartphone, Users, type LucideIcon } from "lucide-react";
import { PricingCards } from "@/components/marketing/pricing-cards";
import { AgendaPreview, BookingPreview, ReminderPreview } from "@/components/marketing/product-preview";
import { ButtonLink } from "@/components/ui/button-link";
import { brand, trialPolicy } from "@/lib/brand";

const AUDIENCES = [
  "Peluquerías y barberías", "Manicuras", "Estética", "Psicología", "Nutrición", "Kinesiología",
  "Consultorios", "Masajes", "Entrenadores", "Clases particulares", "Servicios técnicos", "Y cualquier trabajo con turnos",
];

const MORE_FEATURES: Array<{ icon: LucideIcon; title: string; text: string }> = [
  { icon: Users, title: "Tus clientes, ordenados", text: "Cada persona con su contacto y su historial de turnos. Se cargan solos cuando reservan." },
  { icon: Clock, title: "Horarios a tu medida", text: "Días de atención, horario cortado, feriados, vacaciones y bloqueos puntuales." },
  { icon: Repeat, title: "Cambios sin llamados", text: "Tus clientes pueden reprogramar o cancelar desde su enlace, dentro del plazo que vos definas." },
  { icon: ShieldCheck, title: "Sin turnos pisados", text: "Dos personas nunca pueden quedarse con el mismo horario, aunque reserven a la vez." },
  { icon: Smartphone, title: "Pensada para el celular", text: "Funciona en el navegador de cualquier teléfono o computadora. No hay que instalar nada." },
  { icon: MessageCircle, title: "WhatsApp a un toque", text: "Abrí un chat con tu cliente con el mensaje del turno ya escrito." },
];

const STEPS = [
  { title: "Creá tu cuenta", text: "Nombre, email y contraseña. Sin tarjeta." },
  { title: "Contanos cómo trabajás", text: "Tus servicios, cuánto duran y en qué horarios atendés. Son tres pasos cortos." },
  { title: "Compartí tu enlace", text: "Pegalo en tu Instagram o WhatsApp y empezá a recibir reservas en tu agenda." },
];

const FAQS = [
  { q: "¿Cómo funciona la prueba gratuita?", a: `Al registrarte tenés ${trialPolicy.trialDays} días con todas las funciones, sin cargar ninguna tarjeta. No se cobra nada automáticamente.` },
  { q: "¿Qué pasa cuando termina la prueba?", a: `Tu cuenta queda en modo de solo lectura durante ${trialPolicy.readonlyGraceDays} días: seguís viendo tus turnos y clientes, pero no podés crear turnos nuevos ni recibir reservas hasta activar el plan. Nunca borramos tus datos automáticamente.` },
  { q: "¿Mis clientes tienen que registrarse o instalar algo?", a: "No. Entran a tu enlace, eligen servicio, día y horario, dejan su nombre y un contacto, y listo." },
  { q: "¿Cómo me entero de una reserva nueva?", a: "Aparece al instante en tu agenda y, si querés, también te avisamos por email." },
  { q: "¿Sirve para mi rubro?", a: "Si trabajás con turnos, sí. Vos definís tus propios servicios, duraciones y horarios: no está atada a ninguna actividad en particular." },
  { q: "¿Qué diferencia hay entre el plan mensual y el pago único?", a: `Con el plan mensual usás ${brand.name} online y nosotros nos ocupamos del servidor, las copias de seguridad y las actualizaciones. El pago único es una licencia de uso para instalar ${brand.name} en tu propia infraestructura, con tu propia base de datos; el hosting, el soporte y las actualizaciones se cotizan aparte y no incluye el código fuente.` },
  { q: "¿Puedo cancelar cuando quiera?", a: "Sí. No hay permanencia mínima y tus datos siguen siendo tuyos." },
];

function SectionHeading({ eyebrow, title, text }: { eyebrow: string; title: string; text?: string }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="text-sm font-semibold tracking-wide text-highlight uppercase">{eyebrow}</p>
      <h2 className="mt-2 font-display text-3xl font-semibold sm:text-4xl">{title}</h2>
      {text && <p className="mt-3 text-lg text-muted-foreground">{text}</p>}
    </div>
  );
}

function FeatureRow({
  icon: Icon,
  title,
  text,
  points,
  visual,
  reverse,
}: {
  icon: LucideIcon;
  title: string;
  text: string;
  points: string[];
  visual: React.ReactNode;
  reverse?: boolean;
}) {
  return (
    <div className="grid items-center gap-10 md:grid-cols-2 md:gap-16">
      <div className={reverse ? "md:order-2" : undefined}>
        <span className="flex size-11 items-center justify-center rounded-xl bg-accent text-accent-foreground">
          <Icon className="size-5.5" aria-hidden="true" />
        </span>
        <h3 className="mt-4 font-display text-2xl font-semibold sm:text-3xl">{title}</h3>
        <p className="mt-3 text-lg text-muted-foreground">{text}</p>
        <ul className="mt-5 space-y-2">
          {points.map((point) => (
            <li key={point} className="flex items-start gap-2.5">
              <span className="mt-2 size-1.5 shrink-0 rounded-full bg-highlight" aria-hidden="true" />
              {point}
            </li>
          ))}
        </ul>
      </div>
      <div className="flex justify-center">{visual}</div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <>
      {/* Hero */}
      <section className="overflow-hidden">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 pt-14 pb-16 sm:px-6 sm:pt-20 lg:grid-cols-[1.05fr_1fr] lg:pb-24">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-sm font-medium">
              <span className="size-2 rounded-full bg-highlight" aria-hidden="true" />
              Turnos y reservas online para profesionales
            </p>
            <h1 className="mt-5 font-display text-5xl leading-[1.05] font-semibold sm:text-6xl">
              Tu agenda,
              <br />
              <span className="text-primary italic">más simple.</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg text-muted-foreground sm:text-xl">
              {brand.name} ordena tus turnos, deja que tus clientes reserven solos a cualquier hora y les recuerda
              la cita por vos. Lista para usar en minutos, desde el celular.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <ButtonLink size="lg" href="/registro">Probar {trialPolicy.trialDays} días gratis</ButtonLink>
              <ButtonLink size="lg" variant="outline" href="#como-funciona">Ver cómo funciona</ButtonLink>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">Sin tarjeta. Sin instalar nada. Cancelás cuando quieras.</p>
          </div>

          <div className="relative mx-auto w-full max-w-md lg:max-w-none">
            <div className="absolute -inset-6 -z-10 rounded-[3rem] bg-accent/70" aria-hidden="true" />
            <AgendaPreview className="lg:mr-16" />
            <BookingPreview className="absolute right-0 -bottom-10 hidden rotate-3 sm:block" />
            <p className="mt-3 text-center text-xs text-muted-foreground lg:mr-16">Vista ilustrativa con datos de ejemplo.</p>
          </div>
        </div>
      </section>

      {/* Para quién */}
      <section className="border-y border-border bg-card/60">
        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
          <p className="text-center text-sm font-medium text-muted-foreground">Para cualquier profesional que trabaje con turnos</p>
          <ul className="mt-5 flex flex-wrap justify-center gap-2">
            {AUDIENCES.map((audience) => (
              <li key={audience} className="rounded-full border border-border bg-background px-3.5 py-1.5 text-sm">
                {audience}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Funciones */}
      <section id="funciones" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6">
        <SectionHeading
          eyebrow="Funciones"
          title="Menos coordinar, más atender"
          text="Lo que hoy resolvés con mensajes, cuadernos y memoria, en un solo lugar."
        />

        <div className="mt-16 space-y-20">
          <FeatureRow
            icon={CalendarDays}
            title="Una agenda que se entiende de un vistazo"
            text="Abrís la app y ves tu día: quién viene, a qué hora y para qué."
            points={[
              "Agendá un turno en segundos, con los horarios libres ya calculados.",
              "Reprogramá, cancelá o marcá ausencias sin vueltas.",
              "Buscá cualquier turno por cliente, fecha o estado.",
            ]}
            visual={<AgendaPreview className="w-full max-w-sm" />}
          />
          <FeatureRow
            reverse
            icon={Link2}
            title="Reservas online, las 24 horas"
            text="Tu propio enlace para que tus clientes reserven cuando les quede cómodo, sin escribirte."
            points={[
              "Solo ven los horarios que realmente tenés libres.",
              "Reservan en cuatro pasos, sin crear cuentas ni contraseñas.",
              "Cada reserva aparece al instante en tu agenda.",
            ]}
            visual={<BookingPreview />}
          />
          <FeatureRow
            icon={BellRing}
            title="Recordatorios que se envían solos"
            text="Tus clientes reciben la confirmación al reservar y un recordatorio antes del turno."
            points={[
              "Confirmación, recordatorio y avisos de cambios por email.",
              "Vos elegís con cuánta anticipación se envía el recordatorio.",
              "Si un turno se cancela o cambia, los avisos se ajustan solos.",
            ]}
            visual={<ReminderPreview className="w-full max-w-xs" />}
          />
        </div>

        <ul className="mt-20 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {MORE_FEATURES.map((feature) => (
            <li key={feature.title} className="rounded-2xl border border-border bg-card p-5">
              <feature.icon className="size-5 text-primary" aria-hidden="true" />
              <h3 className="mt-3 font-semibold">{feature.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{feature.text}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* Cómo funciona */}
      <section id="como-funciona" className="scroll-mt-20 bg-primary text-primary-foreground">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="font-display text-3xl font-semibold sm:text-4xl">Empezás hoy mismo</h2>
            <p className="mt-3 text-lg text-primary-foreground/80">Sin capacitaciones ni configuraciones eternas.</p>
          </div>
          <ol className="mt-12 grid gap-8 md:grid-cols-3">
            {STEPS.map((step, index) => (
              <li key={step.title}>
                <span className="font-display text-5xl font-semibold text-primary-foreground/40">{index + 1}</span>
                <h3 className="mt-2 text-xl font-semibold">{step.title}</h3>
                <p className="mt-1.5 text-primary-foreground/80">{step.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Precios */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <SectionHeading eyebrow="Precios" title="Un precio claro, sin sorpresas" text="Probala gratis y decidí después." />
        <PricingCards className="mt-12" />
      </section>

      {/* FAQ */}
      <section className="mx-auto max-w-3xl px-4 pb-20 sm:px-6">
        <SectionHeading eyebrow="Dudas frecuentes" title="Antes de empezar" />
        <div className="mt-10 divide-y divide-border rounded-2xl border border-border bg-card">
          {FAQS.map((item) => (
            <details key={item.q} className="group px-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 font-medium [&::-webkit-details-marker]:hidden">
                {item.q}
                <span className="text-xl text-muted-foreground transition-transform group-open:rotate-45" aria-hidden="true">+</span>
              </summary>
              <p className="pb-4 text-muted-foreground">{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* CTA final */}
      <section className="px-4 pb-20 sm:px-6">
        <div className="mx-auto max-w-4xl rounded-3xl bg-accent px-6 py-14 text-center">
          <h2 className="font-display text-3xl font-semibold text-accent-foreground sm:text-4xl">
            Tu próxima semana, mejor organizada
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-lg text-accent-foreground/80">
            Creá tu cuenta, cargá tus servicios y compartí tu enlace. Te lleva menos que un café.
          </p>
          <ButtonLink size="lg" className="mt-7" href="/registro">Empezar gratis</ButtonLink>
        </div>
      </section>
    </>
  );
}
