"use client";

import Link from "next/link";
import { resendVerificationAction } from "@/app/(auth)/actions";
import { FormMessage } from "@/components/form/form-message";
import { SubmitButton } from "@/components/form/submit-button";
import { useForm } from "@/components/form/use-form";

export function ResendVerificationForm() {
  const form = useForm(resendVerificationAction);

  return (
    <form {...form.formProps} className="space-y-3">
      <FormMessage message={form.message} tone={form.state?.ok ? "success" : "error"} />
      {form.state?.devVerificationLink && (
        <p className="rounded-lg border border-dashed border-warning/50 bg-warning-soft px-3 py-2.5 text-sm text-warning">
          Modo desarrollo: el envío de emails no está configurado, así que el enlace se muestra acá.{" "}
          <Link href={form.state.devVerificationLink} prefetch={false} className="font-medium underline">
            Abrir enlace
          </Link>
        </p>
      )}
      <SubmitButton variant="outline" className="w-full" pending={form.pending} pendingLabel="Enviando…">
        Enviar el enlace de nuevo
      </SubmitButton>
    </form>
  );
}
