import { CircleAlert, CircleCheck } from "lucide-react";
import { cn } from "@/lib/utils";

export function FormMessage({
  message,
  tone = "error",
  className,
}: {
  message?: string | null;
  tone?: "error" | "success" | "info";
  className?: string;
}) {
  if (!message) return null;
  const Icon = tone === "success" ? CircleCheck : CircleAlert;
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm",
        tone === "error" && "bg-danger-soft text-destructive",
        tone === "success" && "bg-success-soft text-success",
        tone === "info" && "bg-secondary text-foreground",
        className,
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </p>
  );
}
