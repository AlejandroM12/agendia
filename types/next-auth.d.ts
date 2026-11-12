import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      organizationId: string | null;
      role: string | null;
      sessionVersion: number;
    } & DefaultSession["user"];
  }

  interface User {
    organizationId?: string | null;
    role?: string | null;
    sessionVersion?: number;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    organizationId?: string | null;
    role?: string | null;
    sessionVersion?: number;
  }
}
