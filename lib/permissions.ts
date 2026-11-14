import { z } from "zod";

/**
 * Permisos del panel: la única definición de qué puede hacer cada rol.
 *
 * Roles (MembershipRole):
 * - `owner`: control completo del negocio, incluida la facturación y la gestión de accesos.
 * - `admin`: la operación cotidiana (turnos, clientes, profesionales, horarios,
 *   servicios, página pública, configuración), SIN facturación, SIN decidir
 *   quién es administrador y SIN configurar los permisos de los profesionales.
 * - `professional`: solo su propia actividad; lo que puede hacer además de
 *   consultar su agenda lo decide el propietario (`ProfessionalPermissions`).
 *
 * Un rol desconocido no tiene ningún permiso: falla cerrado. Todo esto se
 * aplica en el servidor (lib/dal.ts → `requireWriteContext`, `requirePermission`
 * y `requirePagePermission`); la interfaz solo refleja lo que el servidor ya decidió.
 */

export type Permission =
  // Del negocio
  | "team.manage" // crear, editar, ordenar, activar y desactivar profesionales; fotos y servicios que realizan
  | "team.invite" // invitar a un profesional, reenviar, revocar invitación o acceso
  | "members.manage_admins" // invitar y quitar administradores
  | "permissions.configure" // qué pueden hacer los profesionales con cuenta propia
  | "schedule.manage" // horarios, descansos, vacaciones y bloqueos de cualquiera, y cierres generales
  | "appointments.manage" // crear, reprogramar, reasignar y cancelar turnos de cualquiera
  | "services.manage"
  | "customers.manage" // fichas de cualquier cliente
  | "customers.contact" // ver teléfonos y abrir mensajes a cualquier cliente
  | "publicpage.manage"
  | "settings.manage" // actividad, zona horaria, recordatorios, contraseña del negocio
  | "stats.view"
  | "billing.manage" // plan, suscripción y facturación
  // Propios del profesional (los configurables dependen de ProfessionalPermissions)
  | "own.agenda.view"
  | "own.appointments.create"
  | "own.appointments.reschedule"
  | "own.appointments.cancel"
  | "own.appointments.outcome"
  | "own.customers.contact"
  | "own.blocks.manage"
  | "own.hours.manage"
  | "team.availability.view"; // ver la ocupación (sin datos de clientes) de los compañeros

const OWN: Permission[] = [
  "own.agenda.view",
  "own.appointments.create",
  "own.appointments.reschedule",
  "own.appointments.cancel",
  "own.appointments.outcome",
  "own.customers.contact",
  "own.blocks.manage",
  "own.hours.manage",
  "team.availability.view",
];

const ADMIN_PERMISSIONS: Permission[] = [
  "team.manage",
  "team.invite",
  "schedule.manage",
  "appointments.manage",
  "services.manage",
  "customers.manage",
  "customers.contact",
  "publicpage.manage",
  "settings.manage",
  "stats.view",
  ...OWN,
];

const OWNER_PERMISSIONS: Permission[] = [
  ...ADMIN_PERMISSIONS,
  "members.manage_admins",
  "permissions.configure",
  "billing.manage",
];

/** Lo que un profesional con cuenta propia puede hacer: el propietario decide cada punto. */
export const PROFESSIONAL_PERMISSION_KEYS = [
  "createAppointments",
  "rescheduleAppointments",
  "cancelAppointments",
  "markOutcome",
  "contactCustomers",
  "manageBlocks",
  "manageHours",
  "viewTeamAvailability",
] as const;
export type ProfessionalPermissionKey = (typeof PROFESSIONAL_PERMISSION_KEYS)[number];
export type ProfessionalPermissions = Record<ProfessionalPermissionKey, boolean>;

/** Valores predeterminados (mínimo privilegio razonable para trabajar). */
export const DEFAULT_PROFESSIONAL_PERMISSIONS: ProfessionalPermissions = {
  createAppointments: true,
  rescheduleAppointments: true,
  cancelAppointments: false,
  markOutcome: true,
  contactCustomers: true,
  manageBlocks: true,
  manageHours: false,
  viewTeamAvailability: false,
};

