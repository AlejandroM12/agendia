import { z } from "zod";

export const weeklyRuleSchema = z
  .object({
    weekday: z.number().int().min(0).max(6),
    startMinute: z.number().int().min(0).max(1439),
    endMinute: z.number().int().min(1).max(1440),
  })
  .refine((r) => r.endMinute > r.startMinute, "El horario de cierre debe ser posterior al de apertura.");

export type WeeklyRule = z.infer<typeof weeklyRuleSchema>;

/** Horario semanal completo: sin franjas superpuestas dentro de un mismo día. */
export const weeklyRulesSchema = z
  .array(weeklyRuleSchema)
  .max(21)
  .refine((rules) => {
    for (let weekday = 0; weekday <= 6; weekday++) {
      const day = rules.filter((r) => r.weekday === weekday).sort((a, b) => a.startMinute - b.startMinute);
      for (let i = 1; i < day.length; i++) {
        if (day[i].startMinute < day[i - 1].endMinute) return false;
      }
    }
    return true;
  }, "Hay franjas horarias que se superponen en un mismo día.");

/** Lunes a viernes de 9 a 18: el punto de partida del onboarding. */
export const DEFAULT_WEEKLY_RULES: WeeklyRule[] = [1, 2, 3, 4, 5].map((weekday) => ({
  weekday,
  startMinute: 9 * 60,
  endMinute: 18 * 60,
}));

export function parseJsonField<T>(schema: z.ZodType<T>, raw: FormDataEntryValue | null) {
  try {
    return schema.safeParse(JSON.parse(String(raw ?? "")));
  } catch {
    return schema.safeParse(undefined);
  }
}
