import { Check } from "lucide-react";
import { ButtonLink } from "@/components/ui/button-link";
import { brand, formatMoney, licenseRenewalText, licenseTerms, offers, pricing, trialPolicy } from "@/lib/brand";
import { teamPlansPublished } from "@/lib/features";
import { PLAN_CAPABILITIES } from "@/lib/plans";
import { cn } from "@/lib/utils";

function Feature({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 text-sm">
      <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
      <span>{children}</span>
    </li>
  );
}

function Card({
  badge,
  title,
  summary,
  price,
  unit,
  features,
  cta,
  note,
  featured,
}: {
  badge?: string;
  title: string;
  summary: string;
  price: string;
  unit: string;
  features: string[];
  cta: { label: string; href: string };
  note: string;
  featured?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative flex flex-col rounded-3xl bg-card p-7",
        featured ? "border-2 border-primary shadow-lg shadow-primary/10" : "border border-border",
      )}
    >
      {badge && (
        <span
          className={cn(
            "absolute -top-3 left-7 rounded-full px-3 py-0.5 text-xs font-semibold",
            featured ? "bg-primary text-primary-foreground" : "border border-border bg-background text-foreground",
          )}
        >
          {badge}
        </span>
      )}
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{summary}</p>
      <p className="mt-5">
        <span className="font-display text-5xl font-semibold tracking-tight">{price}</span>
        <span className="text-muted-foreground"> {unit}</span>
      </p>
      <ul className="mt-6 flex-1 space-y-2.5">
        {features.map((feature) => (
          <Feature key={feature}>{feature}</Feature>
        ))}
      </ul>
      <ButtonLink size="lg" variant={featured ? "default" : "outline"} className="mt-7 w-full" href={cta.href}>
        {cta.label}
      </ButtonLink>
      <p className="mt-3 text-center text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

/**
 * Antes de publicar los planes con equipo, el plan único se describe como siempre: no se anuncia
 * nada que todavía no esté disponible para todos.
 */
const SINGLE_PLAN_FEATURES = [
  `${trialPolicy.trialDays} días gratis para probarlo`,
  "Agendá todos los turnos y clientes que necesites",
  "Tu propia página para recibir reservas online",
  "Tus clientes pueden reservar las 24 horas",
  "Confirmaciones y recordatorios automáticos por correo",
  "Contactá a tus clientes por WhatsApp con mensajes preparados desde tu agenda",
  "Accedé desde tu celular o computadora",
  "Personalizá tu página con tu marca, logo y colores",
  "Te ayudamos a configurar tu agenda",
  "Soporte incluido",
  "Cancelá cuando quieras",
];

/** Lo que incluyen los dos planes mensuales: es lo mismo; solo cambia la cantidad de profesionales activos. */
const PLAN_FEATURES = [
  `${trialPolicy.trialDays} días gratis para probarlo`,
  "Turnos, clientes y agenda sin límite",
  "Una agenda propia para cada profesional",
  "Tu página de reservas online, con tu marca, logo y colores",
  "Tus clientes reservan las 24 horas y pueden elegir con quién",
  "Confirmaciones y recordatorios automáticos por email",
  "WhatsApp manual: mensajes preparados desde tu agenda",
  "Cuentas individuales opcionales, con permisos que vos configurás",
  "Te ayudamos a configurar tu agenda",
  "Hosting y soporte incluidos",
  "Cancelás cuando quieras",
];

