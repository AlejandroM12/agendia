import { z } from "zod";

/**
 * Datos de un cliente y su validación. Sin dependencias del servidor: la
 * página pública de reservas valida con este mismo esquema antes de enviar.
 */

/** Deja solo dígitos (y un "+" inicial) para comparar teléfonos escritos distinto. */
export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 6) return null;
  return trimmed.startsWith("+") ? `+${digits}` : digits;
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional()
    .transform((v) => v ?? null);

export const customerInputSchema = z.object({
  name: z.string().trim().min(2, "Ingresá el nombre.").max(120, "Máximo 120 caracteres."),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(200)
    .refine((v) => v === "" || z.email().safeParse(v).success, "Ingresá un email válido, como nombre@ejemplo.com.")
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  // Un teléfono que no se puede normalizar se guardaba vacío sin avisar: la
  // persona creía haber dejado un contacto y no era así.
  phone: z
    .string()
    .trim()
    .max(40, "Máximo 40 caracteres.")
    .refine((v) => v === "" || normalizePhone(v) !== null, "Ingresá un teléfono válido, con característica. Ej.: 11 5555 0000.")
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  notes: optionalText(2000),
});

export type CustomerInput = z.infer<typeof customerInputSchema>;

/**
 * Datos que deja un cliente al reservar desde la página pública: su nombre
 * y al menos una forma de contactarlo.
 */
export const bookingContactSchema = customerInputSchema
  .pick({ name: true, email: true, phone: true })
  .extend({ name: z.string().trim().min(2, "Ingresá tu nombre y apellido.").max(120, "Máximo 120 caracteres.") })
  .superRefine((data, ctx) => {
    if (!data.email && !data.phone) {
      const message = "Dejanos un email o un WhatsApp para poder avisarte.";
      ctx.addIssue({ code: "custom", path: ["email"], message });
      ctx.addIssue({ code: "custom", path: ["phone"], message });
    }
  });
