import { addDays, formatDateLong, formatTime, todayInTz, toZoned } from "@/lib/time";

/**
 * WhatsApp manual: textos preparados para que el negocio los revise y los
 * envíe desde su propio WhatsApp (enlaces wa.me). Agendia no envía nada:
 * abrir el chat no es un envío, no se registra como enviado y no hay estados
 * de entrega ni de lectura.
 *
 * Funciones puras, sin acceso a la base de datos ni a la red: reciben todo
 * lo que necesitan y devuelven texto. Nunca incluyen notas internas,
 * motivos de consulta ni datos clínicos: el único dato del turno que puede
 * revelar algo es el servicio, y por defecto no se incluye. La versión
 * `discreet` tampoco nombra al profesional.
 */

export type WhatsAppKind = "contact" | "confirmation" | "reminder" | "reschedule" | "cancellation";

export const WHATSAPP_KIND_LABEL: Record<WhatsAppKind, string> = {
  contact: "Escribir un mensaje",
  confirmation: "Enviar confirmación",
  reminder: "Enviar recordatorio",
  reschedule: "Avisar el cambio de horario",
  cancellation: "Avisar la cancelación",
};

export type MessageInput = {
  customerName: string;
  businessName: string;
  businessPhone?: string | null;
  timeZone: string;
  /** Instante del turno. */
  startsAt: Date;
  /** Profesional asignado; solo se pasa si el negocio trabaja con varios. */
  professionalName?: string | null;
  /** Enlace del cliente para ver, reprogramar o cancelar su turno. */
  manageUrl: string;
  /** Página pública del negocio, para reservar de nuevo. */
  publicUrl: string;
  /** Sin profesional ni datos de contacto: solo lo imprescindible. */
  discreet?: boolean;
  /** Para decir «hoy» o «mañana» en lugar de la fecha completa. */
  now?: Date;
};

/** Primer nombre, para saludar de forma natural («Hola, Nicolás.»). */
export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? "";
}

function whenParts(input: MessageInput) {
  const now = input.now ?? new Date();
  const today = todayInTz(input.timeZone, now);
  const { dateStr } = toZoned(input.startsAt, input.timeZone);
  const longDate = formatDateLong(dateStr);
  const [, m, d] = dateStr.split("-").map(Number);
  const months = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  return {
    /** «hoy», «mañana» o «el viernes 20 de noviembre». */
    relative: dateStr === today ? "hoy" : dateStr === addDays(today, 1) ? "mañana" : `el ${longDate}`,
    /** «20 de noviembre» */
    day: `${d} de ${months[m - 1]}`,
    time: `${formatTime(input.startsAt, input.timeZone)} hs`,
    longDate,
  };
}

function detailLines(input: MessageInput): string[] {
  const when = whenParts(input);
  const lines = [`Fecha: ${when.day}.`, `Horario: ${when.time}.`];
  if (input.professionalName && !input.discreet) lines.push(`Profesional: ${input.professionalName}.`);
  return lines;
}

function contactLine(input: MessageInput): string[] {
  return input.businessPhone && !input.discreet ? [`Si necesitás algo, podés escribirnos o llamarnos al ${input.businessPhone}.`] : [];
}

export function buildWhatsAppMessage(kind: WhatsAppKind, input: MessageInput): string {
  const name = firstName(input.customerName);
  const greeting = name ? `Hola, ${name}.` : "Hola.";
  const when = whenParts(input);

  switch (kind) {
    case "contact":
      return [`${greeting} Te escribimos de ${input.businessName} por tu turno ${when.relative} a las ${when.time}.`].join("\n");

    case "confirmation":
      return [
        `${greeting} Tu turno en ${input.businessName} quedó confirmado.`,
        "",
        ...detailLines(input),
        "",
        "Podés consultarlo o gestionarlo desde el siguiente enlace:",
        "",
        input.manageUrl,
        ...(contactLine(input).length ? ["", ...contactLine(input)] : []),
        "",
        "¡Te esperamos!",
      ].join("\n");

    case "reminder":
      return [
        `${greeting} Te recordamos que ${when.relative} tenés un turno en ${input.businessName}.`,
        "",
        ...detailLines(input),
        "",
        "Podés consultar o gestionar tu turno desde el siguiente enlace:",
        "",
        input.manageUrl,
        ...(contactLine(input).length ? ["", ...contactLine(input)] : []),
        "",
        "¡Te esperamos!",
      ].join("\n");

    case "reschedule":
      return [
        `${greeting} Te escribimos de ${input.businessName} para avisarte que tu turno cambió. Estos son los datos nuevos:`,
        "",
        ...detailLines(input),
        "",
        "Podés consultarlo o gestionarlo desde el siguiente enlace:",
        "",
        input.manageUrl,
        ...(contactLine(input).length ? ["", ...contactLine(input)] : []),
        "",
        "Disculpá las molestias.",
      ].join("\n");

    case "cancellation":
      return [
        `${greeting} Te escribimos de ${input.businessName} para avisarte que tu turno ${when.relative} a las ${when.time} fue cancelado.`,
        "",
        "Si querés reservar otro, podés hacerlo desde nuestra página:",
        "",
        input.publicUrl,
        ...(contactLine(input).length ? ["", ...contactLine(input)] : []),
        "",
        "Disculpá las molestias.",
      ].join("\n");
  }
}

/**
 * Qué mensajes tiene sentido ofrecer según el estado del turno. La
 * cancelación solo en turnos cancelados; confirmación, recordatorio y aviso
 * de cambio, solo en turnos confirmados que todavía no pasaron.
 */
export function availableKinds(appointment: { status: string; startsAt: Date }, now: Date = new Date()): WhatsAppKind[] {
  const upcoming = appointment.startsAt.getTime() > now.getTime();
  if (appointment.status === "canceled") return upcoming ? ["contact", "cancellation"] : ["contact"];
  if (appointment.status === "confirmed" && upcoming) return ["confirmation", "reminder", "reschedule", "contact"];
  return ["contact"];
}
