import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { brand, plans, trialPolicy } from "@/lib/brand";

const BENEFITS = [
  { title: "Menos tiempo organizando turnos", text: "Tu agenda centralizada, sin planillas ni cuadernos." },
  { title: "Reservas disponibles las 24 horas", text: "Tus clientes reservan cuando les queda cómodo, sin llamarte." },
  { title: "Agenda centralizada", text: "Turnos manuales y reservas online comparten la misma disponibilidad." },
  { title: "Recordatorios automáticos", text: "Confirmaciones y avisos antes de cada turno, sin que tengas que escribir." },
  { title: "Menos tareas administrativas", text: "Dedicá ese tiempo a atender a tus clientes, no a coordinar horarios." },
  { title: "Mejor experiencia para tus clientes", text: "Un enlace simple para reservar, sin cuentas ni contraseñas." },
];

const FEATURES = [
  { title: "Agenda inteligente", text: "Vista diaria de tus turnos, con acceso rápido para crear uno nuevo." },
  { title: "Reservas online", text: "Un enlace público propio para que tus clientes reserven solos." },
  { title: "Gestión de clientes", text: "Historial y datos de contacto de cada persona que te reservó." },
  { title: "Servicios personalizados", text: "Definí tus servicios, su duración y, si querés, su precio." },
  { title: "Horarios configurables", text: "Reglas semanales y excepciones puntuales para bloquear días u horarios." },
  { title: "Recordatorios automáticos", text: "Confirmación, cancelación, reprogramación y recordatorio previo al turno." },
  { title: "Reprogramación y cancelaciones", text: "Tus clientes pueden gestionar su turno desde el mismo enlace del email." },
];

const STEPS = [
  { title: "Creá tu cuenta y configurá tus servicios", text: "Registrate y definí qué ofrecés, en pocos minutos." },
  { title: "Compartí tu enlace de reservas", text: "Un enlace propio para que tus clientes reserven sin instalar nada." },
  { title: "Administrá tus turnos desde cualquier dispositivo", text: "Agenda manual y reservas públicas, siempre sincronizadas." },
];

const AUDIENCES = [
  "Peluqueros y barberos",
  "Manicuristas",
  "Centros de estética",
  "Psicólogos",
  "Nutricionistas",
  "Kinesiólogos",
  "Profesores particulares",
  "Entrenadores personales",
  "Consultorios",
  "Técnicos y prestadores de servicios",
];

const FAQS = [
  {
    q: "¿Cómo funciona la prueba gratuita?",
    a: `Al registrarte se activa automáticamente una prueba de ${trialPolicy.trialDays} días con acceso completo a la plataforma, controlada desde nuestro servidor.`,
  },
  {
    q: "¿Necesito tarjeta de crédito para probarla?",
    a: "No. La prueba gratuita no requiere ningún medio de pago.",
  },
  {
    q: "¿Cómo reciben los turnos los profesionales?",
    a: "Desde su propio dashboard: turnos creados manualmente y reservas hechas por sus clientes aparecen juntos en la misma agenda.",
  },
  {
    q: "¿Cómo reservan los clientes?",
    a: "Desde el enlace público del profesional, sin crear una cuenta ni una contraseña: eligen servicio, horario disponible y confirman con su nombre y contacto.",
  },
  {
    q: "¿Qué pasa cuando vence la prueba?",
    a: `La cuenta pasa a un modo de solo lectura durante ${trialPolicy.readonlyGraceDays} días: podés consultar tus datos, pero no crear turnos nuevos hasta contratar un plan. Nunca eliminamos datos automáticamente.`,
  },
  {
    q: "¿Cuál es la diferencia entre suscripción y compra única?",
    a: "La suscripción mensual incluye hosting e infraestructura a nuestro cargo. La compra única es una licencia de uso para instalar el software en tu propia infraestructura, sin transferencia del código fuente.",
  },
  {
    q: "¿Qué incluye la instalación independiente?",
    a: "El software, listo para instalarse vía Docker Compose con tu propia base de datos. Hosting, dominio, soporte y actualizaciones se presupuestan por separado.",
  },
];

