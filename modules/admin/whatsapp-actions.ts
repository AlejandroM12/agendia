"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/dal";
import { canAccessPlatformAdmin } from "@/lib/deployment";
import { recordAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import type { ActionState } from "@/lib/action-state";
import { isEncryptionConfigured } from "@/modules/whatsapp/crypto";
import { normalizePhone } from "@/modules/whatsapp/consent";
import { TEMPLATES, WHATSAPP_KINDS, type WhatsappKind } from "@/modules/whatsapp/templates";
import {
  issueVerifyToken,
  revokeCredentials,
  saveConnection,
  sendTest,
  setEnabled,
  setLimits,
  syncTemplates,
  updateSettings,
  validateConnection,
} from "@/modules/whatsapp/service";

/**
 * Administración de WhatsApp automático por negocio (solo plataforma). Cada acción vuelve a verificar el permiso (el
 * layout no alcanza), toma el negocio del identificador que ya viene atado a la página (nunca de un campo libre), queda
 * en la auditoría y NUNCA devuelve ni registra tokens ni secretos.
 */
async function requireAdmin() {
  const context = await requireContext();
  if (!canAccessPlatformAdmin(context.user)) notFound();
  return context;
}

const audit = (adminId: string, organizationId: string, action: string, metadata?: Record<string, string | number | boolean | null>) =>
  recordAudit({ organizationId, userId: adminId, action: `whatsapp.${action}`, entityType: "whatsapp_connection", entityId: organizationId, ...(metadata ? { metadata } : {}) });

const done = (organizationId: string) => revalidatePath(`/admin/negocios/${organizationId}`);

export async function saveWhatsappConnectionAction(organizationId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  if (!isEncryptionConfigured()) return { message: "Falta configurar WHATSAPP_ENCRYPTION_KEY en el servidor (una sola vez para toda la plataforma): no se pueden guardar credenciales." };
  if (!(await db.organization.findUnique({ where: { id: organizationId }, select: { id: true } }))) return { message: "No encontramos ese negocio." };

  const token = String(formData.get("accessToken") ?? "");
  const secret = String(formData.get("appSecret") ?? "");
  const result = await saveConnection(organizationId, {
    phoneNumberId: String(formData.get("phoneNumberId") ?? ""),
    wabaId: String(formData.get("wabaId") ?? ""),
    accessToken: token || undefined,
    appSecret: secret || undefined,
    templateLanguage: String(formData.get("templateLanguage") ?? "") || undefined,
  });
  if (!result.ok) return { message: result.message };
  await audit(admin.user.id, organizationId, "connection.saved", { credentialsChanged: Boolean(token || secret) });
  done(organizationId);
  return { ok: true, message: "Conexión guardada. Validala para poder activarla." };
}

export async function issueWhatsappVerifyTokenAction(organizationId: string, _prev: ActionState): Promise<ActionState> {
  const admin = await requireAdmin();
  if (!(await db.whatsappConnection.findUnique({ where: { organizationId }, select: { id: true } }))) return { message: "Primero guardá la conexión." };
  const token = await issueVerifyToken(organizationId);
  await audit(admin.user.id, organizationId, "verify_token.issued");
  done(organizationId);
  return { ok: true, message: `Token de verificación del webhook (se muestra UNA sola vez, pegalo en Meta ahora): ${token}` };
}

export async function validateWhatsappAction(organizationId: string, _prev: ActionState): Promise<ActionState> {
  const admin = await requireAdmin();
  const result = await validateConnection(organizationId);
  await audit(admin.user.id, organizationId, result.ok ? "connection.validated" : "connection.validation_failed");
  done(organizationId);
  if (!result.ok) return { message: `No se pudo validar: ${result.message}` };
  const states = WHATSAPP_KINDS.map((kind) => `${TEMPLATES[kind].name}: ${result.templates[kind] ?? "?"}`).join(" · ");
  return { ok: true, message: `Conexión válida (${result.verifiedName ?? "sin nombre"}, ${result.displayPhone ?? "sin número"}). Plantillas: ${states}` };
}

export async function syncWhatsappTemplatesAction(organizationId: string, _prev: ActionState): Promise<ActionState> {
  const admin = await requireAdmin();
  const result = await syncTemplates(organizationId);
  await audit(admin.user.id, organizationId, result.ok ? "templates.synced" : "templates.sync_failed", result.ok ? { created: result.created.length } : undefined);
  done(organizationId);
  if (!result.ok) return { message: `No se pudieron crear las plantillas: ${result.message}` };
  return { ok: true, message: result.created.length ? `Se enviaron a Meta ${result.created.length} plantillas para su aprobación (puede tardar hasta 24 h).` : "Las cuatro plantillas ya existen en Meta." };
}

export async function setWhatsappEnabledAction(organizationId: string, enabled: boolean): Promise<ActionState> {
  const admin = await requireAdmin();
  const result = await setEnabled(organizationId, enabled);
  if (!result.ok) return { message: result.message };
  await audit(admin.user.id, organizationId, enabled ? "enabled" : "disabled");
  done(organizationId);
  return { ok: true, message: enabled ? "WhatsApp automático activado." : "WhatsApp automático desactivado." };
}

export async function updateWhatsappLimitsAction(organizationId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const connection = await db.whatsappConnection.findUnique({ where: { organizationId }, select: { id: true } });
  if (!connection) return { message: "Primero guardá la conexión." };
  const organization = await db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } });

  const limit = Number(formData.get("monthlyLimit"));
  if (!Number.isFinite(limit) || limit < 0) return { message: "El límite mensual tiene que ser un número de 0 en adelante." };
  const hours = Number(formData.get("reminderHoursBefore") ?? 24);
  const recipients = String(formData.get("testRecipients") ?? "")
    .split(/[,;\n]+/)
    .filter(Boolean)
    .map((raw) => normalizePhone(raw, organization?.timezone ?? "America/Argentina/Buenos_Aires"));
  if (recipients.some((value) => value === null)) return { message: "Revisá los números de prueba: tienen que ser válidos, con característica." };

  await setLimits(organizationId, { monthlyLimit: limit, testRecipients: recipients as string[] });
  await updateSettings(organizationId, {
    sendConfirmations: formData.get("sendConfirmations") === "on",
    sendReminders: formData.get("sendReminders") === "on",
    sendCancellations: formData.get("sendCancellations") === "on",
    sendReschedules: formData.get("sendReschedules") === "on",
    reminderHoursBefore: Number.isFinite(hours) ? hours : 24,
  });
  await audit(admin.user.id, organizationId, "limits.updated", { monthlyLimit: Math.trunc(limit), testRecipients: recipients.length });
  done(organizationId);
  return { ok: true, message: "Configuración guardada." };
}

export async function sendWhatsappTestAction(organizationId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const organization = await db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } });
  const to = normalizePhone(String(formData.get("to") ?? ""), organization?.timezone ?? "America/Argentina/Buenos_Aires");
  if (!to) return { message: "Ingresá un número válido, con característica." };
  const requested = String(formData.get("template") ?? "hello_world");
  const template = requested === "hello_world" ? "hello_world" : (WHATSAPP_KINDS.find((kind) => kind === requested) as WhatsappKind | undefined);
  if (!template) return { message: "Plantilla desconocida." };

  const result = await sendTest(organizationId, { to, template });
  await audit(admin.user.id, organizationId, result.ok ? "test.sent" : "test.failed", { template });
  done(organizationId);
  return result.ok ? { ok: true, message: "Mensaje de prueba enviado. Revisá el teléfono." } : { message: `No se pudo enviar: ${result.message}` };
}

export async function revokeWhatsappCredentialsAction(organizationId: string): Promise<ActionState> {
  const admin = await requireAdmin();
  await revokeCredentials(organizationId);
  await audit(admin.user.id, organizationId, "credentials.revoked");
  done(organizationId);
  return { ok: true, message: "Credenciales revocadas y WhatsApp desactivado." };
}
