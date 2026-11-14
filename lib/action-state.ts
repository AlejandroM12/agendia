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

/** Primer mensaje de cada campo, para validar en el navegador con el mismo esquema que el servidor. */
export function firstFieldErrors(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "");
    if (field && !(field in result)) result[field] = issue.message;
  }
  return result;
}
