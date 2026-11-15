import "server-only";

import { headers } from "next/headers";
import { db } from "@/lib/db";

/**
 * Sesiones de usuario revocables (compatibles con Auth.js, que usa JWT con el proveedor de credenciales).
 *
 * Cada inicio de sesión crea una fila en `user_sessions` y el JWT lleva su id (`sid`). En cada pedido
 * `lib/dal.ts` comprueba que esa fila exista y no esté revocada, en la misma consulta que ya lee al
 * usuario. Cerrar UNA sesión es marcarla revocada; cerrar «las demás» es revocar el resto; cambiar la
 * contraseña sigue invalidando todas (`sessionVersion`). Un token sin `sid` (anterior a esta tabla) se
 * rige solo por `sessionVersion`, así que el despliegue no cierra sesiones ajenas.
 *
 * No se guarda la IP ni el user agent completo: solo una descripción corta del dispositivo.
 */

const TOUCH_EVERY_MS = 15 * 60 * 1000;
const KEEP_DAYS = 40;

/** «Chrome en Windows», «Safari en iPhone»… Solo para que la persona reconozca su sesión. */
export function describeDevice(userAgent: string | null | undefined): string {
  const ua = userAgent ?? "";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Navegador";
  const system = /Android/.test(ua) ? "Android" : /iPhone|iPad|iOS/.test(ua) ? "iPhone/iPad" : /Windows/.test(ua) ? "Windows" : /Mac OS X|Macintosh/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "otro sistema";
  return `${browser} en ${system}`;
}

export async function createUserSession(userId: string): Promise<string> {
  let device: string | null = null;
  try {
    device = describeDevice((await headers()).get("user-agent"));
  } catch {
    // Fuera de un pedido (pruebas, scripts): sin descripción.
  }
  const created = await db.userSession.create({ data: { userId, device }, select: { id: true } });
  return created.id;
}

/** Marca actividad como mucho cada 15 minutos: no escribe en cada pedido. */
export async function touchUserSession(id: string, lastSeenAt: Date, now = new Date()): Promise<void> {
  if (now.getTime() - lastSeenAt.getTime() < TOUCH_EVERY_MS) return;
  await db.userSession.updateMany({ where: { id, revokedAt: null }, data: { lastSeenAt: now } }).catch(() => undefined);
}

export async function isSessionActive(userId: string, sid: string): Promise<boolean> {
  const row = await db.userSession.findFirst({ where: { id: sid, userId, revokedAt: null }, select: { id: true } });
  return Boolean(row);
}

export async function revokeSession(userId: string, sid: string): Promise<boolean> {
  const { count } = await db.userSession.updateMany({ where: { id: sid, userId, revokedAt: null }, data: { revokedAt: new Date() } });
  return count > 0;
}

/** Cierra todas las sesiones de la persona salvo la indicada (`keep`). */
export async function revokeOtherSessions(userId: string, keep: string | undefined): Promise<number> {
  const { count } = await db.userSession.updateMany({
    where: { userId, revokedAt: null, ...(keep ? { id: { not: keep } } : {}) },
    data: { revokedAt: new Date() },
  });
  return count;
}

export async function listSessions(userId: string) {
  return db.userSession.findMany({
    where: { userId, revokedAt: null, lastSeenAt: { gt: new Date(Date.now() - 30 * 86400000) } },
    orderBy: { lastSeenAt: "desc" },
    take: 20,
    select: { id: true, device: true, createdAt: true, lastSeenAt: true },
  });
}

/** Limpieza periódica: las sesiones revocadas o inactivas hace más de 40 días se borran. */
export async function pruneSessions(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - KEEP_DAYS * 86400000);
  const { count } = await db.userSession.deleteMany({ where: { OR: [{ revokedAt: { lt: cutoff } }, { lastSeenAt: { lt: cutoff } }] } });
  return count;
}