export default function LandingPage() {
  return (
    <>
      {/* Hero */}
      <section className="mx-auto max-w-6xl px-4 pt-16 pb-20 sm:px-6 sm:pt-24">
        <div className="mx-auto max-w-3xl text-center">
          <Badge variant="secondary" className="mb-4">
            Prueba gratuita de {trialPolicy.trialDays} días, sin tarjeta
          </Badge>
          <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
            Tus turnos organizados. Tus clientes siempre informados.
          </h1>
          <p className="mt-4 text-lg text-muted-foreground">
            {brand.name} te deja administrar tu agenda, recibir reservas online y automatizar
            recordatorios desde un solo lugar — sin instalar nada y sin conocimientos técnicos.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button size="lg" nativeButton={false} render={<Link href="/registro">Comenzar gratis</Link>} />
            <Button
              variant="outline"
              size="lg"
              nativeButton={false}
              render={<Link href="#como-funciona">Ver cómo funciona</Link>}
            />
          </div>
        </div>

        <div className="mx-auto mt-16 max-w-4xl rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-10">
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="rounded-xl bg-secondary p-6">
              <p className="text-sm font-medium text-muted-foreground">Agenda de hoy</p>
              <div className="mt-4 space-y-3">
                {["09:00 — Corte de pelo", "10:30 — Consulta inicial", "12:00 — Sesión de entrenamiento"].map(
                  (item) => (
                    <div key={item} className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground">
                      {item}
                    </div>
                  ),
                )}
              </div>
            </div>
            <div className="rounded-xl bg-accent p-6">
              <p className="text-sm font-medium text-accent-foreground">Reserva de un cliente</p>
              <p className="mt-2 text-xs text-accent-foreground/80">agendia.app/reservar/tu-negocio</p>
              <div className="mt-4 space-y-2 text-sm text-foreground">
                <p className="rounded-lg bg-card px-3 py-2">1. Elegís el servicio</p>
                <p className="rounded-lg bg-card px-3 py-2">2. Elegís un horario disponible</p>
                <p className="rounded-lg bg-card px-3 py-2">3. Confirmás con tu nombre y contacto</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Beneficios */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="text-center text-3xl font-semibold text-foreground">Por qué usar {brand.name}</h2>
        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {BENEFITS.map((item) => (
            <Card key={item.title} className="border-border">
              <CardHeader>
                <CardTitle className="text-base">{item.title}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">{item.text}</CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Funcionalidades */}
      <section id="funcionalidades" className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="text-center text-3xl font-semibold text-foreground">Todo lo que necesitás para tu agenda</h2>
        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((item) => (
            <Card key={item.title} className="border-border bg-secondary/40">
              <CardHeader>
                <CardTitle className="text-base">{item.title}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">{item.text}</CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Cómo funciona */}
      <section id="como-funciona" className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
        <h2 className="text-center text-3xl font-semibold text-foreground">Cómo funciona</h2>
        <div className="mt-10 grid gap-8 sm:grid-cols-3">
          {STEPS.map((step, index) => (
            <div key={step.title} className="text-center">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                {index + 1}
              </div>
              <h3 className="mt-4 font-medium text-foreground">{step.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{step.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Para quién es */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="text-center text-3xl font-semibold text-foreground">Para quién es {brand.name}</h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-sm text-muted-foreground">
          Pensada para cualquier profesional que trabaje con turnos, sin limitarse a un solo rubro.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-2">
          {AUDIENCES.map((audience) => (
            <Badge key={audience} variant="outline" className="px-3 py-1 text-sm">
              {audience}
            </Badge>
          ))}
        </div>
      </section>

      {/* Precios */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="text-center text-3xl font-semibold text-foreground">Planes</h2>
        <div className="mx-auto mt-10 grid max-w-4xl gap-6 sm:grid-cols-3">
          <Card className="border-primary/40">
            <CardHeader>
              <CardTitle>Prueba gratuita</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold text-foreground">{trialPolicy.trialDays} días</p>
              <p className="mt-2 text-sm text-muted-foreground">Sin tarjeta. Acceso completo a la plataforma.</p>
            </CardContent>
          </Card>
          {plans.map((plan) => (
            <Card key={plan.id}>
              <CardHeader>
                <CardTitle>{plan.name}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold text-foreground">A confirmar</p>
                <p className="mt-2 text-sm text-muted-foreground">{plan.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Ver el detalle completo en <Link href="/precios" className="underline">precios</Link>.
        </p>
      </section>

      {/* FAQ */}
      <section className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <h2 className="text-center text-3xl font-semibold text-foreground">Preguntas frecuentes</h2>
        <div className="mt-8 space-y-3">
          {FAQS.map((item) => (
            <details key={item.q} className="group rounded-lg border border-border bg-card p-4">
              <summary className="cursor-pointer list-none font-medium text-foreground">{item.q}</summary>
              <p className="mt-2 text-sm text-muted-foreground">{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* CTA final */}
      <section className="mx-auto max-w-4xl px-4 py-20 text-center sm:px-6">
        <h2 className="text-3xl font-semibold text-foreground">Empezá a organizar tu agenda hoy</h2>
        <p className="mt-3 text-muted-foreground">
          {trialPolicy.trialDays} días gratis, sin tarjeta de crédito.
        </p>
        <Button
          size="lg"
          className="mt-6"
          nativeButton={false}
          render={<Link href="/registro">Comenzar gratis</Link>}
        />
      </section>
    </>
  );
}
