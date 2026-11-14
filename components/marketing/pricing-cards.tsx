import { Check } from "lucide-react";
import { ButtonLink } from "@/components/ui/button-link";
import { formatMoney, licenseRenewalText, licenseTerms, offers, pricing, trialPolicy } from "@/lib/brand";
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
  badge: string;
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
      <span
        className={cn(
          "absolute -top-3 left-7 rounded-full px-3 py-0.5 text-xs font-semibold",
          featured ? "bg-primary text-primary-foreground" : "border border-border bg-background text-foreground",
        )}
      >
        {badge}
      </span>
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

/** Las dos opciones de contratación: el Plan Profesional va destacado como la principal. */
export function PricingCards({ className }: { className?: string }) {
  return (
    <div className={cn("mx-auto grid max-w-4xl gap-8 md:grid-cols-2 md:gap-5", className)}>
      <Card
        featured
        badge="La opción más elegida"
        title={offers.monthly}
        summary="Organizá tus turnos y olvidate de la agenda de papel."
        price={`${formatMoney(pricing.monthly)} ${pricing.currency}`}
        unit="/ mes"
        features={[
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
        ]}
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
          "Todas las funciones disponibles del Plan Profesional",
          "Licencia de uso permanente",
          "Un sistema exclusivo para tu negocio",
          "Tu propia dirección web",
          "Personalizado con tu marca, logo y colores",
          "Nos encargamos de instalar y configurar todo",
          "Tus datos en una instalación independiente",
          `Primer año de alojamiento, dominio y soporte incluido`,
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
