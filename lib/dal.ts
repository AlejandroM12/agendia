import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getOrganizationWithSyncedStatus } from "@/lib/organization-access";

/**
 * Data Access Layer (DAL).
 *
 * Centraliza la verificación de sesión y el aislamiento por organización.
 * Todo acceso a datos privados (Server Components, Server Actions, Route
 * Handlers) debe pasar por estas funciones en vez de leer `auth()` o el
 * `organizationId` por su cuenta — así el chequeo de autorización no queda
 * disperso ni depende de que cada pantalla lo repita correctamente.
 *
 * Patrón recomendado por la guía de autenticación de Next.js
 * (node_modules/next/dist/docs/01-app/02-guides/authentication.md).
 */
export const getCurrentSession = cache(async () => {
  return auth();
});

/** Exige una sesión válida; redirige a /login si no existe. */
export async function requireSession() {
  const session = await getCurrentSession();
  if (!session?.user) {
    redirect("/login");
  }
  return session;
}

/**
 * Exige sesión + organización asociada. Es el punto de entrada para
 * cualquier pantalla o server action del dashboard que necesite datos de la
 * organización: se obtiene siempre a partir del `organizationId` de la
 * sesión del servidor, nunca de un parámetro provisto por el cliente.
 *
 * Deliberadamente NO se llama desde app/(dashboard)/dashboard/layout.tsx:
 * la guía de autenticación de Next.js advierte que los layouts no se
 * vuelven a ejecutar en cada navegación (partial rendering), así que el
 * chequeo de autorización real debe hacerse cerca de los datos, en cada
 * página — ver node_modules/next/dist/docs/.../authentication.md
 * ("Layouts and auth checks"). El layout solo usa `getOptionalOrganization`
 * para dibujar la cáscara visual.
 */
export const requireOrganization = cache(async () => {
  const session = await requireSession();

  if (!session.user.organizationId) {
    // Usuario autenticado pero sin organización: onboarding incompleto.
    redirect("/dashboard/onboarding");
  }

  const organization = await getOrganizationWithSyncedStatus(session.user.organizationId);

  if (!organization) {
    redirect("/dashboard/onboarding");
  }

  return { session, organization };
});

/**
 * Variante sin redirección, solo para la cáscara visual del dashboard
 * (sidebar, badge de prueba). Si el usuario todavía no tiene organización
 * (onboarding incompleto), devuelve `organization: null` en vez de
 * redirigir — así la propia página de onboarding puede renderizarse sin
 * quedar atrapada en un bucle de redirects contra sí misma.
 */
export const getOptionalOrganization = cache(async () => {
  const session = await requireSession();

  if (!session.user.organizationId) {
    return { session, organization: null };
  }

  const organization = await getOrganizationWithSyncedStatus(session.user.organizationId);
  return { session, organization };
});
