"use client";

import { Input } from "@/components/ui/input";
import { Field } from "@/components/form/field";
import { FormMessage } from "@/components/form/form-message";
import { SubmitButton } from "@/components/form/submit-button";
import { useForm } from "@/components/form/use-form";
import { startSubscriptionAction } from "@/modules/billing/actions";
import { saveKeepSelectionAction } from "@/modules/team/capacity-actions";

type Member = { id: string; name: string; futureAppointments: number; keep: boolean };

/** Confirmación de contratar o cambiar de plan. Nada se activa acá: se paga en Mercado Pago. */
export function PlanChangeForm(props: {
  tier: "profesional" | "equipo";
  defaultEmail: string;
  submitLabel: string;
  /** Solo al bajar de plan: quiénes siguen recibiendo reservas. */
  professionals?: Member[];
  keepLimit?: number;
  timing?: "period_end" | "now";
}) {
  const form = useForm(startSubscriptionAction);
  return (
    <form {...form.formProps} className="space-y-5">
      <input type="hidden" name="tier" value={props.tier} />
      {props.timing && <input type="hidden" name="timing" value={props.timing} />}
      {props.professionals && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">
            ¿Quiénes siguen recibiendo reservas? (hasta {props.keepLimit})
          </legend>
          <input type="hidden" name="keepSelection" value="1" />
          {props.professionals.map((member) => (
            <label key={member.id} className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 text-sm">
              <input type="checkbox" name="keep" value={member.id} defaultChecked={member.keep} className="size-4 accent-primary" />
              <span className="flex-1">{member.name}</span>
              <span className="text-xs text-muted-foreground">
                {member.futureAppointments === 0
                  ? "Sin turnos futuros"
                  : `${member.futureAppointments} ${member.futureAppointments === 1 ? "turno futuro" : "turnos futuros"}`}
              </span>
            </label>
          ))}
        </fieldset>
      )}
      <Field
        label="Email de tu cuenta de Mercado Pago"
        htmlFor="payerEmail"
        hint="Tiene que ser el email con el que entrás a Mercado Pago para pagar."
        className="max-w-sm"
        error={form.error("payerEmail")}
      >
        <Input id="payerEmail" name="payerEmail" type="email" inputMode="email" defaultValue={props.defaultEmail} required />
      </Field>
      <FormMessage message={form.message} />
      <SubmitButton pending={form.pending} size="lg" pendingLabel="Conectando con Mercado Pago…">
        {props.submitLabel}
      </SubmitButton>
    </form>
  );
}

/** Elegir quiénes siguen recibiendo reservas cuando hay exceso de cupo. */
export function KeepSelectionForm({ professionals, limit }: { professionals: Member[]; limit: number }) {
  const form = useForm(saveKeepSelectionAction);
  return (
    <form {...form.formProps} className="space-y-3" data-testid="keep-selection">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Quiénes siguen recibiendo reservas (hasta {limit})</legend>
        {professionals.map((member) => (
          <label key={member.id} className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 text-sm">
            <input type="checkbox" name="keep" value={member.id} defaultChecked={member.keep} className="size-4 accent-primary" />
            <span className="flex-1">{member.name}</span>
            <span className="text-xs text-muted-foreground">
              {member.futureAppointments === 0 ? "Sin turnos futuros" : `${member.futureAppointments} turnos futuros`}
            </span>
          </label>
        ))}
      </fieldset>
      <FormMessage message={form.message} />
      <SubmitButton pending={form.pending}>Guardar elección</SubmitButton>
    </form>
  );
}
