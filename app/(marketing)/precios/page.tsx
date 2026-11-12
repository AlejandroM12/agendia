import Link from "next/link";
import type { Metadata } from "next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { brand, plans, trialPolicy } from "@/lib/brand";

export const metadata: Metadata = {
  title: "Precios",
  description: `Planes de ${brand.name}: prueba gratuita, suscripción mensual o compra única con instalación independiente.`,
};

export default function PricingPage() {
  return (
    <section className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
      <div className="text-center">
        <h1 className="text-4xl font-semibold text-foreground">Precios</h1>
        <p className="mt-3 text-muted-foreground">
          Elegí cómo usar {brand.name}: con nosotros a cargo de la infraestructura, o en tu propio servidor.
        </p>
      </div>

      <div className="mt-12 grid gap-6 sm:grid-cols-3">
        <Card className="border-primary/40">
          <CardHeader>
            <CardTitle>Prueba gratuita</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-3xl font-semibold text-foreground">{trialPolicy.trialDays} días</p>
            <p className="text-sm text-muted-foreground">
              Sin tarjeta de crédito. Acceso completo a la plataforma desde el registro.
            </p>
            <Button className="w-full" nativeButton={false} render={<Link href="/registro">Empezar ahora</Link>} />
          </CardContent>
        </Card>

        {plans.map((plan) => (
          <Card key={plan.id}>
            <CardHeader>
              <CardTitle>{plan.name}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-3xl font-semibold text-foreground">A confirmar</p>
              <p className="text-sm text-muted-foreground">{plan.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <p className="mx-auto mt-10 max-w-2xl text-center text-sm text-muted-foreground">
        Todavía no publicamos cifras definitivas: los precios se están terminando de definir. Al
        registrarte accedés a la prueba gratuita y te avisamos antes de que esto cambie.
      </p>

      <div className="mx-auto mt-16 max-w-2xl rounded-xl border border-border bg-secondary/40 p-6 text-sm text-muted-foreground">
        <p>
          <strong className="text-foreground">¿Qué pasa al vencer la prueba?</strong> La cuenta pasa a un
          modo de solo lectura durante {trialPolicy.readonlyGraceDays} días. Nunca eliminamos datos
          automáticamente.
        </p>
      </div>
    </section>
  );
}
