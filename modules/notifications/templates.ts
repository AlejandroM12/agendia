import type { NotificationType } from "@prisma/client";
import { brand } from "@/lib/brand";
import { resolveTheme } from "@/lib/theme";
import { formatDateTime, formatDuration } from "@/lib/time";

export type AppointmentEmailContext = {
  organizationName: string;
  organizationPhone: string | null;
  organizationAddress: string | null;
  timezone: string;
  customerName: string;
  serviceName: string;
  durationMinutes: number;
  startsAt: Date;
  manageUrl: string;
  dashboardUrl: string;
  /** Color principal de la página pública del negocio (hexadecimal validado). */
  organizationColor?: string;
  /** Quién atiende. Solo se informa en negocios con varios profesionales. */
  professionalName?: string | null;
  /** Reprogramación que cambió al profesional: quién atendía antes. */
  previousProfessionalName?: string | null;
};

type Rendered = { subject: string; html: string; text: string };

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Estructura común: texto plano + HTML sobrio que funciona en cualquier cliente.
 *
 * Con `business`, el mensaje lleva el nombre del negocio como encabezado y
 * su color en el botón. Es lo único personalizable: el color pasa por
 * `resolveTheme` (solo hexadecimales, con texto legible calculado) y el
 * nombre se escapa como cualquier otro texto. No se admite HTML del negocio.
 */
