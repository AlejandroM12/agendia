"use client";

import { useEffect, useState } from "react";
import { Search, UserRound, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { searchCustomersAction } from "@/modules/appointments/actions";

type Found = { id: string; name: string; detail: string };

/**
 * Cliente del turno: se busca entre los existentes mientras se escribe el
 * nombre; si no hay coincidencia, se crea uno nuevo con esos datos.
 */
export function CustomerPicker({ initial }: { initial?: Found | null }) {
  const [selected, setSelected] = useState<Found | null>(initial ?? null);
  const [name, setName] = useState("");
  const [results, setResults] = useState<Found[]>([]);

  useEffect(() => {
    if (selected || name.trim().length < 2) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      searchCustomersAction(name)
        .then((found) => {
          if (!cancelled) setResults(found);
        })
        .catch(() => undefined);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [name, selected]);

  if (selected) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-3.5 py-3">
        <input type="hidden" name="customerId" value={selected.id} />
        <UserRound className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{selected.name}</p>
          {selected.detail && <p className="truncate text-sm text-muted-foreground">{selected.detail}</p>}
        </div>
        <button
          type="button"
          className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Elegir otro cliente"
          onClick={() => setSelected(null)}
        >
          <X className="size-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute top-3 left-3 size-4 text-muted-foreground" aria-hidden="true" />
        <Input
          name="customerName"
          aria-label="Nombre del cliente"
          placeholder="Nombre del cliente"
          className="pl-9"
          autoComplete="off"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </div>

      {name.trim().length >= 2 && results.length > 0 && (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card" aria-label="Clientes existentes">
          {results.map((customer) => (
            <li key={customer.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left hover:bg-accent"
                onClick={() => setSelected(customer)}
              >
                <span className="truncate font-medium">{customer.name}</span>
                <span className="shrink-0 text-sm text-muted-foreground">{customer.detail}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Input name="customerPhone" type="tel" inputMode="tel" aria-label="Teléfono (opcional)" placeholder="Teléfono (opcional)" autoComplete="off" />
        <Input name="customerEmail" type="email" inputMode="email" aria-label="Email (opcional)" placeholder="Email (opcional)" autoComplete="off" />
      </div>
      <p className="text-xs text-muted-foreground">Con el email, tu cliente recibe la confirmación y el recordatorio.</p>
    </div>
  );
}
