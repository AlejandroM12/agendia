import "server-only";

import { db } from "@/lib/db";
import { isStandalone } from "@/lib/deployment";
import { isEmailConfigured } from "@/modules/notifications/email";

export type RegistrationStatus =
  | { open: true }
  | { open: false; reason: "email_not_configured" | "standalone_already_set_up" };

/**
 * ¿Se pueden crear cuentas nuevas en este momento?
 *
 * - SaaS: solo si el envío de emails funciona. Sin email no hay forma de
 *   recuperar una contraseña olvidada, y no se abre al público un registro
 *   del que alguien pueda quedar afuera sin remedio. Fuera de producción el
 *   registro siempre está abierto (el enlace de recuperación se muestra en
 *   pantalla). `ALLOW_REGISTRATION_WITHOUT_EMAIL=1` lo fuerza en producción:
 *   es para pruebas automatizadas y entornos de staging, no para clientes.
 * - Instalación independiente: solo la primera cuenta (la del dueño de la
 *   licencia). Después el registro queda cerrado.
 */
export async function getRegistrationStatus(): Promise<RegistrationStatus> {
  if (isStandalone()) {
    const users = await db.user.count();
    return users === 0 ? { open: true } : { open: false, reason: "standalone_already_set_up" };
  }

  const allowed =
    isEmailConfigured() ||
    process.env.NODE_ENV !== "production" ||
    process.env.ALLOW_REGISTRATION_WITHOUT_EMAIL === "1";
  return allowed ? { open: true } : { open: false, reason: "email_not_configured" };
}
