/**
 * Adónde se puede volver después de iniciar sesión. Solo rutas internas
 * conocidas (hoy, el enlace de una invitación): nunca una URL externa ni un
 * destino arbitrario enviado por el navegador (redirección abierta).
 */
export function safeCallbackPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return /^\/invitacion\/[A-Za-z0-9_-]{20,100}$/.test(value) ? value : null;
}
