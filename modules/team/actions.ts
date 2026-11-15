"use server";

import { recordAudit } from "@/lib/audit";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, requireScopedWrite } from "@/lib/dal";
import { FORBIDDEN_MESSAGE } from "@/lib/permissions";
import { canActOnProfessional } from "@/modules/access/scope";
import { type ActionState, fieldErrors } from "@/lib/action-state";
import { rateLimit, TOO_MANY_ATTEMPTS } from "@/lib/rate-limit";
import { dateStrToDbDate, isValidDateStr, labelToMinutes, todayInTz } from "@/lib/time";
import { reassignAppointment } from "@/modules/appointments/service";
import { parseJsonField, weeklyRulesSchema } from "@/modules/availability/rules";
import { MAX_UPLOAD_BYTES, removeProfessionalPhoto, saveProfessionalPhoto } from "@/modules/public-page/images";
import { createProfessional, saveProfessionalHours, createAvailabilityException } from "./professionals";
import {
  activateProfessional,
  copyProfessionalHours,
  createDateRangeBlock,
  deactivateProfessional,
  deleteAvailabilityException,
  moveProfessional,
  resolveFutureAppointments,
  setProfessionalServices,
  setProfessionalUser,
  updateProfessional,
} from "./team-admin";

/**
 * Acciones de «Equipo» y de los horarios por profesional. Todas piden el
 * permiso correspondiente en el servidor (lib/permissions.ts) y toman el
 * negocio de la sesión: ningún identificador de negocio viaja en el
 * formulario, y todo identificador de profesional, servicio, turno o
 * bloqueo se vuelve a verificar contra ese negocio.
 */

const profileSchema = z.object({
  displayName: z.string().trim().min(2, "Ingresá el nombre del profesional.").max(80, "Puede tener hasta 80 caracteres."),
  description: z.string().trim().max(300, "Puede tener hasta 300 caracteres.").optional(),
  color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "Elegí un color válido."),
});

function readProfile(formData: FormData) {
  return profileSchema.safeParse({
    displayName: formData.get("displayName") ?? "",
    description: formData.get("description") ?? "",
    color: formData.get("color") ?? "",
  });
}

function revalidateTeam() {
  revalidatePath("/dashboard", "layout");
}

export async function createProfessionalAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const access = await requirePermission("team.manage");
  if (!access.ok) return { message: access.message };
  const { organization, user } = access.context;

  const parsed = readProfile(formData);
  if (!parsed.success) return { errors: fieldErrors(parsed.error), message: "Revisá los campos marcados." };

  const created = await createProfessional(organization, {
    displayName: parsed.data.displayName,
    description: parsed.data.description,
    color: parsed.data.color,
    bookableOnline: formData.get("bookableOnline") === "on",
  });
  if (!created.ok) return { message: created.message };

  if (formData.get("isMe") === "on") await setProfessionalUser(organization, created.value.id, user.id);
  await db.auditLog.create({
    data: {
      organizationId: organization.id,
      userId: user.id,
      action: "team.professional.create",
      entityType: "professional",
      entityId: created.value.id,
    },
  });

  revalidateTeam();
  redirect(`/dashboard/equipo/${created.value.id}`);
}

export async function updateProfessionalAction(
  professionalId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const access = await requirePermission("team.manage");
  if (!access.ok) return { message: access.message };
  const { organization, user } = access.context;

  const parsed = readProfile(formData);
  if (!parsed.success) return { errors: fieldErrors(parsed.error), message: "Revisá los campos marcados." };

  const updated = await updateProfessional(
    organization,
    professionalId,
    { ...parsed.data, bookableOnline: formData.get("bookableOnline") === "on" },
    user.id,
  );
  if (!updated.ok) return { message: updated.message };

  revalidateTeam();
  return { ok: true, message: "Cambios guardados." };
}

export async function moveProfessionalAction(professionalId: string, direction: "up" | "down"): Promise<void> {
  const access = await requirePermission("team.manage");
  if (!access.ok) return;
  if (direction !== "up" && direction !== "down") return;
  await moveProfessional(access.context.organization, professionalId, direction);
  revalidateTeam();
}

/** «Atiendo yo»: marca (o desmarca) a este profesional como la persona de la cuenta. */
export async function setIsMeAction(professionalId: string, isMe: boolean): Promise<void> {
  const access = await requirePermission("team.manage");
  if (!access.ok) return;
  const { organization, user } = access.context;
  await setProfessionalUser(organization, professionalId, isMe ? user.id : null);
  revalidateTeam();
}

export async function saveProfessionalServicesAction(
  professionalId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const access = await requirePermission("team.manage");
  if (!access.ok) return { message: access.message };

  const serviceIds = formData.getAll("serviceId").map(String);
  const saved = await setProfessionalServices(access.context.organization, professionalId, serviceIds);
  if (!saved.ok) return { message: saved.message };
  await recordAudit({
    organizationId: access.context.organization.id,
    userId: access.context.user.id,
    action: "team.professional.services",
    entityType: "professional",
    entityId: professionalId,
    metadata: { services: serviceIds.length },
  });

  revalidateTeam();
  const warning = saved.value.servicesWithoutProfessional;
  return {
    ok: true,
    message:
      warning.length > 0
        ? `Guardado. Ojo: ${warning.map((name) => `«${name}»`).join(", ")} ya no lo hace ningún profesional activo y no se va a poder reservar.`
        : "Servicios guardados.",
  };
}

