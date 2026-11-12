"use client";

import { useActionState } from "react";
import Link from "next/link";
import { requestPasswordResetAction } from "@/app/(auth)/actions";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/form/field";
import { FormMessage } from "@/components/form/form-message";
import { SubmitButton } from "@/components/form/submit-button";
import { AuthCard } from "./auth-card";

export function ForgotPasswordForm() {
  const [state, action] = useActionState(requestPasswordResetAction, undefined);

  return (
    <AuthCard
      title="Recuperar contraseña"
      description="Ingresá tu email y te enviamos un enlace para elegir una nueva."
      footer={
        <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
          Volver a ingresar
        </Link>
      }
    >
      <form action={action} className="space-y-4">
        <FormMessage message={state?.message} tone="info" />
        {state?.devResetLink && (
          <p className="rounded-lg border border-dashed border-warning/50 bg-warning-soft px-3 py-2.5 text-sm text-warning">
            Modo desarrollo: el envío de emails no está configurado, así que el enlace se muestra
            acá.{" "}
            <Link href={state.devResetLink} className="font-medium underline">
              Abrir enlace
            </Link>
          </p>
        )}
        <Field label="Email" htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="email" inputMode="email" required />
        </Field>
        <SubmitButton className="w-full" pendingLabel="Enviando…">
          Enviar enlace
        </SubmitButton>
      </form>
    </AuthCard>
  );
}
