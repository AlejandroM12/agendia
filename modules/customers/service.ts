import "server-only";

import { z } from "zod";
import type { Customer, Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

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
  name: z.string().trim().min(2, "Ingresá el nombre.").max(120),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(200)
    .refine((v) => v === "" || z.email().safeParse(v).success, "Ingresá un email válido.")
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  phone: optionalText(40),
  notes: optionalText(2000),
});

export type CustomerInput = z.infer<typeof customerInputSchema>;

/** Deja solo dígitos (y un "+" inicial) para comparar teléfonos escritos distinto. */
export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 6) return null;
  return trimmed.startsWith("+") ? `+${digits}` : digits;
}

/**
 * Busca un cliente existente de la organización por email o teléfono; si no
 * hay coincidencia exacta, crea uno nuevo. Nunca fusiona por nombre: dos
 * personas distintas pueden llamarse igual.
 */
export async function findOrCreateCustomer(
  tx: Tx,
  organizationId: string,
  input: { name: string; email: string | null; phone: string | null },
): Promise<Customer> {
  const email = input.email?.toLowerCase() ?? null;
  const phone = normalizePhone(input.phone);

  let existing: Customer | null = null;
  if (email) {
    existing = await tx.customer.findFirst({ where: { organizationId, email } });
  }
  if (!existing && phone) {
    existing = await tx.customer.findFirst({ where: { organizationId, phone } });
  }

  if (existing) {
    // Completa datos de contacto faltantes, sin pisar los que ya tenía.
    const patch: Prisma.CustomerUpdateInput = {};
    if (!existing.email && email) patch.email = email;
    if (!existing.phone && phone) patch.phone = phone;
    if (Object.keys(patch).length === 0) return existing;
    return tx.customer.update({ where: { id: existing.id }, data: patch });
  }

  return tx.customer.create({
    data: { organizationId, name: input.name.trim(), email, phone },
  });
}
