"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { DURATION_OPTIONS } from "@/modules/services/schema";
import { formatDuration } from "@/lib/time";

type Row = { name: string; durationMinutes: number; price: string };

/** Alta rápida de varios servicios a la vez (onboarding). Envía JSON en un campo oculto. */
export function ServicesQuickEditor({
  name = "services",
  initial,
}: {
  name?: string;
  initial: Array<{ name: string; durationMinutes: number; price: number | null }>;
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    initial.map((s) => ({ name: s.name, durationMinutes: s.durationMinutes, price: s.price?.toString() ?? "" })),
  );

  const patch = (index: number, change: Partial<Row>) =>
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...change } : row)));

  const durations = Array.from(new Set([...DURATION_OPTIONS, ...rows.map((r) => r.durationMinutes)])).sort(
    (a, b) => a - b,
  );

  return (
    <div className="space-y-3">
      <input
        type="hidden"
        name={name}
        value={JSON.stringify(rows.filter((r) => r.name.trim() !== "").map((r) => ({ ...r, price: r.price || null })))}
      />
      {rows.map((row, index) => (
        <div key={index} className="rounded-xl border border-border bg-card p-3.5">
          <div className="flex items-start gap-2">
            <input
              className="field flex-1"
              aria-label={`Nombre del servicio ${index + 1}`}
              placeholder="Nombre del servicio"
              value={row.name}
              maxLength={80}
              onChange={(e) => patch(index, { name: e.target.value })}
            />
            {rows.length > 1 && (
              <button
                type="button"
                className="rounded-md p-2.5 text-muted-foreground hover:bg-muted hover:text-destructive"
                aria-label={`Quitar ${row.name || "servicio"}`}
                onClick={() => setRows((prev) => prev.filter((_, i) => i !== index))}
              >
                <Trash2 className="size-4" />
              </button>
            )}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="text-xs text-muted-foreground">
              Duración
              <select
                className="field mt-1"
                value={row.durationMinutes}
                onChange={(e) => patch(index, { durationMinutes: Number(e.target.value) })}
              >
                {durations.map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {formatDuration(minutes)}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-muted-foreground">
              Precio (opcional)
              <input
                className="field mt-1"
                inputMode="numeric"
                placeholder="Sin precio"
                value={row.price}
                onChange={(e) => patch(index, { price: e.target.value.replace(/[^\d]/g, "").slice(0, 9) })}
              />
            </label>
          </div>
        </div>
      ))}
      {rows.length < 10 && (
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md py-1 text-sm font-medium text-primary hover:underline"
          onClick={() => setRows((prev) => [...prev, { name: "", durationMinutes: 30, price: "" }])}
        >
          <Plus className="size-4" /> Agregar otro servicio
        </button>
      )}
    </div>
  );
}
