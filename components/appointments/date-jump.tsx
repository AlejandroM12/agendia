"use client";

import { useRouter } from "next/navigation";
import { CalendarSearch } from "lucide-react";

/** Salto directo a cualquier fecha de la agenda. */
export function DateJump({ value }: { value: string }) {
  const router = useRouter();
  return (
    <label className="relative inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-input bg-card px-3 text-sm font-medium hover:bg-muted">
      <CalendarSearch className="size-4" aria-hidden="true" />
      <span>Ir a fecha</span>
      <input
        type="date"
        aria-label="Ir a una fecha"
        className="absolute inset-0 cursor-pointer opacity-0"
        value={value}
        onChange={(e) => {
          if (e.target.value) router.push(`/dashboard/agenda?fecha=${e.target.value}`);
        }}
        onClick={(e) => {
          try {
            e.currentTarget.showPicker();
          } catch {
            // Navegadores sin showPicker abren el selector nativo igual.
          }
        }}
      />
    </label>
  );
}
