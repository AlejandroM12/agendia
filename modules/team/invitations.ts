import "server-only";

import { createHash, randomBytes } from "node:crypto";
import type { Invitation, MembershipRole, Organization, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { brand } from "@/lib/brand";
import { isAccountsEnabled } from "@/lib/features";
import { invitationLinksVisible } from "@/lib/test-flags";
import { canPerformWriteActions } from "@/lib/organization-access";
import { hashPassword } from "@/lib/password";
import { rateLimit } from "@/lib/rate-limit";
import { ROLE_LABEL } from "@/lib/roles";
import { newPasswordSchema } from "@/modules/auth/schemas";
import { isEmailConfigured, sendEmail } from "@/modules/notifications/email";
import { renderInvitationEmail } from "@/modules/notifications/templates";

/**
 * Invitaciones para acceder a Agendia dentro de un negocio.
 *
 * - El token se genera con 32 bytes aleatorios y **solo su hash** (SHA-256)
 *   se guarda: ni la base ni el panel pueden volver a mostrar el enlace. El
 *   enlace solo viaja por correo, y no se registra en logs ni en auditoría.
 * - Es de un solo uso, vence a los 7 días, se puede revocar y reenviar (el
 *   reenvío emite un token nuevo: el anterior deja de servir), y está atado a
 *   un negocio, a un correo, a un rol y (profesionales) a un perfil.
 * - Una sola invitación pendiente por profesional y por correo (índices
 *   parciales en la base); crear otra invalida la anterior.
 * - Todo el flujo requiere que las cuentas individuales estén habilitadas
 *   para el negocio (lib/features.ts) y se vuelve a validar al aceptar.
 *
 * Límites (documentados en docs/AUTH_AND_ACCESS.md): hasta 20 invitaciones
 * nuevas por negocio por hora; hasta 3 por correo por día en toda la
 * plataforma (para que nadie pueda llenarle la casilla a otra persona);
 * un reenvío cada 60 segundos y hasta 5 envíos por invitación.
 */

export const INVITATION_TTL_DAYS = 7;
export const MAX_SENDS_PER_INVITATION = 5;
const RESEND_COOLDOWN_SECONDS = 60;

/**
 * Sin canal de correo, el enlace de la invitación solo se muestra en desarrollo y en las pruebas E2E
 * locales (lib/test-flags.ts): nunca en una instalación comercial, tenga o no la variable de pruebas.
 */
const showsInvitationLinks = invitationLinksVisible;

const hashToken = (raw: string) => createHash("sha256").update(raw).digest("hex");
const normalizeEmail = (email: string) => email.trim().toLowerCase();
const emailOk = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 200;

export type InvitationFailure = { ok: false; code: InvitationFailureCode; message: string };
export type InvitationFailureCode =
  | "disabled"
  | "read_only"
  | "invalid"
  | "not_found"
  | "already_member"
  | "already_linked"
  | "inactive"
  | "pending_elsewhere"
  | "rate_limited"
  | "cooldown"
  | "send_limit"
  | "email_unavailable"
  | "expired"
  | "email_mismatch"
  | "forbidden";
export type InvitationResult<T> = ({ ok: true } & T) | InvitationFailure;

const fail = (code: InvitationFailureCode, message: string): InvitationFailure => ({ ok: false, code, message });

type Org = Pick<
  Organization,
  "id" | "name" | "slug" | "status" | "trialEndsAt" | "readonlyUntil" | "teamAccountsEnabled" | "onboardingCompletedAt" | "themePrimary"
>;

async function audit(
  client: Prisma.TransactionClient | typeof db,
  params: { organizationId: string; userId: string | null; action: string; entityId: string; metadata?: Prisma.InputJsonValue },
) {
  await client.auditLog.create({
    data: {
      organizationId: params.organizationId,
      userId: params.userId,
      action: params.action,
      entityType: "invitation",
      entityId: params.entityId,
      metadata: params.metadata,
    },
  });
}

/* ------------------------------------------------------------------ */
/* Estado en el panel                                                  */
/* ------------------------------------------------------------------ */

export type AccessState = "none" | "pending" | "expired" | "linked" | "revoked";

export const ACCESS_STATE_LABEL: Record<AccessState, string> = {
  none: "Sin acceso individual",
  pending: "Invitación pendiente",
  expired: "Invitación vencida",
  linked: "Cuenta vinculada",
  revoked: "Acceso revocado",
};

export type ProfessionalAccess = {
  state: AccessState;
  /** Correo al que se invitó, si hay una invitación pendiente o vencida. */
  invitedEmail: string | null;
  invitationId: string | null;
  /** Correo de la cuenta vinculada. */
  accountEmail: string | null;
  expiresAt: Date | null;
  sendCount: number;
};

/** Estado de acceso de cada profesional del negocio (dos consultas agrupadas, sin N+1). */
export async function getAccessStates(organizationId: string, now: Date = new Date()): Promise<Map<string, ProfessionalAccess>> {
  const [professionals, invitations] = await Promise.all([
    db.professional.findMany({
      where: { organizationId },
      select: { id: true, accessRevokedAt: true, user: { select: { email: true } } },
    }),
    db.invitation.findMany({
      where: { organizationId, status: "pending", professionalId: { not: null } },
      select: { id: true, professionalId: true, email: true, expiresAt: true, sendCount: true },
    }),
  ]);
  const pending = new Map(invitations.map((i) => [i.professionalId!, i]));
  const result = new Map<string, ProfessionalAccess>();
  for (const p of professionals) {
    const invitation = pending.get(p.id);
    const base = { invitedEmail: null, invitationId: null, accountEmail: null, expiresAt: null, sendCount: 0 };
    if (p.user) result.set(p.id, { ...base, state: "linked", accountEmail: p.user.email });
    else if (invitation) {
      result.set(p.id, {
        state: invitation.expiresAt <= now ? "expired" : "pending",
        invitedEmail: invitation.email,
        invitationId: invitation.id,
        accountEmail: null,
        expiresAt: invitation.expiresAt,
        sendCount: invitation.sendCount,
      });
    } else result.set(p.id, { ...base, state: p.accessRevokedAt ? "revoked" : "none" });
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Crear y reenviar                                                    */
/* ------------------------------------------------------------------ */

function inviteUrl(token: string) {
  return `${brand.url}/invitacion/${token}`;
}

async function deliver(params: {
  organization: Org;
  invitation: Pick<Invitation, "email" | "role" | "expiresAt">;
  token: string;
  inviterName: string;
  professionalName: string | null;
}): Promise<{ sent: boolean; devLink?: string }> {
  if (isEmailConfigured()) {
    const rendered = renderInvitationEmail({
      businessName: params.organization.name,
      businessColor: params.organization.themePrimary,
      inviterName: params.inviterName,
      roleLabel: ROLE_LABEL[params.invitation.role],
      professionalName: params.professionalName,
      url: inviteUrl(params.token),
      expiresAt: params.invitation.expiresAt,
    });
    const result = await sendEmail({ to: params.invitation.email, fromName: params.organization.name, ...rendered });
    // Nunca se registra el enlace: solo si salió o no.
    if (!result.ok) console.error("[invitations] no se pudo enviar la invitación:", result.error);
    return { sent: result.ok };
  }
  // Sin canal de email solo se muestra el enlace fuera de producción (desarrollo y pruebas).
  if (showsInvitationLinks()) return { sent: false, devLink: `/invitacion/${params.token}` };
  return { sent: false };
}

type Actor = { id: string; name: string };

/**
 * Invita a una persona a vincularse con un profesional (`role: professional`) o a
 * administrar el negocio (`role: admin`, solo el propietario). No consume cupo: el
 * profesional ya existe y ya cuenta; un administrador no atiende.
 */
export async function createInvitation(
  organization: Org,
  actor: Actor,
  input: { email: string; role: Extract<MembershipRole, "professional" | "admin">; professionalId?: string | null },
): Promise<InvitationResult<{ invitationId: string; sent: boolean; devLink?: string }>> {
  if (!isAccountsEnabled(organization)) return fail("disabled", "Las cuentas individuales todavía no están habilitadas para tu negocio.");
  if (!canPerformWriteActions(organization) || !organization.onboardingCompletedAt) {
    return fail("read_only", "Tu cuenta está en modo de solo lectura.");
  }
  const email = normalizeEmail(input.email);
  if (!emailOk(email)) return fail("invalid", "Ingresá un correo válido, como nombre@ejemplo.com.");
  if (input.role === "professional" ? !input.professionalId : Boolean(input.professionalId)) {
    return fail("invalid", "La invitación no es válida.");
  }
  if (!isEmailConfigured() && !showsInvitationLinks()) {
    return fail("email_unavailable", "El envío de correos no está configurado en esta instalación: no se puede invitar.");
  }

  // Topes de abuso: por negocio y por casilla (compartido por todos los negocios).
  if (!(await rateLimit(`invite:org:${organization.id}`, 20, 3600)).allowed) {
    return fail("rate_limited", "Enviaste muchas invitaciones en poco tiempo. Esperá un rato y volvé a intentar.");
  }
  const emailKey = createHash("sha256").update(email).digest("hex").slice(0, 32);
  if (!(await rateLimit(`invite:email:${emailKey}`, 3, 86400)).allowed) {
    return fail("rate_limited", "Ese correo ya recibió varias invitaciones hoy. Probá de nuevo mañana.");
  }

  let professionalName: string | null = null;
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 3600 * 1000);

  const created = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`invite:${organization.id}`}))`;

    if (input.role === "professional") {
      const professional = await tx.professional.findFirst({
        where: { id: String(input.professionalId).slice(0, 64), organizationId: organization.id },
        select: { id: true, displayName: true, active: true, userId: true },
      });
      if (!professional) return fail("not_found", "No encontramos a ese profesional.");
      if (professional.userId) return fail("already_linked", "Ese profesional ya tiene una cuenta vinculada.");
      if (!professional.active) return fail("inactive", "Ese profesional está desactivado: activalo antes de invitarlo.");
      professionalName = professional.displayName;
    }

    // Quien ya es miembro de este negocio no se invita de nuevo (solo se revela algo de SU propio negocio).
    const alreadyMember = await tx.membership.findFirst({
      where: { organizationId: organization.id, user: { email: { equals: email, mode: "insensitive" } } },
      select: { id: true },
    });
    if (alreadyMember) return fail("already_member", "Esa persona ya forma parte de tu negocio.");

    // Otra invitación pendiente para ese correo (de otro profesional o rol): no se pisa en silencio.
    const sameEmail = await tx.invitation.findFirst({
      where: { organizationId: organization.id, email, status: "pending", NOT: input.professionalId ? { professionalId: input.professionalId } : undefined },
      select: { id: true },
    });
    if (sameEmail) return fail("pending_elsewhere", "Ya hay una invitación pendiente para ese correo. Revocala antes de enviar otra.");

    // La anterior invitación pendiente del mismo perfil queda sin efecto: nunca dos activas.
    if (input.role === "professional") {
      await tx.invitation.updateMany({
        where: { organizationId: organization.id, professionalId: input.professionalId!, status: "pending" },
        data: { status: "revoked", revokedAt: new Date() },
      });
    } else {
      await tx.invitation.updateMany({
        where: { organizationId: organization.id, email, role: "admin", status: "pending" },
        data: { status: "revoked", revokedAt: new Date() },
      });
    }
    const invitation = await tx.invitation.create({
      data: {
        organizationId: organization.id,
        professionalId: input.professionalId ?? null,
        email,
        role: input.role,
        tokenHash: hashToken(token),
        expiresAt,
        createdByUserId: actor.id,
      },
    });
    await audit(tx, {
      organizationId: organization.id,
      userId: actor.id,
      action: "team.invitation.create",
      entityId: invitation.id,
      metadata: { role: input.role, professionalId: input.professionalId ?? null },
    });
    return { ok: true as const, invitation };
  });
  if (!created.ok) return created;

  const delivery = await deliver({
    organization,
    invitation: created.invitation,
    token,
    inviterName: actor.name,
    professionalName,
  });
  return { ok: true, invitationId: created.invitation.id, ...delivery };
}

/** Reenvía una invitación pendiente: emite un token nuevo (el anterior deja de servir) y renueva el plazo. */
export async function resendInvitation(
  organization: Org,
  actor: Actor,
  invitationId: string,
  now: Date = new Date(),
): Promise<InvitationResult<{ sent: boolean; devLink?: string }>> {
  if (!isAccountsEnabled(organization)) return fail("disabled", "Las cuentas individuales todavía no están habilitadas para tu negocio.");
  if (!canPerformWriteActions(organization)) return fail("read_only", "Tu cuenta está en modo de solo lectura.");
  if (!isEmailConfigured() && !showsInvitationLinks()) {
    return fail("email_unavailable", "El envío de correos no está configurado en esta instalación.");
  }

  const token = randomBytes(32).toString("base64url");
  let professionalName: string | null = null;
  const updated = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`invitation:${invitationId}`}))`;
    const current = await tx.invitation.findFirst({
      where: { id: String(invitationId).slice(0, 64), organizationId: organization.id, status: "pending" },
      include: { professional: { select: { displayName: true, active: true, userId: true } } },
    });
    if (!current) return fail("not_found", "No encontramos esa invitación.");
    if (current.sendCount >= MAX_SENDS_PER_INVITATION) {
      return fail("send_limit", "Esta invitación ya se envió varias veces. Revocala y creá una nueva si hace falta.");
    }
    if (now.getTime() - current.lastSentAt.getTime() < RESEND_COOLDOWN_SECONDS * 1000) {
      return fail("cooldown", "Esperá un minuto antes de reenviarla.");
    }
    if (current.professional?.userId) return fail("already_linked", "Ese profesional ya tiene una cuenta vinculada.");
    professionalName = current.professional?.displayName ?? null;
    const invitation = await tx.invitation.update({
      where: { id: current.id },
      data: {
        tokenHash: hashToken(token),
        expiresAt: new Date(now.getTime() + INVITATION_TTL_DAYS * 24 * 3600 * 1000),
        sendCount: { increment: 1 },
        lastSentAt: now,
      },
    });
    await audit(tx, { organizationId: organization.id, userId: actor.id, action: "team.invitation.resend", entityId: invitation.id });
    return { ok: true as const, invitation };
  });
  if (!updated.ok) return updated;

  const delivery = await deliver({ organization, invitation: updated.invitation, token, inviterName: actor.name, professionalName });
  return { ok: true, ...delivery };
}

