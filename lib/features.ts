import { isStandalone } from "@/lib/deployment";

/**
 * Activación controlada del modo equipo (varios profesionales por negocio).
 *
 * Está APAGADO por defecto. Se enciende de dos formas, ambas del lado del
 * servidor:
 *  - por organización, con `Organization.teamModeEnabled` (piloto con un
 *    negocio concreto; se cambia con `npm run team:mode`), o
 *  - para toda la instalación, con la variable `TEAM_MODE_ENABLED=1`
 *    (desarrollo, pruebas, o una instalación independiente que ya lo usa).
 *
 * Con el modo apagado, el negocio se comporta exactamente como antes: un
 * único profesional, sin elección de profesional, aunque la base contenga
 * más filas. No es un detalle de la interfaz: lo aplican el motor de
 * disponibilidad, la reserva y el alta de profesionales
 * (modules/team/eligibility.ts y modules/team/professionals.ts).
 */
export function isTeamModeEnabled(organization: { teamModeEnabled: boolean }): boolean {
  return process.env.TEAM_MODE_ENABLED === "1" || organization.teamModeEnabled || commercialActivation() || isStandalone();
}

/**
 * Publicación comercial de los planes con equipo (etapa 5): APAGADA por
 * defecto. Encendida (`PUBLISH_TEAM_PLANS=1`, también al construir la imagen,
 * porque la landing es estática), la landing muestra los planes Profesional
 * y Equipo, el registro acepta la intención de plan, y el modo equipo y las
 * cuentas individuales pasan a estar disponibles para todos los negocios
 * según su plan (el cupo lo sigue limitando el plan: lib/plans.ts), sin que
 * AtajoLab tenga que activar nada a mano.
 */
export function teamPlansPublished(): boolean {
  return process.env.PUBLISH_TEAM_PLANS === "1";
}

/**
 * Interruptor de emergencia: con `TEAM_FEATURES_PAUSED=1` se detiene la
 * activación automática por publicación comercial (no se habilitan negocios
 * nuevos). No desactiva lo que un negocio ya tiene habilitado explícitamente
 * ni borra nada.
 */
export function teamFeaturesPaused(): boolean {
  return process.env.TEAM_FEATURES_PAUSED === "1";
}

function commercialActivation(): boolean {
  return teamPlansPublished() && !teamFeaturesPaused();
}

/**
 * Cuentas individuales e invitaciones (etapa 4): APAGADO por defecto y aparte
 * del modo equipo, porque abre la aplicación a personas que no son el
 * propietario y conviene probarlo con un negocio piloto antes. Se enciende
 * por negocio (`Organization.teamAccountsEnabled`, `scripts/team-mode.mjs
 * <enlace> accounts-on`) o para toda la instalación con `TEAM_ACCOUNTS_ENABLED=1`.
 * Lo exigen el servidor al invitar y al aceptar una invitación; apagarlo no
 * borra cuentas ni membresías (solo impide invitar y aceptar).
 */
export function isAccountsEnabled(organization: { teamAccountsEnabled: boolean }): boolean {
  return process.env.TEAM_ACCOUNTS_ENABLED === "1" || organization.teamAccountsEnabled || commercialActivation() || isStandalone();
}

/**
 * ¿Se puede contratar el Plan Equipo? Solo con la publicación comercial encendida (y sin la
 * pausa de emergencia). Antes de eso el plan existe en la base pero no se ofrece ni se vende.
 */
export function teamPlansAvailable(): boolean {
  return commercialActivation();
}
