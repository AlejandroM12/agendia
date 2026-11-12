import type { AppointmentStatus } from "@prisma/client";
import { cn } from "@/lib/utils";

export const STATUS_LABEL: Record<AppointmentStatus, string> = {
  confirmed: "Confirmado",
  completed: "Completado",
  canceled: "Cancelado",
  no_show: "No asistió",
};

const STATUS_STYLE: Record<AppointmentStatus, string> = {
  confirmed: "bg-accent text-accent-foreground",
  completed: "bg-secondary text-muted-foreground",
  canceled: "bg-danger-soft text-destructive",
  no_show: "bg-warning-soft text-warning",
};

export function StatusBadge({ status, className }: { status: AppointmentStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        STATUS_STYLE[status],
        className,
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
