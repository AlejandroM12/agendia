-- Etapa 5: importe contratado y baja pendiente de la suscripción anterior (aditiva).
-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "contractedAmount" INTEGER,
ADD COLUMN     "contractedCurrency" TEXT,
ADD COLUMN     "retiredProviderSubscriptionId" TEXT;
