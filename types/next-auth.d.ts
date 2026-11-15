import type { DefaultSession } from "next-auth";

// El token y la sesión NO llevan negocio ni rol (ver auth.ts y lib/dal.ts):
// se resuelven en el servidor en cada pedido.
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      sessionVersion: number;
      /** Id de esta sesión en `user_sessions` (ausente en sesiones anteriores a su introducción). */
      sid?: string;
    } & DefaultSession["user"];
  }

  interface User {
    sessionVersion?: number;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    sessionVersion?: number;
    sid?: string;
  }
}
