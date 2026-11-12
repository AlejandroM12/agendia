import { db } from "@/lib/db";

/** Normaliza un nombre a un slug apto para `/reservar/[slug]`. */
export function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // quita acentos
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Genera un slug único para una nueva organización, agregando un sufijo
 * numérico si ya existe uno igual.
 */
export async function generateUniqueOrganizationSlug(
  baseName: string,
): Promise<string> {
  const base = slugify(baseName) || "profesional";
  let candidate = base;
  let attempt = 1;

  while (
    await db.organization.findUnique({
      where: { slug: candidate },
      select: { id: true },
    })
  ) {
    attempt += 1;
    candidate = `${base}-${attempt}`;
  }

  return candidate;
}
