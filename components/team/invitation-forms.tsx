"use client";

import { useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/form/field";
import { FormMessage } from "@/components/form/form-message";
import { PasswordField } from "@/components/form/password-field";
import { SubmitButton } from "@/components/form/submit-button";
import { useForm } from "@/components/form/use-form";
import { acceptInvitationAction, acceptInvitationAsNewUserAction } from "@/modules/auth/invitation-actions";

/** Aceptar con la cuenta con la que ya se inició sesión. */
export function AcceptWithAccountButton({ token }: { token: string }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <FormMessage message={message} />
      <Button
        size="lg"
        className="w-full"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await acceptInvitationAction(token);
            if (result?.message) setMessage(result.message);
          })
        }
      >
        {pending ? "Aceptando…" : "Aceptar la invitación"}
      </Button>
    </div>
  );
}

/** Sin cuenta: nombre y contraseña, y se entra directo. */
export function NewAccountForm({ token, email }: { token: string; email: string }) {
  const form = useForm(acceptInvitationAsNewUserAction.bind(null, token));
  return (
    <form {...form.formProps} className="space-y-4">
      <p className="rounded-xl bg-secondary px-4 py-3 text-sm">
        Vas a ingresar con <strong className="break-all">{email}</strong>.
      </p>
      <Field label="Tu nombre" htmlFor="name" error={form.error("name")}>
        <Input id="name" name="name" required minLength={2} maxLength={120} autoComplete="name" />
      </Field>
      <PasswordField id="password" name="password" label="Elegí una contraseña" autoComplete="new-password" error={form.error("password")} />
      <FormMessage message={form.message} />
      <SubmitButton size="lg" className="w-full" pending={form.pending} pendingLabel="Creando tu acceso…">
        Aceptar y entrar a mi agenda
      </SubmitButton>
    </form>
  );
}
