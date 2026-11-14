import { z } from "zod";
import { isValidSlugFormat, slugify } from "@/lib/slug";
import { isThemeFont, normalizeHexColor } from "@/lib/theme";

/**
 * Lo que un negocio puede configurar de su página pública, con su
 * validación. Es la única puerta de entrada: lo usan la acción que guarda y
 * la vista previa. Sin dependencias del servidor.
 */

const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .transform((value) => (value === "" ? null : value));

/**
 * Número de WhatsApp en formato internacional, solo dígitos (lo que espera
 * wa.me). Un número argentino escrito sin código de país (10 dígitos:
 * característica + número) se completa con 549.
 */
export function normalizeWhatsapp(value: string): string | null {
  const digits = value.replace(/\D/g, "").replace(/^00/, "");
  if (digits.length === 10) return `549${digits}`;
  return digits.length >= 11 && digits.length <= 15 ? digits : null;
}

/** Usuario de Instagram a partir de "@usuario", "usuario" o la URL del perfil. */
export function normalizeInstagram(value: string): string | null {
  const handle = value
    .trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
    .replace(/^@/, "")
    .replace(/[/?#].*$/, "");
  return /^[a-zA-Z0-9._]{1,30}$/.test(handle) ? handle.toLowerCase() : null;
}

const color = z
  .string()
  .transform((value) => normalizeHexColor(value))
  .refine((value): value is string => value !== null, "Elegí un color válido.");

export const publicPageSchema = z.object({
  name: z.string().trim().min(2, "Ingresá el nombre de tu negocio.").max(80, "Máximo 80 caracteres."),
  specialty: optionalText(60, "Máximo 60 caracteres."),
  description: optionalText(300, "Máximo 300 caracteres."),
  address: optionalText(160, "Máximo 160 caracteres."),
  phone: optionalText(40, "Máximo 40 caracteres."),
  whatsapp: z
    .string()
    .trim()
    .max(40)
    .transform((value) => (value === "" ? null : (normalizeWhatsapp(value) ?? "invalid")))
    .refine((value) => value !== "invalid", "Ingresá el número con característica, por ejemplo 11 5555 0000."),
  instagram: z
    .string()
    .trim()
    .max(80)
    .transform((value) => (value === "" ? null : (normalizeInstagram(value) ?? "/")))
    .refine((value) => value !== "/", "Ingresá tu usuario de Instagram, por ejemplo @minegocio."),
  themePrimary: color,
  themeSecondary: color,
  themeFont: z.string().refine(isThemeFont, "Elegí una tipografía de la lista."),
  showAddress: z.boolean(),
  showPhone: z.boolean(),
  showWhatsapp: z.boolean(),
  showInstagram: z.boolean(),
  showPrices: z.boolean(),
  slug: z
    .string()
    .trim()
    .max(80)
    .transform((value) => slugify(value))
    .refine(isValidSlugFormat, "Usá entre 3 y 50 letras, números o guiones. Algunos nombres están reservados."),
});

export type PublicPageSettings = z.infer<typeof publicPageSchema>;

const TEXT_FIELDS = [
  "name", "specialty", "description", "address", "phone", "whatsapp", "instagram",
  "themePrimary", "themeSecondary", "themeFont", "slug",
] as const;
const TOGGLE_FIELDS = ["showAddress", "showPhone", "showWhatsapp", "showInstagram", "showPrices"] as const;

/** Lee el formulario (o los parámetros de la vista previa) con el mismo criterio. */
export function readPublicPageInput(get: (name: string) => unknown): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (const field of TEXT_FIELDS) input[field] = String(get(field) ?? "");
  for (const field of TOGGLE_FIELDS) input[field] = get(field) === "on";
  return input;
}

/** Datos de un negocio que dibujan su página pública. */
export type PublicProfile = {
  name: string;
  slug: string;
  specialty: string | null;
  description: string | null;
  address: string | null;
  phone: string | null;
  whatsapp: string | null;
  instagram: string | null;
  themePrimary: string;
  themeSecondary: string;
  themeFont: string;
  showAddress: boolean;
  showPhone: boolean;
  showWhatsapp: boolean;
  showInstagram: boolean;
  showPrices: boolean;
};

export function toPublicProfile(organization: PublicProfile): PublicProfile {
  const {
    name, slug, specialty, description, address, phone, whatsapp, instagram,
    themePrimary, themeSecondary, themeFont, showAddress, showPhone, showWhatsapp, showInstagram, showPrices,
  } = organization;
  return {
    name, slug, specialty, description, address, phone, whatsapp, instagram,
    themePrimary, themeSecondary, themeFont, showAddress, showPhone, showWhatsapp, showInstagram, showPrices,
  };
}