export async function revokeInvitation(
  organization: Pick<Organization, "id">,
  actor: Actor,
  invitationId: string,
): Promise<InvitationResult<object>> {
  const revoked = await db.invitation.updateMany({
    where: { id: String(invitationId).slice(0, 64), organizationId: organization.id, status: "pending" },
    data: { status: "revoked", revokedAt: new Date() },
  });
  if (revoked.count === 0) return fail("not_found", "No encontramos esa invitación.");
  await audit(db, { organizationId: organization.id, userId: actor.id, action: "team.invitation.revoke", entityId: invitationId });
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Revocar el acceso de una cuenta                                     */
/* ------------------------------------------------------------------ */

/**
 * Quita el acceso individual de un profesional: se borra SU membresía en ESTE
 * negocio y nada más. El perfil, los horarios, los turnos, los clientes, el
 * historial y los servicios se conservan, y la agenda sigue gestionada por el
 * negocio. Sus otros negocios no se tocan, y una sesión abierta deja de tener
 * acceso de inmediato (lib/dal.ts lee la membresía en cada pedido). No se
 * puede revocar al propietario ni a un administrador desde acá.
 */
export async function revokeProfessionalAccess(
  organization: Pick<Organization, "id">,
  actor: Actor,
  professionalId: string,
): Promise<InvitationResult<{ revokedEmail: string }>> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`invite:${organization.id}`}))`;
    const professional = await tx.professional.findFirst({
      where: { id: String(professionalId).slice(0, 64), organizationId: organization.id },
      select: { id: true, userId: true, user: { select: { email: true } } },
    });
    if (!professional?.userId || !professional.user) return fail("not_found", "Ese profesional no tiene una cuenta vinculada.");

    const membership = await tx.membership.findFirst({
      where: { organizationId: organization.id, userId: professional.userId },
      select: { id: true, role: true },
    });
    // Un propietario o administrador que además atiende no pierde su acceso por esta vía.
    if (membership && membership.role !== "professional") {
      return fail("forbidden", "Esa persona es propietaria o administradora del negocio: su acceso no se revoca desde acá.");
    }
    if (membership) await tx.membership.delete({ where: { id: membership.id } }); // el trigger de la base suelta al profesional
    await tx.professional.update({ where: { id: professional.id }, data: { userId: null, accessRevokedAt: new Date() } });
    await tx.invitation.updateMany({
      where: { organizationId: organization.id, professionalId: professional.id, status: "pending" },
      data: { status: "revoked", revokedAt: new Date() },
    });
    // Los avisos internos que estaban por salir hacia esa cuenta no salen.
    await tx.notification.updateMany({
      where: { organizationId: organization.id, status: "pending", recipient: { equals: professional.user.email, mode: "insensitive" } },
      data: { status: "canceled" },
    });
    await tx.auditLog.create({
      data: {
        organizationId: organization.id,
        userId: actor.id,
        action: "team.access.revoke",
        entityType: "professional",
        entityId: professional.id,
        metadata: { userId: professional.userId },
      },
    });
    return { ok: true as const, revokedEmail: professional.user.email };
  });
}

/** El propietario quita a un administrador (su membresía en este negocio). Nunca al propietario. */
export async function removeAdmin(
  organization: Pick<Organization, "id">,
  actor: Actor,
  userId: string,
): Promise<InvitationResult<object>> {
  const membership = await db.membership.findFirst({
    where: { organizationId: organization.id, userId: String(userId).slice(0, 64) },
    select: { id: true, role: true, userId: true },
  });
  if (!membership || membership.role !== "admin") return fail("not_found", "No encontramos a ese administrador.");
  await db.$transaction([
    db.membership.delete({ where: { id: membership.id } }),
    db.auditLog.create({
      data: { organizationId: organization.id, userId: actor.id, action: "team.admin.remove", entityType: "membership", entityId: membership.id, metadata: { userId: membership.userId } },
    }),
  ]);
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Lo que ve quien abre el enlace                                      */
/* ------------------------------------------------------------------ */

export type InvitationView = {
  organizationName: string;
  organizationId: string;
  roleLabel: string;
  professionalName: string | null;
  inviterName: string | null;
  email: string;
  expiresAt: Date;
  /** ¿Ya existe una cuenta con ese correo? Solo lo sabe quien tiene el enlace (es de quien es esa casilla). */
  accountExists: boolean;
};

/**
 * Datos de una invitación a partir del token. Un token inexistente, vencido,
 * revocado o ya usado devuelve `null`: la respuesta es la misma en todos los
 * casos, así el enlace no permite averiguar nada.
 */
export async function findInvitationByToken(rawToken: string, now: Date = new Date()): Promise<{ invitation: Invitation; view: InvitationView } | null> {
  if (typeof rawToken !== "string" || rawToken.length < 20 || rawToken.length > 100) return null;
  const invitation = await db.invitation.findUnique({ where: { tokenHash: hashToken(rawToken) } });
  if (!invitation || invitation.status !== "pending" || invitation.expiresAt <= now) return null;

  const [organization, professional, inviter, account] = await Promise.all([
    db.organization.findUnique({ where: { id: invitation.organizationId }, select: { id: true, name: true } }),
    invitation.professionalId
      ? db.professional.findFirst({ where: { id: invitation.professionalId, organizationId: invitation.organizationId }, select: { displayName: true } })
      : null,
    invitation.createdByUserId ? db.user.findUnique({ where: { id: invitation.createdByUserId }, select: { name: true } }) : null,
    db.user.findFirst({ where: { email: { equals: invitation.email, mode: "insensitive" } }, select: { id: true } }),
  ]);
  if (!organization) return null;
  return {
    invitation,
    view: {
      organizationName: organization.name,
      organizationId: organization.id,
      roleLabel: ROLE_LABEL[invitation.role],
      professionalName: professional?.displayName ?? null,
      inviterName: inviter?.name ?? null,
      email: invitation.email,
      expiresAt: invitation.expiresAt,
      accountExists: Boolean(account),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Aceptar                                                             */
/* ------------------------------------------------------------------ */

/**
 * Núcleo de la aceptación, dentro de una transacción y con un bloqueo por
 * invitación: dos aceptaciones simultáneas (o una aceptación y una revocación)
 * se serializan y solo una gana. Se vuelve a validar TODO al aceptar: la
 * invitación (pendiente, vigente), el negocio (con cuentas habilitadas), el
 * profesional (existe, activo, sin cuenta) y el correo de quien acepta.
 */
async function acceptWithin(
  tx: Prisma.TransactionClient,
  params: { rawToken: string; userId: string; userEmail: string; now: Date },
): Promise<InvitationResult<{ organizationId: string; role: MembershipRole }>> {
  const hash = hashToken(params.rawToken);
  const lookup = await tx.invitation.findUnique({ where: { tokenHash: hash }, select: { id: true } });
  if (!lookup) return fail("not_found", "Esta invitación no es válida o ya fue usada.");
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`invitation:${lookup.id}`}))`;

  const invitation = await tx.invitation.findUnique({ where: { id: lookup.id } });
  if (!invitation || invitation.tokenHash !== hash || invitation.status !== "pending") {
    return fail("not_found", "Esta invitación no es válida o ya fue usada.");
  }
  if (invitation.expiresAt <= params.now) return fail("expired", "Esta invitación venció. Pedí que te envíen una nueva.");
  if (normalizeEmail(params.userEmail) !== invitation.email) {
    return fail("email_mismatch", "Esta invitación es para otro correo. Ingresá con la cuenta a la que llegó.");
  }

  const organization = await tx.organization.findUnique({ where: { id: invitation.organizationId } });
  if (!organization || !organization.onboardingCompletedAt || organization.status === "suspended") {
    return fail("not_found", "Este negocio no está disponible.");
  }
  if (!isAccountsEnabled(organization)) return fail("disabled", "Las cuentas individuales no están habilitadas para este negocio.");

  if (invitation.role === "professional") {
    const professional = await tx.professional.findFirst({
      where: { id: invitation.professionalId ?? "", organizationId: organization.id },
      select: { id: true, active: true, userId: true },
    });
    if (!professional) return fail("not_found", "El perfil de profesional ya no existe.");
    if (!professional.active) return fail("inactive", "El perfil de profesional está desactivado: pedile al negocio que lo active.");
    if (professional.userId) return fail("already_linked", "Ese perfil ya tiene una cuenta vinculada.");
  }
  if (await tx.membership.findFirst({ where: { organizationId: organization.id, userId: params.userId }, select: { id: true } })) {
    return fail("already_member", "Ya sos parte de este negocio.");
  }

  await tx.membership.create({
    data: {
      organizationId: organization.id,
      userId: params.userId,
      role: invitation.role,
      // Los avisos internos de una cuenta nueva (profesional o administrador) arrancan apagados: cada
      // persona los activa si los quiere, desde su Perfil. No cambia lo ya configurado de cuentas existentes.
      notifyBookings: false,
    },
  });
  if (invitation.role === "professional") {
    await tx.professional.update({ where: { id: invitation.professionalId! }, data: { userId: params.userId, accessRevokedAt: null } });
  }
  await tx.invitation.update({ where: { id: invitation.id }, data: { status: "accepted", acceptedAt: params.now, acceptedByUserId: params.userId } });
  await tx.auditLog.create({
    data: {
      organizationId: organization.id,
      userId: params.userId,
      action: "team.invitation.accept",
      entityType: "invitation",
      entityId: invitation.id,
      metadata: { role: invitation.role, professionalId: invitation.professionalId },
    },
  });
  return { ok: true, organizationId: organization.id, role: invitation.role };
}

