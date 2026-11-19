import type { MembershipRole, Organization } from "@prisma/client";
import { canPerformWriteActions } from "@/lib/organization-access";
import { permissionsFor, resolveProfessionalPermissions, type Permission, type ProfessionalPermissions } from "@/lib/permissions";
import { DEMO_REMOVED_PERMISSIONS } from "@/modules/demo/policy";

export type AppContext = {
  user: { id: string; email: string; name: string; isPlatformAdmin: boolean };
  organization: Organization;
  role: MembershipRole;
  /** `false` con la prueba vencida o la cuenta suspendida: solo lectura. */
  canWrite: boolean;
  /**
   * En solo lectura (prueba terminada, cuenta cancelada) igual se pueden gestionar los turnos YA
   * confirmados: cancelarlos y marcar su resultado. No se crean ni se mueven. Una cuenta suspendida no puede nada.
   */
  canManageExisting: boolean;
  /** La membresía vigente de esta persona en este negocio. */
  membership: { id: string; notifyBookings: boolean };
  /** El perfil de profesional vinculado a esta cuenta en este negocio, si lo hay. */
  professional: { id: string; displayName: string; active: boolean } | null;
  /** Qué puede hacer, ya resuelto (rol + configuración del negocio + excepciones). */
  permissions: ReadonlySet<Permission>;
  /** Lo que el propietario permite hacer a este profesional (solo tiene sentido con el rol `professional`). */
  professionalConfig: ProfessionalPermissions;
  /**
   * Con el rol `professional`, el identificador de SU perfil (o uno imposible si
   * no tiene): todo lo que consulta o modifica se limita a esa agenda. `null`
   * para propietario y administrador (ven todo el negocio).
   */
  restrictedProfessionalId: string | null;
};

export type LoadedContext = AppContext & { emailVerified: boolean };

/** Sin un perfil de profesional, una cuenta `professional` no coincide con ninguna agenda. */
const NO_PROFESSIONAL = "00000000-0000-0000-0000-000000000000";

/**
 * Arma el contexto a partir de lo leído de la base de datos. Separado de la
 * lectura de la sesión para poder ejercitar la autorización real con
 * identidades de prueba (test/helpers.ts → `contextFor`).
 */
export function composeContext(input: {
  user: { id: string; email: string; name: string; isPlatformAdmin: boolean; emailVerifiedAt: Date | null };
  membership: { id: string; role: MembershipRole; notifyBookings: boolean };
  organization: Organization;
  professional: { id: string; displayName: string; active: boolean; permissionOverrides: unknown } | null;
}): LoadedContext {
  const { user, membership, organization, professional } = input;
  const professionalConfig = resolveProfessionalPermissions(organization.professionalPermissions, professional?.permissionOverrides);
  return {
    user: { id: user.id, email: user.email, name: user.name, isPlatformAdmin: user.isPlatformAdmin },
    organization,
    role: membership.role,
    canWrite: canPerformWriteActions(organization),
    canManageExisting: canPerformWriteActions(organization) || organization.status !== "suspended",
    membership: { id: membership.id, notifyBookings: membership.notifyBookings },
    professional: professional ? { id: professional.id, displayName: professional.displayName, active: professional.active } : null,
    // Una demo nunca concede facturación ni invitaciones, ni siquiera a su «propietario».
    permissions: organization.isDemo
      ? new Set([...permissionsFor(membership.role, professionalConfig)].filter((permission) => !DEMO_REMOVED_PERMISSIONS.includes(permission)))
      : permissionsFor(membership.role, professionalConfig),
    professionalConfig,
    restrictedProfessionalId: membership.role === "professional" ? (professional?.id ?? NO_PROFESSIONAL) : null,
    emailVerified: user.emailVerifiedAt !== null,
  };
}
