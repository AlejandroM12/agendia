"use server";

import { revalidatePath } from "next/cache";
import { AuthError } from "next-auth";
import { signIn } from "@/auth";
import { requireContext } from "@/lib/dal";
import { db } from "@/lib/db";
import type { ActionState } from "@/lib/action-state";
import { clientIp, rateLimit, TOO_MANY_ATTEMPTS } from "@/lib/rate-limit";
import { processDueNotifications } from "@/modules/notifications/process";
import { enqueueReminderNow } from "@/modules/notifications/enqueue-demo";
import { countActivePublicDemos, createDemoWorkspace } from "./workspace";
import { DEMO, DEMO_BLOCKED_MESSAGE } from "./policy";

/**
 * Acciones de la demostración pública. Cada visitante recibe SU propio negocio ficticio (nunca se comparte con otro ni
 * con un negocio real); la sesión que se abre es la de ese negocio.
 *
 * Defensas: interruptor `DEMO_DISABLED=1`, tope de creaciones por IP, tope de demos vivas a la vez, y vencimiento con
 * borrado automático (modules/demo/cleanup.ts, desde el proceso periódico).
 */
async function openNewDemo(): Promise<ActionState> {
  if (process.env.DEMO_DISABLED === "1") return { message: "La demostración no está disponible en este momento." };

  const ip = await clientIp();
  if (!(await rateLimit(`demo:${ip}`, DEMO.createsPerIpPerHour, 3600)).allowed) return { message: TOO_MANY_ATTEMPTS };
  if ((await countActivePublicDemos()) >= DEMO.maxActivePublic) {
    return { message: "Hay muchas demostraciones en uso en este momento. Probá de nuevo en unos minutos." };
  }

  const demo = await createDemoWorkspace({ kind: "public" });
  try {
    await signIn("credentials", { email: demo.email, password: demo.password, redirectTo: "/dashboard/demo" });
  } catch (error) {
    if (error instanceof AuthError) return { message: "No pudimos abrir la demostración. Probá de nuevo." };
    throw error; // el redireccionamiento de una sesión iniciada también sale como excepción: se deja pasar
  }
}

export async function startDemoAction(_prev: ActionState): Promise<ActionState> {
  return openNewDemo();
}

/** Arranca una demo nueva desde cero (la anterior queda hasta su vencimiento). */
export async function restartDemoAction(_prev: ActionState): Promise<ActionState> {
  const { organization } = await requireContext();
  if (!organization.isDemo || organization.demoKind !== "public") return { message: DEMO_BLOCKED_MESSAGE };
  return openNewDemo();
}

/**
 * «Enviar el recordatorio ahora»: en la demo no hay que esperar al día anterior para ver cómo funciona. Encola el
 * recordatorio del turno, lo procesa en el momento y queda registrado como simulado (nada sale de verdad).
 */
export async function sendDemoReminderAction(appointmentId: string): Promise<ActionState> {
  const { organization } = await requireContext();
  if (!organization.isDemo) return { message: DEMO_BLOCKED_MESSAGE };
  const appointment = await db.appointment.findFirst({
    where: { id: appointmentId, organizationId: organization.id, status: "confirmed", startsAt: { gt: new Date() } },
    select: { id: true },
  });
  if (!appointment) return { message: "Ese turno ya no está disponible." };

  await enqueueReminderNow(organization.id, appointment.id);
  await processDueNotifications(10);
  revalidatePath("/dashboard/demo");
  return { ok: true, message: "Recordatorio enviado (simulado)." };
}
