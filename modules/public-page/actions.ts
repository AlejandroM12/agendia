"use server";

import { revalidatePath } from "next/cache";
import type { OrganizationImageKind } from "@prisma/client";
import { db } from "@/lib/db";
import { requireWriteContext } from "@/lib/dal";
import { type ActionState, fieldErrors } from "@/lib/action-state";
import { rateLimit, TOO_MANY_ATTEMPTS } from "@/lib/rate-limit";
import { MAX_UPLOAD_BYTES, removeOrganizationImage, saveOrganizationImage } from "./images";
import { publicPageSchema, readPublicPageInput } from "./settings";
import { changeOrganizationSlug } from "./slug";

/**
 * Acciones de «Mi página pública». El negocio sale siempre de la sesión
 * (lib/dal.ts): ningún identificador de negocio viaja en el formulario.
 */

export type PublicPageState = (NonNullable<ActionState> & { slug?: string }) | undefined;

export async function updatePublicPageAction(_prev: PublicPageState, formData: FormData): Promise<PublicPageState> {
  const access = await requireWriteContext();
  if (!access.ok) return { message: access.message };
  const { organization } = access.context;

  const parsed = publicPageSchema.safeParse(readPublicPageInput((name) => formData.get(name)));
  if (!parsed.success) return { errors: fieldErrors(parsed.error), message: "Revisá los campos marcados." };

  const { slug, ...settings } = parsed.data;
  const slugError = await db.$transaction(async (tx) => {
    const changed = await changeOrganizationSlug(tx, organization, slug);
    if (!changed.ok) return changed.message;
    await tx.organization.update({ where: { id: organization.id }, data: settings });
    return null;
  });
  if (slugError) return { errors: { slug: [slugError] }, message: "Revisá los campos marcados." };

  revalidatePath("/dashboard", "layout");
  return { ok: true, message: "Cambios guardados. Tu página ya está actualizada.", slug };
}

const isImageKind = (value: unknown): value is OrganizationImageKind => value === "logo" || value === "cover";

export type ImageActionState = { ok: true; id: string | null } | { ok: false; message: string };

export async function uploadPublicImageAction(kind: OrganizationImageKind, formData: FormData): Promise<ImageActionState> {
  const access = await requireWriteContext();
  if (!access.ok) return { ok: false, message: access.message };
  const { organization } = access.context;

  if (!isImageKind(kind)) return { ok: false, message: "Tipo de imagen desconocido." };
  // Procesar imágenes consume CPU: se limita por negocio.
  if (!(await rateLimit(`image-upload:${organization.id}`, 30, 3600)).allowed) {
    return { ok: false, message: TOO_MANY_ATTEMPTS };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Elegí una imagen." };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, message: "La imagen pesa demasiado. El máximo es 8 MB." };

  const result = await saveOrganizationImage(organization.id, kind, new Uint8Array(await file.arrayBuffer()));
  if (!result.ok) return result;

  revalidatePath("/dashboard/pagina");
  return { ok: true, id: result.id };
}

export async function removePublicImageAction(kind: OrganizationImageKind): Promise<ImageActionState> {
  const access = await requireWriteContext();
  if (!access.ok) return { ok: false, message: access.message };
  if (!isImageKind(kind)) return { ok: false, message: "Tipo de imagen desconocido." };

  await removeOrganizationImage(access.context.organization.id, kind);
  revalidatePath("/dashboard/pagina");
  return { ok: true, id: null };
}
