"use client";

import { resetPasswordAction } from "@/app/(auth)/actions";
import { ButtonLink } from "@/components/ui/button-link";
import { FormMessage } from "@/components/form/form-message";
import { PasswordField } from "@/components/form/password-field";
import { SubmitButton } from "@/components/form/submit-button";
import { useForm } from "@/components/form/use-form";
import { firstFieldErrors } from "@/lib/action-state";
import { newPasswordSchema } from "@/modules/auth/schemas";
import { AuthCard } from "./auth-card";

export function ResetPasswordForm({ token }: { token: string }) {
  const form = useForm(resetPasswordAction, {
    validate: (data) => {
      const parsed = newPasswordSchema.safeParse({ password: data.get("password") });
      return parsed.success ? null : firstFieldErrors(parsed.error);
    },
  });

  if (form.state?.ok) {
    return (
      <AuthCard title="Contraseña actualizada" description="Ya podés ingresar con tu contraseña nueva.">
        <ButtonLink size="lg" className="w-full" href="/login">Ingresar</ButtonLink>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Elegí una contraseña nueva">
      <form {...form.formProps} className="space-y-4">
        <FormMessage message={form.message} />
        <input type="hidden" name="token" value={token} />
        <PasswordField
          id="password"
          name="password"
          label="Contraseña nueva"
          autoComplete="new-password"
          showRules
          error={form.error("password")}
        />
        <SubmitButton size="lg" className="w-full" pending={form.pending}>
          Guardar contraseña
        </SubmitButton>
      </form>
    </AuthCard>
  );
}
