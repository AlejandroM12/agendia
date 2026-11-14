"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireWriteContext } from "@/lib/dal";
import { type ActionState, fieldErrors } from "@/lib/action-state";
import { getOrCreatePrimaryProfessional } from "@/modules/team/eligibility";
import { saveProfessionalHours } from "@/modules/team/professionals";
import { deleteAvailabilityException } from "@/modules/team/team-admin";
import { parseJsonField, weeklyRulesSchema } from "./rules";

export async function saveWeeklyHoursAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const access = await requireWriteContext("schedule.manage");
  if (!access.ok) return { message: access.message };
  const parsed = parseJsonField(weeklyRulesSchema, formData.get("rules"));
  if (!parsed.success) {
    return { message: parsed.error.issues[0]?.message ?? "Revisá los horarios ingresados." };
  }

  // Hoy esta pantalla edita la agenda del profesional «de siempre»: guardar no
  // debe tocar los horarios de ningún otro profesional del equipo.
  const primary = await getOrCreatePrimaryProfessional(db, access.context.organization);
  if (!primary) return { message: "No encontramos a un profesional activo para guardar los horarios." };
  const saved = await saveProfessionalHours(access.context.organization, primary.id, parsed.data);
  if (!saved.ok) return { message: saved.message };

  revalidatePath("/dashboard/disponibilidad");
  return { ok: true, message: "Horarios guardados." };
}

const settingsSchema = z.object({
  slotIntervalMinutes: z.coerce.number().int().refine((v) => [10, 15, 20, 30, 45, 60].includes(v)),
  bufferMinutes: z.coerce.number().int().min(0).max(120),
  minNoticeMinutes: z.coerce.number().int().min(0).max(7 * 24 * 60),
  maxAdvanceDays: z.coerce.number().int().min(1).max(365),
  cancellationNoticeHours: z.coerce.number().int().min(0).max(168),
});

export async function saveBookingSettingsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const access = await requireWriteContext("schedule.manage");
  if (!access.ok) return { message: access.message };

  const parsed = settingsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { message: "Revisá los valores ingresados.", errors: fieldErrors(parsed.error) };

  await db.organization.update({ where: { id: access.context.organization.id }, data: parsed.data });

  revalidatePath("/dashboard/disponibilidad");
  return { ok: true, message: "Reglas de reserva guardadas." };
}

/** Quita un cierre general del negocio. Los bloqueos individuales se quitan desde el profesional (modules/team/actions.ts). */
export async function deleteExceptionAction(exceptionId: string): Promise<void> {
  const access = await requireWriteContext("schedule.manage");
  if (!access.ok) return;
  await deleteAvailabilityException(access.context.organization, exceptionId, { professionalId: null });
  revalidatePath("/dashboard/disponibilidad");
}
