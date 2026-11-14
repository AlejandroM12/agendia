"use client";

import { Input } from "@/components/ui/input";
import { Field } from "@/components/form/field";
import { FormMessage } from "@/components/form/form-message";
import { SubmitButton } from "@/components/form/submit-button";
import { useForm } from "@/components/form/use-form";
import { updateAccountNameAction, updateMyNotificationsAction } from "@/modules/auth/account-actions";

export function AccountNameForm({ name }: { name: string }) {
  const form = useForm(updateAccountNameAction);
  return (
    <form {...form.formProps} className="max-w-md space-y-4">
      <Field label="Tu nombre" htmlFor="name" error={form.error("name")}>
        <Input id="name" name="name" defaultValue={name} required minLength={2} maxLength={120} autoComplete="name" />
      </Field>
      <FormMessage message={form.message} tone={form.state?.ok ? "success" : "error"} />
      <SubmitButton pending={form.pending} variant="outline">Guardar nombre</SubmitButton>
    </form>
  );
}

export function MyNotificationsForm({ enabled, label, hint }: { enabled: boolean; label: string; hint: string }) {
  const form = useForm(updateMyNotificationsAction);
  return (
    <form {...form.formProps} className="max-w-md space-y-4">
      <label className="flex cursor-pointer items-start gap-3 text-sm">
        <input type="checkbox" name="notifyBookings" defaultChecked={enabled} className="mt-0.5 size-5 accent-[var(--primary)]" />
        <span>
          <span className="font-medium">{label}</span>
          <span className="block text-muted-foreground">{hint}</span>
        </span>
      </label>
      <FormMessage message={form.message} tone={form.state?.ok ? "success" : "error"} />
      <SubmitButton pending={form.pending} variant="outline">Guardar</SubmitButton>
    </form>
  );
}
