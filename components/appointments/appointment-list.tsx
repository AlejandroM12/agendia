import Link from "next/link";
import type { AppointmentStatus } from "@prisma/client";
import { formatDateShort, formatTime, toZoned } from "@/lib/time";
import { cn } from "@/lib/utils";
import { StatusBadge } from "./status";

export type AppointmentListItem = {
  id: string;
  startsAt: Date;
  endsAt: Date;
  status: AppointmentStatus;
  customer: { name: string };
  service: { name: string };
};

/** Lista de turnos: hora a la izquierda, quién y qué a la derecha. */
export function AppointmentList({
  appointments,
  timeZone,
  showDate = false,
  now,
}: {
  appointments: AppointmentListItem[];
  timeZone: string;
  showDate?: boolean;
  /** Si se pasa, resalta el turno en curso y atenúa los que ya pasaron. */
  now?: Date;
}) {
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
      {appointments.map((appointment) => {
        const inProgress = now && appointment.status === "confirmed" && appointment.startsAt <= now && appointment.endsAt > now;
        const past = now && appointment.endsAt <= now;
        const inactive = appointment.status === "canceled";
        return (
          <li key={appointment.id}>
            <Link
              href={`/dashboard/turnos/${appointment.id}`}
              className={cn(
                "flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-accent/50",
                inProgress && "bg-highlight-soft/60",
              )}
            >
              <div className={cn("w-14 shrink-0 text-center", (past || inactive) && "opacity-55")}>
                {showDate && (
                  <p className="text-xs font-medium text-muted-foreground">
                    {formatDateShort(toZoned(appointment.startsAt, timeZone).dateStr)}
                  </p>
                )}
                <p className="text-base font-semibold tabular-nums">{formatTime(appointment.startsAt, timeZone)}</p>
                {!showDate && (
                  <p className="text-xs text-muted-foreground tabular-nums">{formatTime(appointment.endsAt, timeZone)}</p>
                )}
              </div>
              <div
                className={cn(
                  "w-1 self-stretch rounded-full",
                  inProgress ? "bg-highlight" : inactive ? "bg-border" : past ? "bg-input" : "bg-primary",
                )}
                aria-hidden="true"
              />
              <div className={cn("min-w-0 flex-1", inactive && "opacity-60")}>
                <p className={cn("truncate font-medium", inactive && "line-through")}>{appointment.customer.name}</p>
                <p className="truncate text-sm text-muted-foreground">{appointment.service.name}</p>
              </div>
              {inProgress ? (
                <span className="shrink-0 rounded-full bg-highlight px-2.5 py-0.5 text-xs font-medium text-white">Ahora</span>
              ) : (
                appointment.status !== "confirmed" && <StatusBadge status={appointment.status} />
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
