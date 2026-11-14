import { BellRing, CalendarCheck, Link2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Lo que resuelve Agendia, en tres líneas. Se usa en las pantallas de cuenta. */
export const AUTH_BENEFITS: ReadonlyArray<{ icon: LucideIcon; title: string; text: string }> = [
  { icon: CalendarCheck, title: "Tu agenda ordenada", text: "Todos tus turnos en un solo lugar, desde el celular." },
  { icon: Link2, title: "Reservas online con tu marca", text: "Tus clientes reservan solos, a cualquier hora." },
  { icon: BellRing, title: "Recordatorios automáticos", text: "Menos ausencias, sin escribirle a cada uno." },
];

export function AuthBenefits({ tone = "default", className }: { tone?: "default" | "onPrimary"; className?: string }) {
  const onPrimary = tone === "onPrimary";
  return (
    <ul className={cn("space-y-5", className)}>
      {AUTH_BENEFITS.map((benefit) => (
        <li key={benefit.title} className="flex items-start gap-3.5">
          <span
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-xl",
              onPrimary ? "bg-primary-foreground/12 text-primary-foreground" : "bg-accent text-accent-foreground",
            )}
          >
            <benefit.icon className="size-5" aria-hidden="true" />
          </span>
          <span>
            <span className={cn("block font-semibold", onPrimary ? "text-primary-foreground" : "text-foreground")}>
              {benefit.title}
            </span>
            <span className={cn("block text-sm", onPrimary ? "text-primary-foreground/75" : "text-muted-foreground")}>
              {benefit.text}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
