/**
 * Plantillas de los avisos por WhatsApp: UNA sola definición, sin dependencias, que usan el envío real (se crean en la
 * cuenta de cada negocio y se envían con estos parámetros), la vista previa de la demo y las pruebas. Categoría
 * «utilidad» de Meta: solo lo necesario para el turno, sin promociones ni datos sensibles (ni precio, notas o motivos).
 *
 * Las respuestas rápidas son acciones del cliente sobre SU turno; reprogramar siempre pasa por la página segura del
 * turno (botón con enlace), nunca por una respuesta de chat.
 */
export type WhatsappKind = "booking_confirmation" | "reminder" | "cancellation" | "reschedule";

export const WHATSAPP_KINDS: readonly WhatsappKind[] = ["booking_confirmation", "reminder", "cancellation", "reschedule"];

export const WHATSAPP_KIND_LABEL: Record<WhatsappKind, string> = {
  booking_confirmation: "Confirmación de turno",
  reminder: "Recordatorio",
  cancellation: "Aviso de cancelación",
  reschedule: "Aviso de reprogramación",
};

export type WhatsappButton = { kind: "reply" | "link"; label: string; action: "confirm" | "cancel" | "manage" };

type ButtonDef =
  | { type: "QUICK_REPLY"; text: string; action: "confirm" | "cancel"; payloadPrefix: "c" | "x" }
  | { type: "URL"; text: string; action: "manage"; urlPath: "turno" | "negocio" };

export type TemplateDef = {
  kind: WhatsappKind;
  /** Nombre en Meta (minúsculas y guiones bajos); la versión permite crear una nueva si Meta rechaza una. */
  name: string;
  body: string;
  /** Valores de ejemplo, uno por variable, que Meta exige al crear la plantilla. */
  example: [string, string, string, string];
  buttons: ButtonDef[];
};

export const TEMPLATE_LANGUAGE = "es_AR";

const CONFIRM_BUTTONS: ButtonDef[] = [
  { type: "QUICK_REPLY", text: "Confirmo", action: "confirm", payloadPrefix: "c" },
  { type: "QUICK_REPLY", text: "Cancelar turno", action: "cancel", payloadPrefix: "x" },
  { type: "URL", text: "Reprogramar", action: "manage", urlPath: "turno" },
];

export const TEMPLATES: Record<WhatsappKind, TemplateDef> = {
  booking_confirmation: {
    kind: "booking_confirmation",
    name: "agendia_confirmacion_v1",
    body: "Hola {{1}}, tu turno en {{2}} quedó confirmado: {{3}}, {{4}}.",
    example: ["Ana", "Barbería Don Lucho", "Corte clásico con Luciano", "martes 4 de noviembre, 10:30"],
    buttons: CONFIRM_BUTTONS,
  },
  reminder: {
    kind: "reminder",
    name: "agendia_recordatorio_v1",
    body: "Hola {{1}}, te recordamos tu turno en {{2}}: {{3}}, {{4}}. ¿Venís?",
    example: ["Ana", "Barbería Don Lucho", "Corte clásico con Luciano", "martes 4 de noviembre, 10:30"],
    buttons: CONFIRM_BUTTONS,
  },
  cancellation: {
    kind: "cancellation",
    name: "agendia_cancelacion_v1",
    body: "Hola {{1}}, tu turno en {{2}} ({{3}}, {{4}}) fue cancelado. Si querés, podés reservar otro.",
    example: ["Ana", "Barbería Don Lucho", "Corte clásico", "martes 4 de noviembre, 10:30"],
    buttons: [{ type: "URL", text: "Reservar de nuevo", action: "manage", urlPath: "negocio" }],
  },
  reschedule: {
    kind: "reschedule",
    name: "agendia_reprogramacion_v1",
    body: "Hola {{1}}, tu turno en {{2}} cambió de horario: {{3}}, {{4}}.",
    example: ["Ana", "Barbería Don Lucho", "Corte clásico con Luciano", "miércoles 5 de noviembre, 11:00"],
    buttons: [
      { type: "QUICK_REPLY", text: "Confirmo", action: "confirm", payloadPrefix: "c" },
      { type: "URL", text: "Ver mi turno", action: "manage", urlPath: "turno" },
    ],
  },
};

