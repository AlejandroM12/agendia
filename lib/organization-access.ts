import "server-only";

import { OrganizationStatus, type Organization } from "@prisma/client";
import { db } from "@/lib/db";
import { trialPolicy } from "@/lib/brand";
import { isStandalone } from "@/lib/deployment";

/**
 * Política centralizada del ciclo de prueba gratuita / acceso.
 *
 * Esta es la ÚNICA función que decide el estado comercial "efectivo" de una
 * organización a partir del tiempo transcurrido. Ningún otro punto del
 * código debe comparar `trialEndsAt`/`readonlyUntil` contra `Date.now()`
 * por su cuenta — eso es justamente lo que docs/ARCHITECTURE.md pide evitar
 * ("un único punto centralizado, no validaciones dispersas por pantalla").
 *
 * Los estados `active`, `past_due`, `canceled` y `suspended` no están
 * gobernados por el tiempo: los controla el ciclo de suscripción (Fase 5)
 * o una acción de administración, así que se devuelven sin modificar.
 */
export function getEffectiveStatus(
  org: Pick<Organization, "status" | "trialEndsAt" | "readonlyUntil">,
): OrganizationStatus {
  const now = new Date();

  if (org.status === OrganizationStatus.trial) {
    return now > org.trialEndsAt ? OrganizationStatus.trial_readonly : OrganizationStatus.trial;
  }

  if (org.status === OrganizationStatus.trial_readonly) {
    const readonlyUntil = org.readonlyUntil ?? computeReadonlyUntil(org.trialEndsAt);
    return now > readonlyUntil ? OrganizationStatus.locked : OrganizationStatus.trial_readonly;
  }

  return org.status;
}

function computeReadonlyUntil(trialEndsAt: Date): Date {
  return new Date(trialEndsAt.getTime() + trialPolicy.readonlyGraceDays * 24 * 60 * 60 * 1000);
}

/**
 * Indica si la organización puede realizar operaciones de escritura
 * (crear/editar turnos, reservas públicas nuevas, etc.) en su estado actual.
 */
export function canPerformWriteActions(
  org: Pick<Organization, "status" | "trialEndsAt" | "readonlyUntil">,
): boolean {
  // Una instalación independiente no depende de prueba ni suscripción.
  if (isStandalone()) return true;
  const effective = getEffectiveStatus(org);
  return (
    effective === OrganizationStatus.trial ||
    effective === OrganizationStatus.active ||
    effective === OrganizationStatus.past_due
  );
}

export function daysRemainingInTrial(
  org: Pick<Organization, "status" | "trialEndsAt">,
): number {
  if (org.status !== OrganizationStatus.trial) return 0;
  const ms = org.trialEndsAt.getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

/**
 * Lee una organización y, si su estado persistido quedó desactualizado
 * respecto al estado efectivo (por ejemplo: la prueba venció pero nadie
 * escribió `trial_readonly` en la fila todavía), lo sincroniza antes de
 * devolverla. Es una escritura perezosa (lazy) en el momento de la lectura;
 * no sustituye al worker de notificaciones/estados de la Fase 4 ni a un
 * futuro job programado, pero evita que el campo `status` quede obsoleto
 * indefinidamente mientras ese worker no exista todavía.
 */
export async function getOrganizationWithSyncedStatus(
  organizationId: string,
): Promise<Organization | null> {
  const org = await db.organization.findUnique({ where: { id: organizationId } });
  if (!org) return null;

  const effective = getEffectiveStatus(org);
  if (effective === org.status) return org;

  const readonlyUntil =
    effective === OrganizationStatus.trial_readonly
      ? org.readonlyUntil ?? computeReadonlyUntil(org.trialEndsAt)
      : org.readonlyUntil;

  return db.organization.update({
    where: { id: organizationId },
    data: { status: effective, readonlyUntil },
  });
}
