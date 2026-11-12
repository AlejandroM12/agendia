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
  // Los turnos referencian servicio y cliente con RESTRICT: se borran primero.
  await db.appointment.deleteMany({ where: { organizationId } });
  // Cascada sobre memberships, servicios, clientes, reglas, notificaciones, etc.
  await db.organization.deleteMany({ where: { id: organizationId } });
}

/**
 * Organización lista para agendar: dueño, un servicio de 30 minutos y
 * atención de lunes a domingo de 09:00 a 18:00.
 */
export async function createSchedulableOrganization() {
  const { registerOrganization } = await import("@/modules/organizations/register");
  const suffix = uniqueSuffix();
  const result = await registerOrganization({
    businessName: `Agenda Test ${suffix}`,
    name: "Owner Test",
    email: `agenda-${suffix}@example.com`,
    password: "Contrasena123",
  });
  if (!result.success) throw new Error("No se pudo crear la organización de prueba");

  const membership = await db.membership.findFirstOrThrow({ where: { userId: result.userId } });
  const organizationId = membership.organizationId;

  const service = await db.service.create({
    data: { organizationId, name: "Consulta", durationMinutes: 30, price: 1000 },
  });
  await db.availabilityRule.createMany({
    data: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      organizationId,
      weekday,
      startMinute: 9 * 60,
      endMinute: 18 * 60,
    })),
  });
  const organization = await db.organization.update({
    where: { id: organizationId },
    data: { minNoticeMinutes: 0 },
  });

  return {
    organization,
    service,
    userId: result.userId,
    ownerEmail: `agenda-${suffix}@example.com`,
    cleanup: async () => {
      await cleanupOrganization(organizationId);
      await cleanupUser(result.userId);
    },
  };
}
