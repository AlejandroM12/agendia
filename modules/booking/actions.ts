"use server";

import { z } from "zod";
import type { Organization } from "@prisma/client";
import { db } from "@/lib/db";
import { canPerformWriteActions } from "@/lib/organization-access";
import { clientIp, rateLimit, TOO_MANY_ATTEMPTS } from "@/lib/rate-limit";
import { addDays, formatTime, isValidDateStr, todayInTz } from "@/lib/time";
import { cancelAppointment, createAppointment, rescheduleAppointment } from "@/modules/appointments/service";
import { getAvailability } from "@/modules/availability/queries";
import { customerInputSchema } from "@/modules/customers/service";

/**
 * Acciones de la página pública de reservas. No hay sesión: todo se valida
 * desde cero en el servidor (negocio por slug, servicio activo, horario
 * realmente ofrecido) y se limita por IP para frenar abusos.
 */

export type PublicDay = { dateStr: string; slots: Array<{ iso: string; label: string }> };
export type PublicAvailability = { ok: true; days: PublicDay[]; hasMore: boolean } | { ok: false; message: string };

const WINDOW_DAYS = 14;

async function findBookableOrganization(slug: string): Promise<Organization | null> {
  const organization = await db.organization.findUnique({ where: { slug } });
  if (!organization || !organization.onboardingCompletedAt) return null;
  return canPerformWriteActions(organization) ? organization : null;
}

async function availabilityFor(
  organization: Organization,
  durationMinutes: number,
  fromDateStr: string | undefined,
  ignoreAppointmentId?: string,
): Promise<PublicAvailability> {
  const today = todayInTz(organization.timezone);
  const lastDay = addDays(today, organization.maxAdvanceDays);
  const from = isValidDateStr(fromDateStr) && fromDateStr >= today && fromDateStr <= lastDay ? fromDateStr : today;

  const days = await getAvailability({
    organization,
    durationMinutes,
    fromDateStr: from,
    days: WINDOW_DAYS,
    ignoreAppointmentId,
  });

  return {
    ok: true,
    hasMore: addDays(from, WINDOW_DAYS) <= lastDay,
    days: days
      .filter((day) => day.dateStr <= lastDay)
      .map((day) => ({
        dateStr: day.dateStr,
        slots: day.slots.map((slot) => ({ iso: slot.toISOString(), label: formatTime(slot, organization.timezone) })),
      })),
  };
}

export async function getPublicAvailabilityAction(
  slug: string,
  serviceId: string,
  fromDateStr?: string,
): Promise<PublicAvailability> {
  const ip = await clientIp();
  if (!(await rateLimit(`availability:${ip}`, 120, 60)).allowed) return { ok: false, message: TOO_MANY_ATTEMPTS };

  const organization = await findBookableOrganization(String(slug));
  if (!organization) return { ok: false, message: "Este negocio no está recibiendo reservas online." };

  const service = await db.service.findFirst({
    where: { id: String(serviceId), organizationId: organization.id, active: true },
    select: { durationMinutes: true },
  });
  if (!service) return { ok: false, message: "El servicio ya no está disponible." };

  return availabilityFor(organization, service.durationMinutes, fromDateStr);
}

const bookingSchema = z.object({
  slug: z.string().min(1).max(80),
  serviceId: z.string().min(1).max(80),
  slot: z.iso.datetime(),
});

export type BookingState =
  | { ok: true; manageToken: string; startsAt: string }
  | { ok: false; message: string; refresh?: boolean }
  | undefined;

export async function bookAppointmentAction(_prev: BookingState, formData: FormData): Promise<BookingState> {
  // Campo trampa: los humanos no lo ven; los bots suelen completarlo.
  if (String(formData.get("website") ?? "") !== "") {
    return { ok: false, message: "No pudimos procesar la reserva." };
  }

  const ip = await clientIp();
  if (!(await rateLimit(`booking:${ip}`, 10, 3600)).allowed) return { ok: false, message: TOO_MANY_ATTEMPTS };

  const base = bookingSchema.safeParse({
    slug: formData.get("slug"),
    serviceId: formData.get("serviceId"),
    slot: formData.get("slot"),
  });
  if (!base.success) return { ok: false, message: "Elegí un servicio y un horario." };

  const customer = customerInputSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email") ?? "",
    phone: formData.get("phone") ?? "",
  });
  if (!customer.success) {
    return { ok: false, message: customer.error.issues[0]?.message ?? "Revisá tus datos." };
  }
  if (!customer.data.email && !customer.data.phone) {
    return { ok: false, message: "Dejanos un email o un teléfono para poder contactarte." };
  }

  const organization = await findBookableOrganization(base.data.slug);
  if (!organization) return { ok: false, message: "Este negocio no está recibiendo reservas online." };

  const result = await createAppointment({
    organization,
    serviceId: base.data.serviceId,
    startsAt: new Date(base.data.slot),
    customer: { name: customer.data.name, email: customer.data.email, phone: customer.data.phone },
    actor: "customer",
  });

  if (!result.ok) return { ok: false, message: result.message, refresh: true };
  return { ok: true, manageToken: result.appointment.manageToken, startsAt: result.appointment.startsAt.toISOString() };
}

async function findByToken(token: string) {
  if (typeof token !== "string" || token.length < 20 || token.length > 100) return null;
  return db.appointment.findUnique({ where: { manageToken: token }, include: { organization: true } });
}

export type ManageState = { ok: true } | { ok: false; message: string } | undefined;

export async function cancelByTokenAction(token: string): Promise<ManageState> {
  const ip = await clientIp();
  if (!(await rateLimit(`manage:${ip}`, 30, 3600)).allowed) return { ok: false, message: TOO_MANY_ATTEMPTS };

  const appointment = await findByToken(token);
  if (!appointment) return { ok: false, message: "No encontramos ese turno." };

  const result = await cancelAppointment({
    organization: appointment.organization,
    appointmentId: appointment.id,
    actor: "customer",
  });
  return result.ok ? { ok: true } : { ok: false, message: result.message };
}

export async function getRescheduleAvailabilityAction(token: string, fromDateStr?: string): Promise<PublicAvailability> {
  const ip = await clientIp();
  if (!(await rateLimit(`availability:${ip}`, 120, 60)).allowed) return { ok: false, message: TOO_MANY_ATTEMPTS };

  const appointment = await findByToken(token);
  if (!appointment || appointment.status !== "confirmed") return { ok: false, message: "No encontramos ese turno." };

  const duration = Math.round((appointment.endsAt.getTime() - appointment.startsAt.getTime()) / 60000);
  return availabilityFor(appointment.organization, duration, fromDateStr, appointment.id);
}

export async function rescheduleByTokenAction(token: string, slotIso: string): Promise<ManageState> {
  const ip = await clientIp();
  if (!(await rateLimit(`manage:${ip}`, 30, 3600)).allowed) return { ok: false, message: TOO_MANY_ATTEMPTS };

  const appointment = await findByToken(token);
  if (!appointment) return { ok: false, message: "No encontramos ese turno." };

  const startsAt = new Date(String(slotIso));
  const result = await rescheduleAppointment({
    organization: appointment.organization,
    appointmentId: appointment.id,
    startsAt,
    actor: "customer",
  });
  return result.ok ? { ok: true } : { ok: false, message: result.message };
}
