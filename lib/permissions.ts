/**
 * Permisos del panel: la única definición de qué puede hacer cada rol.
 *
 * Hoy los roles son `owner` y `admin`, y los dos pueden todo lo de la
 * gestión del negocio. Estos permisos existen para que las acciones
 * administrativas del equipo pregunten «¿puede hacer esto?» en el servidor
 * (lib/dal.ts → `requirePermission`) en lugar de confiar en que el usuario
 * esté autenticado. Un rol desconocido no tiene ningún permiso: falla cerrado.
 *
 * Los roles de profesional con cuenta propia (etapa 4) se agregan acá, con
 * permisos acotados a su agenda; ver docs/MULTI_PROFESSIONAL.md.
 */

export type Permission =
  /** Crear, editar, ordenar, activar y desactivar profesionales; fotos y servicios que realizan. */
  | "team.manage"
  /** Horarios, descansos, vacaciones y bloqueos (individuales y generales). */
  | "schedule.manage"
  /** Crear, reprogramar, reasignar y cancelar turnos. */
  | "appointments.manage"
  /** Crear, editar y ordenar los servicios del negocio. */
  | "services.manage"
  /** Crear y editar fichas de clientes. */
  | "customers.manage"
  /** Ver teléfonos y abrir mensajes a clientes. */
  | "customers.contact";

const FULL_ACCESS: ReadonlySet<Permission> = new Set([
  "team.manage",
  "schedule.manage",
  "appointments.manage",
  "services.manage",
  "customers.manage",
  "customers.contact",
]);

const ROLE_PERMISSIONS: Record<string, ReadonlySet<Permission>> = {
  owner: FULL_ACCESS,
  admin: FULL_ACCESS,
};

export function can(role: string | null | undefined, permission: Permission): boolean {
  return Boolean(role && ROLE_PERMISSIONS[role]?.has(permission));
}

export const FORBIDDEN_MESSAGE = "Tu usuario no tiene permiso para hacer esto.";
