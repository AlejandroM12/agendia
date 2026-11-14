"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireContext, requireScopedWrite } from "@/lib/dal";
import { appointmentScope, customerScope, findAppointmentFor } from "@/modules/access/scope";
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
  const context = await requireContext();
  const { organization } = context;
  if (!isValidDateStr(dateStr)) return [];
  // Un profesional solo ve los horarios de SU agenda, pida lo que pida el navegador.
  if (context.restrictedProfessionalId) professionalId = context.restrictedProfessionalId;

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
      where: { ...appointmentScope(context), id: ignoreAppointmentId },
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
  const context = await requireContext();
  const q = query.trim().slice(0, 80);
  if (q.length < 2) return [];
  // Un profesional solo encuentra a quienes ya tienen turnos con él.
  const sees = context.restrictedProfessionalId === null || context.permissions.has("own.appointments.create");
  if (!sees) return [];

  const customers = await db.customer.findMany({
    where: {
      ...customerScope(context),
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
  const showContact = context.restrictedProfessionalId === null || context.permissions.has("own.customers.contact");
  return customers.map((c) => ({ id: c.id, name: c.name, detail: showContact ? (c.phone ?? c.email ?? "") : "" }));
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
  const access = await requireScopedWrite("appointments.manage", "own.appointments.create");
  if (!access.ok) return { message: access.message };
  const { organization, restrictedProfessionalId } = access.context;

  const serviceId = String(formData.get("serviceId") ?? "");
  if (!serviceId) return { message: "Elegí un servicio." };

  const startsAt = parseStart(formData, organization.timezone);
  if (!startsAt) return { message: "Elegí un día y un horario." };

  const customerId = String(formData.get("customerId") ?? "");
  let customer: Parameters<typeof createAppointment>[0]["customer"];
  if (customerId) {
    // Un profesional solo puede usar a sus propios clientes: un identificador ajeno no alcanza.
    if (restrictedProfessionalId && !(await db.customer.findFirst({ where: { ...customerScope(access.context), id: customerId.slice(0, 64) }, select: { id: true } }))) {
      return { message: "No encontramos ese cliente." };
    }
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
    // Un profesional agenda SIEMPRE en su propia agenda, ignorando lo que diga el formulario.
    professional: restrictedProfessionalId ?? (String(formData.get("professionalId") ?? "") || undefined),
    actorUserId: access.context.user.id,
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
  const access = await requireScopedWrite("appointments.manage", "own.appointments.reschedule");
  if (!access.ok) return { message: access.message };
  const { organization, restrictedProfessionalId } = access.context;
  if (!(await findAppointmentFor(access.context, appointmentId))) return { message: "No encontramos ese turno." };

  const startsAt = parseStart(formData, organization.timezone);
  if (!startsAt) return { message: "Elegí un día y un horario." };

  const result = await rescheduleAppointment({
    organization,
    appointmentId,
    startsAt,
    actor: "professional",
    // Un profesional conserva su agenda: no puede pasarse el turno a otro.
    professional: restrictedProfessionalId ? undefined : String(formData.get("professionalId") ?? "") || undefined,
    actorUserId: access.context.user.id,
  });
  if (!result.ok) return { message: result.message };

  revalidateAgenda();
  redirect(`/dashboard/turnos/${appointmentId}`);
}

export async function cancelAppointmentAction(appointmentId: string): Promise<ActionState> {
  const access = await requireScopedWrite("appointments.manage", "own.appointments.cancel");
  if (!access.ok) return { message: access.message };
  if (!(await findAppointmentFor(access.context, appointmentId))) return { message: "No encontramos ese turno." };

  const result = await cancelAppointment({
    organization: access.context.organization,
    appointmentId,
    actor: "professional",
    actorUserId: access.context.user.id,
  });
  revalidateAgenda();
  return result.ok ? { ok: true } : { message: result.message };
}

export async function setOutcomeAction(
  appointmentId: string,
  status: "confirmed" | "completed" | "no_show",
): Promise<void> {
  const access = await requireScopedWrite("appointments.manage", "own.appointments.outcome");
  if (!access.ok) return;
  if (!(await findAppointmentFor(access.context, appointmentId))) return;
  await setAppointmentOutcome({ organizationId: access.context.organization.id, appointmentId, status });
  revalidateAgenda();
}

export async function updateNotesAction(
  appointmentId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  // Las notas internas son del negocio: un profesional no las ve ni las edita.
  const access = await requireScopedWrite("appointments.manage", "appointments.manage");
  if (!access.ok) return { message: access.message };

  await db.appointment.updateMany({
    where: { id: appointmentId, organizationId: access.context.organization.id },
    data: { notes: String(formData.get("notes") ?? "").trim().slice(0, 2000) || null },
  });
  revalidatePath(`/dashboard/turnos/${appointmentId}`);
  return { ok: true, message: "Nota guardada." };
}
