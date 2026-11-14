"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/form/confirm-button";
import { FormMessage } from "@/components/form/form-message";
import {
  activateProfessionalAction,
  deactivateProfessionalAction,
  moveProfessionalAction,
  setIsMeAction,
} from "@/modules/team/actions";

/** Sube o baja al profesional en el orden de visualización. */
export function MoveButtons({
  professionalId,
  name,
  canUp,
  canDown,
  disabled,
}: {
  professionalId: string;
  name: string;
  canUp: boolean;
  canDown: boolean;
  disabled: boolean;
}) {
  const router = useRouter();
  const move = async (direction: "up" | "down") => {
    await moveProfessionalAction(professionalId, direction);
    router.refresh();
  };
  return (
    <div className="flex flex-col gap-1">
      <Button type="button" variant="ghost" size="icon-sm" disabled={disabled || !canUp} aria-label={`Subir a ${name}`} onClick={() => move("up")}>
        <ArrowUp aria-hidden="true" />
      </Button>
      <Button type="button" variant="ghost" size="icon-sm" disabled={disabled || !canDown} aria-label={`Bajar a ${name}`} onClick={() => move("down")}>
        <ArrowDown aria-hidden="true" />
      </Button>
    </div>
  );
}

/** «Soy yo»: marca o desmarca esta agenda como la de la persona de la cuenta. */
export function IsMeToggle({ professionalId, isMe, disabled }: { professionalId: string; isMe: boolean; disabled: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <label className="flex cursor-pointer items-start gap-3 text-sm">
      <input
        type="checkbox"
        checked={isMe}
        disabled={disabled || pending}
        onChange={async (event) => {
          setPending(true);
          try {
            await setIsMeAction(professionalId, event.target.checked);
            router.refresh();
          } finally {
            setPending(false);
          }
        }}
        className="mt-0.5 size-5 accent-[var(--primary)]"
      />
      <span>
        <span className="font-medium">Soy yo: yo también atiendo clientes</span>
        <span className="block text-muted-foreground">Identifica tu propia agenda dentro del equipo.</span>
      </span>
    </label>
  );
}

/** Activar un profesional desactivado (respeta el cupo del plan: el servidor lo valida). */
export function ActivateButton({ professionalId, name }: { professionalId: string; name: string }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <ConfirmButton
        variant="default"
        confirmMessage={`¿Volver a activar a ${name}? Va a ocupar un cupo de tu plan y va a poder recibir turnos.`}
        action={async () => {
          const result = await activateProfessionalAction(professionalId);
          if (result?.ok) {
            setMessage(null);
            router.refresh();
          } else {
            setMessage(result?.message ?? "No pudimos activar al profesional.");
          }
        }}
      >
        Activar
      </ConfirmButton>
      <FormMessage message={message} />
    </div>
  );
}

/**
 * Desactivar: si no tiene turnos futuros se desactiva acá; si los tiene, el
 * servidor lo rechaza y la persona va a la pantalla que los resuelve.
 */
export function DeactivateButton({ professionalId, name, futureAppointments }: { professionalId: string; name: string; futureAppointments: number }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  if (futureAppointments > 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Tiene {futureAppointments} {futureAppointments === 1 ? "turno por venir" : "turnos por venir"}. Para desactivarlo, primero hay que pasarlos a otro profesional o cancelarlos.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <ConfirmButton
        confirmMessage={`¿Desactivar a ${name}? Deja de recibir turnos y libera un cupo. Su historial se conserva.`}
        action={async () => {
          const result = await deactivateProfessionalAction(professionalId);
          if (result?.ok) {
            setMessage(null);
            router.push("/dashboard/equipo");
            router.refresh();
          } else {
            setMessage(result?.message ?? "No pudimos desactivar al profesional.");
          }
        }}
      >
        Desactivar profesional
      </ConfirmButton>
      <FormMessage message={message} />
    </div>
  );
}