export function renderEmail(params: {
  business?: { name: string; primary: string };
  heading: string;
  paragraphs: string[];
  details?: Array<[label: string, value: string]>;
  action?: { label: string; url: string };
  footer?: string;
}): { html: string; text: string } {
  const { business, heading, paragraphs, details = [], action, footer } = params;
  const theme = business ? resolveTheme({ primary: business.primary }) : null;
  const button = theme ? { bg: theme.primary, fg: theme.primaryForeground } : { bg: "#1f4d3f", fg: "#fbf9f5" };

  const text = [
    ...(business ? [business.name, ""] : []),
    heading,
    "",
    ...paragraphs,
    ...(details.length ? ["", ...details.map(([label, value]) => `${label}: ${value}`)] : []),
    ...(action ? ["", `${action.label}: ${action.url}`] : []),
    "",
    footer ?? `Enviado con ${brand.name}.`,
  ].join("\n");

  const detailRows = details
    .map(
      ([label, value]) =>
        `<tr><td style="padding:6px 16px 6px 0;color:#6b645a;font-size:14px;white-space:nowrap;vertical-align:top">${escapeHtml(label)}</td><td style="padding:6px 0;color:#1d1b18;font-size:14px;font-weight:600">${escapeHtml(value)}</td></tr>`,
    )
    .join("");

  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#faf7f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf7f2;padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e3dbcd;border-radius:14px;padding:28px">
<tr><td>
${business && theme ? `<p style="margin:0 0 18px;padding:0 0 14px;border-bottom:3px solid ${theme.primary};font-size:16px;font-weight:700;letter-spacing:.01em;color:#1d1b18">${escapeHtml(business.name)}</p>` : ""}
<h1 style="margin:0 0 14px;font-family:Georgia,'Times New Roman',serif;font-size:22px;line-height:1.3;color:#1d1b18">${escapeHtml(heading)}</h1>
${paragraphs.map((p) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.55;color:#1d1b18">${escapeHtml(p)}</p>`).join("")}
${detailRows ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:10px 0 6px;border-top:1px solid #e3dbcd;padding-top:10px;width:100%">${detailRows}</table>` : ""}
${action ? `<p style="margin:22px 0 4px"><a href="${escapeHtml(action.url)}" style="display:inline-block;background:${button.bg};color:${button.fg};text-decoration:none;font-size:15px;font-weight:600;padding:12px 20px;border-radius:10px">${escapeHtml(action.label)}</a></p>` : ""}
</td></tr></table>
<p style="margin:16px 0 0;font-size:12px;color:#6b645a">${escapeHtml(footer ?? `Enviado con ${brand.name}.`)}</p>
</td></tr></table></body></html>`;

  return { html, text };
}

export function renderAppointmentEmail(type: NotificationType, ctx: AppointmentEmailContext): Rendered {
  const when = formatDateTime(ctx.startsAt, ctx.timezone);
  const details: Array<[string, string]> = [
    ["Servicio", `${ctx.serviceName} (${formatDuration(ctx.durationMinutes)})`],
    ["Cuándo", when],
  ];
  if (ctx.professionalName) details.splice(1, 0, ["Profesional", ctx.professionalName]);
  if (ctx.organizationAddress) details.push(["Dónde", ctx.organizationAddress]);
  if (ctx.organizationPhone) details.push(["Contacto", ctx.organizationPhone]);

  const ownerDetails: Array<[string, string]> = [
    ["Cliente", ctx.customerName],
    ["Servicio", `${ctx.serviceName} (${formatDuration(ctx.durationMinutes)})`],
    ...(ctx.professionalName ? ([["Profesional", ctx.professionalName]] as Array<[string, string]>) : []),
    ["Cuándo", when],
  ];

  const business = { name: ctx.organizationName, primary: ctx.organizationColor ?? "#1f4d3f" };
  const customerFooter = `Recibís este mensaje porque tenés un turno en ${ctx.organizationName}. Enviado con ${brand.name}.`;
  const manage = { label: "Ver, reprogramar o cancelar", url: ctx.manageUrl };

  switch (type) {
    case "booking_confirmation":
      return {
        subject: `Turno confirmado en ${ctx.organizationName} — ${when}`,
        ...renderEmail({
          business,
          heading: "Tu turno está confirmado",
          paragraphs: [`Hola ${ctx.customerName}, te esperamos en ${ctx.organizationName}.`],
          details,
          action: manage,
          footer: customerFooter,
        }),
      };
    case "reminder":
      return {
        subject: `Recordatorio: tu turno en ${ctx.organizationName} — ${when}`,
        ...renderEmail({
          business,
          heading: "Te recordamos tu turno",
          paragraphs: [`Hola ${ctx.customerName}, este es un recordatorio de tu turno en ${ctx.organizationName}.`],
          details,
          action: manage,
          footer: customerFooter,
        }),
      };
    case "reschedule":
      return {
        subject: ctx.previousProfessionalName
          ? `Tu turno en ${ctx.organizationName} cambió de horario y de profesional — ${when}`
          : `Tu turno en ${ctx.organizationName} cambió de horario — ${when}`,
        ...renderEmail({
          business,
          heading: "Tu turno fue reprogramado",
          paragraphs: [
            `Hola ${ctx.customerName}, este es el nuevo horario de tu turno en ${ctx.organizationName}.`,
            ...(ctx.previousProfessionalName && ctx.professionalName
              ? [`Con este horario, cambia quién te atiende: antes era ${ctx.previousProfessionalName} y ahora te atiende ${ctx.professionalName}.`]
              : []),
          ],
          details,
          action: manage,
          footer: customerFooter,
        }),
      };
    case "professional_change":
      return {
        subject: `Cambió el profesional de tu turno en ${ctx.organizationName} — ${when}`,
        ...renderEmail({
          business,
          heading: "Cambió quién te atiende",
          paragraphs: [
            ctx.professionalName
              ? `Hola ${ctx.customerName}, tu turno en ${ctx.organizationName} sigue en el mismo día y horario, pero ahora te va a atender ${ctx.professionalName}.`
              : `Hola ${ctx.customerName}, tu turno en ${ctx.organizationName} sigue en el mismo día y horario, pero cambió el profesional que te va a atender.`,
          ],
          details,
          action: manage,
          footer: customerFooter,
        }),
      };
    case "cancellation":
      return {
        subject: `Turno cancelado en ${ctx.organizationName}`,
        ...renderEmail({
          business,
          heading: "Tu turno fue cancelado",
          paragraphs: [
            `Hola ${ctx.customerName}, el siguiente turno en ${ctx.organizationName} quedó cancelado.`,
          ],
          details,
          footer: customerFooter,
        }),
      };
    case "booking_received_owner":
      return {
        subject: `Nueva reserva: ${ctx.customerName} — ${when}`,
        ...renderEmail({
          heading: "Recibiste una nueva reserva",
          paragraphs: ["Un cliente reservó desde tu página pública."],
          details: ownerDetails,
          action: { label: "Abrir mi agenda", url: ctx.dashboardUrl },
        }),
      };
    case "cancellation_owner":
      return {
        subject: `Turno cancelado por el cliente: ${ctx.customerName} — ${when}`,
        ...renderEmail({
          heading: "Un cliente canceló su turno",
          paragraphs: ["El horario volvió a quedar disponible en tu agenda."],
          details: ownerDetails,
          action: { label: "Abrir mi agenda", url: ctx.dashboardUrl },
        }),
      };
    case "reschedule_owner":
      return {
        subject: `Turno reprogramado por el cliente: ${ctx.customerName} — ${when}`,
        ...renderEmail({
          heading: "Un cliente reprogramó su turno",
          paragraphs: ["Este es el nuevo horario."],
          details: ownerDetails,
          action: { label: "Abrir mi agenda", url: ctx.dashboardUrl },
        }),
      };
  }
}
