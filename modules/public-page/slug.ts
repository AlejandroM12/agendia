import "server-only";

import type { Organization, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { isValidSlugFormat } from "@/lib/slug";

/** Cuántos enlaces anteriores conserva cada negocio. Los más viejos se liberan. */
const MAX_ALIASES = 5;

export type PublicSlugResolution =
  | { kind: "organization"; organization: Organization }
  /** El identificador es un enlace anterior: hay que redirigir al actual. */
  | { kind: "alias"; currentSlug: string }
  | null;

/**
 * Encuentra el negocio de una URL pública. Un negocio sin onboarding
 * terminado todavía no tiene página. Los enlaces anteriores (alias) no
 * devuelven datos del negocio: solo a dónde redirigir.
 */
export async function resolvePublicSlug(slug: string): Promise<PublicSlugResolution> {
  if (!isValidSlugFormat(slug)) return null;

  const organization = await db.organization.findUnique({ where: { slug } });
  if (organization) {
    return organization.onboardingCompletedAt ? { kind: "organization", organization } : null;
  }

  const alias = await db.organizationSlugAlias.findUnique({
    where: { slug },
    select: { organization: { select: { slug: true, onboardingCompletedAt: true } } },
  });
  return alias?.organization.onboardingCompletedAt ? { kind: "alias", currentSlug: alias.organization.slug } : null;
}

export type SlugChangeResult = { ok: true } | { ok: false; message: string };

/**
 * Cambia el identificador de URL de un negocio dentro de una transacción.
 *
 * - No puede coincidir con el de otro negocio ni con un enlace anterior de
 *   otro negocio.
 * - El identificador que se deja pasa a ser un alias: los enlaces ya
 *   compartidos siguen funcionando y redirigen al nuevo.
 * - Volver a un identificador propio anterior lo recupera.
 */
export async function changeOrganizationSlug(
  tx: Prisma.TransactionClient,
  organization: Pick<Organization, "id" | "slug">,
  newSlug: string,
): Promise<SlugChangeResult> {
  if (newSlug === organization.slug) return { ok: true };
  if (!isValidSlugFormat(newSlug)) {
    return { ok: false, message: "Usá entre 3 y 50 letras, números o guiones. Algunos nombres están reservados." };
  }

  const taken = await tx.organization.findUnique({ where: { slug: newSlug }, select: { id: true } });
  if (taken) return { ok: false, message: "Ese enlace ya está en uso. Probá con otro." };

  const alias = await tx.organizationSlugAlias.findUnique({ where: { slug: newSlug } });
  if (alias && alias.organizationId !== organization.id) {
    return { ok: false, message: "Ese enlace ya está en uso. Probá con otro." };
  }
  if (alias) await tx.organizationSlugAlias.delete({ where: { slug: newSlug } });

  await tx.organization.update({ where: { id: organization.id }, data: { slug: newSlug } });
  await tx.organizationSlugAlias.create({ data: { slug: organization.slug, organizationId: organization.id } });

  const stale = await tx.organizationSlugAlias.findMany({
    where: { organizationId: organization.id },
    orderBy: { createdAt: "desc" },
    skip: MAX_ALIASES,
    select: { slug: true },
  });
  if (stale.length) {
    await tx.organizationSlugAlias.deleteMany({ where: { slug: { in: stale.map((item) => item.slug) } } });
  }
  return { ok: true };
}
