-- Datos extra de un aviso (hoy: quién atendía antes, cuando una reprogramación
-- del cliente implica un cambio de profesional). Columna opcional: la versión
-- anterior de la aplicación la ignora.
ALTER TABLE "notifications" ADD COLUMN "payload" JSONB;
