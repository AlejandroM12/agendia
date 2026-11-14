"use client";

import Link from "next/link";
import { loginAction } from "@/app/(auth)/actions";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/form/field";
import { FormMessage } from "@/components/form/form-message";
import { PasswordField } from "@/components/form/password-field";
import { SubmitButton } from "@/components/form/submit-button";
import { useForm } from "@/components/form/use-form";
import { AuthCard } from "./auth-card";

export function LoginForm({ notice }: { notice?: { message: string; tone: "success" | "error" } }) {
  const form = useForm(loginAction);

  return (
    <AuthCard
      title="Hola de nuevo"
      description="Ingresá para ver tu agenda de hoy."
      footer={
        <>
          ¿Todavía no tenés cuenta?{" "}
          <Link href="/registro" className="font-medium text-primary underline-offset-4 hover:underline">
            Crear mi cuenta
          </Link>
        </>
      }
    >
      <form {...form.formProps} className="space-y-4">
        {!form.message && <FormMessage message={notice?.message} tone={notice?.tone} />}
        <FormMessage message={form.message} />
        <Field label="Email" htmlFor="email" error={form.error("email")}>
          <Input id="email" name="email" type="email" autoComplete="username" inputMode="email" autoCapitalize="none" required />
        </Field>
        <PasswordField
          id="password"
          name="password"
          label="Contraseña"
          autoComplete="current-password"
          error={form.error("password")}
        />
        <SubmitButton size="lg" className="w-full" pending={form.pending} pendingLabel="Ingresando…">
          Ingresar
        </SubmitButton>
        <p className="text-center text-sm">
          <Link
            href="/olvide-contrasena"
            className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Olvidé mi contraseña
          </Link>
        </p>
      </form>
    </AuthCard>
  );
}
