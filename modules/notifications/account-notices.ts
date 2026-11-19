import "server-only";

import type { Notification } from "@prisma/client";
import { db } from "@/lib/db";
import { brand, formatMoney, trialPolicy } from "@/lib/brand";
import { teamPlansAvailable } from "@/lib/features";
import { isStandalone } from "@/lib/deployment";
import { PLAN_CAPABILITIES } from "@/lib/plans";
import { formatDateLong, toZoned } from "@/lib/time";
import { renderEmail } from "./templates";

/**
 * Avisos de la cuenta al propietario (no de turnos): fin de la prueba y exceso de cupo.
 *
 * Pocos y útiles, y cada uno sale UNA sola vez (la clave de idempotencia lo garantiza):
 *  - `trial_ending`: 3 días antes de que termine la prueba.
 *  - `trial_ended`: cuando terminó (qué pasa ahora y cómo recuperar el acceso completo).
 *  - `capacity_grace`: se bajó de plan y hay más profesionales que cupos (empieza la adaptación).
 *  - `capacity_restricting`: terminó la adaptación y los excedentes ya no reciben reservas nuevas.
 * Van solo al propietario (quien puede contratar), por el mismo outbox que el resto.
 */

export type AccountNoticeKind = "trial_ending" | "trial_ended" | "capacity_grace" | "capacity_restricting";

const TRIAL_REMINDER_DAYS = 3;
const DAY = 86400000;

async function ownerEmails(organizationId: string): Promise<string[]> {
  const owners = await db.membership.findMany({
    where: { organizationId, role: "owner" },
    select: { user: { select: { email: true } } },
  });
  return [...new Set(owners.map((owner) => owner.user.email.toLowerCase()))];
}

export async function enqueueAccountNotice(
  organizationId: string,
  kind: AccountNoticeKind,
  options: { key?: string; payload?: Record<string, string | number> } = {},
): Promise<number> {
  if (isStandalone()) return 0;
  const recipients = await ownerEmails(organizationId);
  let created = 0;
  for (const recipient of recipients) {
    const idempotencyKey = `account:${kind}:${organizationId}:${options.key ?? "once"}:${recipient}`;
    const { count } = await db.notification.createMany({
      data: [
        {
          organizationId,
          type: "account_notice",
          recipient,
          scheduledFor: new Date(),
          idempotencyKey,
          payload: { kind, ...(options.payload ?? {}) },
        },
      ],
      skipDuplicates: true,
    });
    created += count;
  }
  return created;
}

/** Busca qué avisos corresponden ahora y los encola. Idempotente: se llama desde el tick. */
export async function scanAccountNotices(now = new Date()): Promise<{ enqueued: number }> {
  if (isStandalone()) return { enqueued: 0 };
  let enqueued = 0;

  const ending = await db.organization.findMany({
    where: { isDemo: false, status: "trial", trialEndsAt: { gt: now, lte: new Date(now.getTime() + TRIAL_REMINDER_DAYS * DAY) }, subscription: null },
    select: { id: true, trialEndsAt: true },
    take: 200,
  });
  for (const org of ending) enqueued += await enqueueAccountNotice(org.id, "trial_ending", { key: org.trialEndsAt.toISOString() });

  const ended = await db.organization.findMany({
    where: { isDemo: false, status: { in: ["trial", "trial_readonly"] }, trialEndsAt: { lte: now, gt: new Date(now.getTime() - 7 * DAY) }, subscription: null },
    select: { id: true, trialEndsAt: true },
    take: 200,
  });
  for (const org of ended) enqueued += await enqueueAccountNotice(org.id, "trial_ended", { key: org.trialEndsAt.toISOString() });

  const grace = await db.organization.findMany({
    where: { isDemo: false, capacityGraceStartedAt: { not: null } },
    select: { id: true, capacityGraceStartedAt: true, capacityGraceEndsAt: true },
    take: 200,
  });
  for (const org of grace) {
    const key = org.capacityGraceStartedAt!.toISOString();
    enqueued += await enqueueAccountNotice(org.id, "capacity_grace", { key, payload: { endsAt: org.capacityGraceEndsAt!.toISOString() } });
    if (org.capacityGraceEndsAt! <= now) enqueued += await enqueueAccountNotice(org.id, "capacity_restricting", { key });
  }
  return { enqueued };
}

