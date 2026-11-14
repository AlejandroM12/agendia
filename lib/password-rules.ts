import { z } from "zod";

/**
 * Requisitos de contraseña de Agendia: la única definición.
 *
 * De esta lista salen el esquema que valida el servidor (registro, cambio y
 * restablecimiento de contraseña) y los indicadores que ve la persona
 * mientras escribe. Cambiar un requisito acá lo cambia en todos lados.
 *
 * Sin dependencias del servidor: se importa también desde el navegador.
 */
export const PASSWORD_RULES = [
  { id: "length", label: "Al menos 8 caracteres", test: (value: string) => value.length >= 8, message: "Debe tener al menos 8 caracteres." },
  { id: "letter", label: "Al menos una letra", test: (value: string) => /[a-zA-Z]/.test(value), message: "Debe contener al menos una letra." },
  { id: "number", label: "Al menos un número", test: (value: string) => /[0-9]/.test(value), message: "Debe contener al menos un número." },
] as const;

export const passwordSchema = PASSWORD_RULES.reduce<z.ZodType<string>>(
  (schema, rule) => schema.refine(rule.test, rule.message),
  z.string(),
);

/** Estado de cada requisito para una contraseña a medio escribir. */
export function checkPassword(value: string): Array<{ id: string; label: string; met: boolean }> {
  return PASSWORD_RULES.map((rule) => ({ id: rule.id, label: rule.label, met: rule.test(value) }));
}
