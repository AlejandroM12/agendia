"use client";

import { useActionState, useCallback, useState } from "react";
import { ButtonLink } from "@/components/ui/button-link";
import { FormMessage } from "@/components/form/form-message";
import { SubmitButton } from "@/components/form/submit-button";
import { formatDuration } from "@/lib/time";
import { createAppointmentAction, loadSlotsAction } from "@/modules/appointments/actions";
import { CustomerPicker } from "./customer-picker";
import { SlotField } from "./slot-field";

type ServiceOption = { id: string; name: string; durationMinutes: number; active: boolean };

function Step({ number, title, children }: { number: number; title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2.5 text-base font-semibold">
        <span className="flex size-6 items-center justify-center rounded-full bg-accent text-xs font-bold text-accent-foreground">
          {number}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

export function AppointmentForm({
  services,
  defaultDate,
  customer,
}: {
  services: ServiceOption[];
  defaultDate: string;
  customer: { id: string; name: string; detail: string } | null;
}) {
  const [state, action] = useActionState(createAppointmentAction, undefined);
  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  const [date, setDate] = useState(defaultDate);

  const loadSlots = useCallback((dateStr: string) => loadSlotsAction(serviceId, dateStr), [serviceId]);

  return (
    <form action={action} className="max-w-xl space-y-8">
      <Step number={1} title="Cliente">
        <CustomerPicker initial={customer} />
      </Step>

      <Step number={2} title="Servicio">
        <select
          name="serviceId"
          aria-label="Servicio"
          className="field"
          value={serviceId}
          onChange={(e) => setServiceId(e.target.value)}
        >
          {services.map((service) => (
            <option key={service.id} value={service.id}>
              {service.name} · {formatDuration(service.durationMinutes)}
              {service.active ? "" : " (no se ofrece online)"}
            </option>
          ))}
        </select>
      </Step>

      <Step number={3} title="Día y horario">
        <div className="space-y-3">
          <input
            type="date"
            name="date"
            aria-label="Día"
            className="field sm:max-w-56"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
          <SlotField date={date} loadSlots={loadSlots} reloadKey={serviceId} allowCustomTime />
        </div>
      </Step>

      <Step number={4} title="Nota interna (opcional)">
        <textarea
          name="notes"
          aria-label="Nota interna"
          className="field h-auto min-h-20 py-2"
          maxLength={2000}
          placeholder="Solo la ves vos."
        />
      </Step>

      <FormMessage message={state?.message} />

      <div className="flex gap-3">
        <SubmitButton size="lg" pendingLabel="Agendando…">
          Agendar turno
        </SubmitButton>
        <ButtonLink variant="ghost" size="lg" href="/dashboard/agenda">Cancelar</ButtonLink>
      </div>
    </form>
  );
}
