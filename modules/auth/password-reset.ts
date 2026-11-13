import "server-only";

import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { brand } from "@/lib/brand";
import { isEmailConfigured, sendEmail } from "@/modules/notifications/email";
import { renderEmail } from "@/modules/notifications/templates";

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hora

function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export const requestPasswordResetSchema = z.object({
  email: z.email().trim().toLowerCase(),
});

export type RequestPasswordResetResult =
  | { requested: true; devResetLink?: string }
  | { requested: false };

/**
 * Genera un token de recuperación de un solo uso y lo envía por email.
 *
 * Nunca revela si el email pertenece o no a una cuenta: la respuesta es la
 * misma en ambos casos.
 *
 * `devResetLink` solo existe fuera de producción y cuando el canal de email
 * no está configurado, para poder probar el flujo en desarrollo. En
 * producción el enlace viaja únicamente por email.
 */
export async function requestPasswordReset(
  rawInput: unknown,
): Promise<RequestPasswordResetResult> {
  const parsed = requestPasswordResetSchema.safeParse(rawInput);
  if (!parsed.success) return { requested: false };

  const user = await db.user.findUnique({ where: { email: parsed.data.email } });
  if (!user) return { requested: true };

  const rawToken = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

  await db.passwordResetToken.create({
    data: { userId: user.id, tokenHash, expiresAt },
  });

  const path = `/restablecer-contrasena/${rawToken}`;

  if (isEmailConfigured()) {
    const result = await sendEmail({
      to: user.email,
      subject: `Restablecé tu contraseña de ${brand.name}`,
      ...renderEmail({
        heading: "Restablecé tu contraseña",
        paragraphs: [
          `Hola ${user.name}, recibimos un pedido para cambiar la contraseña de tu cuenta.`,
          "El enlace vence en una hora. Si no fuiste vos, podés ignorar este mensaje.",
        ],
        action: { label: "Elegir una contraseña nueva", url: `${brand.url}${path}` },
      }),
    });
    if (!result.ok) console.error("[password-reset] no se pudo enviar el email:", result.error);
    return { requested: true };
  }

  if (process.env.NODE_ENV !== "production") {
    return { requested: true, devResetLink: path };
  }

  console.error("[password-reset] canal de email sin configurar: no se envió el enlace de recuperación.");
  return { requested: true };
}

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z
    .string()
    .min(8, "Debe tener al menos 8 caracteres.")
    .regex(/[a-zA-Z]/, "Debe contener al menos una letra.")
    .regex(/[0-9]/, "Debe contener al menos un número."),
});

export type ResetPasswordResult = { success: true } | { success: false; error: string };

export async function resetPassword(rawInput: unknown): Promise<ResetPasswordResult> {
  const parsed = resetPasswordSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { success: false, error: "Datos inválidos." };
  }

  const tokenHash = hashToken(parsed.data.token);
  const resetToken = await db.passwordResetToken.findUnique({ where: { tokenHash } });

  if (!resetToken || resetToken.usedAt || resetToken.expiresAt < new Date()) {
    return { success: false, error: "El enlace es inválido o venció. Solicitá uno nuevo." };
  }

  const passwordHash = await hashPassword(parsed.data.password);

  await db.$transaction([
    // sessionVersion + 1 cierra cualquier sesión abierta con la contraseña anterior.
    db.user.update({
      where: { id: resetToken.userId },
      data: { passwordHash, sessionVersion: { increment: 1 } },
    }),
    // Llegar hasta acá prueba que la persona controla la casilla.
    db.user.updateMany({
      where: { id: resetToken.userId, emailVerifiedAt: null },
      data: { emailVerifiedAt: new Date() },
    }),
    db.passwordResetToken.update({
      where: { id: resetToken.id },
      data: { usedAt: new Date() },
    }),
  ]);

  return { success: true };
}
