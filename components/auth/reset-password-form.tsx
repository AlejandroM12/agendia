"use client";

import { useActionState } from "react";
import Link from "next/link";
import { resetPasswordAction } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(resetPasswordAction, undefined);
  const succeeded = state?.message?.startsWith("Contraseña actualizada");

  return (
    <form action={action} className="space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Elegí una nueva contraseña</h1>
      </div>

      {state?.message && (
        <Alert variant={succeeded ? "default" : "destructive"}>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}

      {succeeded ? (
        <Button className="w-full" nativeButton={false} render={<Link href="/login">Iniciar sesión</Link>} />
      ) : (
        <>
          <input type="hidden" name="token" value={token} />
          <div className="space-y-2">
            <Label htmlFor="password">Nueva contraseña</Label>
            <Input id="password" name="password" type="password" autoComplete="new-password" required />
          </div>
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Guardando…" : "Guardar contraseña"}
          </Button>
        </>
      )}
    </form>
  );
}
