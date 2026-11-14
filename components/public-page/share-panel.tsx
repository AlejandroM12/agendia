"use client";

import { useState } from "react";
import { Check, Copy, Download, ExternalLink, MessageCircle } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";

/** Todo lo necesario para difundir la página pública: enlace, WhatsApp y QR. */
export function SharePanel({ url, businessName }: { url: string; businessName: string }) {
  const [copied, setCopied] = useState(false);
  const display = url.replace(/^https?:\/\//, "");
  const whatsapp = `https://wa.me/?text=${encodeURIComponent(`¡Hola! Ya podés reservar tu turno online en ${businessName}: ${url}`)}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copiá tu enlace:", url);
    }
  }

  return (
    <div className="grid gap-5 rounded-2xl border border-border bg-card p-5 sm:grid-cols-[1fr_auto] sm:items-center">
      <div className="min-w-0">
        <p className="text-sm font-medium text-muted-foreground">La dirección de tu página</p>
        <p className="mt-1 font-mono text-sm font-medium break-all text-foreground" data-testid="public-url">
          {display}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" onClick={copy} aria-live="polite">
            {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
            {copied ? "Copiado" : "Copiar enlace"}
          </Button>
          <ButtonLink size="sm" variant="outline" href={url} target="_blank" rel="noopener noreferrer">
            <ExternalLink aria-hidden="true" /> Abrir página
          </ButtonLink>
          <ButtonLink size="sm" variant="outline" href={whatsapp} target="_blank" rel="noopener noreferrer">
            <MessageCircle aria-hidden="true" /> Compartir por WhatsApp
          </ButtonLink>
        </div>
      </div>

      <div className="flex items-center gap-4 border-t border-border pt-5 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/dashboard/pagina/qr?formato=svg"
          alt={`Código QR de la página de ${businessName}`}
          width={104}
          height={104}
          className="size-26 rounded-lg border border-border bg-white"
        />
        <div className="space-y-2">
          <p className="text-sm font-medium">Código QR</p>
          <p className="max-w-44 text-xs text-muted-foreground">Para imprimir y dejar en tu local o sumar a tus redes.</p>
          <div className="flex flex-wrap gap-2">
            {/* Descargas: enlaces comunes, no navegación de la app. */}
            <a className={buttonVariants({ variant: "outline", size: "sm" })} href="/dashboard/pagina/qr?formato=png&descargar=1" download>
              <Download aria-hidden="true" /> Descargar PNG
            </a>
            <a className={buttonVariants({ variant: "ghost", size: "sm" })} href="/dashboard/pagina/qr?formato=svg&descargar=1" download>
              SVG
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
