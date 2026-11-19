import "server-only";

import { DEMO_BLOCKED_MESSAGE } from "@/modules/demo/policy";
import sharp from "sharp";
import type { OrganizationImageKind } from "@prisma/client";
import { db } from "@/lib/db";
import { imageUrl } from "./images-client";

/**
 * Logo y portada de la página pública.
 *
 * Almacenamiento: PostgreSQL (tabla `organization_images`). Las imágenes se
 * guardan ya reducidas a WebP (un logo pesa ~20 KB y una portada ~150 KB),
 * así que persisten con los mismos backups que el resto de los datos, no
 * dependen del disco del contenedor y funcionan igual en una instalación
 * independiente, sin servicios ni credenciales adicionales. Si el volumen
 * creciera mucho, este módulo es el único punto a cambiar para pasar a un
 * object storage.
 *
 * Nunca se guarda ni se sirve el archivo original: se decodifica, se
 * reescala y se vuelve a codificar, lo que descarta metadatos (EXIF,
 * ubicación) y cualquier contenido que no sea la imagen.
 */

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
/** Tope de píxeles a decodificar: frena imágenes "bomba" que explotan en memoria. */
const MAX_INPUT_PIXELS = 50_000_000;

const RULES: Record<OrganizationImageKind, { minWidth: number; minHeight: number; label: string }> = {
  logo: { minWidth: 96, minHeight: 96, label: "El logo" },
  cover: { minWidth: 600, minHeight: 240, label: "La portada" },
  professional: { minWidth: 160, minHeight: 160, label: "La foto" },
};

const LOGO_SIZE = 512;
const COVER_WIDTH = 1600;
const COVER_RATIO = 2; // ancho : alto
const PROFESSIONAL_PHOTO_SIZE = 512; // recorte cuadrado centrado en la cara o lo más relevante

type SniffedFormat = "jpeg" | "png" | "webp";

/** Formato real según los primeros bytes del archivo, no según su nombre ni el tipo que declara el navegador. */
export function sniffImageFormat(bytes: Uint8Array): SniffedFormat | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (
    bytes.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value)
  ) {
    return "png";
  }
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  return null;
}

export type ProcessedImage = { bytes: Buffer; width: number; height: number; contentType: "image/webp" };
export type ProcessImageResult = { ok: true; image: ProcessedImage } | { ok: false; message: string };

/** Valida el contenido y devuelve la versión optimizada lista para guardar. */
export async function processImage(kind: OrganizationImageKind, input: Uint8Array): Promise<ProcessImageResult> {
  const rule = RULES[kind];
  if (input.length === 0) return { ok: false, message: "Elegí una imagen." };
  if (input.length > MAX_UPLOAD_BYTES) return { ok: false, message: "La imagen pesa demasiado. El máximo es 8 MB." };

  const sniffed = sniffImageFormat(input);
  if (!sniffed) return { ok: false, message: "Formato no admitido. Subí una imagen JPG, PNG o WebP." };

  try {
    const source = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" });
    const metadata = await source.metadata();
    // El contenido tiene que ser lo que dicen sus primeros bytes.
    if (metadata.format !== sniffed || !metadata.width || !metadata.height) {
      return { ok: false, message: "El archivo no es una imagen válida." };
    }

    // La orientación EXIF (fotos de celular) intercambia ancho y alto.
    const rotated = (metadata.orientation ?? 1) >= 5;
    const width = rotated ? metadata.height : metadata.width;
    const height = rotated ? metadata.width : metadata.height;
    if (width < rule.minWidth || height < rule.minHeight) {
      return {
        ok: false,
        message: `${rule.label} es muy chica: tiene que medir al menos ${rule.minWidth} × ${rule.minHeight} píxeles.`,
      };
    }

    const pipeline = source.rotate();
    if (kind === "logo") {
      pipeline.resize(LOGO_SIZE, LOGO_SIZE, { fit: "inside", withoutEnlargement: true });
    } else if (kind === "professional") {
      const side = Math.min(PROFESSIONAL_PHOTO_SIZE, width, height);
      pipeline.resize(side, side, { fit: "cover", position: "attention" });
    } else {
      // Recorte 2:1 centrado en lo más relevante, sin agrandar imágenes chicas.
      const targetWidth = Math.min(COVER_WIDTH, width, Math.floor(height * COVER_RATIO));
      pipeline.resize(targetWidth, Math.round(targetWidth / COVER_RATIO), { fit: "cover", position: "attention" });
    }

    const { data, info } = await pipeline
      .webp({ quality: kind === "cover" ? 80 : 88 })
      .toBuffer({ resolveWithObject: true });
    return { ok: true, image: { bytes: data, width: info.width, height: info.height, contentType: "image/webp" } };
  } catch {
    return { ok: false, message: "No pudimos leer la imagen. Probá con otro archivo JPG, PNG o WebP." };
  }
}

