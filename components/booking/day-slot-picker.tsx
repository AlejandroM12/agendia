"use client";

import { useEffect, useState } from "react";
import { addDays, formatDateLong, WEEKDAY_SHORT, weekdayOf } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { PublicAvailability, PublicDay } from "@/modules/booking/actions";

export type PickedSlot = { iso: string; label: string; dateStr: string };

/**
 * Elegir día y horario entre los realmente disponibles. Carga dos semanas
 * por vez y deja pedir más fechas.
 */
type Props = {
  load: (fromDateStr?: string) => Promise<PublicAvailability>;
  reloadKey: string;
  value: PickedSlot | null;
  onChange: (slot: PickedSlot | null) => void;
};

export function DaySlotPicker(props: Props) {
  // Cada reloadKey monta el selector de nuevo: vuelve a "cargando" solo.
  return <DaySlotPickerInner key={props.reloadKey} {...props} />;
}

function DaySlotPickerInner({ load, value, onChange }: Props) {
  const [days, setDays] = useState<PublicDay[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    let cancelled = false;
    load()
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          setError(result.message);
          setDays([]);
          return;
        }
        setDays(result.days);
        setHasMore(result.hasMore);
        setSelectedDay(result.days.find((d) => d.slots.length > 0)?.dateStr ?? null);
      })
      .catch(() => {
        if (!cancelled) {
          setError("No pudimos cargar los horarios. Revisá tu conexión e intentá de nuevo.");
          setDays([]);
        }
      });
    return () => {
      cancelled = true;
    };
    // Se carga una sola vez por montaje (ver `key` en DaySlotPicker).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadMore() {
    if (!days?.length) return;
    setLoadingMore(true);
    try {
      const result = await load(addDays(days[days.length - 1].dateStr, 1));
      if (result.ok) {
        setDays([...days, ...result.days]);
        setHasMore(result.hasMore);
        if (!selectedDay) setSelectedDay(result.days.find((d) => d.slots.length > 0)?.dateStr ?? null);
      } else {
        setError(result.message);
      }
    } finally {
      setLoadingMore(false);
    }
  }

  if (days === null) {
    return (
      <div aria-busy="true" aria-label="Cargando horarios" className="space-y-4">
        <div className="flex gap-2 overflow-hidden">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="h-[4.25rem] w-14 shrink-0 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="h-12 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-destructive">
        {error}
      </p>
    );
  }

  const anyAvailable = days.some((d) => d.slots.length > 0);
  const current = days.find((d) => d.dateStr === selectedDay);

  return (
    <div className="space-y-4">
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]" role="tablist" aria-label="Día">
        {days.map((day) => {
          const available = day.slots.length > 0;
          const active = day.dateStr === selectedDay;
          return (
            <button
              key={day.dateStr}
              type="button"
              role="tab"
              aria-selected={active}
              aria-label={`${formatDateLong(day.dateStr)}${available ? "" : ", sin horarios"}`}
              disabled={!available}
              onClick={() => {
                setSelectedDay(day.dateStr);
                if (value?.dateStr !== day.dateStr) onChange(null);
              }}
              className={cn(
                "flex w-14 shrink-0 flex-col items-center rounded-xl border py-2 transition-colors",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : available
                    ? "border-input bg-card hover:border-primary"
                    : "border-transparent text-muted-foreground/50",
              )}
            >
              <span className="text-[11px] font-medium uppercase">{WEEKDAY_SHORT[weekdayOf(day.dateStr)]}</span>
              <span className="text-xl leading-tight font-semibold tabular-nums">{Number(day.dateStr.slice(8))}</span>
            </button>
          );
        })}
        {hasMore && (
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            className="shrink-0 rounded-xl border border-dashed border-input px-3 text-sm font-medium text-primary hover:bg-accent"
          >
            {loadingMore ? "Cargando…" : "Más fechas"}
          </button>
        )}
      </div>

      {!anyAvailable ? (
        <p className="rounded-xl bg-secondary px-4 py-3 text-sm text-muted-foreground">
          No hay horarios disponibles en estas fechas.{hasMore ? " Probá con «Más fechas»." : ""}
        </p>
      ) : current ? (
        <div>
          <p className="mb-2 text-sm font-medium text-muted-foreground first-letter:uppercase">{formatDateLong(current.dateStr)}</p>
          <div role="radiogroup" aria-label="Horario" className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {current.slots.map((slot) => {
              const active = value?.iso === slot.iso;
              return (
                <button
                  key={slot.iso}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => onChange({ ...slot, dateStr: current.dateStr })}
                  className={cn(
                    "h-12 rounded-xl border text-base font-medium tabular-nums transition-colors",
                    active
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-input bg-card hover:border-primary hover:bg-accent",
                  )}
                >
                  {slot.label}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
