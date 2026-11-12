"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireWriteContext } from "@/lib/dal";
import { type ActionState, fieldErrors } from "@/lib/action-state";
import { serviceInputSchema } from "./schema";

function parse(formData: FormData) {
  return serviceInputSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") ?? undefined,
    durationMinutes: formData.get("durationMinutes"),
    price: formData.get("price"),
  });
}

export async function createServiceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const access = await requireWriteContext();
  if (!access.ok) return { message: access.message };
  const organizationId = access.context.organization.id;

  const parsed = parse(formData);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const last = await db.service.aggregate({ where: { organizationId }, _max: { sortOrder: true } });
  await db.service.create({
    data: { organizationId, ...parsed.data, sortOrder: (last._max.sortOrder ?? -1) + 1 },
  });

  revalidatePath("/dashboard/servicios");
  redirect("/dashboard/servicios");
}

export async function updateServiceAction(
  serviceId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const access = await requireWriteContext();
  if (!access.ok) return { message: access.message };

  const parsed = parse(formData);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  // updateMany con organizationId: nunca toca un servicio de otra organización.
  const result = await db.service.updateMany({
    where: { id: serviceId, organizationId: access.context.organization.id },
    data: parsed.data,
  });
  if (result.count === 0) return { message: "No encontramos ese servicio." };

  revalidatePath("/dashboard/servicios");
  redirect("/dashboard/servicios");
}

export async function setServiceActiveAction(serviceId: string, active: boolean): Promise<void> {
  const access = await requireWriteContext();
  if (!access.ok) return;
  await db.service.updateMany({
    where: { id: serviceId, organizationId: access.context.organization.id },
    data: { active },
  });
  revalidatePath("/dashboard/servicios");
}

export async function moveServiceAction(serviceId: string, direction: "up" | "down"): Promise<void> {
  const access = await requireWriteContext();
  if (!access.ok) return;
  const organizationId = access.context.organization.id;

  const services = await db.service.findMany({
    where: { organizationId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true },
  });
  const index = services.findIndex((s) => s.id === serviceId);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index === -1 || target < 0 || target >= services.length) return;

  [services[index], services[target]] = [services[target], services[index]];
  await db.$transaction(
    services.map((service, sortOrder) =>
      db.service.updateMany({ where: { id: service.id, organizationId }, data: { sortOrder } }),
    ),
  );
  revalidatePath("/dashboard/servicios");
}

export async function deleteServiceAction(serviceId: string): Promise<ActionState> {
  const access = await requireWriteContext();
  if (!access.ok) return { message: access.message };
  const organizationId = access.context.organization.id;

  const used = await db.appointment.count({ where: { serviceId, organizationId } });
  if (used > 0) {
    // Con turnos asociados se conserva el historial: se desactiva en vez de borrar.
    await db.service.updateMany({ where: { id: serviceId, organizationId }, data: { active: false } });
  } else {
    await db.service.deleteMany({ where: { id: serviceId, organizationId } });
  }

  revalidatePath("/dashboard/servicios");
  redirect("/dashboard/servicios");
}
