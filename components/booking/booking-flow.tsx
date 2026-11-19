"use client";

import { CONSENT_TEXT } from "@/modules/whatsapp/consent-text";
import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarCheck, Check, ChevronRight, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { Input } from "@/components/ui/input";
import { Field, FieldError } from "@/components/form/field";
import { FormMessage } from "@/components/form/form-message";
import { SubmitButton } from "@/components/form/submit-button";
import { useForm } from "@/components/form/use-form";
import { firstFieldErrors } from "@/lib/action-state";
import { formatMoney } from "@/lib/brand";
import { formatDateLong, formatDuration } from "@/lib/time";
import { cn } from "@/lib/utils";
import { bookAppointmentAction, getPublicAvailabilityAction } from "@/modules/booking/actions";
import { bookingContactSchema } from "@/modules/customers/schema";
import { DaySlotPicker, type PickedSlot } from "./day-slot-picker";
import { ANY_PROFESSIONAL, ProfessionalPicker, type PublicTeamView } from "./professional-picker";

/** `price` llega en `null` cuando el servicio no tiene precio o el negocio eligió no mostrarlos. */
export type BookableService = {
  id: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  price: number | null;
};

/**
 * Identifica este formulario: un reintento o un doble clic envía la misma
 * clave y el servidor devuelve la misma reserva en lugar de crear otra.
 * Reservas distintas (dos formularios) tienen claves distintas.
 */
function newSubmissionKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function BookingFlow({
  slug,
  businessName,
  services,
  team,
  preview = false,
  whatsappConsent = false,
}: {
  slug: string;
  businessName: string;
  /** El negocio tiene avisos automáticos por WhatsApp: se pide el consentimiento del cliente. */
  whatsappConsent?: boolean;
  services: BookableService[];
  /** Quiénes atienden cada servicio online. Sin esto, o con un solo profesional, no hay paso de profesional. */
  team?: PublicTeamView;
  /** Vista previa del panel: se puede recorrer, pero no reserva. */
  preview?: boolean;
}) {
  const [service, setService] = useState<BookableService | null>(services.length === 1 ? services[0] : null);
  // «any» (cualquiera), el identificador de un profesional, o nada todavía.
  const [choice, setChoice] = useState<string | null>(null);
  const [slot, setSlot] = useState<PickedSlot | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  // Los datos del cliente viven acá, fuera del formulario: si el horario
  // elegido se ocupa y hay que elegir otro, el paso «Tus datos» desaparece
  // un momento de la pantalla, pero lo escrito no se pierde.
  const [contact, setContact] = useState({ name: "", email: "", phone: "" });
  const [submissionKey] = useState(newSubmissionKey);
  const [conflict, setConflict] = useState<string | null>(null);
  const form = useForm(bookAppointmentAction, {
    // El mismo esquema con el que valida el servidor.
    validate: (data) => {
      const parsed = bookingContactSchema.safeParse({
        name: data.get("name") ?? "",
        email: data.get("email") ?? "",
        phone: data.get("phone") ?? "",
      });
      return parsed.success ? null : firstFieldErrors(parsed.error);
    },
  });
  const state = form.state;
  const professionalRef = useRef<HTMLElement>(null);
  const scheduleRef = useRef<HTMLElement>(null);
  const detailsRef = useRef<HTMLElement>(null);
  const handled = useRef<typeof state>(undefined);

  // Quiénes atienden el servicio elegido. Con uno solo no hay nada que elegir; sin ninguno, no se puede reservar.
  const eligibleIds = service ? (team?.byService[service.id] ?? null) : null;
  const eligible = eligibleIds && team ? eligibleIds.map((id) => team.professionals.find((p) => p.id === id)).filter((p) => p !== undefined) : [];
  const noProfessional = Boolean(service && team && eligible.length === 0);
  const asksProfessional = eligible.length > 1;
  // La elección solo vale si sigue siendo una opción real del servicio actual.
  const professional = asksProfessional && choice && (choice === ANY_PROFESSIONAL || eligible.some((p) => p.id === choice)) ? choice : null;
  const chosenProfessional = professional && professional !== ANY_PROFESSIONAL ? eligible.find((p) => p.id === professional) : null;
  const readyForSchedule = Boolean(service) && !noProfessional && (!asksProfessional || Boolean(professional));
  const scheduleStep = asksProfessional ? 3 : 2;
  const detailsStep = scheduleStep + 1;

  const load = useCallback(
    (from?: string) => getPublicAvailabilityAction(slug, service?.id ?? "", from, professional ?? undefined),
    [slug, service?.id, professional],
  );

  // Si el horario se ocupó mientras el cliente completaba sus datos, se
  // vuelve a pedir la disponibilidad para que elija otro.
  useEffect(() => {
    if (state && state !== handled.current && !state.ok && state.refresh) {
      handled.current = state;
      setSlot(null);
      setConflict(state.message);
      setRefreshKey((k) => k + 1);
      scheduleRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [state]);

  useEffect(() => {
    if (slot) detailsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [slot]);

  function chooseService(item: BookableService) {
    setService(item);
    setSlot(null);
    // En el celular la lista de servicios puede ser larga: se lleva la vista al paso siguiente.
    requestAnimationFrame(() => (team && (team.byService[item.id]?.length ?? 0) > 1 ? professionalRef : scheduleRef).current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function chooseProfessional(value: string) {
    setChoice(value);
    // Los horarios mostrados eran de otra elección: se vuelven a pedir.
    setSlot(null);
    setConflict(null);
    requestAnimationFrame(() => scheduleRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  if (state?.ok) {
    return (
      <div className="rounded-3xl border border-border bg-card p-6 text-center sm:p-8" role="status">
        <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-success-soft text-success">
          <CalendarCheck className="size-7" aria-hidden="true" />
        </span>
        <h2 className="mt-4 font-display text-2xl font-semibold">¡Turno confirmado!</h2>
        {slot && service && (
          <p className="mt-2 text-muted-foreground">
            {service.name} en {businessName}
            {state.professionalName && (
              <>
                <br />
                Te atiende <span className="font-medium text-foreground">{state.professionalName}</span>
              </>
            )}
            <br />
            <span className="inline-block font-medium text-foreground first-letter:uppercase">
              {formatDateLong(slot.dateStr)}, {slot.label} h
            </span>
          </p>
        )}
        <p className="mx-auto mt-4 max-w-sm text-sm text-muted-foreground">
          Guardá este enlace: desde ahí podés ver, reprogramar o cancelar tu turno. Si dejaste tu email, también te lo
          enviamos.
        </p>
        <div className="mt-5 flex flex-col justify-center gap-2 sm:flex-row">
          <ButtonLink size="lg" href={`/turno/${state.manageToken}`}>Ver mi turno</ButtonLink>
          {/* Recarga completa: vuelve a empezar con la disponibilidad actualizada. */}
          {/* eslint-disable-next-line @next/next/no-location-assign-relative-destination */}
          <Button size="lg" variant="outline" onClick={() => window.location.assign(`/${slug}`)}>
            Reservar otro turno
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-9">
      <section aria-labelledby="paso-servicio">
        <StepTitle id="paso-servicio" number={1} done={Boolean(service)}>
          {service ? "Servicio" : "Elegí un servicio"}
        </StepTitle>
        {service ? (
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-brand-border bg-accent/50 px-4 py-3.5">
            <ServiceSummary service={service} />
            {services.length > 1 && (
              <button
                type="button"
                className="shrink-0 text-sm font-medium text-brand-text underline-offset-4 hover:underline"
                onClick={() => {
                  setService(null);
                  setSlot(null);
                }}
              >
                Cambiar
              </button>
            )}
          </div>
        ) : (
          <ul className="grid gap-2.5 sm:grid-cols-2">
            {services.map((item) => {
              const unavailable = team ? (team.byService[item.id]?.length ?? 0) === 0 : false;
              return (
              <li key={item.id}>
                <button
                  type="button"
                  disabled={unavailable}
                  onClick={() => chooseService(item)}
                  className="group flex h-full w-full items-center justify-between gap-3 rounded-2xl border border-input bg-card px-4 py-3.5 text-left transition-colors hover:border-brand-border hover:bg-accent/40 disabled:opacity-60 disabled:hover:border-input disabled:hover:bg-card"
                >
                  <div className="min-w-0">
                    <ServiceSummary service={item} />
                    {unavailable && <p className="mt-1 text-xs font-medium text-muted-foreground">Por ahora no se puede reservar online</p>}
                  </div>
                  {!unavailable && <ChevronRight className="size-4 shrink-0 text-muted-foreground group-hover:text-brand-text" aria-hidden="true" />}
                </button>
              </li>
              );
            })}
          </ul>
        )}
      </section>

      {noProfessional && (
        <FormMessage
          tone="info"
          message="Por ahora este servicio no se puede reservar online: no hay profesionales disponibles. Elegí otro servicio o comunicate con el negocio."
        />
      )}

      {service && asksProfessional && (
        <section aria-labelledby="paso-profesional" ref={professionalRef} className="scroll-mt-4">
          <StepTitle id="paso-profesional" number={2} done={Boolean(professional)}>
            {professional ? "Profesional" : "Elegí con quién"}
          </StepTitle>
          <ProfessionalPicker
            professionals={eligible}
            value={professional}
            onChange={chooseProfessional}
            performedBy={performedByProfessional(team, services)}
          />
        </section>
      )}

      {readyForSchedule && service && (
        <section aria-labelledby="paso-horario" ref={scheduleRef} className="scroll-mt-4">
          <StepTitle id="paso-horario" number={scheduleStep} done={Boolean(slot)}>
            Elegí día y horario
          </StepTitle>
          {conflict && !slot && (
            <FormMessage
              className="mb-4"
              message={`${conflict} Tus datos quedaron guardados: solo tenés que elegir otro horario.`}
            />
          )}
          <DaySlotPicker
            load={load}
            reloadKey={`${service.id}:${professional ?? ""}:${refreshKey}`}
            value={slot}
            onChange={(next) => {
              setSlot(next);
              if (next) setConflict(null);
            }}
          />
        </section>
      )}

      {readyForSchedule && service && slot && (
        <section aria-labelledby="paso-datos" ref={detailsRef} className="scroll-mt-4">
          <StepTitle id="paso-datos" number={detailsStep} done={false}>
            Tus datos
          </StepTitle>
          <form
            {...form.formProps}
            onSubmit={preview ? (event) => event.preventDefault() : form.formProps.onSubmit}
            className="space-y-4"
          >
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="serviceId" value={service.id} />
            <input type="hidden" name="slot" value={slot.iso} />
            {professional && <input type="hidden" name="professionalId" value={professional} />}
            <input type="hidden" name="idempotencyKey" value={submissionKey} />
            {/* Campo trampa anti-bots: invisible para personas y lectores de pantalla. */}
            <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
              <label>
                No completar
                <input type="text" name="website" tabIndex={-1} autoComplete="off" />
              </label>
            </div>

            <Field label="Nombre y apellido" htmlFor="name" required error={form.error("name")}>
              <Input
                id="name"
                name="name"
                autoComplete="name"
                maxLength={120}
                value={contact.name}
                onChange={(event) => setContact((current) => ({ ...current, name: event.target.value }))}
              />
            </Field>

            <fieldset className="space-y-4">
              <legend className="text-sm font-medium">
                ¿Cómo te avisamos?{" "}
                <span className="font-normal text-muted-foreground">Completá al menos uno de los dos.</span>
              </legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Email" htmlFor="email" hint="Para enviarte la confirmación y un recordatorio." error={form.error("email")}>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    autoCapitalize="none"
                    maxLength={200}
                    value={contact.email}
                    onChange={(event) => {
                      setContact((current) => ({ ...current, email: event.target.value }));
                      // «Al menos uno»: completar un contacto resuelve el error del otro.
                      form.clearError("phone");
                    }}
                  />
                </Field>
                <Field label="WhatsApp o teléfono" htmlFor="phone" hint="Con característica. Ej.: 11 5555 0000." error={form.error("phone")}>
                  <Input
                    id="phone"
                    name="phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    maxLength={40}
                    value={contact.phone}
                    onChange={(event) => {
                      setContact((current) => ({ ...current, phone: event.target.value }));
                      form.clearError("email");
                    }}
                  />
                </Field>
                {whatsappConsent && (
                  <label className="flex items-start gap-2.5 text-sm text-muted-foreground">
                    <input type="checkbox" name="whatsappConsent" className="mt-0.5 size-4 shrink-0 accent-primary" />
                    <span>{CONSENT_TEXT}</span>
                  </label>
                )}
              </div>
            </fieldset>

            {/* Errores que no son de un campo: un fallo de conexión, por ejemplo. */}
            {!form.hasErrors && !(state && !state.ok && state.refresh) && <FormMessage message={form.message} />}
            {form.hasErrors && (
              <FieldError>Revisá los datos marcados. Lo que ya completaste sigue acá.</FieldError>
            )}

            <dl className="space-y-1.5 rounded-2xl bg-secondary px-4 py-3 text-sm" aria-label="Resumen de tu reserva">
              <SummaryRow label="Negocio">{businessName}</SummaryRow>
              <SummaryRow label="Servicio">{service.name}</SummaryRow>
              {asksProfessional && (
                <SummaryRow label="Profesional">
                  {chosenProfessional ? chosenProfessional.displayName : "Cualquier profesional (te asignamos uno al confirmar)"}
                </SummaryRow>
              )}
              <SummaryRow label="Cuándo">
                <span className="first-letter:uppercase">{formatDateLong(slot.dateStr)}</span>, {slot.label} h
              </SummaryRow>
              <SummaryRow label="Duración">{formatDuration(service.durationMinutes)}</SummaryRow>
              {service.price !== null && <SummaryRow label="Precio">{formatMoney(service.price)}</SummaryRow>}
              {(contact.name.trim() || contact.email.trim() || contact.phone.trim()) && (
                <SummaryRow label="Tus datos">
                  {[contact.name.trim(), contact.email.trim(), contact.phone.trim()].filter(Boolean).join(" · ")}
                </SummaryRow>
              )}
            </dl>
            {preview ? (
              <p className="rounded-xl border border-dashed border-input px-4 py-3 text-center text-sm text-muted-foreground">
                Vista previa: desde acá no se crean reservas.
              </p>
            ) : (
              <SubmitButton size="lg" className="w-full" pending={form.pending} pendingLabel="Reservando…">
                Confirmar reserva
              </SubmitButton>
            )}
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
    <h2 id={id} className="mb-3.5 flex items-center gap-2.5 font-display text-xl font-semibold">
      <span
        className={cn(
          "flex size-7 items-center justify-center rounded-full font-sans text-xs font-bold",
          done ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground",
        )}
      >
        {done ? <Check className="size-4" aria-hidden="true" /> : number}
      </span>
      {children}
    </h2>
  );
}

function ServiceSummary({ service }: { service: BookableService }) {
  return (
    <div className="min-w-0">
      <p className="font-medium">{service.name}</p>
      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Clock className="size-3.5" aria-hidden="true" /> {formatDuration(service.durationMinutes)}
        </span>
        {service.price !== null && (
          <span className="font-medium text-foreground tabular-nums">{formatMoney(service.price)}</span>
        )}
      </p>
      {service.description && <p className="mt-1 text-sm text-muted-foreground">{service.description}</p>}
    </div>
  );
}

function SummaryRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-24 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1 font-medium break-words">{children}</dd>
    </div>
  );
}

/** Servicios que hace cada profesional, solo para quienes no hacen todos (así la tarjeta aclara algo útil). */
function performedByProfessional(team: PublicTeamView | undefined, services: BookableService[]): Record<string, string[]> | undefined {
  if (!team || services.length < 2) return undefined;
  const result: Record<string, string[]> = {};
  for (const professional of team.professionals) {
    const names = services.filter((service) => team.byService[service.id]?.includes(professional.id)).map((service) => service.name);
    if (names.length > 0 && names.length < services.length) result[professional.id] = names;
  }
  return result;
}
