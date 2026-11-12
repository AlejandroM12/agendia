import { Check } from "lucide-react";
import { ButtonLink } from "@/components/ui/button-link";
import { brand, formatMoney, pricing, trialPolicy } from "@/lib/brand";
import { cn } from "@/lib/utils";

function Feature({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 text-sm">
      <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
      <span>{children}</span>
    </li>
  );
}

export function PricingCards({ className }: { className?: string }) {
  return (
    <div className={cn("mx-auto grid max-w-4xl gap-5 md:grid-cols-2", className)}>
      <div className="relative rounded-3xl border-2 border-primary bg-card p-7 shadow-lg shadow-primary/5">
        <span className="absolute -top-3 left-7 rounded-full bg-primary px-3 py-0.5 text-xs font-semibold text-primary-foreground">
          {trialPolicy.trialDays} días gratis
        </span>
        <h3 className="text-lg font-semibold">Plan mensual</h3>
        <p className="mt-1 text-sm text-muted-foreground">Nos ocupamos de todo: vos solo usás tu agenda.</p>
        <p className="mt-5">
          <span className="font-display text-5xl font-semibold tracking-tight">{formatMoney(pricing.monthly)}</span>
          <span className="text-muted-foreground"> / mes</span>
        </p>
        <ul className="mt-6 space-y-2.5">
          <Feature>Agenda, turnos y clientes sin límite</Feature>
          <Feature>Tu página de reservas online</Feature>
          <Feature>Confirmaciones y recordatorios por email</Feature>
          <Feature>Actualizaciones, copias de seguridad y soporte</Feature>
          <Feature>Sin permanencia: cancelás cuando quieras</Feature>
        </ul>
        <ButtonLink size="lg" className="mt-7 w-full" href="/registro">Empezar la prueba gratis</ButtonLink>
        <p className="mt-3 text-center text-xs text-muted-foreground">Sin tarjeta para empezar.</p>
      </div>

      <div className="rounded-3xl border border-border bg-card p-7">
        <h3 className="text-lg font-semibold">Pago único</h3>
        <p className="mt-1 text-sm text-muted-foreground">Licencia de uso con instalación independiente.</p>
        <p className="mt-5">
          <span className="font-display text-5xl font-semibold tracking-tight">{formatMoney(pricing.oneTime)}</span>
          <span className="text-muted-foreground"> una vez</span>
        </p>
        <ul className="mt-6 space-y-2.5">
          <Feature>{brand.name} instalado en tu propia infraestructura</Feature>
          <Feature>Base de datos propia y separada</Feature>
          <Feature>Las mismas funciones de agenda y reservas</Feature>
          <Feature>Hosting, dominio, soporte y actualizaciones se cotizan aparte</Feature>
        </ul>
        <ButtonLink
          size="lg"
          variant="outline"
          className="mt-7 w-full" href={`mailto:${brand.contactEmail}?subject=${encodeURIComponent(`Licencia de ${brand.name}`)}`}>Consultar</ButtonLink>
        <p className="mt-3 text-center text-xs text-muted-foreground">Es una licencia de uso: no incluye el código fuente.</p>
      </div>
    </div>
  );
}