/** Las opciones de contratación. */
export function PricingCards({ className }: { className?: string }) {
  if (!teamPlansPublished()) {
    // Antes del lanzamiento de los planes con equipo: un solo plan mensual y la licencia.
    return (
      <div className={cn("mx-auto grid max-w-4xl gap-8 md:grid-cols-2 md:gap-5", className)}>
        <Card
          featured
          badge="La opción más elegida"
          title={offers.monthly}
          summary="Organizá tus turnos y olvidate de la agenda de papel."
          price={`${formatMoney(pricing.monthly)} ${pricing.currency}`}
          unit="/ mes"
          features={SINGLE_PLAN_FEATURES}
          cta={{ label: "Empezar gratis", href: "/registro" }}
          note={`${trialPolicy.trialDays} días gratis. Sin permanencia.`}
        />
        <Card
          badge="Pago único"
          title={offers.license}
          summary="Tu propio sistema de turnos, con una licencia de uso permanente."
          price={`${formatMoney(pricing.oneTime)} ${pricing.currency}`}
          unit="· Pago único por la licencia"
          features={[
            "Todas las funciones del Plan Profesional",
            "Licencia de uso permanente",
            "Un sistema exclusivo para tu negocio",
            "Tu propia dirección web",
            "Personalizado con tu marca, logo y colores",
            "Nos encargamos de instalar y configurar todo",
            "Tus datos en una instalación independiente",
            "Primer año de alojamiento, dominio y soporte incluido",
          ]}
          cta={{ label: "Consultar por mi licencia", href: "/licencia" }}
          note="Licencia de uso: no incluye el código fuente."
        />
        <p className="text-center text-sm text-muted-foreground md:col-span-2">
          <strong className="font-medium text-foreground">Desde el segundo año, el alojamiento, dominio y soporte se renuevan por separado.</strong>{" "}
          {licenseTerms.renewalPrice ? licenseRenewalText() : "Te informamos el valor por escrito antes de que compres."}
        </p>
      </div>
    );
  }

  const pro = PLAN_CAPABILITIES.profesional;
  const team = PLAN_CAPABILITIES.equipo;
  return (
    <div className={cn("mx-auto grid max-w-4xl gap-8 md:grid-cols-2 md:gap-5", className)}>
      <Card
        featured
        badge="Para trabajar solo o con una persona más"
        title={offers.monthly}
        summary={`Ideal si trabajás por tu cuenta o con otra persona. Hasta ${pro.maxActiveProfessionals} profesionales activos.`}
        price={`${formatMoney(pro.monthlyPrice)} ${pricing.currency}`}
        unit="/ mes"
        features={PLAN_FEATURES}
        cta={{ label: "Empezar gratis", href: "/registro?plan=profesional" }}
        note={`${trialPolicy.trialDays} días gratis. Sin permanencia.`}
      />
      <Card
        title={offers.team}
        summary={`Para varios profesionales en un mismo lugar. Hasta ${team.maxActiveProfessionals} profesionales activos.`}
        price={`${formatMoney(team.monthlyPrice)} ${pricing.currency}`}
        unit="/ mes"
        features={[...PLAN_FEATURES.slice(0, 1), "Todo lo del Plan Profesional, con más profesionales", "Administrás las agendas de todo el equipo desde un solo lugar", ...PLAN_FEATURES.slice(1)]}
        cta={{ label: "Empezar gratis con el Plan Equipo", href: "/registro?plan=equipo" }}
        note={`La prueba es de ${trialPolicy.trialDays} días con hasta ${PLAN_CAPABILITIES.profesional.maxActiveProfessionals} profesionales; no se cobra nada al registrarte.`}
      />
    </div>
  );
}

/** Licencias de pago único: sección secundaria, separada de los planes mensuales. */
export function LicensesSection({ className }: { className?: string }) {
  if (!teamPlansPublished()) return null;
  const pro = PLAN_CAPABILITIES.profesional;
  const team = PLAN_CAPABILITIES.equipo;
  return (
    <section className={cn("mx-auto max-w-4xl rounded-3xl border border-border bg-card p-7", className)} aria-labelledby="licencias">
      <h2 id="licencias" className="font-display text-2xl font-semibold">
        ¿Preferís pagar una sola vez?
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Con una licencia tenés tu propia instalación de {brand.name}, independiente y con tu propia base de datos. La licencia es de uso
        permanente; el alojamiento, el dominio y el soporte son un servicio aparte.
      </p>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-border p-5">
          <p className="font-medium">{offers.licenseProfessional}</p>
          <p className="mt-1 font-display text-3xl font-semibold">{formatMoney(pricing.oneTime)} <span className="text-sm font-normal text-muted-foreground">{pricing.currency} · pago único</span></p>
          <p className="mt-1 text-sm text-muted-foreground">Hasta {pro.maxActiveProfessionals} profesionales activos.</p>
        </div>
        <div className="rounded-2xl border border-border p-5">
          <p className="font-medium">{offers.licenseTeam}</p>
          <p className="mt-1 font-display text-3xl font-semibold">{formatMoney(pricing.licenseTeam)} <span className="text-sm font-normal text-muted-foreground">{pricing.currency} · pago único</span></p>
          <p className="mt-1 text-sm text-muted-foreground">Hasta {team.maxActiveProfessionals} profesionales activos.</p>
        </div>
      </div>
      <ul className="mt-5 space-y-2 text-sm">
        <Feature>Incluye la instalación y la configuración.</Feature>
        <Feature>El primer año incluye alojamiento, dominio y soporte.</Feature>
        <Feature>
          <strong className="font-medium">Desde el segundo año, el alojamiento, dominio y soporte se renuevan por separado.</strong>{" "}
          {licenseTerms.renewalPrice ? licenseRenewalText() : "Te informamos el valor por escrito antes de que compres."}
        </Feature>
        <Feature>Es una licencia de uso: no incluye el código fuente.</Feature>
      </ul>
      <ButtonLink variant="outline" className="mt-6" href="/licencia">
        Ver condiciones de las licencias
      </ButtonLink>
    </section>
  );
}
