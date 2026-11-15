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
  PROFESSIONAL_PERMISSION_KEYS,
  PROFESSIONAL_PERMISSION_LABELS,
  type ProfessionalPermissionKey,
  type ProfessionalPermissions,
} from "@/lib/permissions";
import {
  inviteAdminAction,
  removeAdminAction,
  resendInvitationAction,
  revokeInvitationAction,
  saveProfessionalOverridesAction,
  savePermissionsAction,
  setAdminNotificationsAction,
  type InviteState,
} from "@/modules/team/access-actions";

/** Qué pueden hacer los profesionales con cuenta propia, en general (solo el propietario). */
export function GeneralPermissionsForm({ values, disabled }: { values: ProfessionalPermissions; disabled: boolean }) {
  const form = useForm(savePermissionsAction);
  return (
    <form {...form.formProps} className="max-w-lg">
      <fieldset disabled={disabled} className="space-y-4">
        <p className="rounded-xl bg-secondary px-4 py-3 text-sm">
          Todos los profesionales con cuenta pueden <strong>ver su propia agenda</strong>. Lo demás lo decidís vos.
        </p>
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {PROFESSIONAL_PERMISSION_KEYS.map((key) => (
            <li key={key}>
              <label className="flex cursor-pointer items-start gap-3 px-4 py-3 text-sm">
                <input type="checkbox" name={key} defaultChecked={values[key]} className="mt-0.5 size-5 accent-[var(--primary)]" />
                <span>
                  <span className="font-medium">{PROFESSIONAL_PERMISSION_LABELS[key].label}</span>
                  <span className="block text-muted-foreground">{PROFESSIONAL_PERMISSION_LABELS[key].hint}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        <FormMessage message={form.message} tone={form.state?.ok ? "success" : "error"} />
        <SubmitButton pending={form.pending}>Guardar permisos</SubmitButton>
      </fieldset>
    </form>
  );
}

/** Excepciones para un profesional: «igual que el negocio», sí o no, por cada permiso (solo el propietario). */
export function OverridesForm({
  professionalId,
  base,
  overrides,
  disabled,
}: {
  professionalId: string;
  base: ProfessionalPermissions;
  overrides: Partial<ProfessionalPermissions>;
  disabled: boolean;
}) {
  const form = useForm(saveProfessionalOverridesAction.bind(null, professionalId));
  return (
    <form {...form.formProps} className="max-w-lg">
      <fieldset disabled={disabled} className="space-y-4">
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {PROFESSIONAL_PERMISSION_KEYS.map((key: ProfessionalPermissionKey) => {
            const current = overrides[key] === undefined ? "inherit" : overrides[key] ? "on" : "off";
            return (
              <li key={key} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <label htmlFor={`ov-${key}`} className="min-w-0 flex-1 font-medium">
                  {PROFESSIONAL_PERMISSION_LABELS[key].label}
                </label>
                <select id={`ov-${key}`} name={key} defaultValue={current} className="field w-auto">
                  <option value="inherit">Como el negocio ({base[key] ? "sí" : "no"})</option>
                  <option value="on">Sí</option>
                  <option value="off">No</option>
                </select>
              </li>
            );
          })}
        </ul>
        <FormMessage message={form.message} tone={form.state?.ok ? "success" : "error"} />
        <SubmitButton pending={form.pending} variant="outline">Guardar excepciones</SubmitButton>
      </fieldset>
    </form>
  );
}

export type AdminView = { userId: string; name: string; email: string; notifyBookings: boolean };
export type PendingAdminInvite = { id: string; email: string; expiresLabel: string };

/** Administradores del negocio: invitar, quitar y decidir si reciben los avisos de reservas (solo el propietario). */
export function AdminsPanel({
  admins,
  pending,
  accountsEnabled,
  disabled,
}: {
  admins: AdminView[];
  pending: PendingAdminInvite[];
  accountsEnabled: boolean;
  disabled: boolean;
}) {
  const router = useRouter();
  const [note, setNote] = useState<InviteState>(undefined);
  const form = useForm(async (prev: InviteState, data: FormData) => {
    const result = await inviteAdminAction(prev, data);
    if (result?.ok) router.refresh();
    return result;
  });

  async function run(action: () => Promise<InviteState>) {
    const result = await action();
    setNote(result);
    if (result?.ok) router.refresh();
  }

  return (
    <div className="max-w-lg space-y-5">
      {admins.length === 0 && pending.length === 0 && <p className="text-sm text-muted-foreground">Todavía no tenés administradores.</p>}

      {admins.length > 0 && (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {admins.map((admin) => (
            <li key={admin.userId} className="space-y-2 px-4 py-3 text-sm">
              <div>
                <p className="font-medium">{admin.name}</p>
                <p className="text-muted-foreground">{admin.email}</p>
              </div>
              <label className="flex cursor-pointer items-center gap-2.5">
                <input
                  type="checkbox"
                  defaultChecked={admin.notifyBookings}
                  disabled={disabled}
                  onChange={(event) => run(() => setAdminNotificationsAction(admin.userId, event.target.checked))}
                  className="size-4 accent-[var(--primary)]"
                />
                Recibe los avisos de reservas del negocio
              </label>
              <ConfirmButton
                size="sm"
                variant="outline"
                confirmMessage={`¿Quitar a ${admin.name} como administrador? Pierde el acceso a este negocio de inmediato (sus otros negocios no cambian).`}
                action={async () => {
                  await run(() => removeAdminAction(admin.userId));
                }}
              >
                Quitar administrador
              </ConfirmButton>
            </li>
          ))}
        </ul>
      )}

      {pending.length > 0 && (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {pending.map((invite) => (
            <li key={invite.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
              <span>
                <span className="font-medium">{invite.email}</span>
                <span className="block text-muted-foreground">Invitación pendiente · vence el {invite.expiresLabel}</span>
              </span>
              <span className="flex gap-2">
                <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => run(() => resendInvitationAction(invite.id))}>
                  Reenviar
                </Button>
                <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => run(() => revokeInvitationAction(invite.id))}>
                  Cancelar
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {accountsEnabled ? (
        <form {...form.formProps}>
          <fieldset disabled={disabled} className="space-y-3">
            <Field
              label="Invitar a un administrador"
              htmlFor="admin-email"
              hint="Un administrador gestiona la operación diaria. No puede ver ni cambiar la facturación, ni dar permisos a otros."
              error={form.error("email")}
            >
              <Input id="admin-email" name="email" type="email" inputMode="email" autoCapitalize="none" required placeholder="correo@ejemplo.com" />
            </Field>
            <FormMessage message={form.message} tone={form.state?.ok ? "success" : "error"} />
            {form.state?.devLink && (
              <p className="rounded-lg bg-secondary px-3 py-2 text-xs break-all">
                Enlace de prueba: <a className="underline" href={form.state.devLink}>{form.state.devLink}</a>
              </p>
            )}
            <SubmitButton pending={form.pending} variant="outline" pendingLabel="Enviando…">Enviar invitación</SubmitButton>
          </fieldset>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">Las cuentas individuales todavía no están habilitadas para tu negocio.</p>
      )}
      <FormMessage message={note?.message} tone={note?.ok ? "success" : "error"} />
    </div>
  );
}