export type WhatsappMessageInput = {
  customerFirstName: string;
  organizationName: string;
  serviceName: string;
  /** Ya formateado en la zona horaria del negocio. */
  when: string;
  professionalName?: string | null;
};

export type WhatsappMessage = { kind: WhatsappKind; body: string; buttons: WhatsappButton[] };

/** Meta no admite saltos de línea, tabulaciones ni más de 4 espacios seguidos dentro de una variable. */
export function cleanVariable(value: string, max: number): string {
  const text = value.replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim();
  return (text.length > max ? `${text.slice(0, max - 1)}…` : text) || "-";
}

/** Los cuatro valores de las variables {{1}}…{{4}}, ya limpios. El profesional se suma al servicio (solo en equipos). */
export function templateVariables(input: WhatsappMessageInput): [string, string, string, string] {
  const service = input.professionalName ? `${input.serviceName} con ${input.professionalName}` : input.serviceName;
  return [cleanVariable(input.customerFirstName, 40), cleanVariable(input.organizationName, 60), cleanVariable(service, 80), cleanVariable(input.when, 60)];
}

export function fillBody(body: string, values: readonly string[]): string {
  return body.replace(/\{\{(\d)\}\}/g, (_match, index: string) => values[Number(index) - 1] ?? "");
}

export function renderWhatsappMessage(kind: WhatsappKind, input: WhatsappMessageInput): WhatsappMessage {
  const definition = TEMPLATES[kind];
  return {
    kind,
    body: fillBody(definition.body, templateVariables(input)),
    buttons: definition.buttons.map((button) => ({ kind: button.type === "URL" ? "link" : "reply", label: button.text, action: button.action })),
  };
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

/** Definición de la plantilla tal como se crea en Meta (`POST /{waba}/message_templates`). */
export function metaTemplateDefinition(kind: WhatsappKind, appUrl: string, language: string = TEMPLATE_LANGUAGE): Record<string, unknown> {
  const definition = TEMPLATES[kind];
  const origin = appUrl.replace(/\/$/, "");
  return {
    name: definition.name,
    category: "UTILITY",
    language,
    parameter_format: "positional",
    components: [
      { type: "BODY", text: definition.body, example: { body_text: [definition.example] } },
      {
        type: "BUTTONS",
        buttons: definition.buttons.map((button) =>
          button.type === "QUICK_REPLY"
            ? { type: "QUICK_REPLY", text: button.text }
            : {
                type: "URL",
                text: button.text,
                // «turno»: /turno/<token del turno>. «negocio»: /<enlace de la página del negocio>.
                url: button.urlPath === "turno" ? `${origin}/turno/{{1}}` : `${origin}/{{1}}`,
                example: [button.urlPath === "turno" ? `${origin}/turno/ejemplo` : `${origin}/ejemplo`],
              },
        ),
      },
    ],
  };
}

/**
 * Componentes con los valores reales para enviar una plantilla ya aprobada: las cuatro variables del cuerpo y, por cada
 * botón, su payload (respuestas rápidas) o el sufijo del enlace.
 * - Respuestas rápidas: `c:<token>` confirma, `x:<token>` pide cancelar (se confirma con un segundo paso).
 * - Enlace «turno»: sufijo = token del turno. Enlace «negocio»: sufijo = el enlace de la página del negocio.
 */
export function templateComponents(kind: WhatsappKind, input: WhatsappMessageInput, ids: { appointmentToken: string; organizationSlug: string }) {
  const definition = TEMPLATES[kind];
  const components: Array<{ type: "body" | "button"; sub_type?: "quick_reply" | "url"; index?: string; parameters: Array<{ type: "text"; text: string } | { type: "payload"; payload: string }> }> = [
    { type: "body", parameters: templateVariables(input).map((text) => ({ type: "text" as const, text })) },
  ];
  definition.buttons.forEach((button, index) => {
    if (button.type === "QUICK_REPLY") {
      components.push({ type: "button", sub_type: "quick_reply", index: String(index), parameters: [{ type: "payload", payload: `${button.payloadPrefix}:${ids.appointmentToken}` }] });
    } else {
      components.push({ type: "button", sub_type: "url", index: String(index), parameters: [{ type: "text", text: button.urlPath === "turno" ? ids.appointmentToken : ids.organizationSlug }] });
    }
  });
  return components;
}
