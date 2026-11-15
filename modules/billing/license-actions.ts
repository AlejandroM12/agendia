"use server";

import { redirect } from "next/navigation";
import { type ActionState, fieldErrors } from "@/lib/action-state";
import { isStandalone } from "@/lib/deployment";
import { clientIp, rateLimit, TOO_MANY_ATTEMPTS } from "@/lib/rate-limit";
import { createLicenseOrder, licenseOrderSchema } from "./licenses";

/**
 * Inicia la compra de la licencia: crea la orden y envía a la persona a
 * pagar en Mercado Pago. La orden NO queda pagada acá: se confirma cuando
 * Mercado Pago informa el pago (webhook, retorno o reconciliación).
 */
export async function startLicensePurchaseAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (isStandalone()) return { message: "Esta instalación no vende licencias." };

  if (!(await rateLimit(`license-order:${await clientIp()}`, 6, 3600)).allowed) {
    return { message: TOO_MANY_ATTEMPTS };
  }

  const parsed = licenseOrderSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    phone: formData.get("phone") ?? undefined,
    businessName: formData.get("businessName"),
    tier: formData.get("tier") ?? undefined,
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  if (formData.get("acceptTerms") !== "on") {
    return { message: "Para continuar tenés que aceptar las condiciones de la licencia." };
  }

  const result = await createLicenseOrder(parsed.data);
  if (!result.ok) return { message: result.error };

  redirect(result.checkoutUrl);
}