/** Arma el correo del aviso. El contenido es fijo (no hay texto libre del negocio ni datos de clientes). */
export function renderAccountNotice(
  notification: Pick<Notification, "payload">,
  organization: { name: string; timezone: string; trialEndsAt: Date },
): { subject: string; html: string; text: string } | null {
  const payload = (notification.payload ?? {}) as { kind?: AccountNoticeKind; endsAt?: string };
  const date = (value: Date) => formatDateLong(toZoned(value, organization.timezone).dateStr);
  const billingUrl = `${brand.url}/dashboard/facturacion`;
  const footer = `Recibís este aviso como propietario de ${organization.name} en ${brand.name}.`;

  const plans = [
    `${PLAN_CAPABILITIES.profesional.name}: ${formatMoney(PLAN_CAPABILITIES.profesional.monthlyPrice)} por mes, hasta ${PLAN_CAPABILITIES.profesional.maxActiveProfessionals} profesionales activos.`,
    ...(teamPlansAvailable()
      ? [`${PLAN_CAPABILITIES.equipo.name}: ${formatMoney(PLAN_CAPABILITIES.equipo.monthlyPrice)} por mes, hasta ${PLAN_CAPABILITIES.equipo.maxActiveProfessionals} profesionales activos.`]
      : []),
  ];

  switch (payload.kind) {
    case "trial_ending":
      return {
        subject: `Tu prueba gratuita de ${brand.name} termina el ${date(organization.trialEndsAt)}`,
        ...renderEmail({
          heading: "Tu prueba gratuita está por terminar",
          paragraphs: [
            `Tu prueba de ${trialPolicy.trialDays} días termina el ${date(organization.trialEndsAt)}. No se cobra nada automáticamente.`,
            ...plans,
            `Si no contratás, tu cuenta pasa a solo lectura durante ${trialPolicy.readonlyGraceDays} días: seguís viendo tus turnos y clientes, y tus datos no se borran. Al contratar recuperás todo al instante.`,
          ],
          action: { label: "Ver planes", url: billingUrl },
          footer,
        }),
      };
    case "trial_ended":
      return {
        subject: `Terminó tu prueba gratuita de ${brand.name}`,
        ...renderEmail({
          heading: "Terminó tu prueba gratuita",
          paragraphs: [
            "Tus turnos, clientes y profesionales siguen guardados. Mientras no contrates podés verlos, pero no crear ni modificar turnos, y tu página no recibe reservas nuevas.",
            ...plans,
            "Cuando contrates, recuperás el acceso completo al instante.",
          ],
          action: { label: "Elegir un plan", url: billingUrl },
          footer,
        }),
      };
    case "capacity_grace": {
      const ends = payload.endsAt ? new Date(payload.endsAt) : null;
      return {
        subject: `Tu plan admite menos profesionales de los que tenés activos`,
        ...renderEmail({
          heading: "Elegí quiénes siguen recibiendo reservas",
          paragraphs: [
            "Tu plan actual admite menos profesionales activos que los que tenés. No borramos ni desactivamos nada, y tus turnos confirmados no se tocan.",
            ends
              ? `Tenés tiempo hasta el ${date(ends)} para elegir quiénes siguen recibiendo reservas nuevas (o volver al Plan Equipo). Después, los demás dejan de recibir reservas nuevas, pero conservan su historial y sus turnos ya confirmados.`
              : "Elegí quiénes siguen recibiendo reservas nuevas.",
          ],
          action: { label: "Elegir profesionales", url: `${brand.url}/dashboard/equipo` },
          footer,
        }),
      };
    }
    case "capacity_restricting":
      return {
        subject: "Algunos profesionales dejaron de recibir reservas nuevas",
        ...renderEmail({
          heading: "Terminó el período de adaptación",
          paragraphs: [
            "Como tu plan admite menos profesionales activos, algunos dejaron de recibir reservas nuevas. Conservan su perfil, su historial y los turnos ya confirmados.",
            "Podés cambiar quiénes siguen recibiendo reservas o volver al Plan Equipo para recuperar todos los cupos.",
          ],
          action: { label: "Revisar equipo y plan", url: `${brand.url}/dashboard/equipo` },
          footer,
        }),
      };
    default:
      return null;
  }
}
