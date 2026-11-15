import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/login-form";
import { safeCallbackPath } from "@/lib/safe-redirect";

export const metadata: Metadata = { title: "Iniciar sesión" };
export const instant = false;

const NOTICES: Record<string, { message: string; tone: "success" | "error" }> = {
  confirmado: { message: "Tu email quedó confirmado. Ingresá para continuar.", tone: "success" },
  "enlace-invalido": {
    message: "Ese enlace no es válido o ya venció. Ingresá y te enviamos uno nuevo.",
    tone: "error",
  },
};

export default async function LoginPage(props: PageProps<"/login">) {
  const params = await props.searchParams;
  const email = params.email;
  return <LoginForm notice={typeof email === "string" ? NOTICES[email] : undefined} callbackUrl={safeCallbackPath(params.callbackUrl)} />;
}
