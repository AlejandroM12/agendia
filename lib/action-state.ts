import { z } from "zod";

/** Estado estándar que devuelven las server actions a `useActionState`. */
export type ActionState =
  | {
      ok?: boolean;
      message?: string;
      errors?: Record<string, string[] | undefined>;
    }
  | undefined;

export function fieldErrors(error: z.ZodError): Record<string, string[] | undefined> {
  return z.flattenError(error).fieldErrors as Record<string, string[] | undefined>;
}

export const firstError = (state: ActionState, field: string): string | null =>
  state?.errors?.[field]?.[0] ?? null;
