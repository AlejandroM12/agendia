"use server";

import { DEMO_BLOCKED_MESSAGE } from "@/modules/demo/policy";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireContext, requireWriteContext } from "@/lib/dal";
import { type ActionState, fieldErrors } from "@/lib/action-state";
import { industries } from "@/lib/brand";
import { hashPassword, verifyPassword } from "@/lib/password";
import { changePasswordSchema } from "@/modules/auth/schemas";

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const businessSchema = z.object({
  industry: z.string().refine((v) => industries.some((i) => i.id === v), "Elegí una actividad."),
  timezone: z.string().refine(isValidTimeZone, "Zona horaria inválida."),
});

/**
 * Datos operativos del negocio. Nombre, descripción, contacto y enlace son
 * parte de «Mi página pública» (modules/public-page/actions.ts).
 */
export async function updateBusinessAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const access = await requireWriteContext("settings.manage");
  if (!access.ok) return { message: access.message };

  const parsed = businessSchema.safeParse({ industry: formData.get("industry"), timezone: formData.get("timezone") });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  await db.organization.update({ where: { id: access.context.organization.id }, data: parsed.data });

  revalidatePath("/dashboard", "layout");
  return { ok: true, message: "Cambios guardados." };
}

const remindersSchema = z.object({
  remindersEnabled: z.boolean(),
  reminderHoursBefore: z.coerce.number().int().min(1).max(168),
  notifyOwnerOnBooking: z.boolean(),
});

export async function updateRemindersAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const access = await requireWriteContext("settings.manage");
  if (!access.ok) return { message: access.message };

  const parsed = remindersSchema.safeParse({
    remindersEnabled: formData.get("remindersEnabled") === "on",
    reminderHoursBefore: formData.get("reminderHoursBefore"),
    notifyOwnerOnBooking: formData.get("notifyOwnerOnBooking") === "on",
  });
  if (!parsed.success) return { message: "Revisá los valores ingresados." };

  await db.organization.update({ where: { id: access.context.organization.id }, data: parsed.data });

  revalidatePath("/dashboard/recordatorios");
  return { ok: true, message: "Preferencias guardadas. Se aplican a los turnos que se agenden desde ahora." };
}

export async function changePasswordAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user, organization } = await requireContext();
  if (organization.isDemo) return { message: DEMO_BLOCKED_MESSAGE };

  const parsed = changePasswordSchema.safeParse({ current: formData.get("current"), next: formData.get("next") });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const record = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { passwordHash: true } });
  if (!(await verifyPassword(parsed.data.current, record.passwordHash))) {
    return { errors: { current: ["La contraseña actual no coincide."] } };
  }

  // sessionVersion + 1 cierra todas las sesiones abiertas, incluida esta:
  // el formulario navega a /logout y se vuelve a ingresar con la nueva.
  await db.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(parsed.data.next), sessionVersion: { increment: 1 } },
  });
  return { ok: true };
}
