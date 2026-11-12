import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { AuthCard } from "@/components/auth/auth-card";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { brand } from "@/lib/brand";
import { isEmailConfigured } from "@/modules/notifications/email";

export const metadata: Metadata = { title: "Recuperar contraseña" };
export const instant = false;

export default async function ForgotPasswordPage() {
  await connection();

  // Sin canal de email en producción no se promete un envío que no va a
  // ocurrir: se deriva a soporte. (En desarrollo el formulario muestra el
  // enlace en pantalla.)
  if (process.env.NODE_ENV === "production" && !isEmailConfigured()) {
    return (
      <AuthCard
        title="Recuperar contraseña"
        description="La recuperación automática por email no está disponible en este momento."
        footer={
          <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
            Volver a ingresar
          </Link>
        }
      >
        <p className="text-sm text-muted-foreground">
          Escribinos a{" "}
          <a href={`mailto:${brand.contactEmail}`} className="font-medium text-primary underline underline-offset-4">
            {brand.contactEmail}
          </a>{" "}
          desde el email de tu cuenta y te ayudamos a recuperar el acceso.
        </p>
      </AuthCard>
    );
  }

  return <ForgotPasswordForm />;
}
