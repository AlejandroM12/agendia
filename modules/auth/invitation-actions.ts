"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { signIn } from "@/auth";
import { ACTIVE_ORGANIZATION_COOKIE, getCurrentSession } from "@/lib/dal";
import { db } from "@/lib/db";
import { type ActionState } from "@/lib/action-state";
import { clientIp, rateLimit, TOO_MANY_ATTEMPTS } from "@/lib/rate-limit";
import { isSessionActive } from "@/lib/sessions";
import { acceptInvitationWithAccount, acceptInvitationWithNewAccount } from "@/modules/team/invitations";

/**
 * Aceptar una invitación (público, a partir del token). Todo se valida en el
 * servidor: el token, el correo de quien acepta y el estado del negocio, del
 * profesional y de la invitación en el momento de aceptar.
 */

/** Con una cuenta que ya existe: hay que haber iniciado sesión con el correo invitado. */
export async function acceptInvitationAction(token: string): Promise<ActionState> {
  if (!(await rateLimit(`invitation:accept:${await clientIp()}`, 20, 3600)).allowed) return { message: TOO_MANY_ATTEMPTS };

  const session = await getCurrentSession();
  if (!session?.user?.id) return { message: "Iniciá sesión para aceptar la invitación." };
  const user = await db.user.findUnique({ where: { id: session.user.id }, select: { id: true, email: true, sessionVersion: true } });
  if (!user || user.sessionVersion !== session.user.sessionVersion) return { message: "Tu sesión venció. Ingresá de nuevo." };
  if (session.user.sid && !(await isSessionActive(user.id, session.user.sid))) return { message: "Tu sesión venció. Ingresá de nuevo." };

  const result = await acceptInvitationWithAccount(String(token), user);
  if (!result.ok) return { message: result.message };

  // Entra directo al negocio nuevo; sus otros negocios siguen en el selector.
  (await cookies()).set(ACTIVE_ORGANIZATION_COOKIE, result.organizationId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath("/", "layout");
  redirect("/dashboard");
}

/** Sin cuenta: se elige el nombre y la contraseña, y se entra directo a la agenda. */
export async function acceptInvitationAsNewUserAction(token: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!(await rateLimit(`invitation:accept:${await clientIp()}`, 20, 3600)).allowed) return { message: TOO_MANY_ATTEMPTS };

  const password = String(formData.get("password") ?? "");
  const result = await acceptInvitationWithNewAccount(String(token), { name: String(formData.get("name") ?? ""), password });
  if (!result.ok) {
    if (result.code === "weak_password") return { errors: { password: [result.message] }, message: "Revisá los datos marcados." };
    if (result.code === "name") return { errors: { name: [result.message] }, message: "Revisá los datos marcados." };
    return { message: result.message };
  }

  try {
    await signIn("credentials", { email: result.email, password, redirectTo: "/dashboard" });
  } catch (error) {
    if (error instanceof AuthError) {
      return { message: "Tu cuenta quedó creada, pero no pudimos iniciar sesión automáticamente. Ingresá con tu correo y tu contraseña." };
    }
    throw error;
  }
}
