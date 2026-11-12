"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { labelToMinutes, minutesToLabel, WEEKDAY_NAMES } from "@/lib/time";
import { cn } from "@/lib/utils";

type Rule = { weekday: number; startMinute: number; endMinute: number };
type Range = { start: string; end: string };

// La semana se muestra de lunes a domingo.
const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

function toState(rules: Rule[]): Record<number, Range[]> {
  const state: Record<number, Range[]> = {};
  for (const weekday of DISPLAY_ORDER) {
    state[weekday] = rules
      .filter((r) => r.weekday === weekday)
      .sort((a, b) => a.startMinute - b.startMinute)
      .map((r) => ({ start: minutesToLabel(r.startMinute), end: minutesToLabel(r.endMinute) }));
  }
  return state;
}

function toRules(state: Record<number, Range[]>): Rule[] {
  const rules: Rule[] = [];
  for (const weekday of DISPLAY_ORDER) {
    for (const range of state[weekday]) {
      const startMinute = labelToMinutes(range.start);
      const endMinute = labelToMinutes(range.end);
      if (startMinute !== null && endMinute !== null) rules.push({ weekday, startMinute, endMinute });
    }
  }
  return rules;
}

/**
 * Editor del horario semanal. Envía el resultado como JSON en un campo
 * oculto (`name`), que el servidor vuelve a validar por completo.
 */
export function WeeklyHoursEditor({ name = "rules", initialRules }: { name?: string; initialRules: Rule[] }) {
  const [days, setDays] = useState(() => toState(initialRules));

  const update = (weekday: number, ranges: Range[]) => setDays((prev) => ({ ...prev, [weekday]: ranges }));

  return (
    <div className="divide-y divide-border rounded-xl border border-border bg-card">
      <input type="hidden" name={name} value={JSON.stringify(toRules(days))} />
      {DISPLAY_ORDER.map((weekday) => {
        const ranges = days[weekday];
        const open = ranges.length > 0;
        const dayName = WEEKDAY_NAMES[weekday];
        return (
          <div key={weekday} className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-start">
            <label className="flex w-36 shrink-0 cursor-pointer items-center gap-3 py-1.5">
              <input
                type="checkbox"
                className="size-5 accent-[var(--primary)]"
                checked={open}
                onChange={(e) => update(weekday, e.target.checked ? [{ start: "09:00", end: "18:00" }] : [])}
              />
              <span className={cn("text-sm font-medium capitalize", !open && "text-muted-foreground")}>
                {dayName}
              </span>
            </label>

            {!open ? (
              <p className="py-1.5 text-sm text-muted-foreground sm:pt-2">No atiendo</p>
            ) : (
              <div className="flex flex-1 flex-col gap-2">
                {ranges.map((range, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <input
                      type="time"
                      aria-label={`${dayName}: desde`}
                      className="field w-auto"
                      value={range.start}
                      onChange={(e) =>
                        update(weekday, ranges.map((r, i) => (i === index ? { ...r, start: e.target.value } : r)))
                      }
                      required
                    />
                    <span className="text-sm text-muted-foreground">a</span>
                    <input
                      type="time"
                      aria-label={`${dayName}: hasta`}
                      className="field w-auto"
                      value={range.end}
                      onChange={(e) =>
                        update(weekday, ranges.map((r, i) => (i === index ? { ...r, end: e.target.value } : r)))
                      }
                      required
                    />
                    {ranges.length > 1 && (
                      <button
                        type="button"
                        className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
                        aria-label={`Quitar franja de ${dayName}`}
                        onClick={() => update(weekday, ranges.filter((_, i) => i !== index))}
                      >
                        <X className="size-4" />
                      </button>
                    )}
                  </div>
                ))}
                {ranges.length < 3 && (
                  <button
                    type="button"
                    className="inline-flex w-fit items-center gap-1.5 rounded-md py-1 text-sm font-medium text-primary hover:underline"
                    onClick={() => {
                      const last = labelToMinutes(ranges[ranges.length - 1].end) ?? 18 * 60;
                      const start = Math.min(last + 60, 22 * 60);
                      update(weekday, [
                        ...ranges,
                        { start: minutesToLabel(start), end: minutesToLabel(Math.min(start + 180, 24 * 60 - 1)) },
                      ]);
                    }}
                  >
                    <Plus className="size-4" /> Agregar otra franja
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
