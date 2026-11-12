"use client";

import { useActionState } from "react";
import Link from "next/link";
import { loginAction } from "@/app/(auth)/actions";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/form/field";
import { FormMessage } from "@/components/form/form-message";
import { SubmitButton } from "@/components/form/submit-button";
import { AuthCard } from "./auth-card";

export function LoginForm() {
  const [state, action] = useActionState(loginAction, undefined);

  return (
    <AuthCard
      title="Hola de nuevo"
      description="Ingresá para ver tu agenda."
      footer={
        <>
          ¿Todavía no tenés cuenta?{" "}
          <Link href="/registro" className="font-medium text-primary underline-offset-4 hover:underline">
            Probala gratis
          </Link>
        </>
      }
    >
      <form action={action} className="space-y-4">
        <FormMessage message={state?.message} />
        <Field label="Email" htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="email" inputMode="email" required />
        </Field>
        <Field label="Contraseña" htmlFor="password">
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </Field>
        <SubmitButton className="w-full" pendingLabel="Ingresando…">
          Ingresar
        </SubmitButton>
        <p className="text-center text-sm">
          <Link
            href="/olvide-contrasena"
            className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Olvidé mi contraseña
          </Link>
        </p>
      </form>
    </AuthCard>
  );
}
