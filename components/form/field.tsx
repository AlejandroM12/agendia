import { cn } from "@/lib/utils";

/**
 * Etiqueta + control + ayuda/error, con el mismo espaciado en toda la app.
 *
 * La ayuda y el error llevan ids derivados del campo (`<id>-hint`,
 * `<id>-error`): `useForm` los asocia al control con `aria-describedby` y
 * marca `aria-invalid`, así un lector de pantalla anuncia el error al
 * enfocar el campo. El error no depende solo del color: lleva un ícono.
 */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  optional,
  required,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string | null;
  optional?: boolean;
  /** Muestra «obligatorio» junto a la etiqueta, donde conviven campos obligatorios y opcionales. */
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div data-field={htmlFor} className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="flex items-baseline gap-2 text-sm font-medium text-foreground">
        {label}
        {optional && <span className="text-xs font-normal text-muted-foreground">opcional</span>}
        {required && <span className="text-xs font-normal text-muted-foreground">obligatorio</span>}
      </label>
      {children}
      {hint && (
        <p id={htmlFor ? `${htmlFor}-hint` : undefined} className={cn("text-sm text-muted-foreground", error && "sr-only")}>
          {hint}
        </p>
      )}
      {error && <FieldError id={htmlFor ? `${htmlFor}-error` : undefined}>{error}</FieldError>}
    </div>
  );
}

export function FieldError({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <p id={id} role="alert" className="flex items-start gap-1.5 text-sm text-destructive">
      <svg viewBox="0 0 16 16" aria-hidden="true" className="mt-0.5 size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6">
        <circle cx="8" cy="8" r="6.4" />
        <path d="M8 4.8v3.6M8 10.9v.3" strokeLinecap="round" />
      </svg>
      <span>{children}</span>
    </p>
  );
}
