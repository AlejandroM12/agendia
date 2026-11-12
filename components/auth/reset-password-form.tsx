"use client";

import { useActionState } from "react";
import { resetPasswordAction } from "@/app/(auth)/actions";
import { ButtonLink } from "@/components/ui/button-link";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/form/field";
import { FormMessage } from "@/components/form/form-message";
import { SubmitButton } from "@/components/form/submit-button";
import { AuthCard } from "./auth-card";

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action] = useActionState(resetPasswordAction, undefined);

  if (state?.ok) {
    return (
      <AuthCard title="Contraseña actualizada" description="Ya podés ingresar con tu contraseña nueva.">
        <ButtonLink className="w-full" href="/login">Ingresar</ButtonLink>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Elegí una contraseña nueva">
      <form action={action} className="space-y-4">
        <FormMessage message={state?.message} />
        <input type="hidden" name="token" value={token} />
        <Field label="Contraseña nueva" htmlFor="password" hint="Al menos 8 caracteres, con letras y números.">
          <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required />
        </Field>
        <SubmitButton className="w-full">Guardar contraseña</SubmitButton>
      </form>
    </AuthCard>
  );
}
