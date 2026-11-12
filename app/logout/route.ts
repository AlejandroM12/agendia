import { signOut } from "@/auth";

// Cierra una sesión que dejó de ser válida (ver lib/dal.ts) y vuelve al login.
export async function GET() {
  await signOut({ redirectTo: "/login" });
}
