import { brand } from "@/lib/brand";
import { callingCodeForTimezone, toWhatsAppNumber, whatsAppUrl } from "@/lib/phone";
import { availableKinds, buildWhatsAppMessage, WHATSAPP_KIND_LABEL, type WhatsAppKind } from "./messages";

export type WhatsAppOption = {
  kind: WhatsAppKind;
  label: string;
  /** Enlace con el mensaje completo. */
  url: string;
  /** Enlace con el mensaje discreto (sin profesional ni datos de contacto). */
  discreetUrl: string;
};

export type WhatsAppActions =
  | { status: "ok"; options: WhatsAppOption[] }
  | { status: "no_phone" }
  | { status: "invalid_phone" };

/**
 * Enlaces wa.me para un turno. Todo se arma en el servidor con los datos
 * del propio negocio; no se llama a ningún proveedor ni se guarda nada.
 */
export function buildWhatsAppActions(params: {
  organization: { name: string; slug: string; phone: string | null; timezone: string };
  appointment: { status: string; startsAt: Date; manageToken: string };
  customer: { name: string; phone: string | null };
  /** Nombre del profesional, solo si el negocio trabaja con varios. */
  professionalName?: string | null;
  now?: Date;
}): WhatsAppActions {
  const { organization, appointment, customer } = params;
  const number = toWhatsAppNumber(customer.phone, callingCodeForTimezone(organization.timezone));
  if (!number.ok) return { status: number.reason === "missing" ? "no_phone" : "invalid_phone" };

  const base = {
    customerName: customer.name,
    businessName: organization.name,
    businessPhone: organization.phone,
    timeZone: organization.timezone,
    startsAt: appointment.startsAt,
    professionalName: params.professionalName ?? null,
    manageUrl: `${brand.url}/turno/${appointment.manageToken}`,
    publicUrl: `${brand.url}/${organization.slug}`,
    now: params.now,
  };

  const options = availableKinds(appointment, params.now, Boolean(params.professionalName)).map((kind) => ({
    kind,
    label: WHATSAPP_KIND_LABEL[kind],
    url: whatsAppUrl(number.digits, buildWhatsAppMessage(kind, base)),
    discreetUrl: whatsAppUrl(number.digits, buildWhatsAppMessage(kind, { ...base, discreet: true })),
  }));
  return { status: "ok", options };
}