export const PROFESSIONAL_PERMISSION_LABELS: Record<ProfessionalPermissionKey, { label: string; hint: string }> = {
  createAppointments: { label: "Crear turnos propios", hint: "Agendar turnos a mano en su propia agenda." },
  rescheduleAppointments: { label: "Reprogramar turnos propios", hint: "Cambiar el día u horario de sus turnos (el cliente recibe un aviso)." },
  cancelAppointments: { label: "Cancelar turnos propios", hint: "Cancelar sus turnos (el cliente recibe un aviso)." },
  markOutcome: { label: "Marcar turnos como atendidos o ausentes", hint: "Registrar si el cliente vino o no." },
  contactCustomers: { label: "Escribir por WhatsApp a sus clientes", hint: "Ver el teléfono y abrir mensajes de los clientes de sus propios turnos." },
  manageBlocks: { label: "Crear bloqueos y ausencias propias", hint: "Bloquear horarios o días en su agenda. Nunca cancela turnos que ya existen." },
  manageHours: { label: "Modificar sus horarios de trabajo", hint: "Cambiar sus días y franjas de atención." },
  viewTeamAvailability: { label: "Ver cuándo están ocupados sus compañeros", hint: "Solo horarios ocupados: sin nombres, teléfonos ni datos de los clientes." },
};

const partialSchema = z.object(
  Object.fromEntries(PROFESSIONAL_PERMISSION_KEYS.map((key) => [key, z.boolean().optional()])) as Record<ProfessionalPermissionKey, z.ZodOptional<z.ZodBoolean>>,
);

/** Lee un JSON guardado (parcial): ignora lo que no sea un booleano de una clave conocida. */
export function parsePermissionOverrides(raw: unknown): Partial<ProfessionalPermissions> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const result: Partial<ProfessionalPermissions> = {};
  for (const key of PROFESSIONAL_PERMISSION_KEYS) {
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value === "boolean") result[key] = value;
  }
  return partialSchema.safeParse(result).success ? result : {};
}

/** Predeterminados ← configuración del negocio ← excepciones de este profesional. */
export function resolveProfessionalPermissions(orgConfig: unknown, overrides: unknown): ProfessionalPermissions {
  return { ...DEFAULT_PROFESSIONAL_PERMISSIONS, ...parsePermissionOverrides(orgConfig), ...parsePermissionOverrides(overrides) };
}

function professionalSet(config: ProfessionalPermissions): ReadonlySet<Permission> {
  const set = new Set<Permission>(["own.agenda.view"]);
  if (config.createAppointments) set.add("own.appointments.create");
  if (config.rescheduleAppointments) set.add("own.appointments.reschedule");
  if (config.cancelAppointments) set.add("own.appointments.cancel");
  if (config.markOutcome) set.add("own.appointments.outcome");
  if (config.contactCustomers) set.add("own.customers.contact");
  if (config.manageBlocks) set.add("own.blocks.manage");
  if (config.manageHours) set.add("own.hours.manage");
  if (config.viewTeamAvailability) set.add("team.availability.view");
  return set;
}

const OWNER_SET: ReadonlySet<Permission> = new Set(OWNER_PERMISSIONS);
const ADMIN_SET: ReadonlySet<Permission> = new Set(ADMIN_PERMISSIONS);
const NONE: ReadonlySet<Permission> = new Set();

/** Conjunto de permisos de un rol (el de un profesional depende de lo que configuró el propietario). */
export function permissionsFor(role: string | null | undefined, professional?: ProfessionalPermissions): ReadonlySet<Permission> {
  if (role === "owner") return OWNER_SET;
  if (role === "admin") return ADMIN_SET;
  if (role === "professional") return professionalSet(professional ?? DEFAULT_PROFESSIONAL_PERMISSIONS);
  return NONE;
}

/** ¿Tiene el rol este permiso con los valores predeterminados? Un rol desconocido nunca. */
export function can(role: string | null | undefined, permission: Permission): boolean {
  return permissionsFor(role).has(permission);
}

export const FORBIDDEN_MESSAGE = "Tu usuario no tiene permiso para hacer esto.";
