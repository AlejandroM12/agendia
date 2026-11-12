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
 * Las páginas públicas de reserva viven en la raíz (`/mi-negocio`), así que
 * un slug no puede coincidir con una ruta de la aplicación, ni con nombres
 * que convenga reservar para rutas futuras.
 */
export const RESERVED_SLUGS = new Set([
  "admin", "api", "app", "agenda", "ayuda", "blog", "cancelar", "clientes", "configuracion",
  "contacto", "dashboard", "docs", "facturacion", "favicon.ico", "health", "inicio", "legal",
  "login", "logout", "olvide-contrasena", "onboarding", "pagos", "planes", "precios",
  "privacidad", "registro", "reprogramar", "reservar", "restablecer-contrasena", "robots.txt",
  "servicios", "sitemap.xml", "soporte", "static", "terminos", "turno", "turnos", "_next",
]);

export function isValidSlugFormat(slug: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$/.test(slug) && !RESERVED_SLUGS.has(slug);
}

/**
 * Genera un slug único para una nueva organización, agregando un sufijo
 * numérico si ya existe uno igual.
 */
export async function generateUniqueOrganizationSlug(
  baseName: string,
): Promise<string> {
  let base = slugify(baseName).slice(0, 40).replace(/-+$/, "");
  if (base.length < 3) base = `${base || "mi"}-agenda`;
  let candidate = base;
  let attempt = 1;

  while (
    RESERVED_SLUGS.has(candidate) ||
    (await db.organization.findUnique({
      where: { slug: candidate },
      select: { id: true },
    }))
  ) {
    attempt += 1;
    candidate = `${base}-${attempt}`;
  }

  return candidate;
}
