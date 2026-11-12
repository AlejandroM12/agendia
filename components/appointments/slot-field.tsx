"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export type SlotOption = { iso: string; label: string };

/**
 * Selector de horario: muestra los horarios realmente libres del día
 * elegido. Envía el instante elegido en el campo `slot`; si se habilita
 * "otro horario", envía `time` (HH:mm) junto con el `date` del formulario.
 */
type Props = {
  date: string;
  loadSlots: (dateStr: string) => Promise<SlotOption[]>;
  /** Cambia cuando cambia algo que afecta la disponibilidad (por ejemplo, el servicio). */
  reloadKey?: string;
  allowCustomTime?: boolean;
  emptyMessage?: string;
};

export function SlotField(props: Props) {
  if (!props.date) return <p className="text-sm text-muted-foreground">Elegí primero un día.</p>;
  // Al cambiar el día o el servicio se monta de nuevo: arranca "cargando"
  // y sin horario elegido, sin tener que resetear estado a mano.
  return <SlotFieldInner key={`${props.date}:${props.reloadKey ?? ""}`} {...props} />;
}

function SlotFieldInner({
  date,
  loadSlots,
  allowCustomTime = false,
  emptyMessage = "No quedan horarios libres ese día.",
}: Props) {
  const [slots, setSlots] = useState<SlotOption[] | null>(null);
  const [selected, setSelected] = useState("");
  const [custom, setCustom] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadSlots(date)
      .then((result) => {
        if (!cancelled) setSlots(result);
      })
      .catch(() => {
        if (!cancelled) {
          setSlots([]);
          setFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
    // Se carga una sola vez por montaje (ver `key` en SlotField).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-3">
      {!custom && <input type="hidden" name="slot" value={selected} />}

      {slots === null ? (
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6" aria-busy="true" aria-label="Cargando horarios">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="h-11 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : failed ? (
        <p role="alert" className="text-sm text-destructive">
          No pudimos cargar los horarios. Revisá tu conexión y volvé a elegir el día.
        </p>
      ) : slots.length === 0 ? (
        <p className="rounded-lg bg-secondary px-3 py-2.5 text-sm text-muted-foreground">{emptyMessage}</p>
      ) : (
        <div role="radiogroup" aria-label="Horario" className="grid grid-cols-4 gap-2 sm:grid-cols-6">
          {slots.map((slot) => {
            const active = !custom && selected === slot.iso;
            return (
              <button
                key={slot.iso}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => {
                  setCustom(false);
                  setSelected(slot.iso);
                }}
                className={cn(
                  "h-11 rounded-lg border text-sm font-medium tabular-nums transition-colors",
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-input bg-card text-foreground hover:border-primary hover:bg-accent",
                )}
              >
                {slot.label}
              </button>
            );
          })}
        </div>
      )}

      {allowCustomTime &&
        (custom ? (
          <div className="flex items-center gap-3">
            <input type="time" name="time" aria-label="Otro horario" className="field w-auto" required autoFocus />
            <button type="button" className="text-sm font-medium text-primary hover:underline" onClick={() => setCustom(false)}>
              Volver a los horarios libres
            </button>
          </div>
        ) : (
          <button type="button" className="text-sm font-medium text-primary hover:underline" onClick={() => setCustom(true)}>
            Usar otro horario
          </button>
        ))}
    </div>
  );
}
