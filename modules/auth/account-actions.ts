"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireContext } from "@/lib/dal";
import { type ActionState, fieldErrors } from "@/lib/action-state";

/**
 * Datos de la propia cuenta (cualquier rol). Siempre sobre la persona con
 * sesión: no reciben identificadores del navegador.
 */

const nameSchema = z.object({ name: z.string().trim().min(2, "Ingresá tu nombre.").max(120, "Puede tener hasta 120 caracteres.") });

export async function updateAccountNameAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user } = await requireContext();
  const parsed = nameSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) return { errors: fieldErrors(parsed.error), message: "Revisá el nombre." };

  await db.user.update({ where: { id: user.id }, data: { name: parsed.data.name } });
  revalidatePath("/dashboard", "layout");
  return { ok: true, message: "Nombre actualizado." };
}

/**
 * Avisos de turnos por correo de ESTA persona en el negocio activo: el
 * profesional, los de sus turnos; el propietario y los administradores, los de
 * todo el negocio (si el negocio los tiene activos). Es una preferencia propia:
 * nadie la cambia por otra persona.
 */
export async function updateMyNotificationsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { membership } = await requireContext();
  await db.membership.update({ where: { id: membership.id }, data: { notifyBookings: formData.get("notifyBookings") === "on" } });
  revalidatePath("/dashboard/perfil");
  return { ok: true, message: "Preferencia guardada." };
}
