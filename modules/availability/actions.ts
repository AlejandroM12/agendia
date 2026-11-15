"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { recordAudit } from "@/lib/audit";
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
  await recordAudit({
    organizationId: access.context.organization.id,
    userId: access.context.user.id,
    action: "schedule.hours.update",
    entityType: "professional",
    entityId: primary.id,
    metadata: { ranges: parsed.data.length },
  });

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

  const before = access.context.organization;
  await db.organization.update({ where: { id: before.id }, data: parsed.data });
  await recordAudit({
    organizationId: before.id,
    userId: access.context.user.id,
    action: "settings.booking.update",
    entityType: "organization",
    entityId: before.id,
    metadata: {
      changed: Object.keys(parsed.data).filter((key) => (before as unknown as Record<string, unknown>)[key] !== (parsed.data as Record<string, unknown>)[key]),
    },
  });

  revalidatePath("/dashboard/disponibilidad");
  return { ok: true, message: "Reglas de reserva guardadas." };
}

/** Quita un cierre general del negocio. Los bloqueos individuales se quitan desde el profesional (modules/team/actions.ts). */
export async function deleteExceptionAction(exceptionId: string): Promise<void> {
  const access = await requireWriteContext("schedule.manage");
  if (!access.ok) return;
  await deleteAvailabilityException(access.context.organization, exceptionId, { professionalId: null });
  await recordAudit({
    organizationId: access.context.organization.id,
    userId: access.context.user.id,
    action: "schedule.block.delete",
    entityType: "availability_exception",
    entityId: exceptionId,
    metadata: { scope: "business" },
  });
  revalidatePath("/dashboard/disponibilidad");
}
