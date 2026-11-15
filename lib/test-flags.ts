/**
 * Interruptores SOLO para pruebas. Ninguno puede activarse por error en una instalación real.
 *
 * `ALLOW_INVITATIONS_WITHOUT_EMAIL=1` deja mostrar en pantalla el enlace de una invitación cuando no hay
 * canal de correo. Mostrar ese enlace equivale a entregar la entrada al negocio a quien lo vea, así que
 * una instalación comercial jamás debe hacerlo: el enlace solo viaja por el correo del invitado.
 * Por eso la variable se ignora salvo que el servidor corra en la propia máquina (AUTH_URL/APP_URL con
 * host localhost) y nunca en una instalación independiente. Una variable olvidada en producción o en una
 * licencia no tiene efecto.
 */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function isLocalRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  const url = env.AUTH_URL || env.APP_URL;
  if (!url) return false;
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** ¿Se puede mostrar un enlace de invitación en pantalla (sin pasar por el correo)? */
export function invitationLinksVisible(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV !== "production") return true;
  if (env.DEPLOYMENT_MODE === "standalone") return false;
  return env.ALLOW_INVITATIONS_WITHOUT_EMAIL === "1" && isLocalRuntime(env);
}
