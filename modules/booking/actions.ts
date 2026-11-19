"use server";

import { createHash } from "node:crypto";
import { after } from "next/server";
import { z } from "zod";
import type { Organization } from "@prisma/client";
import { db } from "@/lib/db";
import { canPerformWriteActions } from "@/lib/organization-access";
import { clientIp, rateLimit, TOO_MANY_ATTEMPTS } from "@/lib/rate-limit";
import { addDays, formatTime, isValidDateStr, todayInTz } from "@/lib/time";
import { cancelAppointment, createAppointment, rescheduleAppointment } from "@/modules/appointments/service";
import { getTeamAvailability, unionSlots } from "@/modules/availability/queries";
import { bookingContactSchema } from "@/modules/customers/schema";
import { isEmailConfigured } from "@/modules/notifications/email";
import { normalizeLookupEmail, requestAppointmentsLink } from "@/modules/public-page/lookup";
import { resolvePublicSlug } from "@/modules/public-page/slug";
import { resolveEligibleProfessionals, usesTeam, type ProfessionalChoice } from "@/modules/team/eligibility";

/**
 * Acciones de la página pública de reservas. No hay sesión: todo se valida
 * desde cero en el servidor (negocio por slug, servicio activo, horario
 * realmente ofrecido) y se limita por IP para frenar abusos.
 */

export type PublicDay = { dateStr: string; slots: Array<{ iso: string; label: string }> };
export type PublicAvailability = { ok: true; days: PublicDay[]; hasMore: boolean } | { ok: false; message: string };

const WINDOW_DAYS = 14;
const NOT_BOOKABLE = "Este negocio no está tomando reservas online en este momento. Comunicate directamente.";

async function findBookableOrganization(slug: string): Promise<Organization | null> {
  const organization = await db.organization.findUnique({ where: { slug } });
  if (!organization || !organization.onboardingCompletedAt) return null;
  return canPerformWriteActions(organization) ? organization : null;
}

/**
 * Elección de profesional que llega del navegador: un identificador, «any» o
 * nada. Es un dato no confiable: acá solo se normaliza; la validación real
 * (activo, de esta organización, que realice el servicio, que acepte reservas
 * online) la hace `resolveEligibleProfessionals`.
 */
function parseChoice(value: unknown): ProfessionalChoice {
  if (typeof value !== "string" || value === "") return undefined;
  return value === "any" ? "any" : value.slice(0, 64);
}

async function availabilityFor(
  organization: Organization,
  durationMinutes: number,
  fromDateStr: string | undefined,
  professionalIds: string[],
  ignoreAppointmentId?: string,
): Promise<PublicAvailability> {
  const today = todayInTz(organization.timezone);
  const lastDay = addDays(today, organization.maxAdvanceDays);
  const from = isValidDateStr(fromDateStr) && fromDateStr >= today && fromDateStr <= lastDay ? fromDateStr : today;

  const days = unionSlots(
    await getTeamAvailability({
      organization,
      professionalIds,
      durationMinutes,
      fromDateStr: from,
      days: WINDOW_DAYS,
      ignoreAppointmentId,
    }),
  );

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
  professionalId?: string,
): Promise<PublicAvailability> {
  const ip = await clientIp();
  if (!(await rateLimit(`availability:${ip}`, 120, 60)).allowed) return { ok: false, message: TOO_MANY_ATTEMPTS };

  const organization = await findBookableOrganization(String(slug));
  if (!organization) return { ok: false, message: "Este negocio no está recibiendo reservas online." };

  const service = await db.service.findFirst({
    where: { id: String(serviceId), organizationId: organization.id, active: true },
    select: { id: true, durationMinutes: true },
  });
  if (!service) return { ok: false, message: "El servicio ya no está disponible." };

  const eligible = await resolveEligibleProfessionals(db, {
    organization,
    serviceId: service.id,
    audience: "public",
    choice: parseChoice(professionalId),
  });
  if (!eligible.ok) return { ok: false, message: "Ese profesional no está disponible para este servicio." };

  return availabilityFor(
    organization,
    service.durationMinutes,
    fromDateStr,
    eligible.professionals.map((p) => p.id),
  );
}

const bookingSchema = z.object({
  slug: z.string().min(1).max(80),
  serviceId: z.string().min(1).max(80),
  slot: z.iso.datetime(),
});

