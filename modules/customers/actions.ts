"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireWriteContext } from "@/lib/dal";
import { type ActionState, fieldErrors } from "@/lib/action-state";
import { customerInputSchema, normalizePhone } from "./service";

function parse(formData: FormData) {
  return customerInputSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email") ?? "",
    phone: formData.get("phone") ?? "",
    notes: formData.get("notes") ?? "",
  });
}

/** Otro cliente de la organización con el mismo email o teléfono, si existe. */
async function findDuplicate(
  organizationId: string,
  data: { email: string | null; phone: string | null },
  exceptId?: string,
) {
  const conditions = [
    ...(data.email ? [{ email: data.email }] : []),
    ...(data.phone ? [{ phone: data.phone }] : []),
  ];
  if (conditions.length === 0) return null;
  return db.customer.findFirst({
    where: { organizationId, OR: conditions, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true, name: true },
  });
}

export async function createCustomerAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const access = await requireWriteContext();
  if (!access.ok) return { message: access.message };
  const organizationId = access.context.organization.id;

  const parsed = parse(formData);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const data = { ...parsed.data, phone: normalizePhone(parsed.data.phone) };

  const duplicate = await findDuplicate(organizationId, data);
  if (duplicate) {
    return { message: `Ya tenés un cliente con ese email o teléfono: ${duplicate.name}.` };
  }

  const customer = await db.customer.create({ data: { organizationId, ...data } });
  revalidatePath("/dashboard/clientes");
  redirect(`/dashboard/clientes/${customer.id}`);
}

export async function updateCustomerAction(
  customerId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const access = await requireWriteContext();
  if (!access.ok) return { message: access.message };
  const organizationId = access.context.organization.id;

  const parsed = parse(formData);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const data = { ...parsed.data, phone: normalizePhone(parsed.data.phone) };

  const duplicate = await findDuplicate(organizationId, data, customerId);
  if (duplicate) {
    return { message: `Otro cliente ya usa ese email o teléfono: ${duplicate.name}.` };
  }

  const result = await db.customer.updateMany({ where: { id: customerId, organizationId }, data });
  if (result.count === 0) return { message: "No encontramos ese cliente." };

  revalidatePath(`/dashboard/clientes/${customerId}`);
  return { ok: true, message: "Cambios guardados." };
}

export async function deleteCustomerAction(customerId: string): Promise<ActionState> {
  const access = await requireWriteContext();
  if (!access.ok) return { message: access.message };
  const organizationId = access.context.organization.id;

  const appointments = await db.appointment.count({ where: { customerId, organizationId } });
  if (appointments > 0) {
    return { message: "Este cliente tiene turnos en su historial y no se puede eliminar." };
  }

  await db.customer.deleteMany({ where: { id: customerId, organizationId } });
  revalidatePath("/dashboard/clientes");
  redirect("/dashboard/clientes");
}
