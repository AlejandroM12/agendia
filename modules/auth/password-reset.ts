import "server-only";

import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/password";

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
 * Genera un token de recuperación de un solo uso.
 *
 * IMPORTANTE (placeholder explícito): el envío real por email vía Resend es
 * una funcionalidad de la Fase 4 (ver docs/ROADMAP.md). Hasta entonces, esta
 * función devuelve el enlace en texto plano para que la pantalla de "olvidé
 * mi contraseña" pueda mostrarlo directamente, en vez de simular un envío
 * que todavía no existe.
 *
 * Nunca revela si el email pertenece o no a una cuenta existente, para no
 * filtrar qué emails están registrados.
 */
export async function requestPasswordReset(
  rawInput: unknown,
): Promise<RequestPasswordResetResult> {
  const parsed = requestPasswordResetSchema.safeParse(rawInput);
  if (!parsed.success) return { requested: false };

  const user = await db.user.findUnique({ where: { email: parsed.data.email } });
  if (!user) {
    // Respuesta idéntica al caso exitoso: no se filtra la existencia del email.
    return { requested: true };
  }

  const rawToken = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

  await db.passwordResetToken.create({
    data: { userId: user.id, tokenHash, expiresAt },
  });

  return {
    requested: true,
    devResetLink: `/restablecer-contrasena/${rawToken}`,
  };
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
    db.user.update({ where: { id: resetToken.userId }, data: { passwordHash } }),
    db.passwordResetToken.update({
      where: { id: resetToken.id },
      data: { usedAt: new Date() },
    }),
  ]);

  return { success: true };
}
