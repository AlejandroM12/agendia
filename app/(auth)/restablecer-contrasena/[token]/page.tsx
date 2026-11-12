import type { Metadata } from "next";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export const metadata: Metadata = { title: "Restablecer contraseña" };

// Ruta dinámica por token: no hay nada que pre-generar estáticamente.
export const instant = false;

export default async function ResetPasswordPage(
  props: PageProps<"/restablecer-contrasena/[token]">,
) {
  const { token } = await props.params;
  return <ResetPasswordForm token={token} />;
}
