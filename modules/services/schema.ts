import { z } from "zod";

export const DURATION_OPTIONS = [15, 20, 30, 40, 45, 50, 60, 75, 90, 105, 120, 150, 180, 240] as const;

const price = z
  .union([z.string(), z.number(), z.null(), z.undefined()])
  .transform((value) => {
    if (value === null || value === undefined || value === "") return null;
    const n = typeof value === "number" ? value : Number(String(value).replace(/[^\d]/g, ""));
    return Number.isFinite(n) ? Math.round(n) : NaN;
  })
  .refine((v) => v === null || (Number.isInteger(v) && v >= 0 && v <= 100_000_000), "Ingresá un precio válido.");

export const serviceInputSchema = z.object({
  name: z.string().trim().min(2, "Ingresá el nombre del servicio.").max(80),
  description: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((v) => (v ? v : null)),
  durationMinutes: z.coerce
    .number()
    .int()
    .min(5, "La duración mínima es de 5 minutos.")
    .max(600, "La duración máxima es de 10 horas."),
  price,
});

export type ServiceInput = z.infer<typeof serviceInputSchema>;

export const serviceListSchema = z
  .array(serviceInputSchema)
  .min(1, "Agregá al menos un servicio.")
  .max(20);
