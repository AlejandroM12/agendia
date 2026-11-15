"use client";

import Link from "next/link";
import { registerAction } from "@/app/(auth)/actions";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/form/field";
import { FormMessage } from "@/components/form/form-message";
import { PasswordField } from "@/components/form/password-field";
import { SubmitButton } from "@/components/form/submit-button";
import { useForm } from "@/components/form/use-form";
import { firstFieldErrors } from "@/lib/action-state";
import { brand, trialPolicy } from "@/lib/brand";
import { PLAN_CAPABILITIES, TRIAL_MAX_PROFESSIONALS, type PlanTier } from "@/lib/plans";
import { registerSchema } from "@/modules/auth/schemas";
import { AuthBenefits } from "./benefits";
import { AuthCard } from "./auth-card";

/** `trial`: la cuenta empieza con la prueba gratuita (no aplica a una instalación independiente). */
export function RegisterForm({ trial, plan = null }: { trial: boolean; plan?: PlanTier | null }) {
  const form = useForm(registerAction, {
    // El mismo esquema con el que valida el servidor.
    validate: (data) => {
      const parsed = registerSchema.safeParse(Object.fromEntries(data));
      return parsed.success ? null : firstFieldErrors(parsed.error);
    },
  });

  return (
    <>
      <AuthCard
        title="Tu agenda, más simple."
        description={
          trial
            ? `Creá tu cuenta y empezá a organizar tus turnos. Probá ${brand.name} gratis durante ${trialPolicy.trialDays} días.`
            : "Creá tu cuenta y empezá a organizar tus turnos."
        }
        footer={
          <>
            ¿Ya tenés cuenta?{" "}
            <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
              Ingresar
            </Link>
          </>
        }
      >
        <form {...form.formProps} className="space-y-4">
          <FormMessage message={form.message} />
          {plan && <input type="hidden" name="plan" value={plan} />}
          <Field label="Tu nombre" htmlFor="name" error={form.error("name")}>
            <Input id="name" name="name" autoComplete="name" maxLength={120} required />
          </Field>
          <Field
            label="Email"
            htmlFor="email"
            hint="Lo usás para ingresar. Te enviamos un enlace para confirmarlo."
            error={form.error("email")}
          >
            <Input id="email" name="email" type="email" autoComplete="email" inputMode="email" autoCapitalize="none" required />
          </Field>
          <PasswordField
            id="password"
            name="password"
            label="Contraseña"
            autoComplete="new-password"
            showRules
            error={form.error("password")}
          />
          <SubmitButton size="lg" className="w-full" pending={form.pending} pendingLabel="Creando tu cuenta…">
            {trial ? "Crear mi cuenta gratis" : "Crear mi cuenta"}
          </SubmitButton>
          {trial && (
            <p className="text-center text-sm text-muted-foreground">
              {trialPolicy.trialDays} días de prueba con todas las funciones.
            </p>
          )}
          {trial && plan === "equipo" && (
            <p className="rounded-xl bg-secondary p-3.5 text-sm" data-testid="team-intent">
              Elegiste el {PLAN_CAPABILITIES.equipo.name}. Empezás con la prueba gratuita de {trialPolicy.trialDays} días, con hasta{" "}
              {TRIAL_MAX_PROFESSIONALS} profesionales activos y sin ningún cobro. Cuando quieras sumar más (hasta{" "}
              {PLAN_CAPABILITIES.equipo.maxActiveProfessionals}), lo contratás desde «Mi plan».
            </p>
          )}
        </form>
      </AuthCard>

      {/* En el celular no hay panel lateral: los beneficios van debajo. */}
      <AuthBenefits className="mt-8 px-1 lg:hidden" />
    </>
  );
}
