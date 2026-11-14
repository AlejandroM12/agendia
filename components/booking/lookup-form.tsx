"use client";

import Link from "next/link";
import { MailCheck } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/form/field";
import { FormMessage } from "@/components/form/form-message";
import { SubmitButton } from "@/components/form/submit-button";
import { useForm } from "@/components/form/use-form";
import { requestAppointmentsLinkAction } from "@/modules/booking/actions";

/** Pedir por email el enlace para consultar los turnos propios en un negocio. */
export function LookupForm({ slug }: { slug: string }) {
  const form = useForm(requestAppointmentsLinkAction);

  if (form.state?.ok) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 text-center" role="status">
        <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
          <MailCheck className="size-6" aria-hidden="true" />
        </span>
        <p className="mt-4 font-medium">Revisá tu email</p>
        <p className="mt-1.5 text-sm text-muted-foreground">{form.state.message}</p>
        {form.state.devLink && (
          <p className="mt-4 rounded-lg border border-dashed border-warning/50 bg-warning-soft px-3 py-2.5 text-sm text-warning">
            Modo desarrollo: el envío de emails no está configurado, así que el enlace se muestra acá.{" "}
            <Link href={form.state.devLink} prefetch={false} className="font-medium underline">
              Abrir enlace
            </Link>
          </p>
        )}
      </div>
    );
  }

  return (
    <form {...form.formProps} className="space-y-4">
      <input type="hidden" name="slug" value={slug} />
      {/* Campo trampa anti-bots: invisible para personas y lectores de pantalla. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          No completar
          <input type="text" name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <Field label="Tu email" htmlFor="lookup-email" hint="El mismo que usaste al reservar." error={form.error("email")}>
        <Input id="lookup-email" name="email" type="email" inputMode="email" autoComplete="email" required />
      </Field>
      <FormMessage message={form.message} />
      <SubmitButton pending={form.pending} size="lg" className="w-full" pendingLabel="Enviando…">
        Enviarme el enlace
      </SubmitButton>
    </form>
  );
}
