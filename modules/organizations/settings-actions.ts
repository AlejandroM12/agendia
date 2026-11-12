"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireContext, requireWriteContext } from "@/lib/dal";
import { type ActionState, fieldErrors } from "@/lib/action-state";
import { industries } from "@/lib/brand";
import { hashPassword, verifyPassword } from "@/lib/password";
import { isValidSlugFormat, slugify } from "@/lib/slug";

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v));

const businessSchema = z.object({
  name: z.string().trim().min(2, "Ingresá el nombre de tu negocio.").max(80),
  industry: z.string().refine((v) => industries.some((i) => i.id === v), "Elegí una actividad."),
  description: optional(160),
  phone: optional(40),
  address: optional(160),
  timezone: z.string().refine(isValidTimeZone, "Zona horaria inválida."),
  slug: z
    .string()
    .trim()
    .transform((v) => slugify(v))
    .refine(isValidSlugFormat, "Usá entre 3 y 50 letras, números o guiones. Algunos nombres están reservados."),
});

export async function updateBusinessAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const access = await requireWriteContext();
  if (!access.ok) return { message: access.message };
  const { organization } = access.context;

  const parsed = businessSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  if (parsed.data.slug !== organization.slug) {
    const taken = await db.organization.findUnique({ where: { slug: parsed.data.slug }, select: { id: true } });
    if (taken) return { errors: { slug: ["Ese enlace ya está en uso. Probá con otro."] } };
  }

  await db.organization.update({ where: { id: organization.id }, data: parsed.data });

  revalidatePath("/dashboard", "layout");
  return { ok: true, message: "Cambios guardados." };
}

const remindersSchema = z.object({
  remindersEnabled: z.boolean(),
  reminderHoursBefore: z.coerce.number().int().min(1).max(168),
  notifyOwnerOnBooking: z.boolean(),
});

export async function updateRemindersAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const access = await requireWriteContext();
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

const passwordSchema = z.object({
  current: z.string().min(1, "Ingresá tu contraseña actual."),
  next: z
    .string()
    .min(8, "Debe tener al menos 8 caracteres.")
    .regex(/[a-zA-Z]/, "Debe contener al menos una letra.")
    .regex(/[0-9]/, "Debe contener al menos un número."),
});

export async function changePasswordAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user } = await requireContext();

  const parsed = passwordSchema.safeParse({ current: formData.get("current"), next: formData.get("next") });
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
