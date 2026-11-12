import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/password";

const credentialsSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Sesiones por JWT: no hay tabla de sesiones en base de datos todavía.
  // El proveedor Credentials de Auth.js solo admite esta estrategia.
  // Ver docs/ARCHITECTURE.md §3.
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Contraseña", type: "password" },
      },
      async authorize(rawCredentials) {
        const parsed = credentialsSchema.safeParse(rawCredentials);
        if (!parsed.success) return null;

        const { email, password } = parsed.data;

        const user = await db.user.findUnique({
          where: { email },
          include: { memberships: { take: 1 } },
        });
        if (!user) return null;

        const isValid = await verifyPassword(password, user.passwordHash);
        if (!isValid) return null;

        const membership = user.memberships[0];

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          organizationId: membership?.organizationId ?? null,
          role: membership?.role ?? null,
        };
      },
    }),
  ],
  callbacks: {
    // El payload del JWT debe contener lo mínimo necesario para autorizar
    // (ver guía de Next.js sobre sesiones: nunca datos sensibles).
    async jwt({ token, user }) {
      if (user) {
        token.organizationId = user.organizationId;
        token.role = user.role;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub as string;
        session.user.organizationId = token.organizationId as string | null;
        session.user.role = token.role as string | null;
      }
      return session;
    },
  },
});
