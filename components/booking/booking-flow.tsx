"use client";

import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import { CalendarCheck, Check, ChevronLeft } from "lucide-react";
import { ButtonLink } from "@/components/ui/button-link";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/form/field";
import { FormMessage } from "@/components/form/form-message";
import { SubmitButton } from "@/components/form/submit-button";
import { formatMoney } from "@/lib/brand";
import { formatDateLong, formatDuration } from "@/lib/time";
import { cn } from "@/lib/utils";
import { bookAppointmentAction, getPublicAvailabilityAction } from "@/modules/booking/actions";
import { DaySlotPicker, type PickedSlot } from "./day-slot-picker";

type Service = { id: string; name: string; description: string | null; durationMinutes: number; price: number | null };

export function BookingFlow({ slug, businessName, services }: { slug: string; businessName: string; services: Service[] }) {
  const [service, setService] = useState<Service | null>(services.length === 1 ? services[0] : null);
  const [slot, setSlot] = useState<PickedSlot | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [state, action] = useActionState(bookAppointmentAction, undefined);
  const detailsRef = useRef<HTMLDivElement>(null);
  const handled = useRef<typeof state>(undefined);

  const load = useCallback(
    (from?: string) => getPublicAvailabilityAction(slug, service?.id ?? "", from),
    [slug, service?.id],
  );

  // Si el horario se ocupó mientras el cliente completaba sus datos, se
  // vuelve a pedir la disponibilidad para que elija otro.
  useEffect(() => {
    if (state && state !== handled.current && !state.ok && state.refresh) {
      handled.current = state;
      setSlot(null);
      setRefreshKey((k) => k + 1);
    }
  }, [state]);

  useEffect(() => {
    if (slot) detailsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [slot]);

  if (state?.ok) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 text-center">
        <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-success-soft text-success">
          <CalendarCheck className="size-7" aria-hidden="true" />
        </span>
        <h2 className="mt-4 font-display text-2xl font-semibold">¡Turno confirmado!</h2>
        {slot && service && (
          <p className="mt-2 text-muted-foreground">
            {service.name} en {businessName}
            <br />
            <span className="inline-block font-medium text-foreground first-letter:uppercase">
              {formatDateLong(slot.dateStr)}, {slot.label} h
            </span>
          </p>
        )}
        <p className="mt-4 text-sm text-muted-foreground">
          Guardá este enlace: desde ahí podés ver, reprogramar o cancelar tu turno.
        </p>
        <ButtonLink
          className="mt-4"
          variant="outline" href={`/turno/${state.manageToken}`}>Ver mi turno</ButtonLink>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <section aria-labelledby="paso-servicio">
        <StepTitle id="paso-servicio" number={1} done={Boolean(service)}>
          {service ? "Servicio" : "Elegí un servicio"}
        </StepTitle>
        {service && services.length > 1 ? (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
            <ServiceSummary service={service} />
            <button
              type="button"
              className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-primary hover:underline"
              onClick={() => {
                setService(null);
                setSlot(null);
              }}
            >
              <ChevronLeft className="size-4" aria-hidden="true" /> Cambiar
            </button>
          </div>
        ) : service ? (
          <div className="rounded-xl border border-border bg-card px-4 py-3">
            <ServiceSummary service={service} />
          </div>
        ) : (
          <ul className="space-y-2">
            {services.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => setService(item)}
                  className="w-full rounded-xl border border-input bg-card px-4 py-3.5 text-left transition-colors hover:border-primary hover:bg-accent/40"
                >
                  <ServiceSummary service={item} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {service && (
        <section aria-labelledby="paso-horario">
          <StepTitle id="paso-horario" number={2} done={Boolean(slot)}>
            Elegí día y horario
          </StepTitle>
          <DaySlotPicker load={load} reloadKey={`${service.id}:${refreshKey}`} value={slot} onChange={setSlot} />
        </section>
      )}

      {service && slot && (
        <section aria-labelledby="paso-datos" ref={detailsRef} className="scroll-mt-4">
          <StepTitle id="paso-datos" number={3} done={false}>
            Tus datos
          </StepTitle>
          <form action={action} className="space-y-4">
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="serviceId" value={service.id} />
            <input type="hidden" name="slot" value={slot.iso} />
            {/* Campo trampa anti-bots: invisible para personas y lectores de pantalla. */}
            <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
              <label>
                No completar
                <input type="text" name="website" tabIndex={-1} autoComplete="off" />
              </label>
            </div>

            <Field label="Nombre y apellido" htmlFor="name">
              <Input id="name" name="name" autoComplete="name" maxLength={120} required />
            </Field>
            <Field label="Email" htmlFor="email" hint="Te enviamos la confirmación y un recordatorio.">
              <Input id="email" name="email" type="email" inputMode="email" autoComplete="email" />
            </Field>
            <Field label="Teléfono" htmlFor="phone" optional>
              <Input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" />
            </Field>

            <FormMessage message={state && !state.ok ? state.message : null} />

            <div className="rounded-xl bg-secondary px-4 py-3 text-sm">
              <span className="font-medium">{service.name}</span> ·{" "}
              {formatDateLong(slot.dateStr)}, {slot.label} h
            </div>
            <SubmitButton size="lg" className="w-full" pendingLabel="Reservando…">
              Confirmar reserva
            </SubmitButton>
            <p className="text-center text-xs text-muted-foreground">
              Tus datos se usan únicamente para gestionar este turno con {businessName}.
            </p>
          </form>
        </section>
      )}
    </div>
  );
}

function StepTitle({ id, number, done, children }: { id: string; number: number; done: boolean; children: React.ReactNode }) {
  return (
    <h2 id={id} className="mb-3 flex items-center gap-2.5 text-lg font-semibold">
      <span
        className={cn(
          "flex size-6 items-center justify-center rounded-full text-xs font-bold",
          done ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground",
        )}
      >
        {done ? <Check className="size-3.5" aria-hidden="true" /> : number}
      </span>
      {children}
    </h2>
  );
}

function ServiceSummary({ service }: { service: Service }) {
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-medium">{service.name}</p>
        {service.price !== null && <p className="shrink-0 font-medium tabular-nums">{formatMoney(service.price)}</p>}
      </div>
      <p className="text-sm text-muted-foreground">{formatDuration(service.durationMinutes)}</p>
      {service.description && <p className="mt-1 text-sm text-muted-foreground">{service.description}</p>}
    </div>
  );
}
