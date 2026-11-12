"use client";

import { useActionState } from "react";
import Link from "next/link";
import { requestPasswordResetAction } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(requestPasswordResetAction, undefined);

  return (
    <form action={action} className="space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Recuperar contraseña</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Te enviamos un enlace para restablecerla.
        </p>
      </div>

      {state?.message && (
        <Alert>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}

      {state?.devResetLink && (
        <Alert variant="destructive">
          <AlertDescription>
            <strong>Placeholder de desarrollo:</strong> el envío por email todavía no está
            implementado (llega en la Fase 4, con Resend). Por ahora, usá este enlace directamente:{" "}
            <Link href={state.devResetLink} className="underline">
              restablecer contraseña
            </Link>
            .
          </AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Enviando…" : "Enviar enlace"}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        <Link href="/login" className="text-primary hover:underline">
          Volver a iniciar sesión
        </Link>
      </p>
    </form>
  );
}
