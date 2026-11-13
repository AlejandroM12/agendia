import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth/auth-card";
import { ResendVerificationForm } from "@/components/auth/resend-verification-form";
import { FormMessage } from "@/components/form/form-message";
import { requireSignedInUser } from "@/lib/dal";

export const metadata: Metadata = { title: "Confirmá tu email", robots: { index: false } };
export const instant = false;

export default async function VerifyEmailPage(props: PageProps<"/verificar-email">) {
  const { user, emailVerified } = await requireSignedInUser();
  if (emailVerified) redirect("/dashboard");

  const invalidLink = (await props.searchParams).enlace === "invalido";

  return (
    <AuthCard
      title="Confirmá tu email"
      description="Es un solo paso, para asegurarnos de que la cuenta es tuya y de que vas a poder recuperarla."
      footer={
        <>
          ¿Te equivocaste de email?{" "}
          {/* /logout es un route handler: tiene que ser una navegación completa. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/logout" className="font-medium text-primary underline-offset-4 hover:underline">
            Salir y crear la cuenta de nuevo
          </a>
        </>
      }
    >
      <div className="space-y-4">
        {invalidLink && <FormMessage message="Ese enlace no es válido o ya venció. Pedí uno nuevo." />}
        <p className="text-sm">
          Te enviamos un enlace a <strong className="break-all">{user.email}</strong>. Abrilo para empezar a usar tu
          agenda.
        </p>
        <p className="text-sm text-muted-foreground">
          Puede demorar un par de minutos. Si no lo ves, revisá la carpeta de correo no deseado.
        </p>
        <ResendVerificationForm />
      </div>
    </AuthCard>
  );
}
