import type { Organization } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { getEffectiveStatus, daysRemainingInTrial } from "@/lib/organization-access";

const LABELS: Record<string, string> = {
  trial: "Prueba gratuita",
  trial_readonly: "Prueba vencida — solo lectura",
  locked: "Cuenta bloqueada",
  active: "Suscripción activa",
  past_due: "Pago pendiente",
  canceled: "Suscripción cancelada",
  suspended: "Cuenta suspendida",
};

export function TrialStatusBadge({ organization }: { organization: Organization }) {
  const status = getEffectiveStatus(organization);
  const label = LABELS[status] ?? status;
  const variant = status === "trial" || status === "active" ? "secondary" : "destructive";

  if (status === "trial") {
    const days = daysRemainingInTrial(organization);
    return (
      <Badge variant={variant}>
        {label} · {days} {days === 1 ? "día restante" : "días restantes"}
      </Badge>
    );
  }

  return <Badge variant={variant}>{label}</Badge>;
}
