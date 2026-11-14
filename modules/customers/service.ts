import "server-only";

import type { Customer, Prisma } from "@prisma/client";
import { normalizePhone } from "./schema";

type Tx = Prisma.TransactionClient;

export { customerInputSchema, normalizePhone, type CustomerInput } from "./schema";

/**
 * Busca un cliente existente de la organización por email o teléfono; si no
 * hay coincidencia exacta, crea uno nuevo. Nunca fusiona por nombre: dos
 * personas distintas pueden llamarse igual.
 */
export async function findOrCreateCustomer(
  tx: Tx,
  organizationId: string,
  input: { name: string; email: string | null; phone: string | null },
  options: { completeMissingContact?: boolean } = {},
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
    // Solo el profesional puede completar datos faltantes de una ficha (sin
    // pisar los que ya tenía). Una reserva pública nunca modifica un cliente
    // existente: cualquiera podría escribir el email de otra persona.
    if (!options.completeMissingContact) return existing;
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
