"use client";

import { ConfirmButton } from "@/components/form/confirm-button";
import { revokeOtherSessionsAction, revokeSessionAction } from "@/modules/auth/account-actions";

type SessionView = { id: string; device: string; lastSeenAt: string };

const when = (iso: string) => new Date(iso).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });

/** Las sesiones abiertas de la persona: cerrar una o todas las demás. */
export function SessionsList({ sessions, currentId }: { sessions: SessionView[]; currentId: string | null }) {
  if (sessions.length === 0) {
    return <p className="text-sm text-muted-foreground">No hay sesiones registradas para mostrar.</p>;
  }
  return (
    <div className="max-w-xl space-y-3" data-testid="sessions">
      <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
        {sessions.map((session) => (
          <li key={session.id} className="flex items-center gap-3 px-4 py-3 text-sm">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">
                {session.device}
                {session.id === currentId && <span className="ml-2 rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">Este dispositivo</span>}
              </p>
              <p className="text-xs text-muted-foreground">Última actividad: {when(session.lastSeenAt)}</p>
            </div>
            {session.id !== currentId && (
              <ConfirmButton variant="outline" size="sm" action={revokeSessionAction.bind(null, session.id)} confirmMessage="¿Cerrar esa sesión?">
                Cerrar
              </ConfirmButton>
            )}
          </li>
        ))}
      </ul>
      {sessions.length > 1 && (
        <ConfirmButton variant="outline" action={revokeOtherSessionsAction} confirmMessage="¿Cerrar todas las demás sesiones?">
          Cerrar las demás sesiones
        </ConfirmButton>
      )}
    </div>
  );
}
