import "server-only";

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * Registro de auditoría: quién hizo qué, sobre qué y cuándo. Guarda identificadores y datos mínimos del
 * cambio (cantidades, valores anteriores y nuevos de configuración), NUNCA datos personales de clientes,
 * notas, motivos escritos a mano, contraseñas ni tokens. Un fallo al escribirlo se informa en el log y no
 * interrumpe la operación que ya se hizo.
 */
export async function recordAudit(entry: {
  organizationId?: string | null;
  userId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Prisma.InputJsonObject;
}): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        organizationId: entry.organizationId ?? null,
        userId: entry.userId ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        ...(entry.metadata ? { metadata: entry.metadata } : {}),
      },
    });
  } catch (error) {
    console.error("[audit] no se pudo registrar", entry.action, error);
  }
}
