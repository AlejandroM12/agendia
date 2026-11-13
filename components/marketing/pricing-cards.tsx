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
}: {
  badge: string;
  title: string;
  summary: string;
  price: string;
  unit: string;
  features: string[];
  cta: { label: string; href: string };
  note: string;
}) {
  return (
    <div className="relative flex flex-col rounded-3xl border-2 border-primary bg-card p-7 shadow-lg shadow-primary/5">
      <span className="absolute -top-3 left-7 rounded-full bg-primary px-3 py-0.5 text-xs font-semibold text-primary-foreground">
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
      <ButtonLink size="lg" className="mt-7 w-full" href={cta.href}>{cta.label}</ButtonLink>
      <p className="mt-3 text-center text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

/** Las dos modalidades comerciales, con el mismo peso visual. */
export function PricingCards({ className }: { className?: string }) {
  return (
    <div className={cn("mx-auto grid max-w-4xl gap-8 md:grid-cols-2 md:gap-5", className)}>
      <Card
        badge={`${trialPolicy.trialDays} días gratis`}
        title={offers.monthly}
        summary="Pagás por mes y nos ocupamos de todo."
        price={formatMoney(pricing.monthly)}
        unit="/ mes"
        features={[
          "Agenda, turnos y clientes sin límite",
          "Tu página de reservas online",
          "Confirmaciones y recordatorios por email",
          "Hosting y soporte incluidos",
          "Sin permanencia: cancelás cuando quieras",
        ]}
        cta={{ label: "Empezar la prueba gratis", href: "/registro" }}
        note="Sin tarjeta para empezar."
      />
      <Card
        badge="Pago único"
        title={offers.license}
        summary="Tu propia instalación, lista para usar."
        price={formatMoney(pricing.oneTime)}
        unit="una vez"
        features={[
          "Licencia de uso permanente",
          "Instalación y configuración incluidas",
          `Hosting, dominio y soporte incluidos durante ${licenseTerms.includedServiceMonths} meses`,
          "Instalación independiente, con base de datos propia",
          "Agenda, reservas online y recordatorios",
        ]}
        cta={{ label: "Comprar la licencia", href: "/licencia" }}
        note="Licencia de uso: no incluye el código fuente."
      />
      <p className="text-center text-xs text-muted-foreground md:col-span-2">
        <strong className="font-medium text-foreground">Renovación de la {offers.license.toLowerCase()}:</strong>{" "}
        {licenseRenewalText()}
      </p>
    </div>
  );
}
