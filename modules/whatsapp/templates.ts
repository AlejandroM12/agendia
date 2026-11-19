/**
 * Textos de los avisos por WhatsApp, en un solo lugar y sin dependencias: los usa hoy la vista previa de la demo
 * y los usará el envío real, que necesita las MISMAS plantillas aprobadas por Meta (categoría «utilidad»).
 * No llevan promociones ni datos sensibles: solo lo necesario para el turno, que es lo que exige la política.
 *
 * Los botones de respuesta rápida son acciones del cliente sobre SU turno; reprogramar siempre pasa por la página
 * segura del turno (enlace), nunca por una respuesta de chat.
 */
export type WhatsappKind = "booking_confirmation" | "reminder" | "cancellation" | "reschedule";

export type WhatsappButton = { kind: "reply" | "link"; label: string; action: "confirm" | "cancel" | "manage" };

export type WhatsappMessageInput = {
  customerFirstName: string;
  organizationName: string;
  serviceName: string;
  /** Ya formateados en la zona horaria del negocio. */
  when: string;
  professionalName?: string | null;
};

export type WhatsappMessage = { kind: WhatsappKind; body: string; buttons: WhatsappButton[] };

export const WHATSAPP_KINDS: readonly WhatsappKind[] = ["booking_confirmation", "reminder", "cancellation", "reschedule"];

export const WHATSAPP_KIND_LABEL: Record<WhatsappKind, string> = {
  booking_confirmation: "Confirmación de turno",
  reminder: "Recordatorio",
  cancellation: "Aviso de cancelación",
  reschedule: "Aviso de reprogramación",
};

const with_ = (professional?: string | null) => (professional ? ` con ${professional}` : "");

export function renderWhatsappMessage(kind: WhatsappKind, input: WhatsappMessageInput): WhatsappMessage {
  const { customerFirstName: name, organizationName: business, serviceName: service, when, professionalName } = input;
  switch (kind) {
    case "booking_confirmation":
      return {
        kind,
        body: `Hola ${name}, tu turno en ${business} quedó confirmado: ${service}${with_(professionalName)}, ${when}.`,
        buttons: [
          { kind: "reply", label: "Confirmo", action: "confirm" },
          { kind: "reply", label: "Cancelar turno", action: "cancel" },
          { kind: "link", label: "Reprogramar", action: "manage" },
        ],
      };
    case "reminder":
      return {
        kind,
        body: `Hola ${name}, te recordamos tu turno en ${business}: ${service}${with_(professionalName)}, ${when}. ¿Venís?`,
        buttons: [
          { kind: "reply", label: "Confirmo", action: "confirm" },
          { kind: "reply", label: "Cancelar turno", action: "cancel" },
          { kind: "link", label: "Reprogramar", action: "manage" },
        ],
      };
    case "cancellation":
      return {
        kind,
        body: `Hola ${name}, tu turno en ${business} (${service}, ${when}) fue cancelado. Si querés, podés reservar otro.`,
        buttons: [{ kind: "link", label: "Reservar de nuevo", action: "manage" }],
      };
    case "reschedule":
      return {
        kind,
        body: `Hola ${name}, tu turno en ${business} cambió de horario: ${service}${with_(professionalName)}, ${when}.`,
        buttons: [
          { kind: "reply", label: "Confirmo", action: "confirm" },
          { kind: "link", label: "Ver mi turno", action: "manage" },
        ],
      };
  }
}

/** De un tipo de notificación a la plantilla que le corresponde (los avisos internos no van por WhatsApp). */
export function whatsappKindOf(type: string): WhatsappKind | null {
  switch (type) {
    case "booking_confirmation":
      return "booking_confirmation";
    case "reminder":
      return "reminder";
    case "cancellation":
      return "cancellation";
    case "reschedule":
    case "professional_change":
      return "reschedule";
    default:
      return null;
  }
}
