import "server-only";

import { db } from "@/lib/db";
import { DEMO } from "./policy";

/**
 * Borra las demos vencidas. Solo toca negocios con `isDemo` Y vencimiento cumplido; nunca un negocio real.
 * Los turnos referencian servicios y clientes con RESTRICT, así que se borran primero; el resto cuelga del negocio
 * en cascada. Después se quitan los usuarios de demo que quedaron sin ningún negocio.
 */
export async function deleteExpiredDemos(now = new Date(), limit = 20): Promise<number> {
  const expired = await db.organization.findMany({
    where: { isDemo: true, demoExpiresAt: { lt: now } },
    select: { id: true },
    orderBy: { demoExpiresAt: "asc" },
    take: limit,
  });
  for (const { id } of expired) {
    await db.$transaction(async (tx) => {
      await tx.appointment.deleteMany({ where: { organizationId: id, organization: { isDemo: true } } });
      await tx.auditLog.deleteMany({ where: { organizationId: id } });
      await tx.organization.deleteMany({ where: { id, isDemo: true } });
    });
  }
  if (expired.length > 0) {
    await db.user.deleteMany({ where: { email: { endsWith: `@${DEMO.emailDomain}` }, memberships: { none: {} } } });
  }
  return expired.length;
}
