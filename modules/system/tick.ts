import "server-only";

import { db } from "@/lib/db";
import { trialPolicy } from "@/lib/brand";
import { reconcileSubscriptions } from "@/modules/billing/subscriptions";
import { processDueNotifications } from "@/modules/notifications/process";

/**
 * Trabajo periódico de la plataforma. Lo dispara el proceso `worker` cada
 * minuto (scripts/worker.mjs → POST /api/internal/tick). Todo el estado
 * vive en la base de datos, así que es seguro repetirlo, saltearse una
 * ejecución o correrlo en paralelo.
 */
export async function runTick() {
  const startedAt = Date.now();

  // 1. Notificaciones pendientes (varios lotes si hay acumuladas).
  const notifications = { claimed: 0, sent: 0, failed: 0, retried: 0, skipped: 0, canceled: 0 };
  for (let batch = 0; batch < 4; batch++) {
    const summary = await processDueNotifications(25);
    for (const key of Object.keys(notifications) as Array<keyof typeof notifications>) {
      notifications[key] += summary[key];
    }
    if (summary.claimed < 25) break;
  }

  // 2. Ciclo de la prueba gratuita: mismas reglas que lib/organization-access.ts,
  //    aplicadas en bloque para las cuentas que nadie abrió últimamente.
  const expiredTrials = await db.$executeRaw`
    UPDATE "organizations"
    SET "status" = 'trial_readonly',
        "readonlyUntil" = "trialEndsAt" + make_interval(days => ${trialPolicy.readonlyGraceDays})
    WHERE "status" = 'trial' AND "trialEndsAt" < now()
  `;
  const lockedAccounts = await db.$executeRaw`
    UPDATE "organizations"
    SET "status" = 'locked'
    WHERE "status" = 'trial_readonly' AND "readonlyUntil" IS NOT NULL AND "readonlyUntil" < now()
  `;

  // 3. Suscripciones: red de seguridad frente a webhooks perdidos.
  const subscriptions = await reconcileSubscriptions();

  // 4. Limpieza de datos efímeros.
  await db.rateLimit.deleteMany({ where: { windowStart: { lt: new Date(Date.now() - 24 * 3600000) } } });
  await db.passwordResetToken.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 24 * 3600000) } } });

  return { notifications, expiredTrials, lockedAccounts, subscriptions, durationMs: Date.now() - startedAt };
}
