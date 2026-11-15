import type { Metadata } from "next";
import { connection } from "next/server";
import { LicensesSection, PricingCards } from "@/components/marketing/pricing-cards";
import { brand, licenseRenewalText, offers, trialPolicy } from "@/lib/brand";
import { teamPlansPublished } from "@/lib/features";

export const metadata: Metadata = {
  title: "Precios",
  description: `Planes de ${brand.name}: ${trialPolicy.trialDays} días de prueba gratis, ${offers.monthly} mensual o ${offers.license} de pago único.`,
};

export const instant = false;

export default async function PricingPage() {
  // Los precios y la publicación de planes se leen de la configuración en ejecución.
  await connection();
  return (
    <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="font-display text-4xl font-semibold sm:text-5xl">Precios</h1>
        <p className="mt-4 text-lg text-muted-foreground">
          {teamPlansPublished()
            ? `Probá ${brand.name} ${trialPolicy.trialDays} días gratis y seguí por mes con el plan que se ajuste a tu equipo. Todos los importes están en pesos argentinos.`
            : `Probá ${brand.name} ${trialPolicy.trialDays} días gratis y seguí por mes, o quedate con tu propio sistema con una licencia de pago único. Todos los importes están en pesos argentinos.`}
        </p>
      </div>

      <PricingCards className="mt-14" />
      <LicensesSection className="mt-12" />

      <div className="mx-auto mt-12 max-w-2xl rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
        <p>
          <strong className="text-foreground">¿Qué pasa al terminar la prueba del {offers.monthly}?</strong> Tu cuenta queda en solo lectura
          durante {trialPolicy.readonlyGraceDays} días: seguís viendo tus datos, pero no podés crear turnos ni recibir
          reservas hasta activar el plan. Nunca eliminamos datos automáticamente.
        </p>
        {!teamPlansPublished() && (
          <p className="mt-3">
            <strong className="text-foreground">¿Cómo se renueva la {offers.license.toLowerCase()}?</strong>{" "}
            {licenseRenewalText()}
          </p>
        )}
        <p className="mt-3">
          ¿Dudas? Escribinos a{" "}
          <a href={`mailto:${brand.contactEmail}`} className="font-medium text-primary underline underline-offset-4">
            {brand.contactEmail}
          </a>
          .
        </p>
      </div>
    </section>
  );
}
