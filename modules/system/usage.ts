import "server-only";

import { db } from "@/lib/db";

/**
 * Métricas internas de consumo, calculadas con las tablas que ya existen
 * (turnos, notificaciones, profesionales): sin servicios de analítica, sin
 * colas ni infraestructura nueva. Sirven para saber cuánto cuesta cada
 * negocio (sobre todo en correos, el único gasto variable: Resend) antes de
 * decidir cambios de plan.
 *
 * - «Correos enviados» son notificaciones en estado `sent`.
 * - «Reintentos» son envíos que necesitaron más de un intento (`attempts > 1`).
 * - Los canales no configurados quedan como `skipped` y no cuentan como envíos.
 */

export type EmailUsage = {
  sent: number;
  failed: number;
  skipped: number;
  pending: number;
  canceled: number;
  retried: number;
  byType: Record<string, number>;
};

export type OrganizationUsage = {
  organizationId: string;
  name: string;
  slug: string;
  activeProfessionals: number;
  appointmentsCreated: number;
  emails: EmailUsage;
};

export type DailyEmailUsage = { day: string; sent: number; failed: number; skipped: number };

export type UsageRange = { from: Date; to: Date };

/** Del primer instante del mes (UTC) al primero del siguiente. */
export function monthRange(now: Date = new Date()): UsageRange {
  return {
    from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    to: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  };
}

const emptyEmails = (): EmailUsage => ({ sent: 0, failed: 0, skipped: 0, pending: 0, canceled: 0, retried: 0, byType: {} });

/**
 * Consumo por negocio en un período, de mayor a menor cantidad de correos.
 * Tres consultas agrupadas (profesionales, turnos creados y notificaciones),
 * sin recorrer negocio por negocio.
 */
export async function getUsageByOrganization(range: UsageRange, limit = 100): Promise<OrganizationUsage[]> {
  const [professionals, appointments, statuses, types] = await Promise.all([
    db.professional.groupBy({ by: ["organizationId"], where: { active: true }, _count: { _all: true } }),
    db.appointment.groupBy({
      by: ["organizationId"],
      where: { createdAt: { gte: range.from, lt: range.to } },
      _count: { _all: true },
    }),
    db.$queryRaw<Array<{ organizationId: string; status: string; total: bigint; retried: bigint }>>`
      SELECT "organizationId", "status"::text AS "status", count(*) AS total,
             count(*) FILTER (WHERE "attempts" > 1) AS retried
      FROM "notifications"
      WHERE "createdAt" >= ${range.from} AND "createdAt" < ${range.to}
      GROUP BY "organizationId", "status"
    `,
    db.$queryRaw<Array<{ organizationId: string; type: string; total: bigint }>>`
      SELECT "organizationId", "type"::text AS "type", count(*) AS total
      FROM "notifications"
      WHERE "createdAt" >= ${range.from} AND "createdAt" < ${range.to} AND "status" IN ('sent', 'failed')
      GROUP BY "organizationId", "type"
    `,
  ]);

  const emails = new Map<string, EmailUsage>();
  const forOrg = (id: string) => {
    let usage = emails.get(id);
    if (!usage) emails.set(id, (usage = emptyEmails()));
    return usage;
  };
  for (const row of statuses) {
    const usage = forOrg(row.organizationId);
    const count = Number(row.total);
    if (row.status === "sent") usage.sent += count;
    else if (row.status === "failed") usage.failed += count;
    else if (row.status === "skipped") usage.skipped += count;
    else if (row.status === "pending") usage.pending += count;
    else if (row.status === "canceled") usage.canceled += count;
    usage.retried += Number(row.retried);
  }
  for (const row of types) forOrg(row.organizationId).byType[row.type] = Number(row.total);

  const activeByOrg = new Map(professionals.map((row) => [row.organizationId, row._count._all]));
  const appointmentsByOrg = new Map(appointments.map((row) => [row.organizationId, row._count._all]));

  const ids = new Set([...emails.keys(), ...appointmentsByOrg.keys()]);
  if (ids.size === 0) return [];
  const organizations = await db.organization.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, name: true, slug: true },
  });

  return organizations
    .map((org) => ({
      organizationId: org.id,
      name: org.name,
      slug: org.slug,
      activeProfessionals: activeByOrg.get(org.id) ?? 0,
      appointmentsCreated: appointmentsByOrg.get(org.id) ?? 0,
      emails: emails.get(org.id) ?? emptyEmails(),
    }))
    .sort((a, b) => b.emails.sent + b.emails.failed - (a.emails.sent + a.emails.failed) || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/** Correos por día (en UTC) en un período: el consumo diario de la plataforma. */
export async function getDailyEmailUsage(range: UsageRange): Promise<DailyEmailUsage[]> {
  const rows = await db.$queryRaw<Array<{ day: Date; sent: bigint; failed: bigint; skipped: bigint }>>`
    SELECT date_trunc('day', "createdAt") AS "day",
           count(*) FILTER (WHERE "status" = 'sent') AS sent,
           count(*) FILTER (WHERE "status" = 'failed') AS failed,
           count(*) FILTER (WHERE "status" = 'skipped') AS skipped
    FROM "notifications"
    WHERE "createdAt" >= ${range.from} AND "createdAt" < ${range.to}
    GROUP BY 1 ORDER BY 1
  `;
  return rows.map((row) => ({
    day: row.day.toISOString().slice(0, 10),
    sent: Number(row.sent),
    failed: Number(row.failed),
    skipped: Number(row.skipped),
  }));
}

/** Totales de la plataforma a partir del detalle por negocio. */
export function totalUsage(usage: OrganizationUsage[]) {
  return usage.reduce(
    (total, org) => ({
      appointments: total.appointments + org.appointmentsCreated,
      sent: total.sent + org.emails.sent,
      failed: total.failed + org.emails.failed,
      retried: total.retried + org.emails.retried,
      activeProfessionals: total.activeProfessionals + org.activeProfessionals,
    }),
    { appointments: 0, sent: 0, failed: 0, retried: 0, activeProfessionals: 0 },
  );
}
