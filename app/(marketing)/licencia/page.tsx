import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Check } from "lucide-react";
import { LicenseOrderForm } from "@/components/billing/license-order-form";
import { ButtonLink } from "@/components/ui/button-link";
import { brand, formatMoney, licenseRenewalText, licenseTerms, offers, pricing } from "@/lib/brand";
import { isStandalone } from "@/lib/deployment";
import { isMercadoPagoConfigured } from "@/modules/billing/mercadopago";

export const metadata: Metadata = {
  title: offers.license,
  description: `${offers.license} de ${brand.name}: pago único, licencia de uso permanente, con instalación, configuración y ${licenseTerms.includedServiceMonths} meses de hosting, dominio y soporte incluidos.`,
};
export const instant = false;

const INCLUDED = [
  "Licencia de uso permanente",
  "Instalación y configuración a cargo nuestro",
  `Hosting, dominio y soporte durante ${licenseTerms.includedServiceMonths} meses`,
  "Instalación independiente, con base de datos propia",
  "Agenda, clientes, reservas online y recordatorios por email",
];

export default async function LicensePage() {
  // Depende de la configuración del servidor en ejecución, no del build.
  await connection();
  if (isStandalone()) notFound();

  const price = formatMoney(pricing.oneTime);
  const terms = licenseRenewalText();

  return (
    <section className="mx-auto max-w-5xl px-4 py-16 sm:px-6 sm:py-20">
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="font-display text-4xl font-semibold sm:text-5xl">{offers.license}</h1>
        <p className="mt-4 text-lg text-muted-foreground">
          {brand.name} en una instalación propia para tu negocio, con un pago único. La instalamos y la configuramos
          por vos.
        </p>
      </div>

      <div className="mt-12 grid gap-8 md:grid-cols-2">
        <div>
          <p>
            <span className="font-display text-5xl font-semibold tracking-tight">{price}</span>
            <span className="text-muted-foreground"> una vez</span>
          </p>
          <ul className="mt-6 space-y-2.5">
            {INCLUDED.map((item) => (
              <li key={item} className="flex items-start gap-2.5">
                <Check className="mt-1 size-4 shrink-0 text-primary" aria-hidden="true" />
                <span>{item}</span>
              </li>
            ))}
          </ul>

          <div className="mt-8 rounded-2xl border border-border bg-card p-5 text-sm">
            <h2 className="font-semibold">Condiciones, antes de comprar</h2>
            <ul className="mt-3 space-y-2 text-muted-foreground">
              <li>{terms}</li>
              <li>Es una licencia de uso para un negocio: no incluye la entrega del código fuente.</li>
              <li>
                Después del pago te escribimos al email que nos dejes para coordinar la instalación, el dominio y la
                carga inicial de tus servicios y horarios.
              </li>
            </ul>
          </div>
        </div>

        <div className="rounded-3xl border-2 border-primary bg-card p-6 shadow-lg shadow-primary/5 sm:p-7">
          <h2 className="text-lg font-semibold">Comprar la licencia</h2>
          {isMercadoPagoConfigured() ? (
            <div className="mt-5">
              <LicenseOrderForm priceLabel={price} terms={terms} />
            </div>
          ) : (
            <div className="mt-4 space-y-4 text-sm">
              <p className="text-muted-foreground">
                El pago online todavía no está habilitado. Escribinos y coordinamos la compra y la instalación.
              </p>
              <ButtonLink
                size="lg"
                className="w-full"
                href={`mailto:${brand.contactEmail}?subject=${encodeURIComponent(`${offers.license} de ${brand.name}`)}`}
              >
                Escribir a {brand.contactEmail}
              </ButtonLink>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
