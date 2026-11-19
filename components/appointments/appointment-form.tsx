"use client";

import { useCallback, useState } from "react";
import { ButtonLink } from "@/components/ui/button-link";
import { FormMessage } from "@/components/form/form-message";
import { SubmitButton } from "@/components/form/submit-button";
import { useForm } from "@/components/form/use-form";
import { formatDuration } from "@/lib/time";
import { createAppointmentAction, loadSlotsAction } from "@/modules/appointments/actions";
import { CustomerPicker } from "./customer-picker";
import { SlotField } from "./slot-field";

type ServiceOption = { id: string; name: string; durationMinutes: number; active: boolean };

/** Solo cuando el negocio trabaja con varios profesionales activos. */
export type TeamOptions = {
  professionals: Array<{ id: string; displayName: string }>;
  /** Para cada servicio: quiénes lo realizan. */
  performedBy: Record<string, string[]>;
  defaultProfessionalId: string | null;
};

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
  team,
  whatsappConsent = false,
}: {
  services: ServiceOption[];
  defaultDate: string;
  customer: { id: string; name: string; detail: string } | null;
  team?: TeamOptions;
  /** El negocio tiene WhatsApp automático: permite registrar que el cliente aceptó recibir avisos. */
  whatsappConsent?: boolean;
}) {
  const form = useForm(createAppointmentAction);
  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  const [date, setDate] = useState(defaultDate);
  const [chosen, setChosen] = useState(team?.defaultProfessionalId ?? "any");

  // Solo se ofrecen los profesionales que realizan el servicio elegido.
  const eligible = team ? team.professionals.filter((p) => team.performedBy[serviceId]?.includes(p.id)) : [];
  const professionalId = eligible.some((p) => p.id === chosen) ? chosen : "any";
  const askProfessional = eligible.length > 1;

  const loadSlots = useCallback(
    (dateStr: string) => loadSlotsAction(serviceId, dateStr, undefined, askProfessional && professionalId !== "any" ? professionalId : undefined),
    [serviceId, askProfessional, professionalId],
  );

  return (
    <form {...form.formProps} className="max-w-xl space-y-8">
      <Step number={1} title="Cliente">
        <CustomerPicker initial={customer} />
        {whatsappConsent && (
          <label className="mt-3 flex items-start gap-2.5 text-sm text-muted-foreground">
            <input type="checkbox" name="whatsappConsent" className="mt-0.5 size-4 shrink-0 accent-primary" />
            <span>El cliente aceptó recibir por WhatsApp los avisos de su turno (confirmación, recordatorio y cambios).</span>
          </label>
        )}
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

      {askProfessional && (
        <Step number={3} title="Profesional">
          <select
            name="professionalId"
            aria-label="Profesional"
            className="field"
            value={professionalId}
            onChange={(e) => setChosen(e.target.value)}
          >
            <option value="any">Cualquiera disponible (se asigna automáticamente)</option>
            {eligible.map((professional) => (
              <option key={professional.id} value={professional.id}>
                {professional.displayName}
              </option>
            ))}
          </select>
        </Step>
      )}

      <Step number={askProfessional ? 4 : 3} title="Día y horario">
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
          <SlotField date={date} loadSlots={loadSlots} reloadKey={`${serviceId}:${professionalId}`} allowCustomTime />
        </div>
      </Step>

      <Step number={askProfessional ? 5 : 4} title="Nota interna (opcional)">
        <textarea
          name="notes"
          aria-label="Nota interna"
          className="field h-auto min-h-20 py-2"
          maxLength={2000}
          placeholder="Solo la ves vos."
        />
      </Step>

      <FormMessage message={form.message} />

      <div className="flex gap-3">
        <SubmitButton pending={form.pending} size="lg" pendingLabel="Agendando…">
          Agendar turno
        </SubmitButton>
        <ButtonLink variant="ghost" size="lg" href="/dashboard/agenda">Cancelar</ButtonLink>
      </div>
    </form>
  );
}