export type BookingState =
  | {
      ok: true;
      manageToken: string;
      startsAt: string;
      /** Quién atiende, ya asignado. Solo en negocios con varios profesionales. */
      professionalName?: string | null;
      message?: undefined;
      errors?: undefined;
    }
  | {
      ok: false;
      message: string;
      /** Errores por campo (name, email, phone): la página los muestra debajo de cada uno. */
      errors?: Record<string, string[] | undefined>;
      /** El horario ya no está disponible: hay que elegir otro (los datos del cliente se conservan). */
      refresh?: boolean;
    }
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

  // El mismo esquema con el que la página valida antes de enviar.
  const customer = bookingContactSchema.safeParse({
    name: formData.get("name") ?? "",
    email: formData.get("email") ?? "",
    phone: formData.get("phone") ?? "",
  });
  if (!customer.success) {
    return { ok: false, message: "Revisá los datos marcados.", errors: z.flattenError(customer.error).fieldErrors };
  }

  const organization = await findBookableOrganization(base.data.slug);
  if (!organization) return { ok: false, message: "Este negocio no está recibiendo reservas online." };

  const result = await createAppointment({
    organization,
    serviceId: base.data.serviceId,
    startsAt: new Date(base.data.slot),
    customer: { name: customer.data.name, email: customer.data.email, phone: customer.data.phone },
    actor: "customer",
    professional: parseChoice(formData.get("professionalId")),
    // Un reintento o doble envío del mismo formulario no crea un segundo turno.
    idempotencyKey: typeof formData.get("idempotencyKey") === "string" ? String(formData.get("idempotencyKey")) : null,
  });

  if (!result.ok) return { ok: false, message: result.message, refresh: true };
  return {
    ok: true,
    manageToken: result.appointment.manageToken,
    startsAt: result.appointment.startsAt.toISOString(),
    professionalName: await assignedProfessionalName(organization, result.appointment.professionalId),
  };
}

/** Nombre del profesional asignado, solo si el negocio trabaja con varios (con uno solo no se menciona). */
async function assignedProfessionalName(organization: Organization, professionalId: string): Promise<string | null> {
  if (!(await usesTeam(db, organization))) return null;
  const professional = await db.professional.findFirst({
    where: { id: professionalId, organizationId: organization.id },
    select: { displayName: true },
  });
  return professional?.displayName ?? null;
}

async function findByToken(token: string) {
  if (typeof token !== "string" || token.length < 20 || token.length > 100) return null;
  return db.appointment.findUnique({ where: { manageToken: token }, include: { organization: true } });
}

export type ManageState =
  | {
      ok: true;
      /** Tras reprogramar: quién atiende ahora, y si cambió respecto del turno anterior. */
      professionalName?: string | null;
      professionalChanged?: boolean;
    }
  | { ok: false; message: string }
  | undefined;

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

/**
 * «Confirmo que voy»: el cliente confirma su asistencia con el enlace de su turno. No cambia el estado del turno ni
 * mueve nada: solo deja registrada la confirmación (`attendanceConfirmedAt`) para que el negocio la vea.
 */
export async function confirmAttendanceByTokenAction(token: string): Promise<ManageState> {
  const ip = await clientIp();
  if (!(await rateLimit(`manage:${ip}`, 30, 3600)).allowed) return { ok: false, message: TOO_MANY_ATTEMPTS };

  const appointment = await findByToken(token);
  if (!appointment) return { ok: false, message: "No encontramos ese turno." };
  if (appointment.status !== "confirmed" || appointment.startsAt <= new Date()) {
    return { ok: false, message: "Este turno ya no se puede confirmar." };
  }
  if (!appointment.attendanceConfirmedAt) {
    await db.appointment.update({ where: { id: appointment.id }, data: { attendanceConfirmedAt: new Date() } });
  }
  return { ok: true };
}

