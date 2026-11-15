-- Etapa 5: integración comercial (planes Profesional y Equipo, cambios de plan,
-- período de adaptación por exceso de cupo, avisos de la cuenta, licencias por nivel).
-- Aditiva: no borra ni reescribe datos de clientes, turnos, profesionales ni suscripciones.
--
-- Datos comerciales (idempotentes):
--  * Plan Equipo: se crea si no existe (ARS 19.900). No modifica uno existente.
--  * Plan Profesional (`mensual`): el valor sembrado originalmente era 14000. Se pasa a
--    9900 SOLO si todavía tiene ese valor (si alguien lo cambió desde /admin, no se toca).
--    Afecta únicamente a las suscripciones que se inicien desde ahora: las vigentes
--    conservan el importe que autorizaron en Mercado Pago.

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'account_notice';
-- AlterTable
ALTER TABLE "license_orders" ADD COLUMN     "tier" TEXT NOT NULL DEFAULT 'profesional';
-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "capacityGraceEndsAt" TIMESTAMP(3),
ADD COLUMN     "capacityGraceStartedAt" TIMESTAMP(3),
ADD COLUMN     "intendedPlan" TEXT,
ADD COLUMN     "workMode" TEXT;
-- AlterTable
ALTER TABLE "professionals" ADD COLUMN     "keepBookable" BOOLEAN;
-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "pendingEffectiveAt" TIMESTAMP(3),
ADD COLUMN     "pendingKind" TEXT,
ADD COLUMN     "pendingPlanId" TEXT,
ADD COLUMN     "pendingProviderSubscriptionId" TEXT;
-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_pendingProviderSubscriptionId_key" ON "subscriptions"("pendingProviderSubscriptionId");
-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_pendingPlanId_fkey" FOREIGN KEY ("pendingPlanId") REFERENCES "plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "plans" ("id", "code", "name", "price", "currency", "active", "updatedAt")
VALUES (gen_random_uuid(), 'equipo', 'Plan Equipo', 19900, 'ARS', true, now())
ON CONFLICT ("code") DO NOTHING;

UPDATE "plans" SET "price" = 9900, "updatedAt" = now() WHERE "code" = 'mensual' AND "price" = 14000;
