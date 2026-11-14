"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/form/form-message";
import { NETWORK_ERROR_MESSAGE } from "@/components/form/use-form";
import { formatDateLong } from "@/lib/time";
import {
  cancelByTokenAction,
  getRescheduleAvailabilityAction,
  rescheduleByTokenAction,
} from "@/modules/booking/actions";
import { DaySlotPicker, type PickedSlot } from "./day-slot-picker";

/** Acciones del cliente sobre su turno: reprogramar o cancelar. */
export function ManageAppointment({
  token,
  professionalName = null,
  anyProfessional = false,
}: {
  token: string;
  /** Quién atiende hoy (solo en negocios con equipo). */
  professionalName?: string | null;
  /** El cliente reservó con «cualquier profesional»: al reprogramar puede cambiar quién lo atiende. */
  anyProfessional?: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "reschedule">("idle");
  const [slot, setSlot] = useState<PickedSlot | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [pending, startTransition] = useTransition();

  const load = useCallback((from?: string) => getRescheduleAvailabilityAction(token, from), [token]);

  function cancel() {
    if (!window.confirm("¿Cancelar tu turno?")) return;
    startTransition(async () => {
      try {
        const result = await cancelByTokenAction(token);
        if (result?.ok) {
          setSuccess(null);
          router.refresh();
        }
        else setMessage(result?.message ?? "No pudimos cancelar el turno.");
      } catch {
        setMessage(NETWORK_ERROR_MESSAGE);
      }
    });
  }

  function reschedule() {
    if (!slot) return;
    startTransition(async () => {
      try {
        const result = await rescheduleByTokenAction(token, slot.iso);
        if (result?.ok) {
          setMode("idle");
          setSlot(null);
          setMessage(null);
          setSuccess(
            result.professionalChanged && result.professionalName
              ? `Listo, reprogramamos tu turno. Con este horario te atiende ${result.professionalName}.`
              : "Listo, reprogramamos tu turno.",
          );
          router.refresh();
        } else {
          setMessage(result?.message ?? "No pudimos reprogramar el turno.");
          setSlot(null);
          setRefreshKey((k) => k + 1);
        }
      } catch {
        // Sin conexión: el horario elegido se conserva para reintentar.
        setMessage(NETWORK_ERROR_MESSAGE);
      }
    });
  }

  if (mode === "reschedule") {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Elegí el nuevo día y horario</h2>
        {professionalName && (
          <p className="rounded-xl bg-secondary px-4 py-3 text-sm text-muted-foreground">
            {anyProfessional
              ? "Reservaste con «cualquier profesional»: te mostramos los horarios de todo el equipo. Si el que elegís lo requiere, puede cambiar quién te atiende, y te lo vamos a avisar."
              : `Seguís con ${professionalName}: solo ves sus horarios.`}
          </p>
        )}
        <DaySlotPicker load={load} reloadKey={String(refreshKey)} value={slot} onChange={setSlot} />
        <FormMessage message={message} />
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button size="lg" disabled={!slot || pending} onClick={reschedule}>
            {pending
              ? "Reprogramando…"
              : slot
                ? `Pasar al ${formatDateLong(slot.dateStr)}, ${slot.label} h`
                : "Elegí un horario"}
          </Button>
          <Button size="lg" variant="ghost" disabled={pending} onClick={() => setMode("idle")}>
            Volver
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <FormMessage tone="success" message={success} />
      <FormMessage message={message} />
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button size="lg" variant="outline" disabled={pending} onClick={() => setMode("reschedule")}>
          Reprogramar
        </Button>
        <Button size="lg" variant="destructive" disabled={pending} onClick={cancel}>
          {pending ? "Un momento…" : "Cancelar turno"}
        </Button>
      </div>
    </div>
  );
}
