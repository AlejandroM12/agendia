"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmButton } from "@/components/form/confirm-button";
import { Field } from "@/components/form/field";
import { FormMessage } from "@/components/form/form-message";
import { SubmitButton } from "@/components/form/submit-button";
import { useForm } from "@/components/form/use-form";
import { formatDateShort } from "@/lib/time";
import { cancelAppointmentAction } from "@/modules/appointments/actions";
import { reassignAppointmentAction, resolveAppointmentsAction } from "@/modules/team/actions";

export type AffectedItem = {
  id: string;
  /** Día y hora ya formateados en la zona horaria del negocio. */
  whenLabel: string;
  dateStr: string;
  customerName: string;
  customerHasEmail: boolean;
  serviceName: string;
  options: Array<{ id: string; displayName: string }>;
};

function ReassignRow({ item }: { item: AffectedItem }) {
  const router = useRouter();
  const form = useForm(reassignAppointmentAction.bind(null, item.id));
  const [cancelError, setCancelError] = useState<string | null>(null);

  return (
    <li className="space-y-3 px-4 py-4">
      <div>
        <p className="font-medium">
          <span className="first-letter:uppercase">{formatDateShort(item.dateStr)}</span> · {item.whenLabel}
        </p>
        <p className="text-sm text-muted-foreground">
          {item.customerName} · {item.serviceName}
        </p>
      </div>

      <form {...form.formProps} className="space-y-2">
        {item.options.length > 0 ? (
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Pasar a" htmlFor={`to-${item.id}`} className="min-w-40 flex-1 sm:max-w-56">
              <select id={`to-${item.id}`} name="professionalId" className="field" defaultValue={item.options[0].id}>
                {item.options.map((option) => (
                  <option key={option.id} value={option.id}>{option.displayName}</option>
                ))}
              </select>
            </Field>
            <SubmitButton pending={form.pending} variant="outline" pendingLabel="Pasando…">Pasar turno</SubmitButton>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Ningún otro profesional tiene libre ese horario.</p>
        )}
        <FormMessage message={form.message} tone={form.state?.ok ? "success" : "error"} />
      </form>

      <ConfirmButton
        size="sm"
        action={async () => {
          const result = await cancelAppointmentAction(item.id);
          if (result?.ok) {
            setCancelError(null);
            router.refresh();
          } else {
            setCancelError(result?.message ?? "No pudimos cancelar el turno.");
          }
        }}
        confirmMessage={
          item.customerHasEmail
            ? `¿Cancelar el turno de ${item.customerName}? Le vamos a avisar por email.`
            : `¿Cancelar el turno de ${item.customerName}? Este cliente no tiene email: avisale por otro medio.`
        }
      >
        Cancelar este turno
      </ConfirmButton>
      <FormMessage message={cancelError} />
    </li>
  );
}

/** Resolver los turnos futuros de un profesional antes de desactivarlo: de a uno o todos juntos. */
export function AffectedAppointments({
  professionalId,
  professionalName,
  items,
  others,
}: {
  professionalId: string;
  professionalName: string;
  items: AffectedItem[];
  others: Array<{ id: string; displayName: string }>;
}) {
  const router = useRouter();
  const bulk = useForm(async (prev: Parameters<typeof resolveAppointmentsAction>[1], data: FormData) => {
    const result = await resolveAppointmentsAction(professionalId, prev, data);
    router.refresh();
    return result;
  });
  const [decision, setDecision] = useState<"reassign" | "cancel">("reassign");

  return (
    <div className="space-y-8">
      <form
        {...bulk.formProps}
        onSubmit={(event) => {
          const message =
            decision === "cancel"
              ? `¿Cancelar los ${items.length} turnos de ${professionalName}? A los clientes con email les avisamos; a los demás hay que avisarles por otro medio.`
              : `¿Pasar los ${items.length} turnos de ${professionalName} al profesional elegido? Se lo avisamos a los clientes por email.`;
          if (!window.confirm(message)) {
            event.preventDefault();
            return;
          }
          bulk.formProps.onSubmit(event);
        }}
        className="space-y-4 rounded-2xl border border-border bg-card p-4"
      >
        <p className="font-semibold">Resolver todos juntos</p>
        <div role="radiogroup" aria-label="Qué hacer con los turnos" className="space-y-2 text-sm">
          <label className="flex cursor-pointer items-center gap-2">
            <input type="radio" name="decision" value="reassign" checked={decision === "reassign"} onChange={() => setDecision("reassign")} className="size-4 accent-[var(--primary)]" />
            Pasarlos a otro profesional
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input type="radio" name="decision" value="cancel" checked={decision === "cancel"} onChange={() => setDecision("cancel")} className="size-4 accent-[var(--primary)]" />
            Cancelarlos
          </label>
        </div>
        {decision === "reassign" &&
          (others.length > 0 ? (
            <Field label="Pasar a" htmlFor="toProfessionalId" className="max-w-xs">
              <select id="toProfessionalId" name="toProfessionalId" className="field" defaultValue={others[0].id}>
                {others.map((option) => (
                  <option key={option.id} value={option.id}>{option.displayName}</option>
                ))}
              </select>
            </Field>
          ) : (
            <p className="text-sm text-muted-foreground">No hay otros profesionales activos. Podés cancelar los turnos o activar a otro primero.</p>
          ))}
        <p className="text-xs text-muted-foreground">
          Si algún turno no se puede pasar (el otro profesional no tiene ese horario libre), queda en la lista para resolverlo de a uno.
        </p>
        <FormMessage message={bulk.message} tone={bulk.state?.ok ? "success" : "error"} />
        <SubmitButton pending={bulk.pending} variant={decision === "cancel" ? "destructive" : "default"} disabled={decision === "reassign" && others.length === 0} pendingLabel="Resolviendo…">
          {decision === "cancel" ? "Cancelar todos los turnos" : "Pasar todos los turnos"}
        </SubmitButton>
      </form>

      <section>
        <h2 className="text-lg font-semibold">Turno por turno</h2>
        <ul className="mt-3 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
          {items.map((item) => (
            <ReassignRow key={item.id} item={item} />
          ))}
        </ul>
      </section>
    </div>
  );
}
