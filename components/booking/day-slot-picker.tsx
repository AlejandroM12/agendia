"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addDays, formatDateLong, WEEKDAY_SHORT, weekdayOf } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { PublicAvailability, PublicDay } from "@/modules/booking/actions";

export type PickedSlot = { iso: string; label: string; dateStr: string };

/**
 * Elegir día y horario entre los realmente disponibles. Muestra una semana
 * por vez, con cuántos horarios libres tiene cada día, y permite avanzar a
 * fechas posteriores hasta donde el negocio toma reservas.
 */
type Props = {
  load: (fromDateStr?: string) => Promise<PublicAvailability>;
  reloadKey: string;
  value: PickedSlot | null;
  onChange: (slot: PickedSlot | null) => void;
};

const PAGE = 7;
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const LOAD_ERROR = "No pudimos cargar los horarios. Revisá tu conexión e intentá de nuevo.";

/** "noviembre" o "noviembre – diciembre" para los días que se están mostrando. */
function monthLabel(days: PublicDay[]): string {
  if (days.length === 0) return "";
  const month = (day: PublicDay) => MONTHS[Number(day.dateStr.slice(5, 7)) - 1];
  const first = month(days[0]);
  const last = month(days[days.length - 1]);
  return first === last ? first : `${first} – ${last}`;
}

const PERIODS: Array<{ label: string; includes: (hour: number) => boolean }> = [
  { label: "Mañana", includes: (hour) => hour < 12 },
  { label: "Tarde", includes: (hour) => hour >= 12 && hour < 19 },
  { label: "Noche", includes: (hour) => hour >= 19 },
];

export function DaySlotPicker(props: Props) {
  // Cada reloadKey monta el selector de nuevo: vuelve a "cargando" solo.
  return <DaySlotPickerInner key={props.reloadKey} {...props} />;
}