/** Acepta con una cuenta que ya existe (la persona inició sesión). No toca sus otros negocios. */
export async function acceptInvitationWithAccount(
  rawToken: string,
  user: { id: string; email: string },
  now: Date = new Date(),
): Promise<InvitationResult<{ organizationId: string; role: MembershipRole }>> {
  try {
    return await db.$transaction((tx) => acceptWithin(tx, { rawToken, userId: user.id, userEmail: user.email, now }), { maxWait: 10_000, timeout: 15_000 });
  } catch (error) {
    // Dos aceptaciones simultáneas del mismo perfil: la restricción única de la base deja pasar solo una.
    if (isUniqueViolation(error)) return fail("already_linked", "Esta invitación ya fue usada.");
    throw error;
  }
}

/**
 * Acepta creando la cuenta: la persona elige nombre y contraseña. El correo
 * queda verificado porque demostró que controla la casilla al abrir el enlace.
 * No pasa por el registro comercial: no crea un negocio ni una suscripción.
 */
export async function acceptInvitationWithNewAccount(
  rawToken: string,
  input: { name: string; password: string },
  now: Date = new Date(),
): Promise<InvitationResult<{ organizationId: string; role: MembershipRole; email: string }> | { ok: false; code: "weak_password" | "name"; message: string }> {
  const name = input.name?.trim() ?? "";
  if (name.length < 2 || name.length > 120) return { ok: false, code: "name", message: "Ingresá tu nombre." };
  const password = newPasswordSchema.safeParse({ password: input.password });
  if (!password.success) return { ok: false, code: "weak_password", message: password.error.issues[0]?.message ?? "La contraseña no es válida." };

  const found = await findInvitationByToken(rawToken, now);
  if (!found) return fail("not_found", "Esta invitación no es válida o ya fue usada.");
  if (found.view.accountExists) return fail("forbidden", "Ya hay una cuenta con ese correo: iniciá sesión para aceptar.");

  const passwordHash = await hashPassword(input.password);
  try {
    return await db.$transaction(
      async (tx) => {
        const user = await tx.user.create({ data: { email: found.invitation.email, name, passwordHash, emailVerifiedAt: now } });
        const accepted = await acceptWithin(tx, { rawToken, userId: user.id, userEmail: user.email, now });
        if (!accepted.ok) throw new RollbackWith(accepted);
        return { ...accepted, email: user.email };
      },
      { maxWait: 10_000, timeout: 15_000 },
    );
  } catch (error) {
    if (error instanceof RollbackWith) return error.result;
    if (isUniqueViolation(error)) return fail("already_linked", "Esta invitación ya fue usada o ya existe una cuenta con ese correo.");
    throw error;
  }
}

class RollbackWith extends Error {
  constructor(public result: InvitationFailure) {
    super(result.message);
  }
}

function isUniqueViolation(error: unknown): boolean {
  const text = error instanceof Error ? `${error.message} ${JSON.stringify(error)}` : String(error);
  return text.includes("P2002") || text.includes("23505") || /unique constraint/i.test(text);
}
