"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/dal";
import { type ActionState, fieldErrors } from "@/lib/action-state";
import {
  PROFESSIONAL_PERMISSION_KEYS,
  type ProfessionalPermissions,
} from "@/lib/permissions";
import { createInvitation, removeAdmin, resendInvitation, revokeInvitation, revokeProfessionalAccess } from "./invitations";

/**
 * Accesos individuales: invitar, reenviar, revocar, administradores y qué
 * pueden hacer los profesionales. Todas validan en el servidor el permiso (rol
 * leído de la base en cada pedido) y que lo tocado sea de la organización
 * activa; ninguna recibe un negocio desde el formulario.
 */

/** Estado con el enlace de desarrollo: solo existe fuera de producción y sin canal de correo. */
export type InviteState = (NonNullable<ActionState> & { devLink?: string }) | undefined;

const emailField = z.object({ email: z.email("Ingresá un correo válido, como nombre@ejemplo.com.").trim().toLowerCase() });

function refresh() {
  revalidatePath("/dashboard/equipo", "layout");
}

export async function inviteProfessionalAction(professionalId: string, _prev: InviteState, formData: FormData): Promise<InviteState> {
  const access = await requirePermission("team.invite");
  if (!access.ok) return { message: access.message };
  const { organization, user } = access.context;

  const parsed = emailField.safeParse({ email: formData.get("email") });
  if (!parsed.success) return { errors: fieldErrors(parsed.error), message: "Revisá el correo." };

  const result = await createInvitation(organization, { id: user.id, name: user.name }, { email: parsed.data.email, role: "professional", professionalId });
  if (!result.ok) return { message: result.message };
  refresh();
  return {
    ok: true,
    devLink: result.devLink,
    message: result.sent ? `Le enviamos la invitación a ${parsed.data.email}.` : result.devLink ? "Invitación creada (sin canal de correo: usá el enlace de prueba)." : "Creamos la invitación, pero no pudimos enviar el correo. Probá reenviarla en un momento.",
  };
}

export async function resendInvitationAction(invitationId: string): Promise<InviteState> {
  const access = await requirePermission("team.invite");
  if (!access.ok) return { message: access.message };
  const { organization, user } = access.context;

  // Un administrador no maneja las invitaciones de administradores.
  const invitation = await db.invitation.findFirst({ where: { id: String(invitationId).slice(0, 64), organizationId: organization.id }, select: { role: true } });
  if (invitation?.role === "admin" && !access.context.permissions.has("members.manage_admins")) return { message: "Tu usuario no tiene permiso para hacer esto." };

  const result = await resendInvitation(organization, { id: user.id, name: user.name }, invitationId);
  if (!result.ok) return { message: result.message };
  refresh();
  return { ok: true, devLink: result.devLink, message: result.sent ? "Invitación reenviada. El enlace anterior ya no sirve." : result.devLink ? "Invitación renovada (sin canal de correo)." : "No pudimos enviar el correo. Probá de nuevo en un momento." };
}

export async function revokeInvitationAction(invitationId: string): Promise<InviteState> {
  const access = await requirePermission("team.invite");
  if (!access.ok) return { message: access.message };
  const { organization, user } = access.context;
  const invitation = await db.invitation.findFirst({ where: { id: String(invitationId).slice(0, 64), organizationId: organization.id }, select: { role: true } });
  if (invitation?.role === "admin" && !access.context.permissions.has("members.manage_admins")) return { message: "Tu usuario no tiene permiso para hacer esto." };

  const result = await revokeInvitation(organization, { id: user.id, name: user.name }, invitationId);
  refresh();
  return result.ok ? { ok: true, message: "Invitación cancelada." } : { message: result.message };
}

export async function revokeAccessAction(professionalId: string): Promise<InviteState> {
  const access = await requirePermission("team.invite");
  if (!access.ok) return { message: access.message };
  const { organization, user } = access.context;

  const result = await revokeProfessionalAccess(organization, { id: user.id, name: user.name }, professionalId);
  refresh();
  return result.ok
    ? { ok: true, message: "Acceso revocado. Su perfil, su agenda y sus turnos se conservan, y los administrás vos." }
    : { message: result.message };
}

/* ---- Administradores (solo el propietario) ---- */

