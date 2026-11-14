-- Aviso al cliente cuando el negocio le cambia el profesional de un turno
-- (reasignación). Cambio aditivo: un valor nuevo del enum; no toca filas existentes.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'professional_change';
