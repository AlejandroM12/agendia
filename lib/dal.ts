import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import type { Organization } from "@prisma/client";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canPerformWriteActions, getOrganizationWithSyncedStatus } from "@/lib/organization-access";

/**
 * Data Access Layer: el único lugar donde se resuelve "quién es el usuario
 * y a qué organización pertenece". Páginas, server actions y route handlers
 * obtienen la organización desde acá — nunca de un parámetro del cliente.
 *
 * En cada request se revalida contra la base de datos que:
 * - el usuario sigue existiendo y su sesión no fue invalidada (cambio de
 *   contraseña → `sessionVersion`), y
 * - sigue siendo miembro de la organización que dice su sesión.
 */
export const getCurrentSession = cache(async () => auth());

export type AppContext = {
  user: { id: string; email: string; name: string };
  organization: Organization;
  role: "owner" | "admin";
  /** `false` con la prueba vencida o la cuenta suspendida: solo lectura. */
  canWrite: boolean;
};

const loadContext = cache(async (): Promise<AppContext | "anonymous" | "stale"> => {
  const session = await getCurrentSession();
  if (!session?.user?.id) return "anonymous";

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      email: true,
      name: true,
      sessionVersion: true,
      memberships: { orderBy: { createdAt: "asc" }, take: 1, select: { organizationId: true, role: true } },
    },
  });

  const membership = user?.memberships[0];
  if (!user || !membership || user.sessionVersion !== session.user.sessionVersion) return "stale";

  const organization = await getOrganizationWithSyncedStatus(membership.organizationId);
  if (!organization) return "stale";

  return {
    user: { id: user.id, email: user.email, name: user.name },
    organization,
    role: membership.role,
    canWrite: canPerformWriteActions(organization),
  };
});

/** Exige usuario + organización válidos. Redirige a /login si no los hay. */
export async function requireContext(): Promise<AppContext> {
  const context = await loadContext();
  if (context === "anonymous") redirect("/login");
  // Sesión que ya no es válida: /logout borra la cookie (un Server
  // Component no puede hacerlo) y vuelve a /login.
  if (context === "stale") redirect("/logout");
  return context;
}

/** Igual que `requireContext`, pero además exige el onboarding terminado. */
export async function requireOrganization(): Promise<AppContext> {
  const context = await requireContext();
  if (!context.organization.onboardingCompletedAt) redirect("/onboarding");
  return context;
}

export const READ_ONLY_MESSAGE =
  "Tu cuenta está en modo de solo lectura. Activá tu plan para volver a crear y modificar turnos.";

/**
 * Para server actions que modifican datos: devuelve el contexto, o un
 * mensaje de error si la cuenta está en solo lectura. La restricción se
 * aplica acá, en el servidor, no solo ocultando botones.
 */
export async function requireWriteContext(): Promise<
  { ok: true; context: AppContext } | { ok: false; message: string }
> {
  const context = await requireContext();
  if (!context.canWrite) return { ok: false, message: READ_ONLY_MESSAGE };
  return { ok: true, context };
}
