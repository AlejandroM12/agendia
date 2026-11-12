"use client";

import { useActionState } from "react";
import Link from "next/link";
import { registerAction } from "@/app/(auth)/actions";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/form/field";
import { FormMessage } from "@/components/form/form-message";
import { SubmitButton } from "@/components/form/submit-button";
import { trialPolicy } from "@/lib/brand";
import { AuthCard } from "./auth-card";

export function RegisterForm() {
  const [state, action] = useActionState(registerAction, undefined);
  const error = (field: string) => state?.errors?.[field]?.[0];

  return (
    <AuthCard
      title="Creá tu cuenta"
      description={`${trialPolicy.trialDays} días gratis. Sin tarjeta.`}
      footer={
        <>
          ¿Ya tenés cuenta?{" "}
          <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
            Ingresar
          </Link>
        </>
      }
    >
      <form action={action} className="space-y-4">
        <FormMessage message={state?.message} />
        <Field label="Tu nombre" htmlFor="name" error={error("name")}>
          <Input id="name" name="name" autoComplete="name" required />
        </Field>
        <Field label="Email" htmlFor="email" error={error("email")}>
          <Input id="email" name="email" type="email" autoComplete="email" inputMode="email" required />
        </Field>
        <Field
          label="Contraseña"
          htmlFor="password"
          error={error("password")}
          hint="Al menos 8 caracteres, con letras y números."
        >
          <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required />
        </Field>
        <SubmitButton className="w-full" pendingLabel="Creando tu cuenta…">
          Empezar gratis
        </SubmitButton>
      </form>
    </AuthCard>
  );
}
