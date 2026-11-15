"use server";

import { revalidatePath } from "next/cache";
import { requireContext } from "@/lib/dal";
import { FORBIDDEN_MESSAGE } from "@/lib/permissions";
import type { ActionState } from "@/lib/action-state";
import { setKeepSelection, syncCapacityGrace } from "./capacity";

/**
 * El propietario elige quiénes siguen recibiendo reservas cuando su plan admite menos
 * profesionales activos que los que tiene. Solo quien puede gestionar la facturación.
 */
export async function saveKeepSelectionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireContext();
  if (!context.permissions.has("billing.manage")) return { message: FORBIDDEN_MESSAGE };
  if (!context.canWrite) return { message: "Tu cuenta está en modo de solo lectura." };

  const result = await setKeepSelection(context.organization.id, formData.getAll("keep").map(String));
  if (!result.ok) return { message: result.message };
  await syncCapacityGrace(context.organization.id);
  revalidatePath("/dashboard", "layout");
  return { ok: true, message: "Guardamos tu elección." };
}