export async function getRescheduleAvailabilityAction(token: string, fromDateStr?: string): Promise<PublicAvailability> {
  const ip = await clientIp();
  if (!(await rateLimit(`availability:${ip}`, 120, 60)).allowed) return { ok: false, message: TOO_MANY_ATTEMPTS };

  const appointment = await findByToken(token);
  if (!appointment || appointment.status !== "confirmed") return { ok: false, message: "No encontramos ese turno." };
  if (!canPerformWriteActions(appointment.organization)) return { ok: false, message: NOT_BOOKABLE };

  const duration = Math.round((appointment.endsAt.getTime() - appointment.startsAt.getTime()) / 60000);
  // El cliente que eligió un profesional conserva ese profesional; con «cualquiera», todos los elegibles.
  const eligible = await resolveEligibleProfessionals(db, {
    organization: appointment.organization,
    serviceId: appointment.serviceId,
    audience: "public",
    choice: appointment.professionalSelection === "any" ? "any" : (appointment.requestedProfessionalId ?? appointment.professionalId),
    purpose: "reschedule",
  });
  if (!eligible.ok) {
    // Eligió a alguien que ya no atiende este servicio online: no se lo cambia por otro.
    const phone = appointment.organization.phone;
    return {
      ok: false,
      message: `El profesional de tu turno ya no está disponible para reprogramar online.${phone ? ` Comunicate con el negocio al ${phone}.` : " Comunicate con el negocio."}`,
    };
  }
  return availabilityFor(
    appointment.organization,
    duration,
    fromDateStr,
    eligible.professionals.map((p) => p.id),
    appointment.id,
  );
}

export async function rescheduleByTokenAction(token: string, slotIso: string): Promise<ManageState> {
  const ip = await clientIp();
  if (!(await rateLimit(`manage:${ip}`, 30, 3600)).allowed) return { ok: false, message: TOO_MANY_ATTEMPTS };

  const appointment = await findByToken(token);
  if (!appointment) return { ok: false, message: "No encontramos ese turno." };
  // Cancelar siempre se puede; mover el turno a otro horario es una reserva
  // nueva, y una cuenta en solo lectura no toma reservas.
  if (!canPerformWriteActions(appointment.organization)) return { ok: false, message: NOT_BOOKABLE };

  const startsAt = new Date(String(slotIso));
  const result = await rescheduleAppointment({
    organization: appointment.organization,
    appointmentId: appointment.id,
    startsAt,
    actor: "customer",
  });
  if (!result.ok) return { ok: false, message: result.message };
  return {
    ok: true,
    professionalName: await assignedProfessionalName(appointment.organization, result.appointment.professionalId),
    professionalChanged: Boolean(result.previousProfessionalId),
  };
}

export type LookupState = { ok: true; message: string; devLink?: string } | { ok: false; message: string } | undefined;

/** La misma respuesta exista o no el email: no revela quién es cliente del negocio. */
const LOOKUP_SENT = "Si ese email tiene turnos en este negocio, te enviamos un enlace para verlos. Revisá tu casilla (y el correo no deseado).";

/**
 * «Consultá tus turnos»: envía al email indicado un enlace temporal para
 * ver sus reservas en este negocio. Nunca muestra turnos ni confirma si el
 * email existe: el acceso se demuestra abriendo el enlace.
 */
export async function requestAppointmentsLinkAction(_prev: LookupState, formData: FormData): Promise<LookupState> {
  if (String(formData.get("website") ?? "") !== "") return { ok: true, message: LOOKUP_SENT };

  const ip = await clientIp();
  if (!(await rateLimit(`lookup:ip:${ip}`, 8, 3600)).allowed) return { ok: false, message: TOO_MANY_ATTEMPTS };

  const email = z.email().safeParse(normalizeLookupEmail(String(formData.get("email") ?? "")));
  if (!email.success) return { ok: false, message: "Ingresá un email válido." };

  const resolution = await resolvePublicSlug(String(formData.get("slug") ?? ""));
  if (!resolution || resolution.kind !== "organization") return { ok: false, message: "No encontramos este negocio." };
  const { organization } = resolution;

  // Tope por casilla: nadie puede llenarle el correo a otra persona. Al
  // superarlo se responde igual, sin enviar nada.
  const emailKey = createHash("sha256").update(email.data).digest("hex").slice(0, 32);
  if (!(await rateLimit(`lookup:email:${organization.id}:${emailKey}`, 3, 3600)).allowed) {
    return { ok: true, message: LOOKUP_SENT };
  }

  if (isEmailConfigured()) {
    // El envío ocurre después de responder: el tiempo de respuesta tampoco
    // delata si el email tiene turnos.
    after(() =>
      requestAppointmentsLink(organization, email.data).catch((error) =>
        console.error("[lookup] error al emitir el enlace de consulta", error),
      ),
    );
    return { ok: true, message: LOOKUP_SENT };
  }

  if (process.env.NODE_ENV === "production") {
    return { ok: false, message: "La consulta por email no está disponible en este momento. Comunicate con el negocio." };
  }
  const result = await requestAppointmentsLink(organization, email.data);
  return { ok: true, message: LOOKUP_SENT, devLink: result.devLink };
}
