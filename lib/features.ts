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
  return process.env.TEAM_MODE_ENABLED === "1" || organization.teamModeEnabled;
}
