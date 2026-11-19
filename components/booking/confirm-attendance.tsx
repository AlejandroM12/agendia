"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NETWORK_ERROR_MESSAGE } from "@/components/form/use-form";
import { confirmAttendanceByTokenAction } from "@/modules/booking/actions";

/** «Confirmo que voy»: deja registrada la asistencia del cliente en su turno (sin cambiar nada más). */
export function ConfirmAttendance({ token, confirmed }: { token: string; confirmed: boolean }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (confirmed) {
    return (
      <p className="flex items-center gap-2 rounded-xl bg-secondary px-4 py-3 text-sm font-medium">
        <Check className="size-4 text-primary" aria-hidden="true" /> Ya confirmaste que vas. ¡Te esperamos!
      </p>
    );
  }

  return (
    <div>
      <Button
        type="button"
        variant="outline"
        className="w-full"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            try {
              const result = await confirmAttendanceByTokenAction(token);
              if (result?.ok) router.refresh();
              else setMessage(result?.message ?? "No pudimos confirmar tu asistencia.");
            } catch {
              setMessage(NETWORK_ERROR_MESSAGE);
            }
          })
        }
      >
        <Check aria-hidden="true" /> Confirmo que voy
      </Button>
      {message && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {message}
        </p>
      )}
    </div>
  );
}