export async function inviteAdminAction(_prev: InviteState, formData: FormData): Promise<InviteState> {
  const access = await requirePermission("members.manage_admins");
  if (!access.ok) return { message: access.message };
  const { organization, user } = access.context;

  const parsed = emailField.safeParse({ email: formData.get("email") });
  if (!parsed.success) return { errors: fieldErrors(parsed.error), message: "Revisá el correo." };

  const result = await createInvitation(organization, { id: user.id, name: user.name }, { email: parsed.data.email, role: "admin" });
  if (!result.ok) return { message: result.message };
  refresh();
  return { ok: true, devLink: result.devLink, message: result.sent ? `Le enviamos la invitación a ${parsed.data.email}.` : result.devLink ? "Invitación creada (sin canal de correo: usá el enlace de prueba)." : "Creamos la invitación, pero no pudimos enviar el correo. Probá reenviarla." };
}

export async function removeAdminAction(userId: string): Promise<InviteState> {
  const access = await requirePermission("members.manage_admins");
  if (!access.ok) return { message: access.message };
  const result = await removeAdmin(access.context.organization, { id: access.context.user.id, name: access.context.user.name }, userId);
  refresh();
  return result.ok ? { ok: true, message: "Administrador quitado." } : { message: result.message };
}

/** El propietario decide si un administrador recibe los avisos de reservas de todo el negocio. */
export async function setAdminNotificationsAction(userId: string, enabled: boolean): Promise<InviteState> {
  const access = await requirePermission("members.manage_admins");
  if (!access.ok) return { message: access.message };
  const { organization, user } = access.context;
  const updated = await db.membership.updateMany({
    where: { organizationId: organization.id, userId: String(userId).slice(0, 64), role: "admin" },
    data: { notifyBookings: Boolean(enabled) },
  });
  if (updated.count === 0) return { message: "No encontramos a ese administrador." };
  await db.auditLog.create({
    data: { organizationId: organization.id, userId: user.id, action: "team.admin.notifications", entityType: "membership", entityId: String(userId).slice(0, 64), metadata: { enabled: Boolean(enabled) } },
  });
  refresh();
  return { ok: true, message: enabled ? "Recibirá los avisos de reservas." : "Dejó de recibir los avisos de reservas." };
}

/* ---- Qué pueden hacer los profesionales ---- */

function readPermissions(formData: FormData): Partial<ProfessionalPermissions> {
  const result: Partial<ProfessionalPermissions> = {};
  for (const key of PROFESSIONAL_PERMISSION_KEYS) {
    const value = formData.get(key);
    // Cada permiso llega como «on» / «off» / «inherit» (solo en las excepciones por profesional).
    if (value === "on") result[key] = true;
    else if (value === "off") result[key] = false;
  }
  return result;
}

/** Permisos generales de los profesionales del negocio (solo el propietario). */
export async function savePermissionsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const access = await requirePermission("permissions.configure");
  if (!access.ok) return { message: access.message };
  const { organization, user } = access.context;

  // En el formulario general cada casilla es un sí/no completo.
  const config: Partial<ProfessionalPermissions> = {};
  for (const key of PROFESSIONAL_PERMISSION_KEYS) config[key] = formData.get(key) === "on";

  await db.$transaction([
    db.organization.update({ where: { id: organization.id }, data: { professionalPermissions: config } }),
    db.auditLog.create({
      data: { organizationId: organization.id, userId: user.id, action: "team.permissions.update", entityType: "organization", entityId: organization.id, metadata: config },
    }),
  ]);
  revalidatePath("/dashboard", "layout");
  return { ok: true, message: "Permisos guardados. Se aplican de inmediato, también a quienes ya tienen la sesión abierta." };
}

/** Excepciones para UN profesional: por cada permiso, «igual que el negocio», sí o no (solo el propietario). */
export async function saveProfessionalOverridesAction(professionalId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const access = await requirePermission("permissions.configure");
  if (!access.ok) return { message: access.message };
  const { organization, user } = access.context;

  const overrides = readPermissions(formData);
  const updated = await db.professional.updateMany({
    where: { id: String(professionalId).slice(0, 64), organizationId: organization.id },
    data: { permissionOverrides: Object.keys(overrides).length ? overrides : Prisma.DbNull },
  });
  if (updated.count === 0) return { message: "No encontramos a ese profesional." };
  await db.auditLog.create({
    data: { organizationId: organization.id, userId: user.id, action: "team.permissions.override", entityType: "professional", entityId: String(professionalId).slice(0, 64), metadata: overrides },
  });
  revalidatePath("/dashboard", "layout");
  return { ok: true, message: "Excepciones guardadas." };
}
