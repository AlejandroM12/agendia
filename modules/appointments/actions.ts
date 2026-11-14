"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireContext, requireWriteContext } from "@/lib/dal";
import { type ActionState, fieldErrors } from "@/lib/action-state";
import { formatTime, isValidDateStr, labelToMinutes, toZoned, zonedTimeToUtc } from "@/lib/time";
import { getTeamAvailability, unionSlots } from "@/modules/availability/queries";
import { customerInputSchema } from "@/modules/customers/service";
import { resolveEligibleProfessionals } from "@/modules/team/eligibility";
import {
  cancelAppointment,
  createAppointment,
  rescheduleAppointment,
  setAppointmentOutcome,
} from "./service";

export type SlotOption = { iso: string; label: string };

/** Horarios libres de un día para la agenda interna (sin anticipación mínima). */
export async function loadSlotsAction(
  serviceId: string,
  dateStr: string,
  ignoreAppointmentId?: string,
  professionalId?: string,
): Promise<SlotOption[]> {
  const { organization } = await requireContext();
  if (!isValidDateStr(dateStr)) return [];

  const service = await db.service.findFirst({
    where: { id: serviceId, organizationId: organization.id },
    select: { id: true, durationMinutes: true },
  });
  if (!service) return [];

  // Sin profesional elegido se muestra la unión del equipo. La validación
  // (activo, de este negocio, que realice el servicio) es la misma que al reservar.
  const eligible = await resolveEligibleProfessionals(db, {
    organization,
    serviceId: service.id,
    audience: "internal",
    choice: professionalId ? professionalId.slice(0, 64) : "any",
  });
  if (!eligible.ok) return [];

  let durationMinutes = service.durationMinutes;
  if (ignoreAppointmentId) {
    const current = await db.appointment.findFirst({
      where: { id: ignoreAppointmentId, organizationId: organization.id },
      select: { startsAt: true, endsAt: true },
    });
    if (current) durationMinutes = Math.round((current.endsAt.getTime() - current.startsAt.getTime()) / 60000);
  }

  const [day] = unionSlots(
    await getTeamAvailability({
      organization: { ...organization, maxAdvanceDays: 730 },
      professionalIds: eligible.professionals.map((p) => p.id),
      durationMinutes,
      fromDateStr: dateStr,
      days: 1,
      applyNotice: false,
      ignoreAppointmentId,
    }),
  );
  return day.slots.map((slot) => ({ iso: slot.toISOString(), label: formatTime(slot, organization.timezone) }));
}

export async function searchCustomersAction(
  query: string,
): Promise<Array<{ id: string; name: string; detail: string }>> {
  const { organization } = await requireContext();
  const q = query.trim().slice(0, 80);
  if (q.length < 2) return [];

  const customers = await db.customer.findMany({
    where: {
      organizationId: organization.id,
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { phone: { contains: q.replace(/\D/g, "") || q } },
      ],
    },
    orderBy: { name: "asc" },
    take: 8,
    select: { id: true, name: true, email: true, phone: true },
  });
  return customers.map((c) => ({ id: c.id, name: c.name, detail: c.phone ?? c.email ?? "" }));
}

function parseStart(formData: FormData, timeZone: string): Date | null {
  const iso = formData.get("slot");
  if (typeof iso === "string" && iso) {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const dateStr = formData.get("date");
  const minutes = labelToMinutes(String(formData.get("time") ?? ""));
  if (!isValidDateStr(dateStr) || minutes === null) return null;
  return zonedTimeToUtc(dateStr, minutes, timeZone);
}

function revalidateAgenda() {
  revalidatePath("/dashboard", "layout");
}

export async function createAppointmentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const access = await requireWriteContext();
  if (!access.ok) return { message: access.message };
  const { organization } = access.context;

  const serviceId = String(formData.get("serviceId") ?? "");
  if (!serviceId) return { message: "Elegí un servicio." };

  const startsAt = parseStart(formData, organization.timezone);
  if (!startsAt) return { message: "Elegí un día y un horario." };

  const customerId = String(formData.get("customerId") ?? "");
  let customer: Parameters<typeof createAppointment>[0]["customer"];
  if (customerId) {
    customer = { id: customerId };
  } else {
    const parsed = customerInputSchema.safeParse({
      name: formData.get("customerName"),
      email: formData.get("customerEmail") ?? "",
      phone: formData.get("customerPhone") ?? "",
    });
    if (!parsed.success) {
      const errors = fieldErrors(parsed.error);
      return { message: errors.name?.[0] ?? errors.email?.[0] ?? "Revisá los datos del cliente.", errors };
    }
    customer = parsed.data;
  }

  const result = await createAppointment({
    organization,
    serviceId,
    startsAt,
    customer,
    actor: "professional",
    notes: String(formData.get("notes") ?? "").slice(0, 2000),
    professional: String(formData.get("professionalId") ?? "") || undefined,
  });
  if (!result.ok) return { message: result.message };

  revalidateAgenda();
  redirect(`/dashboard/agenda?fecha=${toZoned(startsAt, organization.timezone).dateStr}`);
}

export async function rescheduleAppointmentAction(
  appointmentId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const access = await requireWriteContext();
  if (!access.ok) return { message: access.message };
  const { organization } = access.context;

  const startsAt = parseStart(formData, organization.timezone);
  if (!startsAt) return { message: "Elegí un día y un horario." };

  const result = await rescheduleAppointment({
    organization,
    appointmentId,
    startsAt,
    actor: "professional",
    professional: String(formData.get("professionalId") ?? "") || undefined,
  });
  if (!result.ok) return { message: result.message };

  revalidateAgenda();
  redirect(`/dashboard/turnos/${appointmentId}`);
}

export async function cancelAppointmentAction(appointmentId: string): Promise<ActionState> {
  const access = await requireWriteContext();
  if (!access.ok) return { message: access.message };

  const result = await cancelAppointment({
    organization: access.context.organization,
    appointmentId,
    actor: "professional",
  });
  revalidateAgenda();
  return result.ok ? { ok: true } : { message: result.message };
}

export async function setOutcomeAction(
  appointmentId: string,
  status: "confirmed" | "completed" | "no_show",
): Promise<void> {
  const access = await requireWriteContext();
  if (!access.ok) return;
  await setAppointmentOutcome({ organizationId: access.context.organization.id, appointmentId, status });
  revalidateAgenda();
}

export async function updateNotesAction(
  appointmentId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const access = await requireWriteContext();
  if (!access.ok) return { message: access.message };

  await db.appointment.updateMany({
    where: { id: appointmentId, organizationId: access.context.organization.id },
    data: { notes: String(formData.get("notes") ?? "").trim().slice(0, 2000) || null },
  });
  revalidatePath(`/dashboard/turnos/${appointmentId}`);
  return { ok: true, message: "Nota guardada." };
}
