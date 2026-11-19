"use server";

import { revalidatePath } from "next/cache";
import { requireContext, requireWriteContext } from "@/lib/dal";
import { recordAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { brand } from "@/lib/brand";
import type { ActionState } from "@/lib/action-state";
import { clientIp, rateLimit, TOO_MANY_ATTEMPTS } from "@/lib/rate-limit";
import { DEMO_BLOCKED_MESSAGE } from "@/modules/demo/policy";
import { isEmailConfigured, sendEmail } from "@/modules/notifications/email";
import { updateSettings } from "./service";

/**
 * Acciones del negocio sobre su integración de WhatsApp. El negocio puede: pedir la activación y elegir qué avisos
 * enviar y con cuánta anticipación. NO puede conectar ni activar la integración, ni cambiar el límite de consumo ni
 * ver credenciales: eso lo hace AtajoLab desde /admin.
 */
const escape = (value: string) => value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ?? char);

export async function requestWhatsappActivationAction(_prev: ActionState): Promise<ActionState> {
  const access = await requireWriteContext("settings.manage");
  if (!access.ok) return { message: access.message };
  const { organization, user } = access.context;
  if (organization.isDemo) return { message: DEMO_BLOCKED_MESSAGE };

  const ip = await clientIp();
  if (!(await rateLimit(`wa-request:${organization.id}`, 3, 86400)).allowed || !(await rateLimit(`wa-request-ip:${ip}`, 20, 86400)).allowed) return { message: TOO_MANY_ATTEMPTS };

  await recordAudit({ organizationId: organization.id, userId: user.id, action: "whatsapp.activation_requested", entityType: "organization", entityId: organization.id });

  const subject = `Solicitud de WhatsApp automático — ${organization.name}`;
  const text = `${organization.name} (/${organization.slug}) pidió activar el WhatsApp automático.\nContacto: ${user.name} <${user.email}>${organization.phone ? `\nTeléfono del negocio: ${organization.phone}` : ""}`;
  if (isEmailConfigured()) {
    const sent = await sendEmail({
      to: brand.contactEmail,
      subject,
      text,
      html: `<p>${escape(organization.name)} (/${escape(organization.slug)}) pidió activar el WhatsApp automático.</p><p>Contacto: ${escape(user.name)} &lt;${escape(user.email)}&gt;${organization.phone ? `<br>Teléfono del negocio: ${escape(organization.phone)}` : ""}</p>`,
    });
    if (sent.ok) {
      revalidatePath("/dashboard/configuracion/integraciones");
      return { ok: true, message: "¡Listo! Recibimos tu solicitud y te vamos a contactar para activarlo juntos." };
    }
  }
  // Sin canal de correo (o si falla): la solicitud igual quedó registrada y se le indica cómo escribirnos.
  return { ok: true, message: `Tu solicitud quedó registrada. Para agilizarla escribinos a ${brand.contactEmail}.` };
}

export async function updateMyWhatsappSettingsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const access = await requireWriteContext("settings.manage");
  if (!access.ok) return { message: access.message };
  const { organization, user } = access.context;
  if (organization.isDemo) return { message: DEMO_BLOCKED_MESSAGE };
  const connection = await db.whatsappConnection.findUnique({ where: { organizationId: organization.id }, select: { id: true } });
  if (!connection) return { message: "Todavía no tenés WhatsApp automático activado." };

  const hours = Number(formData.get("reminderHoursBefore") ?? 24);
  await updateSettings(organization.id, {
    sendConfirmations: formData.get("sendConfirmations") === "on",
    sendReminders: formData.get("sendReminders") === "on",
    sendCancellations: formData.get("sendCancellations") === "on",
    sendReschedules: formData.get("sendReschedules") === "on",
    reminderHoursBefore: Number.isFinite(hours) ? hours : 24,
  });
  await recordAudit({ organizationId: organization.id, userId: user.id, action: "whatsapp.settings.updated", entityType: "whatsapp_connection", entityId: organization.id });
  revalidatePath("/dashboard/configuracion/integraciones");
  return { ok: true, message: "Preferencias guardadas. Se aplican a los turnos que se agenden desde ahora." };
}

/** Para la página: ¿puede ver la sección? (cualquiera con permiso de configuración). */
export async function whatsappContext() {
  return requireContext();
}
