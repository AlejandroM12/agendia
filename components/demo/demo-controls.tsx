"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { restartDemoAction, sendDemoReminderAction } from "@/modules/demo/actions";

export function SendReminderNowButton({ appointmentId }: { appointmentId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <span className="flex shrink-0 items-center gap-2">
      {message && <span className="text-xs text-muted-foreground">{message}</span>}
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await sendDemoReminderAction(appointmentId);
            setMessage(result?.message ?? null);
            router.refresh();
          })
        }
      >
        Enviar recordatorio
      </Button>
    </span>
  );
}

export function RestartDemoButton() {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div>
      <p className="text-sm text-muted-foreground">¿Ensuciaste los datos? Abrí una demo nueva, con todo como al principio.</p>
      <Button
        type="button"
        variant="outline"
        className="mt-3"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await restartDemoAction(undefined);
            if (result?.message) setMessage(result.message);
          })
        }
      >
        Reiniciar la demo
      </Button>
      {message && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {message}
        </p>
      )}
    </div>
  );
}
