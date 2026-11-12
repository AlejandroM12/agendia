import type { Metadata } from "next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireOrganization } from "@/lib/dal";
import { getEffectiveStatus, daysRemainingInTrial } from "@/lib/organization-access";
import { trialPolicy } from "@/lib/brand";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const { organization } = await requireOrganization();
  const status = getEffectiveStatus(organization);
  const days = daysRemainingInTrial(organization);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Hola, {organization.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Esta es la fundación técnica de tu cuenta. La agenda, los turnos y las reservas online
          se incorporan en las próximas fases (ver docs/ROADMAP.md).
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Estado de tu cuenta</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm text-muted-foreground">
            {status === "trial" ? (
              <p>
                Prueba gratuita activa: te quedan <strong className="text-foreground">{days}</strong>{" "}
                {days === 1 ? "día" : "días"}.
              </p>
            ) : (
              <p>Estado actual: {status}.</p>
            )}
            <p>
              Al vencer la prueba, tu cuenta pasa a solo lectura durante {trialPolicy.readonlyGraceDays}{" "}
              días. Nunca eliminamos datos automáticamente.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tu enlace de reservas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm text-muted-foreground">
            <p className="font-mono text-foreground">/reservar/{organization.slug}</p>
            <p>
              Todavía no está activo: la reserva pública se habilita en la Fase 3 del roadmap, junto
              con servicios y disponibilidad.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Qué falta para que la agenda funcione</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>• Servicios, disponibilidad, turnos manuales y reservas públicas — Fase 3.</p>
          <p>• Recordatorios automáticos por email — Fase 4.</p>
          <p>• Suscripción y pagos reales — Fase 5.</p>
        </CardContent>
      </Card>
    </div>
  );
}