export type PhotoActionState = { ok: true; id: string | null } | { ok: false; message: string };

export async function uploadProfessionalPhotoAction(professionalId: string, formData: FormData): Promise<PhotoActionState> {
  const access = await requirePermission("team.manage");
  if (!access.ok) return { ok: false, message: access.message };
  const { organization } = access.context;

  // Procesar imágenes consume CPU: se limita por negocio (junto con logo y portada).
  if (!(await rateLimit(`image-upload:${organization.id}`, 30, 3600)).allowed) {
    return { ok: false, message: TOO_MANY_ATTEMPTS };
  }
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Elegí una imagen." };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, message: "La imagen pesa demasiado. El máximo es 8 MB." };

  const saved = await saveProfessionalPhoto(organization.id, professionalId, new Uint8Array(await file.arrayBuffer()));
  if (!saved.ok) return saved;
  revalidateTeam();
  return { ok: true, id: saved.id };
}

export async function removeProfessionalPhotoAction(professionalId: string): Promise<PhotoActionState> {
  const access = await requirePermission("team.manage");
  if (!access.ok) return { ok: false, message: access.message };
  const removed = await removeProfessionalPhoto(access.context.organization.id, professionalId);
  if (!removed) return { ok: false, message: "No encontramos a ese profesional." };
  revalidateTeam();
  return { ok: true, id: null };
}

export async function activateProfessionalAction(professionalId: string): Promise<ActionState> {
  const access = await requirePermission("team.manage");
  if (!access.ok) return { message: access.message };
  const result = await activateProfessional(access.context.organization, professionalId, access.context.user.id);
  revalidateTeam();
  return result.ok ? { ok: true, message: "Profesional activado." } : { message: result.message };
}

/** Desactiva solo si no quedan turnos futuros: si quedan, la pantalla de resolución los muestra. */
export async function deactivateProfessionalAction(professionalId: string): Promise<ActionState> {
  const access = await requirePermission("team.manage");
  if (!access.ok) return { message: access.message };
  const result = await deactivateProfessional(access.context.organization, professionalId, access.context.user.id);
  revalidateTeam();
  return result.ok ? { ok: true, message: "Profesional desactivado." } : { message: result.message };
}

export async function reassignAppointmentAction(
  appointmentId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const access = await requirePermission("appointments.manage");
  if (!access.ok) return { message: access.message };

  const professionalId = String(formData.get("professionalId") ?? "");
  if (!professionalId) return { message: "Elegí a quién pasar el turno." };

  const result = await reassignAppointment({
    organization: access.context.organization,
    appointmentId,
    professionalId: professionalId.slice(0, 64),
    userId: access.context.user.id,
  });
  revalidateTeam();
  return result.ok ? { ok: true, message: "Turno reasignado. Le avisamos al cliente por email." } : { message: result.message };
}

/** Pasa todos los turnos futuros de un profesional a otro, o los cancela: siempre por decisión explícita. */
export async function resolveAppointmentsAction(
  professionalId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const access = await requirePermission("appointments.manage");
  if (!access.ok) return { message: access.message };
  const manage = await requirePermission("team.manage");
  if (!manage.ok) return { message: manage.message };

  const kind = String(formData.get("decision") ?? "");
  let decision: Parameters<typeof resolveFutureAppointments>[2];
  if (kind === "cancel") {
    decision = { kind: "cancel" };
  } else if (kind === "reassign") {
    const toProfessionalId = String(formData.get("toProfessionalId") ?? "");
    if (!toProfessionalId) return { message: "Elegí a quién pasar los turnos." };
    decision = { kind: "reassign", toProfessionalId: toProfessionalId.slice(0, 64) };
  } else {
    return { message: "Elegí qué hacer con los turnos." };
  }

  const result = await resolveFutureAppointments(access.context.organization, professionalId, decision, access.context.user.id);
  revalidateTeam();
  if (!result.ok) return { message: result.message };
  const { done, failed } = result.value;
  if (failed.length > 0) {
    return {
      message: `${done} resueltos, ${failed.length} no se pudieron resolver (${failed[0].message}). Resolvelos de a uno desde la lista.`,
    };
  }
  return { ok: true, message: done === 0 ? "No había turnos para resolver." : `Listo: ${done} ${done === 1 ? "turno resuelto" : "turnos resueltos"}.` };
}

/* ------------------------------------------------------------------ */
/* Horarios y bloqueos por profesional                                 */
/* ------------------------------------------------------------------ */