function DaySlotPickerInner({ load, value, onChange }: Props) {
  const [days, setDays] = useState<PublicDay[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [pageStart, setPageStart] = useState(0);
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
        const firstAvailable = result.days.findIndex((day) => day.slots.length > 0);
        if (firstAvailable >= 0) {
          setSelectedDay(result.days[firstAvailable].dateStr);
          setPageStart(Math.floor(firstAvailable / PAGE) * PAGE);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(LOAD_ERROR);
          setDays([]);
        }
      });
    return () => {
      cancelled = true;
    };
    // Se carga una sola vez por montaje (ver `key` en DaySlotPicker).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Muestra la página que empieza en `start`, pidiendo más fechas al servidor si hace falta. */
  async function showPage(start: number, known: PublicDay[]) {
    let all = known;
    if (start >= all.length) {
      if (!hasMore || all.length === 0) return;
      setLoadingMore(true);
      try {
        const result = await load(addDays(all[all.length - 1].dateStr, 1));
        if (!result.ok) {
          setError(result.message);
          return;
        }
        all = [...all, ...result.days];
        setDays(all);
        setHasMore(result.hasMore);
      } catch {
        setError(LOAD_ERROR);
        return;
      } finally {
        setLoadingMore(false);
      }
      if (start >= all.length) return;
    }
    setPageStart(start);
    const page = all.slice(start, start + PAGE);
    const firstAvailable = page.find((day) => day.slots.length > 0);
    // Al cambiar de semana se propone su primer día con horarios.
    if (firstAvailable && !page.some((day) => day.dateStr === selectedDay && day.slots.length > 0)) {
      setSelectedDay(firstAvailable.dateStr);
      if (value) onChange(null);
    }
  }

  if (days === null) {
    return (
      <div aria-busy="true" aria-label="Cargando horarios" className="space-y-4">
        <div className="grid grid-cols-7 gap-1.5">
          {Array.from({ length: PAGE }, (_, i) => (
            <div key={i} className="h-[4.5rem] animate-pulse rounded-xl bg-muted" />
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

  const page = days.slice(pageStart, pageStart + PAGE);
  const canGoBack = pageStart > 0;
  const canGoForward = pageStart + PAGE < days.length || hasMore;
  const pageHasSlots = page.some((day) => day.slots.length > 0);
  const current = page.find((day) => day.dateStr === selectedDay);
  const groups = current
    ? PERIODS.map((period) => ({
        label: period.label,
        slots: current.slots.filter((slot) => period.includes(Number(slot.label.slice(0, 2)))),
      })).filter((group) => group.slots.length > 0)
    : [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold first-letter:uppercase" aria-live="polite">
          {monthLabel(page)}
        </p>
        <div className="flex gap-1.5">
          <button
            type="button"
            aria-label="Días anteriores"
            disabled={!canGoBack || loadingMore}
            onClick={() => showPage(pageStart - PAGE, days)}
            className="flex size-9 items-center justify-center rounded-lg border border-input bg-card transition-colors hover:border-brand-border disabled:pointer-events-none disabled:opacity-40"
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Días siguientes"
            disabled={!canGoForward || loadingMore}
            aria-busy={loadingMore}
            onClick={() => showPage(pageStart + PAGE, days)}
            className="flex size-9 items-center justify-center rounded-lg border border-input bg-card transition-colors hover:border-brand-border disabled:pointer-events-none disabled:opacity-40"
          >
            <ChevronRight className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1.5" role="tablist" aria-label="Día">
        {page.map((day) => {
          const count = day.slots.length;
          const active = day.dateStr === selectedDay;
          return (
            <button
              key={day.dateStr}
              type="button"
              role="tab"
              aria-selected={active}
              aria-label={`${formatDateLong(day.dateStr)}, ${count === 0 ? "sin horarios" : count === 1 ? "1 horario libre" : `${count} horarios libres`}`}
              disabled={count === 0}
              onClick={() => {
                setSelectedDay(day.dateStr);
                if (value?.dateStr !== day.dateStr) onChange(null);
              }}
              className={cn(
                "flex min-w-0 flex-col items-center rounded-xl border px-0.5 pt-1.5 pb-1 transition-colors",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : count > 0
                    ? "border-input bg-card hover:border-brand-border"
                    : "border-transparent text-muted-foreground/60",
              )}
            >
              <span className="text-[11px] font-medium uppercase">{WEEKDAY_SHORT[weekdayOf(day.dateStr)]}</span>
              <span className="text-xl leading-tight font-semibold tabular-nums">{Number(day.dateStr.slice(8))}</span>
              <span
                aria-hidden="true"
                className={cn(
                  "mt-0.5 text-[10px] leading-tight font-medium tabular-nums",
                  active ? "text-primary-foreground/85" : count > 0 ? "text-brand-text" : "text-muted-foreground/60",
                )}
              >
                {count === 0 ? (
                  "—"
                ) : (
                  <>
                    {count}
                    <span className="hidden sm:inline"> {count === 1 ? "libre" : "libres"}</span>
                  </>
                )}
              </span>
            </button>
          );
        })}
      </div>

      {!pageHasSlots ? (
        <div className="rounded-xl bg-secondary px-4 py-4 text-sm">
          <p className="font-medium">No hay horarios disponibles en estos días.</p>
          {canGoForward ? (
            <button
              type="button"
              disabled={loadingMore}
              onClick={() => showPage(pageStart + PAGE, days)}
              className="mt-1 font-medium text-brand-text underline underline-offset-4"
            >
              {loadingMore ? "Buscando…" : "Ver los días siguientes"}
            </button>
          ) : (
            <p className="mt-1 text-muted-foreground">Por ahora no se pueden reservar fechas más lejanas.</p>
          )}
        </div>
      ) : current && groups.length > 0 ? (
        <div>
          <p className="mb-3 text-sm font-medium text-muted-foreground first-letter:uppercase">{formatDateLong(current.dateStr)}</p>
          <div role="radiogroup" aria-label="Horario" className="space-y-4">
            {groups.map((group) => (
              <div key={group.label}>
                <p className="mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{group.label}</p>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {group.slots.map((slot) => {
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
                            : "border-input bg-card hover:border-brand-border hover:bg-accent",
                        )}
                      >
                        {slot.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="rounded-xl bg-secondary px-4 py-3 text-sm text-muted-foreground">Elegí un día para ver sus horarios.</p>
      )}
    </div>
  );
}
