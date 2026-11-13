import "server-only";

import { randomBytes, createHash } from "node:crypto";
import { db } from "@/lib/db";
import { brand } from "@/lib/brand";
import { isEmailConfigured, sendEmail } from "@/modules/notifications/email";
import { renderEmail } from "@/modules/notifications/templates";

const VERIFICATION_TOKEN_TTL_MS = 48 * 60 * 60 * 1000; // 48 horas

function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

/**
 * ¿Hay que verificar el email de las cuentas nuevas?
 *
 * Sí, siempre que exista un canal para enviar el enlace. Sin canal de email
 * (desarrollo, pruebas automatizadas, una instalación independiente sin
 * email) la cuenta se da por verificada al crearla: exigir un enlace que no
 * se puede enviar dejaría a la persona afuera de su propia cuenta.
 */
export function isEmailVerificationRequired(): boolean {
  return isEmailConfigured();
}

export type IssueVerificationResult = { sent: boolean; devVerificationLink?: string };

/**
 * Genera un enlace de verificación de un solo uso y lo envía por email.
 * Los enlaces anteriores de la misma cuenta dejan de servir.
 *
 * `devVerificationLink` solo existe fuera de producción y sin canal de
 * email, igual que el enlace de recuperación de contraseña.
 */
export async function issueEmailVerification(user: {
  id: string;
  email: string;
  name: string;
}): Promise<IssueVerificationResult> {
  const rawToken = randomBytes(32).toString("base64url");
  await db.$transaction([
    db.emailVerificationToken.deleteMany({ where: { userId: user.id } }),
    db.emailVerificationToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS),
      },
    }),
  ]);

  const path = `/verificar-email/${rawToken}`;

  if (isEmailConfigured()) {
    const result = await sendEmail({
      to: user.email,
      subject: `Confirmá tu email para empezar a usar ${brand.name}`,
      ...renderEmail({
        heading: "Confirmá tu email",
        paragraphs: [
          `Hola ${user.name}, falta un paso para empezar a usar ${brand.name}: confirmar que este email es tuyo.`,
          "El enlace vence en 48 horas. Si no creaste una cuenta, podés ignorar este mensaje.",
        ],
        action: { label: "Confirmar mi email", url: `${brand.url}${path}` },
      }),
    });
    if (!result.ok) console.error("[email-verification] no se pudo enviar el email:", result.error);
    return { sent: result.ok };
  }

  if (process.env.NODE_ENV !== "production") return { sent: false, devVerificationLink: path };

  console.error("[email-verification] canal de email sin configurar: no se envió el enlace de verificación.");
  return { sent: false };
}

export type VerifyEmailResult = { ok: true; userId: string } | { ok: false };

/** Marca la cuenta como verificada si el token es válido y no venció. */
export async function verifyEmailToken(rawToken: string): Promise<VerifyEmailResult> {
  if (!rawToken || rawToken.length > 200) return { ok: false };

  const token = await db.emailVerificationToken.findUnique({ where: { tokenHash: hashToken(rawToken) } });
  if (!token || token.expiresAt < new Date()) return { ok: false };

  await db.$transaction([
    db.user.updateMany({ where: { id: token.userId, emailVerifiedAt: null }, data: { emailVerifiedAt: new Date() } }),
    db.emailVerificationToken.deleteMany({ where: { userId: token.userId } }),
  ]);
  return { ok: true, userId: token.userId };
}
