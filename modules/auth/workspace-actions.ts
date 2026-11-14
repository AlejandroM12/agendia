"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ACTIVE_ORGANIZATION_COOKIE, requireContext } from "@/lib/dal";
import { db } from "@/lib/db";

/**
 * Cambiar de negocio. La cookie solo guarda una pista: antes de guardarla se
 * verifica en la base de datos que la persona tiene hoy una membresía en ese
 * negocio, y en cada request lib/dal.ts vuelve a verificarlo. Un
 * identificador ajeno no cambia nada.
 */
export async function switchWorkspaceAction(organizationId: string): Promise<void> {
  const context = await requireContext();
  if (typeof organizationId !== "string" || organizationId.length > 64) return;

  const membership = await db.membership.findFirst({
    where: { userId: context.user.id, organizationId },
    select: { id: true },
  });
  if (!membership) return;

  (await cookies()).set(ACTIVE_ORGANIZATION_COOKIE, organizationId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath("/", "layout");
  redirect("/dashboard");
}
