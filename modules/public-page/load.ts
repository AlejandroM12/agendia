import "server-only";

import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { getOrganizationImages } from "./images";
import { toPublicProfile } from "./settings";
import { resolvePublicSlug } from "./slug";

const resolve = cache(resolvePublicSlug);

/**
 * Negocio de una ruta pública (`/[slug]` y sus subrutas).
 *
 * - Identificador inexistente → 404.
 * - Enlace anterior de un negocio que cambió su identificador → redirección
 *   al actual, conservando la subruta (`suffix`). Es temporal (307) porque
 *   los alias más viejos se liberan: un navegador no debe recordarla para siempre.
 */
export async function loadPublicOrganization(slug: string, suffix = "") {
  const resolution = await resolve(slug);
  if (!resolution) notFound();
  if (resolution.kind === "alias") redirect(`/${resolution.currentSlug}${suffix}`);

  const { organization } = resolution;
  const images = await getOrganizationImages(organization.id);
  return { organization, profile: toPublicProfile(organization), images };
}

/** Igual, pero sin redirigir ni cortar: para `generateMetadata`. */
export async function findPublicOrganization(slug: string) {
  const resolution = await resolve(slug);
  if (!resolution || resolution.kind === "alias") return null;
  const { organization } = resolution;
  const images = await getOrganizationImages(organization.id);
  return { organization, profile: toPublicProfile(organization), images };
}