export async function saveProfessionalHoursAction(
  professionalId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  // El propietario y el administrador editan los horarios de cualquiera; un profesional, solo los suyos y si se lo permitieron.
  const access = await requireScopedWrite("schedule.manage", "own.hours.manage");
  if (!access.ok) return { message: access.message };
  if (!canActOnProfessional(access.context, professionalId)) return { message: FORBIDDEN_MESSAGE };
  const parsed = parseJsonField(weeklyRulesSchema, formData.get("rules"));
  if (!parsed.success) return { message: parsed.error.issues[0]?.message ?? "Revisá los horarios ingresados." };

  const saved = await saveProfessionalHours(access.context.organization, professionalId, parsed.data);
  if (!saved.ok) return { message: saved.message };
  await recordAudit({
    organizationId: access.context.organization.id,
    userId: access.context.user.id,
    action: "schedule.hours.update",
    entityType: "professional",
    entityId: professionalId,
    metadata: { ranges: parsed.data.length },
  });
  revalidatePath("/dashboard/disponibilidad");
  revalidateTeam();
  return { ok: true, message: "Horarios guardados." };
}

export async function copyHoursAction(toProfessionalId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const access = await requirePermission("schedule.manage");
  if (!access.ok) return { message: access.message };
  const from = String(formData.get("fromProfessionalId") ?? "");
  if (!from) return { message: "Elegí de quién copiar los horarios." };

  const copied = await copyProfessionalHours(access.context.organization, from.slice(0, 64), toProfessionalId);
  if (!copied.ok) return { message: copied.message };
  await recordAudit({
    organizationId: access.context.organization.id,
    userId: access.context.user.id,
    action: "schedule.hours.copy",
    entityType: "professional",
    entityId: toProfessionalId,
    metadata: { fromProfessionalId: from.slice(0, 64) },
  });
  revalidatePath("/dashboard/disponibilidad");
  return { ok: true, message: "Horarios copiados. Podés ajustarlos si hace falta." };
}

/**
 * Agrega un bloqueo: de un día (todo el día o un rato) o de varios días
 * seguidos (vacaciones, licencia). Con `professionalId` es individual; sin
 * él, un cierre general del negocio.
 */
export async function addBlockAction(
  professionalId: string | null,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  // Un cierre general del negocio es del propietario/administrador; un bloqueo individual,
  // también del profesional dueño de esa agenda si el negocio se lo permite.
  const access = professionalId === null
    ? await requirePermission("schedule.manage")
    : await requireScopedWrite("schedule.manage", "own.blocks.manage");
  if (!access.ok) return { message: access.message };
  if (professionalId !== null && !canActOnProfessional(access.context, professionalId)) return { message: FORBIDDEN_MESSAGE };
  const { organization } = access.context;
  const today = todayInTz(organization.timezone);

  const date = formData.get("date");
  if (!isValidDateStr(date)) return { message: "Elegí una fecha." };
  if (date < today) return { message: "La fecha ya pasó." };
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 120) || null;

  const until = String(formData.get("until") ?? "");
  if (until) {
    const range = await createDateRangeBlock(organization, { professionalId, from: date, to: until, reason }, today);
    if (!range.ok) return { message: range.message };
    await recordAudit({
      organizationId: organization.id,
      userId: access.context.user.id,
      action: "schedule.block.create",
      entityType: "availability_exception",
      entityId: professionalId,
      metadata: { scope: professionalId ? "professional" : "business", days: range.value.days },
    });
    revalidatePath("/dashboard/disponibilidad");
    return { ok: true, message: `${range.value.days} ${range.value.days === 1 ? "día bloqueado" : "días bloqueados"}.` };
  }

  const fullDay = formData.get("fullDay") === "on";
  let startMinute: number | null = null;
  let endMinute: number | null = null;
  if (!fullDay) {
    startMinute = labelToMinutes(String(formData.get("start") ?? ""));
    endMinute = labelToMinutes(String(formData.get("end") ?? ""));
    if (startMinute === null || endMinute === null || endMinute <= startMinute) {
      return { message: "Indicá un horario válido para el bloqueo." };
    }
  }
  const created = await createAvailabilityException(organization, {
    professionalId,
    date: dateStrToDbDate(date),
    startMinute,
    endMinute,
    reason,
  });
  if (!created.ok) return { message: created.message };
  await recordAudit({
    organizationId: organization.id,
    userId: access.context.user.id,
    action: "schedule.block.create",
    entityType: "availability_exception",
    entityId: created.value.id,
    metadata: { scope: professionalId ? "professional" : "business", fullDay },
  });
  revalidatePath("/dashboard/disponibilidad");
  return { ok: true, message: "Bloqueo agregado." };
}

export async function deleteBlockAction(professionalId: string | null, exceptionId: string): Promise<void> {
  const access = professionalId === null
    ? await requirePermission("schedule.manage")
    : await requireScopedWrite("schedule.manage", "own.blocks.manage");
  if (!access.ok) return;
  if (professionalId !== null && !canActOnProfessional(access.context, professionalId)) return;
  await deleteAvailabilityException(access.context.organization, exceptionId, { professionalId });
  await recordAudit({
    organizationId: access.context.organization.id,
    userId: access.context.user.id,
    action: "schedule.block.delete",
    entityType: "availability_exception",
    entityId: exceptionId,
    metadata: { scope: professionalId ? "professional" : "business" },
  });
  revalidatePath("/dashboard/disponibilidad");
}
