/**
 * Modo de despliegue. `saas` es la plataforma multi-tenant con prueba
 * gratuita y suscripción; `standalone` es una instalación independiente
 * (licencia de compra única): sin facturación ni panel de plataforma, y sin
 * restricciones por estado comercial.
 */
export type DeploymentMode = "saas" | "standalone";

export function deploymentMode(): DeploymentMode {
  return process.env.DEPLOYMENT_MODE === "standalone" ? "standalone" : "saas";
}

export const isStandalone = () => deploymentMode() === "standalone";

/** Emails con acceso al panel de plataforma (/admin), separados por coma. */
export function isPlatformAdmin(email: string | null | undefined): boolean {
  if (!email || isStandalone()) return false;
  const admins = (process.env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return admins.includes(email.toLowerCase());
}
