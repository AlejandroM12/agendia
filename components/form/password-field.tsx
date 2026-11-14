"use client";

import { useState } from "react";
import { Check, Circle, Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { checkPassword } from "@/lib/password-rules";
import { cn } from "@/lib/utils";
import { FieldError } from "./field";

/**
 * Campo de contraseña con botón para verla y, opcionalmente, los requisitos
 * a la vista desde el principio, que se van marcando mientras se escribe.
 *
 * Los requisitos salen de lib/password-rules.ts, la misma lista con la que
 * valida el servidor. La contraseña vive solo en la memoria de la página:
 * no se guarda en el navegador ni se devuelve desde el servidor.
 */
export function PasswordField({
  id,
  name,
  label,
  autoComplete,
  showRules = false,
  hint,
  error,
}: {
  id: string;
  name: string;
  label: string;
  autoComplete: "new-password" | "current-password";
  /** Mostrar los requisitos (para contraseñas nuevas). */
  showRules?: boolean;
  hint?: string;
  error?: string | null;
}) {
  const [value, setValue] = useState("");
  const [visible, setVisible] = useState(false);
  const rules = checkPassword(value);

  return (
    <div data-field={id} className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-foreground">
        {label}
      </label>
      <div className="relative">
        <Input
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          className="pr-11"
          onChange={(event) => setValue(event.target.value)}
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
          aria-pressed={visible}
          aria-controls={id}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
        >
          {visible ? <EyeOff className="size-4.5" aria-hidden="true" /> : <Eye className="size-4.5" aria-hidden="true" />}
        </button>
      </div>

      {error && <FieldError id={`${id}-error`}>{error}</FieldError>}

      {showRules ? (
        <div id={`${id}-hint`}>
          <p className="sr-only">Requisitos de la contraseña:</p>
          <ul className="space-y-1 pt-0.5" data-testid="password-rules">
            {rules.map((rule) => (
              <li
                key={rule.id}
                data-met={rule.met}
                className={cn(
                  "flex items-center gap-2 text-sm transition-colors",
                  rule.met ? "font-medium text-success" : "text-muted-foreground",
                )}
              >
                {/* El estado no depende solo del color: cambia el ícono y hay texto para lectores de pantalla. */}
                {rule.met ? (
                  <Check className="size-4 shrink-0" aria-hidden="true" strokeWidth={3} />
                ) : (
                  <Circle className="size-4 shrink-0" aria-hidden="true" />
                )}
                <span>{rule.label}</span>
                <span className="sr-only">{rule.met ? "(cumplido)" : "(falta)"}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
