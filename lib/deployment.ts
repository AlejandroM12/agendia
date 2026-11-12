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

/**
 * ¿Puede este usuario entrar al panel de plataforma (/admin)?
 *
 * El permiso es una marca en la base de datos (`users.isPlatformAdmin`) que
 * solo se otorga desde el servidor con `npm run admin:grant <email>`. No se
 * deriva del email: como el registro no verifica direcciones, una lista de
 * emails en configuración permitiría que alguien se registre con el email
 * de un administrador que todavía no tiene cuenta y herede el acceso.
 */
export function canAccessPlatformAdmin(user: { isPlatformAdmin: boolean }): boolean {
  return user.isPlatformAdmin && !isStandalone();
}
