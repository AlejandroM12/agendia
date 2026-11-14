"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/form/confirm-button";
import { FormMessage } from "@/components/form/form-message";
import { SubmitButton } from "@/components/form/submit-button";
import { useForm } from "@/components/form/use-form";
import {
  cancelAppointmentAction,
  loadSlotsAction,
  rescheduleAppointmentAction,
  updateNotesAction,
} from "@/modules/appointments/actions";
import { SlotField } from "./slot-field";

export function RescheduleForm({
  appointmentId,
  serviceId,
  defaultDate,
}: {
  appointmentId: string;
  serviceId: string;
  defaultDate: string;
}) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(defaultDate);
  const form = useForm(rescheduleAppointmentAction.bind(null, appointmentId));
  const loadSlots = useCallback(
    (dateStr: string) => loadSlotsAction(serviceId, dateStr, appointmentId),
    [serviceId, appointmentId],
  );

  if (!open) {
    return (
      <Button variant="outline" onClick={() => setOpen(true)}>
        Reprogramar
      </Button>
    );
  }

  return (
    <form {...form.formProps} className="w-full space-y-3 rounded-2xl border border-border bg-card p-4">
      <p className="font-semibold">Elegí el nuevo día y horario</p>
      <input
        type="date"
        name="date"
        aria-label="Nuevo día"
        className="field sm:max-w-56"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        required
      />
      <SlotField date={date} loadSlots={loadSlots} allowCustomTime />
      <FormMessage message={form.message} />
      <div className="flex gap-3">
        <SubmitButton pending={form.pending} pendingLabel="Reprogramando…">Confirmar cambio</SubmitButton>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

export function CancelAppointmentButton({ appointmentId, hasEmail }: { appointmentId: string; hasEmail: boolean }) {
  return (
    <ConfirmButton
      action={() => cancelAppointmentAction(appointmentId)}
      confirmMessage={
        hasEmail
          ? "¿Cancelar este turno? Le vamos a avisar al cliente por email."
          : "¿Cancelar este turno? El horario vuelve a quedar libre."
      }
    >
      Cancelar turno
    </ConfirmButton>
  );
}

export function NotesForm({ appointmentId, notes, disabled }: { appointmentId: string; notes: string | null; disabled: boolean }) {
  const form = useForm(updateNotesAction.bind(null, appointmentId));
  return (
    <form {...form.formProps} className="space-y-3">
      <textarea
        name="notes"
        aria-label="Nota interna"
        className="field h-auto min-h-24 py-2"
        maxLength={2000}
        defaultValue={notes ?? ""}
        placeholder="Solo la ves vos."
        disabled={disabled}
      />
      <FormMessage message={form.message} tone={form.state?.ok ? "success" : "error"} />
      {!disabled && (
        <SubmitButton pending={form.pending} variant="outline" size="sm">
          Guardar nota
        </SubmitButton>
      )}
    </form>
  );
}
