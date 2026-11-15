"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/form/confirm-button";
import { Field } from "@/components/form/field";
import { FormMessage } from "@/components/form/form-message";
import { SubmitButton } from "@/components/form/submit-button";
import { useForm } from "@/components/form/use-form";
import {
  inviteProfessionalAction,
  resendInvitationAction,
  revokeAccessAction,
  revokeInvitationAction,
  type InviteState,
} from "@/modules/team/access-actions";

export type AccessView = {
  state: "none" | "pending" | "expired" | "linked" | "revoked";
  label: string;
  invitedEmail: string | null;
  invitationId: string | null;
  accountEmail: string | null;
  /** Fecha de vencimiento ya formateada. */
  expiresLabel: string | null;
};

const TONE: Record<AccessView["state"], string> = {
  none: "bg-secondary text-muted-foreground",
  pending: "bg-accent text-accent-foreground",
  expired: "bg-warning-soft text-warning",
  linked: "bg-success-soft text-success",
  revoked: "bg-secondary text-muted-foreground",
};

export function AccessBadge({ state, label }: { state: AccessView["state"]; label: string }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TONE[state]}`}>{label}</span>;
}

function DevLink({ link }: { link?: string }) {
  if (!link) return null;
  return (
    <p className="rounded-lg bg-secondary px-3 py-2 text-xs break-all">
      Enlace de prueba (solo fuera de producción y sin correo configurado): <a className="underline" href={link}>{link}</a>
    </p>
  );
}

/**
 * Acceso individual de un profesional: invitar, reenviar, cancelar la
 * invitación o revocar la cuenta. Mantiene claro que revocar el acceso NO
 * borra nada del profesional y que desactivarlo es otra cosa.
 */
export function AccessPanel({
  professionalId,
  professionalName,
  access,
  accountsEnabled,
  disabled,
}: {
  professionalId: string;
  professionalName: string;
  access: AccessView;
  accountsEnabled: boolean;
  disabled: boolean;
}) {
  const router = useRouter();
  const [note, setNote] = useState<InviteState>(undefined);
  const form = useForm(async (prev: InviteState, data: FormData) => {
    const result = await inviteProfessionalAction(professionalId, prev, data);
    if (result?.ok) {
      // El formulario desaparece al quedar pendiente: el aviso (y el enlace de prueba) se muestra aparte.
      setNote(result);
      router.refresh();
    }
    return result;
  });

  async function run(action: () => Promise<InviteState>) {
    const result = await action();
    setNote(result);
    if (result?.ok) router.refresh();
  }

  if (!accountsEnabled) {
    return (
      <p className="text-sm text-muted-foreground">
        Las cuentas individuales todavía no están habilitadas para tu negocio. Mientras tanto, administrás vos la agenda de {professionalName}.
      </p>
    );
  }

  return (
    <div className="max-w-lg space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <AccessBadge state={access.state} label={access.label} />
        {access.state === "linked" && <span className="text-sm text-muted-foreground">{access.accountEmail}</span>}
        {(access.state === "pending" || access.state === "expired") && (
          <span className="text-sm text-muted-foreground">
            {access.invitedEmail}
            {access.expiresLabel && (access.state === "pending" ? ` · vence el ${access.expiresLabel}` : ` · venció el ${access.expiresLabel}`)}
          </span>
        )}
      </div>

      {(access.state === "pending" || access.state === "expired") && access.invitationId && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => run(() => resendInvitationAction(access.invitationId!))}>
            Reenviar invitación
          </Button>
          <ConfirmButton
            size="sm"
            variant="outline"
            confirmMessage="¿Cancelar la invitación? El enlace que se envió deja de servir."
            action={async () => {
              await run(() => revokeInvitationAction(access.invitationId!));
            }}
          >
            Cancelar invitación
          </ConfirmButton>
        </div>
      )}

      {access.state === "linked" && (
        <div className="space-y-2">
          <ConfirmButton
            size="sm"
            confirmMessage={`¿Revocar el acceso de ${professionalName}? Deja de poder entrar a este negocio de inmediato. Su perfil, su agenda y sus turnos se conservan: los administrás vos. Podés invitarlo de nuevo cuando quieras.`}
            action={async () => {
              await run(() => revokeAccessAction(professionalId));
            }}
          >
            Revocar acceso
          </ConfirmButton>
          <p className="text-xs text-muted-foreground">No es lo mismo que desactivar al profesional: revocar el acceso solo le quita la cuenta.</p>
        </div>
      )}

      {(access.state === "none" || access.state === "revoked" || access.state === "expired") && (
        <form {...form.formProps} className="space-y-3">
          <fieldset disabled={disabled} className="space-y-3">
            <Field
              label={access.state === "expired" ? "Invitar con otro correo" : "Invitar a Agendia"}
              htmlFor={`invite-${professionalId}`}
              hint={`${professionalName} recibe un enlace para elegir su contraseña y entrar directo a su agenda. No hace falta que contrate nada.`}
              error={form.error("email")}
            >
              <Input id={`invite-${professionalId}`} name="email" type="email" inputMode="email" autoCapitalize="none" required placeholder="correo@ejemplo.com" />
            </Field>
            <FormMessage message={form.message} tone={form.state?.ok ? "success" : "error"} />
            <DevLink link={form.state?.devLink} />
            <SubmitButton pending={form.pending} variant="outline" pendingLabel="Enviando…">
              Enviar invitación
            </SubmitButton>
          </fieldset>
        </form>
      )}

      <FormMessage message={note?.message} tone={note?.ok ? "success" : "error"} />
      <DevLink link={note?.devLink} />
    </div>
  );
}
