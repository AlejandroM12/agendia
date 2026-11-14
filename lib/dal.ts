import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { MembershipRole } from "@prisma/client";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { composeContext, type AppContext, type LoadedContext } from "@/lib/app-context";
import { getOrganizationWithSyncedStatus } from "@/lib/organization-access";

export { composeContext, type AppContext };
import { FORBIDDEN_MESSAGE, type Permission } from "@/lib/permissions";

/**
 * Data Access Layer: el único lugar donde se resuelve "quién es el usuario,
 * a qué negocio está accediendo y qué puede hacer ahí". Páginas, server
 * actions y route handlers obtienen todo desde acá — nunca de un parámetro
 * del cliente.
 *
 * Una persona puede ser miembro de varios negocios. El negocio ACTIVO se
 * decide en el servidor en cada pedido:
 *  - la cookie `agendia_org` es solo una **pista** (el último negocio usado);
 *    se acepta únicamente si la persona tiene hoy una membresía en ese negocio;
 *  - sin pista válida, se usa su primera membresía (el comportamiento de siempre).
 *
 * En cada request se vuelve a leer de la base de datos —no del token de
 * sesión— que:
 * - el usuario sigue existiendo y su sesión no fue invalidada (cambio de
 *   contraseña → `sessionVersion`),
 * - sigue siendo miembro del negocio activo y con qué rol (una membresía
 *   revocada deja de servir de inmediato, aunque la sesión siga abierta),
 * - confirmó su email,
 * - y qué permisos le tocan (los del profesional los configura el propietario).
 */
export const getCurrentSession = cache(async () => auth());

/** Cookie con el último negocio usado. Solo una pista: nunca autoriza nada por sí sola. */
export const ACTIVE_ORGANIZATION_COOKIE = "agendia_org";

const loadContext = cache(async (): Promise<LoadedContext | "anonymous" | "stale" | "no_workspace"> => {
  const session = await getCurrentSession();
  if (!session?.user?.id) return "anonymous";

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      email: true,
      name: true,
      sessionVersion: true,
      isPlatformAdmin: true,
      emailVerifiedAt: true,
      memberships: { orderBy: { createdAt: "asc" }, select: { id: true, organizationId: true, role: true, notifyBookings: true } },
    },
  });
  if (!user || user.sessionVersion !== session.user.sessionVersion) return "stale";
  if (user.memberships.length === 0) return "no_workspace";

  // La pista solo cuenta si hoy sigue siendo un negocio al que pertenece.
  const hint = (await cookies()).get(ACTIVE_ORGANIZATION_COOKIE)?.value;
  const membership = user.memberships.find((m) => m.organizationId === hint) ?? user.memberships[0];

  const organization = await getOrganizationWithSyncedStatus(membership.organizationId);
  if (!organization) return "stale";

  const professional = await db.professional.findFirst({
    where: { organizationId: organization.id, userId: user.id },
    select: { id: true, displayName: true, active: true, permissionOverrides: true },
  });
  return composeContext({ user, membership, organization, professional });
});

/**
 * Sesión válida, con o sin el email verificado. Solo para la pantalla de
 * verificación: el resto de la app usa `requireContext`.
 */
export async function requireSignedInUser(): Promise<LoadedContext> {
  const context = await loadContext();
  if (context === "anonymous") redirect("/login");
  // Sesión que ya no es válida: /logout borra la cookie (un Server
  // Component no puede hacerlo) y vuelve a /login.
  if (context === "stale") redirect("/logout");
  // Cuenta válida sin ningún negocio (por ejemplo, se le revocó el acceso al único que tenía).
  if (context === "no_workspace") redirect("/sin-acceso");
  return context;
}

/**
 * Exige usuario + negocio activo válidos y el email verificado. Redirige a
 * /login si no hay sesión, y a /verificar-email si falta confirmar el email.
 */
export async function requireContext(): Promise<AppContext> {
  const context = await requireSignedInUser();
  if (!context.emailVerified) redirect("/verificar-email");
  return context;
}

/** Igual que `requireContext`, pero además exige el onboarding terminado. */
export async function requireOrganization(): Promise<AppContext> {
  const context = await requireContext();
  if (!context.organization.onboardingCompletedAt) redirect("/onboarding");
  return context;
}

/**
 * Para páginas: además exige el permiso; sin él, la persona vuelve a su
 * pantalla de inicio (nunca ve una sección que no le corresponde).
 */
export async function requirePagePermission(permission: Permission): Promise<AppContext> {
  const context = await requireOrganization();
  if (!context.permissions.has(permission)) redirect("/dashboard");
  return context;
}

export const READ_ONLY_MESSAGE =
  "Tu cuenta está en modo de solo lectura. Activá tu plan para volver a crear y modificar turnos.";

/**
 * Para server actions que modifican datos: devuelve el contexto, o un
 * mensaje de error si la cuenta está en solo lectura o el rol no tiene el
 * permiso. Ambas restricciones se aplican acá, en el servidor, no solo
 * ocultando botones. El rol y la membresía se leen de la base en cada request.
 */
export async function requireWriteContext(
  permission?: Permission,
): Promise<{ ok: true; context: AppContext } | { ok: false; message: string }> {
  const context = await requireContext();
  if (permission && !context.permissions.has(permission)) return { ok: false, message: FORBIDDEN_MESSAGE };
  if (!context.canWrite) return { ok: false, message: READ_ONLY_MESSAGE };
  return { ok: true, context };
}

/**
 * Para acciones administrativas: la sesión, el modo de solo lectura y que el
 * rol del usuario tenga el permiso (lib/permissions.ts). Un usuario
 * autenticado no alcanza.
 */
export async function requirePermission(
  permission: Permission,
): Promise<{ ok: true; context: AppContext } | { ok: false; message: string }> {
  return requireWriteContext(permission);
}

/**
 * Para acciones que un propietario/administrador hace sobre cualquiera y un
 * profesional solo sobre SU agenda. Devuelve el contexto si tiene el permiso
 * general (`any`) o, siendo profesional, el propio (`own`).
 */
export async function requireScopedWrite(
  any: Permission,
  own: Permission,
): Promise<{ ok: true; context: AppContext } | { ok: false; message: string }> {
  const context = await requireContext();
  if (!context.permissions.has(any) && !context.permissions.has(own)) return { ok: false, message: FORBIDDEN_MESSAGE };
  if (!context.canWrite) return { ok: false, message: READ_ONLY_MESSAGE };
  return { ok: true, context };
}

export type Workspace = {
  organizationId: string;
  name: string;
  slug: string;
  role: MembershipRole;
  logoImageId: string | null;
  active: boolean;
};

/** Los negocios a los que pertenece la persona (para el selector). Una sola consulta agrupada. */
export async function listWorkspaces(userId: string, activeOrganizationId: string): Promise<Workspace[]> {
  const memberships = await db.membership.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { role: true, organization: { select: { id: true, name: true, slug: true, images: { where: { kind: "logo" }, select: { id: true }, take: 1 } } } },
  });
  return memberships.map((m) => ({
    organizationId: m.organization.id,
    name: m.organization.name,
    slug: m.organization.slug,
    role: m.role,
    logoImageId: m.organization.images[0]?.id ?? null,
    active: m.organization.id === activeOrganizationId,
  }));
}
