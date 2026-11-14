"use client";

import { useState } from "react";
import { ChevronDown, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { WhatsAppActions } from "@/modules/whatsapp/links";

/**
 * «WhatsApp»: una sola acción que despliega los mensajes disponibles para
 * este turno. Cada opción abre WhatsApp (en el celular, en la app; en la
 * computadora, en WhatsApp Web) con el mensaje ya escrito: quien administra
 * lo revisa, lo modifica si quiere y lo envía desde su propia cuenta.
 * Agendia no envía nada ni sabe si el mensaje se envió.
 */
export function WhatsAppMenu({ actions, showDiscreet }: { actions: WhatsAppActions; showDiscreet: boolean }) {
  const [open, setOpen] = useState(false);
  const [discreet, setDiscreet] = useState(false);

  if (actions.status === "no_phone") return null;
  if (actions.status === "invalid_phone") {
    return (
      <p className="text-sm text-muted-foreground">
        El teléfono de este cliente no parece válido para WhatsApp. Revisalo en su ficha (con característica, por ejemplo 11 5555 0000).
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-expanded={open}
        aria-controls="whatsapp-options"
        onClick={() => setOpen((value) => !value)}
      >
        <MessageCircle aria-hidden="true" /> WhatsApp <ChevronDown aria-hidden="true" className={open ? "rotate-180 transition-transform" : "transition-transform"} />
      </Button>

      {open && (
        <div id="whatsapp-options" className="w-full max-w-sm space-y-3 rounded-xl border border-border bg-card p-3">
          <ul className="space-y-1">
            {actions.options.map((option) => (
              <li key={option.kind}>
                <a
                  href={discreet ? option.discreetUrl : option.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-whatsapp-kind={option.kind}
                  className="block rounded-lg px-3 py-2 text-sm font-medium hover:bg-accent"
                >
                  {option.label}
                </a>
              </li>
            ))}
          </ul>
          {showDiscreet && (
            <label className="flex cursor-pointer items-start gap-2.5 border-t border-border pt-3 text-sm">
              <input type="checkbox" checked={discreet} onChange={(event) => setDiscreet(event.target.checked)} className="mt-0.5 size-4 accent-[var(--primary)]" />
              <span>
                <span className="font-medium">Mensaje discreto</span>
                <span className="block text-muted-foreground">Sin el nombre del profesional ni datos de contacto.</span>
              </span>
            </label>
          )}
          <p className="text-xs text-muted-foreground">
            Se abre WhatsApp con el mensaje escrito. Lo revisás y lo enviás vos: Agendia no lo envía.
          </p>
        </div>
      )}
    </div>
  );
}
