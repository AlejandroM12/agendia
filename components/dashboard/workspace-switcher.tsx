"use client";

import { useState, useTransition } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { switchWorkspaceAction } from "@/modules/auth/workspace-actions";

export type WorkspaceView = {
  organizationId: string;
  name: string;
  roleLabel: string;
  logoUrl: string | null;
  active: boolean;
};

function Logo({ name, logoUrl, className }: { name: string; logoUrl: string | null; className?: string }) {
  return logoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={logoUrl} alt="" className={cn("size-8 shrink-0 rounded-lg bg-card object-contain", className)} />
  ) : (
    <span aria-hidden="true" className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary font-display text-sm font-semibold text-primary-foreground uppercase", className)}>
      {name.trim().slice(0, 1)}
    </span>
  );
}

/**
 * Selector de negocio para quien pertenece a más de uno: nombre, logo y rol
 * en cada uno, y cuál está seleccionado. Cambiar vuelve a cargar todo el
 * panel desde el servidor, así nada de un negocio queda en pantalla en otro.
 * Con un solo negocio no se muestra.
 */
export function WorkspaceSwitcher({ workspaces, className }: { workspaces: WorkspaceView[]; className?: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const current = workspaces.find((w) => w.active) ?? workspaces[0];
  if (!current || workspaces.length < 2) return null;

  return (
    <div className={cn("relative", className)}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2.5 rounded-xl border border-border bg-card px-2.5 py-2 text-left hover:bg-muted"
      >
        <Logo name={current.name} logoUrl={current.logoUrl} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{current.name}</span>
          <span className="block truncate text-xs text-muted-foreground">{current.roleLabel}</span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>
      {open && (
        <ul role="listbox" aria-label="Tus negocios" className="absolute inset-x-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-xl border border-border bg-card p-1 shadow-lg">
          {workspaces.map((workspace) => (
            <li key={workspace.organizationId} role="option" aria-selected={workspace.active}>
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  if (workspace.active) return setOpen(false);
                  startTransition(async () => {
                    await switchWorkspaceAction(workspace.organizationId);
                  });
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-muted"
              >
                <Logo name={workspace.name} logoUrl={workspace.logoUrl} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{workspace.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{workspace.roleLabel}</span>
                </span>
                {workspace.active && <Check className="size-4 shrink-0 text-primary" aria-label="Seleccionado" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
