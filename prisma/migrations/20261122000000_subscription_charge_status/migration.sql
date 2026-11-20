-- Estado del último cobro de la suscripción, para mostrar «pago pendiente» o «rechazado» antes del primer cobro verificado (aditiva).
-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "lastChargeStatus" TEXT;
