import { auth, signOut } from "@/auth";
import { db } from "@/lib/db";

/**
 * Cierra la sesión.
 *
 * Además de borrar la cookie, invalida la sesión en el servidor
 * (`sessionVersion + 1`): las sesiones son JWT, y sin esto una respuesta
 * que todavía estuviera en camino podría volver a escribir la cookie y
 * "revivir" la sesión después de salir. Con la versión incrementada, ese
 * token ya no pasa la verificación de lib/dal.ts.
 */
export async function GET() {
  const session = await auth();
  if (session?.user?.id) {
    await db.user.updateMany({
      where: { id: session.user.id, sessionVersion: session.user.sessionVersion },
      data: { sessionVersion: { increment: 1 } },
    });
  }
  await signOut({ redirectTo: "/login" });
}
