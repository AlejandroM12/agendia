import { z } from "zod";
import { passwordSchema } from "@/lib/password-rules";

/**
 * Esquemas de los formularios de cuenta. Sin dependencias del servidor: el
 * navegador valida con ellos antes de enviar y el servidor vuelve a validar
 * con los mismos al recibir.
 */

export const emailSchema = z.email("Ingresá un email válido, como nombre@ejemplo.com.").trim().toLowerCase();

export const registerSchema = z.object({
  name: z.string().trim().min(2, "Ingresá tu nombre.").max(120, "Máximo 120 caracteres."),
  email: emailSchema,
  password: passwordSchema,
});

export const newPasswordSchema = z.object({ password: passwordSchema });

export const changePasswordSchema = z.object({
  current: z.string().min(1, "Ingresá tu contraseña actual."),
  next: passwordSchema,
});
