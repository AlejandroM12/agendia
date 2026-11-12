import { db } from "@/lib/db";

/**
 * Helpers de limpieza para los tests de integración, que corren contra la
 * base de datos real de desarrollo (no hay infraestructura de base de datos
 * de test separada todavía — ver docs/DECISIONS.md). Cada test crea datos
 * con un sufijo único (`uniqueSuffix`) y los borra en su `afterEach`.
 */

export function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function cleanupUser(userId: string | undefined | null) {
  if (!userId) return;
  // Cascada sobre memberships y password_reset_tokens (ver schema.prisma).
  await db.user.deleteMany({ where: { id: userId } });
}

export async function cleanupOrganization(organizationId: string | undefined | null) {
  if (!organizationId) return;
  // Cascada sobre memberships.
  await db.organization.deleteMany({ where: { id: organizationId } });
}
