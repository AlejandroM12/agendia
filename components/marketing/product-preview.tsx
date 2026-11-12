import { CalendarCheck, Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Vistas ilustrativas del producto para la landing. Reproducen la interfaz
 * real (mismos estilos y estructura) con datos de ejemplo — no son capturas
 * ni clientes reales.
 */

const DAY = [
  { time: "09:00", end: "09:30", name: "Lucía Fernández", service: "Consulta", state: "done" },
  { time: "10:00", end: "11:00", name: "Martín Sosa", service: "Sesión de 60 minutos", state: "now" },
  { time: "11:30", end: "12:00", name: "Carla Ríos", service: "Consulta", state: "next" },
  { time: "15:00", end: "15:45", name: "Diego Paz", service: "Primera consulta", state: "next" },
] as const;

export function AgendaPreview({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-3xl border border-border bg-card p-5 shadow-xl shadow-foreground/5", className)} aria-hidden="true">
      <p className="text-xs font-medium text-highlight">Hoy</p>
      <p className="font-display text-xl font-semibold">Jueves 12 de marzo</p>
      <div className="mt-4 grid grid-cols-7 gap-1 text-center">
        {["lun", "mar", "mié", "jue", "vie", "sáb", "dom"].map((d, i) => (
          <div key={d} className={cn("rounded-lg py-1.5", i === 3 && "bg-primary text-primary-foreground")}>
            <p className={cn("text-[10px] font-medium uppercase", i === 3 ? "text-primary-foreground/80" : "text-muted-foreground")}>{d}</p>
            <p className="text-sm font-semibold tabular-nums">{9 + i}</p>
          </div>
        ))}
      </div>
      <ul className="mt-4 divide-y divide-border rounded-2xl border border-border">
        {DAY.map((item) => (
          <li key={item.time} className={cn("flex items-center gap-3 px-3 py-2.5", item.state === "now" && "bg-highlight-soft/60")}>
            <div className={cn("w-11 text-center", item.state === "done" && "opacity-50")}>
              <p className="text-sm font-semibold tabular-nums">{item.time}</p>
              <p className="text-[10px] text-muted-foreground tabular-nums">{item.end}</p>
            </div>
            <span className={cn("w-1 self-stretch rounded-full", item.state === "now" ? "bg-highlight" : item.state === "done" ? "bg-input" : "bg-primary")} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{item.name}</p>
              <p className="truncate text-xs text-muted-foreground">{item.service}</p>
            </div>
            {item.state === "now" && <span className="rounded-full bg-highlight px-2 py-0.5 text-[10px] font-medium text-white">Ahora</span>}
            {item.state === "done" && <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-muted-foreground">Completado</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function BookingPreview({ className }: { className?: string }) {
  return (
    <div className={cn("w-56 rounded-[2rem] border-[6px] border-foreground bg-background p-3.5 shadow-2xl shadow-foreground/15", className)} aria-hidden="true">
      <div className="flex items-center gap-2.5">
        <span className="flex size-9 items-center justify-center rounded-xl bg-primary font-display text-base font-semibold text-primary-foreground">E</span>
        <div>
          <p className="font-display text-sm leading-tight font-semibold">Estudio Ejemplo</p>
          <p className="text-[10px] text-muted-foreground">Reservá tu turno</p>
        </div>
      </div>
      <p className="mt-3.5 flex items-center gap-1.5 text-[11px] font-semibold">
        <span className="flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground"><Check className="size-2.5" /></span>
        Consulta · 30 min
      </p>
      <div className="mt-2.5 flex gap-1.5">
        {[["jue", 12], ["vie", 13], ["lun", 16], ["mar", 17]].map(([d, n], i) => (
          <div key={n} className={cn("flex-1 rounded-lg border py-1 text-center", i === 1 ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card")}>
            <p className="text-[8px] font-medium uppercase">{d}</p>
            <p className="text-xs font-semibold tabular-nums">{n}</p>
          </div>
        ))}
      </div>
      <div className="mt-2.5 grid grid-cols-3 gap-1.5">
        {["09:00", "09:30", "10:30", "11:00", "15:00", "16:30"].map((t, i) => (
          <div key={t} className={cn("rounded-lg border py-1.5 text-center text-[11px] font-medium tabular-nums", i === 2 ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card")}>
            {t}
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-center gap-1.5 rounded-lg bg-primary py-2 text-[11px] font-semibold text-primary-foreground">
        <CalendarCheck className="size-3.5" /> Confirmar reserva
      </div>
    </div>
  );
}

export function ReminderPreview({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-2xl border border-border bg-card p-4 shadow-lg shadow-foreground/5", className)} aria-hidden="true">
      <p className="text-[11px] text-muted-foreground">Estudio Ejemplo · email</p>
      <p className="mt-1 font-display text-base font-semibold">Te recordamos tu turno</p>
      <dl className="mt-2 space-y-1 border-t border-border pt-2 text-xs">
        <div className="flex gap-3"><dt className="w-14 text-muted-foreground">Servicio</dt><dd className="font-medium">Consulta (30 min)</dd></div>
        <div className="flex gap-3"><dt className="w-14 text-muted-foreground">Cuándo</dt><dd className="font-medium">viernes 13 de marzo, 10:30</dd></div>
      </dl>
      <span className="mt-3 inline-block rounded-lg bg-primary px-3 py-1.5 text-[11px] font-semibold text-primary-foreground">
        Ver, reprogramar o cancelar
      </span>
    </div>
  );
}