/** Logo y portada: una por negocio. Las fotos de profesionales tienen sus propias funciones. */
async function isDemoOrganization(organizationId: string): Promise<boolean> {
  const organization = await db.organization.findUnique({ where: { id: organizationId }, select: { isDemo: true } });
  return Boolean(organization?.isDemo);
}

export type BusinessImageKind = Exclude<OrganizationImageKind, "professional">;

export type SaveImageResult = { ok: true; id: string } | { ok: false; message: string };

/**
 * Guarda (o reemplaza) la imagen de un negocio. `organizationId` viene
 * siempre del contexto de sesión del servidor, nunca del formulario. La
 * imagen anterior se borra en la misma transacción: no quedan huérfanas.
 */
export async function saveOrganizationImage(
  organizationId: string,
  kind: BusinessImageKind,
  input: Uint8Array,
): Promise<SaveImageResult> {
  if (await isDemoOrganization(organizationId)) return { ok: false, message: DEMO_BLOCKED_MESSAGE };
  const processed = await processImage(kind, input);
  if (!processed.ok) return processed;

  const { bytes, width, height, contentType } = processed.image;
  const [, created] = await db.$transaction([
    db.organizationImage.deleteMany({ where: { organizationId, kind } }),
    db.organizationImage.create({
      data: { organizationId, kind, contentType, width, height, bytes: new Uint8Array(bytes) },
      select: { id: true },
    }),
  ]);
  return { ok: true, id: created.id };
}

export type ProfessionalPhotoResult = { ok: true; id: string } | { ok: false; message: string };

/**
 * Guarda (o reemplaza) la foto de un profesional. Se valida que el
 * profesional sea del negocio, se procesa igual que el resto de las imágenes
 * y la foto anterior se borra en la misma transacción.
 */
export async function saveProfessionalPhoto(
  organizationId: string,
  professionalId: string,
  input: Uint8Array,
): Promise<ProfessionalPhotoResult> {
  if (await isDemoOrganization(organizationId)) return { ok: false, message: DEMO_BLOCKED_MESSAGE };
  const professional = await db.professional.findFirst({
    where: { id: professionalId, organizationId },
    select: { id: true },
  });
  if (!professional) return { ok: false, message: "No encontramos a ese profesional." };

  const processed = await processImage("professional", input);
  if (!processed.ok) return processed;

  const { bytes, width, height, contentType } = processed.image;
  const id = await db.$transaction(async (tx) => {
    // El UPDATE toma el lock de la fila: dos cambios de foto simultáneos se serializan.
    const current = await tx.professional.findUniqueOrThrow({
      where: { id: professionalId },
      select: { photoImageId: true },
    });
    const created = await tx.organizationImage.create({
      data: { organizationId, kind: "professional", contentType, width, height, bytes: new Uint8Array(bytes) },
      select: { id: true },
    });
    await tx.professional.update({ where: { id: professionalId }, data: { photoImageId: created.id } });
    if (current.photoImageId) {
      await tx.organizationImage.deleteMany({ where: { id: current.photoImageId, organizationId } });
    }
    return created.id;
  });
  return { ok: true, id };
}

export async function removeProfessionalPhoto(organizationId: string, professionalId: string): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const professional = await tx.professional.findFirst({
      where: { id: professionalId, organizationId },
      select: { photoImageId: true },
    });
    if (!professional) return false;
    await tx.professional.update({ where: { id: professionalId }, data: { photoImageId: null } });
    if (professional.photoImageId) {
      await tx.organizationImage.deleteMany({ where: { id: professional.photoImageId, organizationId } });
    }
    return true;
  });
}

export async function removeOrganizationImage(organizationId: string, kind: BusinessImageKind): Promise<void> {
  await db.organizationImage.deleteMany({ where: { organizationId, kind } });
}

export type OrganizationImages = { logoUrl: string | null; coverUrl: string | null; logoId: string | null; coverId: string | null };

/** URL pública de una imagen. Cambia cada vez que se reemplaza, así que se puede cachear para siempre. */
export { imageUrl } from "./images-client";

/** Identificadores de las imágenes de un negocio, sin traer su contenido. */
export async function getOrganizationImages(organizationId: string): Promise<OrganizationImages> {
  const rows = await db.organizationImage.findMany({ where: { organizationId }, select: { id: true, kind: true } });
  const logoId = rows.find((row) => row.kind === "logo")?.id ?? null;
  const coverId = rows.find((row) => row.kind === "cover")?.id ?? null;
  return { logoId, coverId, logoUrl: logoId && imageUrl(logoId), coverUrl: coverId && imageUrl(coverId) };
}
