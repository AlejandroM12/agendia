"use client";

import { useState, useSyncExternalStore } from "react";
import { Check, Copy, ExternalLink, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";

/** Enlace público de reservas, listo para copiar o compartir. */
export function ShareLink({ url, businessName }: { url: string; businessName: string }) {
  const [copied, setCopied] = useState(false);
  // En el servidor no hay `navigator`: se resuelve recién en el cliente.
  const canShare = useSyncExternalStore(
    () => () => undefined,
    () => typeof navigator.share === "function",
    () => false,
  );
  const display = url.replace(/^https?:\/\//, "");

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copiá tu enlace:", url);
    }
  }

  async function share() {
    try {
      await navigator.share({ title: businessName, text: `Reservá tu turno en ${businessName}`, url });
    } catch {
      // El usuario cerró el diálogo de compartir.
    }
  }


  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <p className="text-sm font-medium text-muted-foreground">Tu página de reservas</p>
      <p className="mt-1 truncate font-mono text-sm font-medium text-foreground">{display}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" onClick={copy} aria-live="polite">
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {copied ? "Copiado" : "Copiar enlace"}
        </Button>
        {canShare && (
          <Button size="sm" variant="outline" onClick={share}>
            <Share2 aria-hidden="true" /> Compartir
          </Button>
        )}
        <ButtonLink
          size="sm"
          variant="ghost" href={url} target="_blank" rel="noopener noreferrer">
              <ExternalLink aria-hidden="true" /> Ver página
            </ButtonLink>
      </div>
    </div>
  );
}
