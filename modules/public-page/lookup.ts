import "server-only";

import { createHash, randomBytes } from "node:crypto";
import type { Organization } from "@prisma/client";
import { db } from "@/lib/db";
import { brand } from "@/lib/brand";
import { isEmailConfigured, sendEmail } from "@/modules/notifications/email";
import { renderEmail } from "@/modules/notifications/templates";

/**
 * «Consultá tus turnos»: acceso de un cliente a sus reservas en un negocio,
 * sin cuenta ni contraseña. El cliente demuestra que controla su email
 * abriendo un enlace temporal que solo se envía a esa casilla.
 *
 * El enlace vale para un negocio y un email. Dentro de su vigencia se puede
 * abrir más de una vez (la persona entra, reprograma, vuelve); pedir uno
 * nuevo invalida los anteriores.
 */

export const ACCESS_TOKEN_TTL_MINUTES = 60;

const hashToken = (rawToken: string) => createHash("sha256").update(rawToken).digest("hex");

export const normalizeLookupEmail = (email: string) => email.trim().toLowerCase();

export type RequestLinkResult = { sent: boolean; devLink?: string };

/**
 * Emite un enlace de consulta y lo envía por email, solo si ese email tiene
 * algún turno registrado en este negocio. Quien llama responde siempre lo
 * mismo, exista o no: esta función no debe usarse para revelar el resultado.
 *
 * `devLink` solo existe fuera de producción y sin canal de email.
 */
export async function requestAppointmentsLink(
  organization: Pick<Organization, "id" | "name" | "slug" | "themePrimary">,
  rawEmail: string,
): Promise<RequestLinkResult> {
  const email = normalizeLookupEmail(rawEmail);
  const known = await db.customer.findFirst({
    where: { organizationId: organization.id, email, appointments: { some: {} } },
    select: { name: true },
  });
  if (!known) return { sent: false };

  const rawToken = randomBytes(32).toString("base64url");
  await db.$transaction([
    db.customerAccessToken.deleteMany({ where: { organizationId: organization.id, email } }),
    db.customerAccessToken.create({
      data: {
        organizationId: organization.id,
        email,
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_MINUTES * 60000),
      },
    }),
  ]);

  const path = `/${organization.slug}/mis-turnos/${rawToken}`;

  if (isEmailConfigured()) {
    const result = await sendEmail({
      to: email,
      fromName: organization.name,
      subject: `Tus turnos en ${organization.name}`,
      ...renderEmail({
        business: { name: organization.name, primary: organization.themePrimary },
        heading: "Consultá tus turnos",
        paragraphs: [
          `Hola ${known.name}, pediste ver tus turnos en ${organization.name}.`,
          `El enlace vence en ${ACCESS_TOKEN_TTL_MINUTES} minutos. Si no fuiste vos, podés ignorar este mensaje: nadie puede ver tus turnos sin abrirlo.`,
        ],
        action: { label: "Ver mis turnos", url: `${brand.url}${path}` },
        footer: `Recibís este mensaje porque alguien ingresó tu email en la página de ${organization.name}. Enviado con ${brand.name}.`,
      }),
    });
    if (!result.ok) console.error("[lookup] no se pudo enviar el enlace de consulta:", result.error);
    return { sent: result.ok };
  }

  if (process.env.NODE_ENV !== "production") return { sent: false, devLink: path };

  console.error("[lookup] canal de email sin configurar: no se envió el enlace de consulta.");
  return { sent: false };
}

/**
 * Valida un enlace de consulta **para un negocio concreto**. Un token de
 * otro negocio, vencido o inexistente devuelve `null`: la respuesta es la
 * misma en los tres casos.
 */
export async function resolveAccessToken(organizationId: string, rawToken: string): Promise<{ email: string } | null> {
  if (typeof rawToken !== "string" || rawToken.length < 20 || rawToken.length > 100) return null;
  const token = await db.customerAccessToken.findUnique({ where: { tokenHash: hashToken(rawToken) } });
  if (!token || token.organizationId !== organizationId || token.expiresAt < new Date()) return null;
  return { email: token.email };
}

/** Turnos confirmados que todavía no ocurrieron, de ese email en ese negocio. */
export async function listUpcomingAppointments(organizationId: string, email: string) {
  return db.appointment.findMany({
    where: {
      organizationId,
      status: "confirmed",
      startsAt: { gt: new Date() },
      customer: { organizationId, email: normalizeLookupEmail(email) },
    },
    orderBy: { startsAt: "asc" },
    take: 50,
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
      manageToken: true,
      service: { select: { name: true } },
    },
  });
}

/** Invalida los enlaces de consulta de un email en un negocio. */
export async function revokeAccessTokens(organizationId: string, email: string): Promise<void> {
  await db.customerAccessToken.deleteMany({ where: { organizationId, email: normalizeLookupEmail(email) } });
}
