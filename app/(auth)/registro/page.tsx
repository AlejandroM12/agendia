import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { AuthCard } from "@/components/auth/auth-card";
import { RegisterForm } from "@/components/auth/register-form";
import { brand } from "@/lib/brand";
import { isStandalone } from "@/lib/deployment";
import { teamPlansPublished } from "@/lib/features";
import { parsePlanTier } from "@/lib/plans";
import { getRegistrationStatus } from "@/modules/auth/registration";

export const metadata: Metadata = { title: "Crear cuenta" };
export const instant = false;

export default async function RegisterPage(props: PageProps<"/registro">) {
  // Depende de la configuración del servidor en ejecución, no del build.
  await connection();
  const status = await getRegistrationStatus();

  if (status.open) {
    const plan = teamPlansPublished() ? parsePlanTier((await props.searchParams).plan) : null;
    return <RegisterForm trial={!isStandalone()} plan={plan} />;
  }

  const footer = (
    <>
      ¿Ya tenés cuenta?{" "}
      <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
        Ingresar
      </Link>
    </>
  );

  if (status.reason === "standalone_already_set_up") {
    return (
      <AuthCard
        title="Registro cerrado"
        description="Esta instalación ya tiene su cuenta creada. Ingresá con tu email y contraseña."
        footer={footer}
      >
        <p className="text-sm text-muted-foreground">Si no recordás tus datos, usá «Olvidé mi contraseña» en la pantalla de ingreso.</p>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Todavía no abrimos el registro"
      description={`Estamos terminando de preparar ${brand.name} para recibir cuentas nuevas.`}
      footer={footer}
    >
      <p className="text-sm text-muted-foreground">
        Si querés ser de los primeros en usarla, escribinos a{" "}
        <a
          href={`mailto:${brand.contactEmail}?subject=${encodeURIComponent(`Quiero probar ${brand.name}`)}`}
          className="font-medium text-primary underline underline-offset-4"
        >
          {brand.contactEmail}
        </a>{" "}
        y te avisamos apenas esté disponible.
      </p>
    </AuthCard>
  );
}
