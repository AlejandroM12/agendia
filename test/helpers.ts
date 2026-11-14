import type { Organization, Professional } from "@prisma/client";
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
    emailVerified: true,
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

/**
 * Equipos: utilidades para las pruebas de varios profesionales.
 */

/** Enciende el modo equipo del negocio (y, opcionalmente, cupos adicionales) y devuelve la organización actualizada. */
export async function enableTeam(
  organizationId: string,
  options: { extraProfessionals?: number } = {},
): Promise<Organization> {
  return db.organization.update({
    where: { id: organizationId },
    data: { teamModeEnabled: true, extraProfessionals: options.extraProfessionals ?? 0 },
  });
}

export const refreshOrganization = (organizationId: string) =>
  db.organization.findUniqueOrThrow({ where: { id: organizationId } });

/**
 * Agrega un profesional directamente (sin pasar por los cupos del plan, que
 * se prueban aparte), con horario de lunes a domingo de 09:00 a 18:00 salvo
 * que se indique otro.
 */
export async function addProfessional(
  organizationId: string,
  options: {
    displayName: string;
    active?: boolean;
    bookableOnline?: boolean;
    sortOrder?: number;
    /** Franjas [desdeMinuto, hastaMinuto] de todos los días. `[]` = sin horario. */
    hours?: Array<[number, number]>;
    weekdays?: number[];
  },
): Promise<Professional> {
  const last = await db.professional.aggregate({ where: { organizationId }, _max: { sortOrder: true } });
  const professional = await db.professional.create({
    data: {
      organizationId,
      displayName: options.displayName,
      active: options.active ?? true,
      bookableOnline: options.bookableOnline ?? true,
      sortOrder: options.sortOrder ?? (last._max.sortOrder ?? -1) + 1,
    },
  });
  const hours = options.hours ?? [[9 * 60, 18 * 60]];
  const weekdays = options.weekdays ?? [0, 1, 2, 3, 4, 5, 6];
  await db.availabilityRule.createMany({
    data: weekdays.flatMap((weekday) =>
      hours.map(([startMinute, endMinute]) => ({ organizationId, professionalId: professional.id, weekday, startMinute, endMinute })),
    ),
  });
  return professional;
}

/** El profesional que crea el registro (el dueño). */
export const ownerProfessional = (organizationId: string) =>
  db.professional.findFirstOrThrow({ where: { organizationId }, orderBy: { createdAt: "asc" } });
