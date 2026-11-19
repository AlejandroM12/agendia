-- Demostración pública y supervisada (aditiva): marca de negocio de demo, vencimiento y destinatarios autorizados.
-- Confirmación de asistencia del cliente en el turno (aditiva).
ALTER TABLE "organizations" ADD COLUMN     "isDemo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "demoKind" TEXT,
ADD COLUMN     "demoExpiresAt" TIMESTAMP(3),
ADD COLUMN     "demoAllowedRecipients" TEXT[] DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "appointments" ADD COLUMN     "attendanceConfirmedAt" TIMESTAMP(3);

-- Para encontrar rápido las demos vencidas sin recorrer todos los negocios.
CREATE INDEX "organizations_demo_expiry_idx" ON "organizations"("demoExpiresAt") WHERE "isDemo";
