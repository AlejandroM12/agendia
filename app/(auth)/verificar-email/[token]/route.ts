import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { verifyEmailToken } from "@/modules/auth/email-verification";

/**
 * Destino del enlace de verificación que llega por email.
 *
 * Funciona con o sin sesión abierta (el enlace se puede abrir en otro
 * dispositivo). Si la sesión es de la misma cuenta, sigue directo a la
 * app; si no, lleva a ingresar.
 */
export async function GET(_request: Request, ctx: RouteContext<"/verificar-email/[token]">) {
  const { token } = await ctx.params;
  const session = await auth();

  const limited = !(await rateLimit(`verify-email:ip:${await clientIp()}`, 30, 3600)).allowed;
  const result = limited ? ({ ok: false } as const) : await verifyEmailToken(token);

  if (result.ok) {
    redirect(session?.user?.id === result.userId ? "/dashboard" : "/login?email=confirmado");
  }
  redirect(session?.user?.id ? "/verificar-email?enlace=invalido" : "/login?email=enlace-invalido");
}
