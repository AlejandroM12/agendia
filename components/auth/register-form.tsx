"use client";

import { useActionState } from "react";
import Link from "next/link";
import { registerAction } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function RegisterForm() {
  const [state, action, pending] = useActionState(registerAction, undefined);

  return (
    <form action={action} className="space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Probá Agendia gratis</h1>
        <p className="mt-1 text-sm text-muted-foreground">7 días sin tarjeta de crédito.</p>
      </div>

      {state?.message && (
        <Alert variant="destructive">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        <Label htmlFor="businessName">Nombre de tu negocio</Label>
        <Input id="businessName" name="businessName" placeholder="Ej: Estudio Martina" required />
        {state?.errors?.businessName && (
          <p className="text-xs text-destructive">{state.errors.businessName[0]}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="name">Tu nombre</Label>
        <Input id="name" name="name" autoComplete="name" required />
        {state?.errors?.name && <p className="text-xs text-destructive">{state.errors.name[0]}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
        {state?.errors?.email && <p className="text-xs text-destructive">{state.errors.email[0]}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Contraseña</Label>
        <Input id="password" name="password" type="password" autoComplete="new-password" required />
        {state?.errors?.password && (
          <p className="text-xs text-destructive">{state.errors.password[0]}</p>
        )}
      </div>

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Creando cuenta…" : "Comenzar gratis"}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        ¿Ya tenés cuenta?{" "}
        <Link href="/login" className="text-primary hover:underline">
          Iniciar sesión
        </Link>
      </p>
    </form>
  );
}
