import Link from "next/link";
import type { Organization } from "@prisma/client";
import { isStandalone } from "@/lib/deployment";
import { daysRemainingInTrial, getEffectiveStatus } from "@/lib/organization-access";

/**
 * Aviso del estado comercial de la cuenta. Solo aparece cuando hay algo
 * que el profesional necesita saber o hacer.
 */
export function AccountBanner({ organization }: { organization: Organization }) {
  if (isStandalone()) return null;

  const status = getEffectiveStatus(organization);
  const cta = (
    <Link href="/dashboard/facturacion" className="font-semibold underline underline-offset-4">
      Ver mi plan
    </Link>
  );

  if (status === "trial") {
    const days = daysRemainingInTrial(organization);
    if (days > 3) return null;
    return (
      <div className="bg-warning-soft px-4 py-2.5 text-center text-sm text-warning">
        {days <= 1 ? "Tu prueba gratuita termina hoy." : `Te quedan ${days} días de prueba gratuita.`} {cta}
      </div>
    );
  }

  if (status === "active") return null;

  const message: Record<string, string> = {
    trial_readonly: "Tu prueba gratuita terminó. Podés consultar tus datos, pero no crear ni modificar turnos.",
    locked: "Tu cuenta está pausada. Tus datos siguen guardados: activá tu plan para volver a usarla.",
    past_due: "No pudimos cobrar tu suscripción. Revisá tu medio de pago para no perder el acceso.",
    canceled: "Tu suscripción está cancelada. Tu cuenta quedó en modo de solo lectura.",
    suspended: "Tu cuenta está suspendida. Escribinos para resolverlo.",
  };

  return (
    <div className="bg-highlight-soft px-4 py-2.5 text-center text-sm text-highlight">
      {message[status]} {status !== "suspended" && cta}
    </div>
  );
}
