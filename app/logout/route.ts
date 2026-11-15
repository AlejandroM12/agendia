import { auth, signOut } from "@/auth";
import { db } from "@/lib/db";
import { revokeSession } from "@/lib/sessions";

/**
 * Cierra la sesión.
 *
 * Además de borrar la cookie, invalida la sesión en el servidor: las sesiones son JWT, y sin esto una
 * respuesta que todavía estuviera en camino podría volver a escribir la cookie y "revivir" la sesión
 * después de salir.
 *
 * - Sesión con `sid` (la normal): se revoca SOLO esa sesión; las de otros dispositivos siguen abiertas.
 * - Sesión anterior a `user_sessions` (sin `sid`): se invalida con `sessionVersion + 1`, como siempre
 *   (cierra todas las de ese tipo).
 */
export async function GET() {
  const session = await auth();
  if (session?.user?.id) {
    if (session.user.sid) {
      await revokeSession(session.user.id, session.user.sid);
    } else {
      await db.user.updateMany({
        where: { id: session.user.id, sessionVersion: session.user.sessionVersion },
        data: { sessionVersion: { increment: 1 } },
      });
    }
  }
  await signOut({ redirectTo: "/login" });
}
