"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, CheckCheck } from "lucide-react";
import { cancelByTokenAction, confirmAttendanceByTokenAction } from "@/modules/booking/actions";
import type { WhatsappButton } from "@/modules/whatsapp/templates";

export type PreviewMessage = {
  id: string;
  label: string;
  customer: string;
  time: string;
  body: string;
  buttons: WhatsappButton[];
  token: string;
  /** Estado actual del turno, para mostrar la respuesta del cliente. */
  confirmed: boolean;
  canceled: boolean;
};

/**
 * Vista previa de cómo le llega un aviso al cliente por WhatsApp. Es una simulación: los botones de respuesta rápida
 * hacen lo mismo que harán con el envío real (confirmar la asistencia, cancelar), y «Reprogramar» abre la página segura
 * del turno. No se envía nada a ningún teléfono.
 */
export function WhatsappPhone({ messages }: { messages: PreviewMessage[] }) {
  const router = useRouter();
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(message: PreviewMessage, button: WhatsappButton) {
    setNote(null);
    if (button.action === "cancel" && !window.confirm("¿Cancelar este turno? (es una demo: no pasa nada real)")) return;
    startTransition(async () => {
      const result = button.action === "confirm" ? await confirmAttendanceByTokenAction(message.token) : await cancelByTokenAction(message.token);
      if (result?.ok) router.refresh();
      else setNote(result && "message" in result ? result.message : "No se pudo completar.");
    });
  }

  if (messages.length === 0) {
    return <p className="rounded-xl bg-secondary px-4 py-3 text-sm text-muted-foreground">Todavía no hay avisos. Reservá un turno desde la página de reservas o enviá un recordatorio.</p>;
  }

  return (
    <div className="mx-auto w-full max-w-sm rounded-[2rem] border-4 border-foreground/80 bg-[#e5ddd5] p-3 shadow-xl">
      <div className="mb-3 flex items-center gap-2 rounded-xl bg-[#075e54] px-3 py-2 text-white">
        <span className="grid size-8 place-items-center rounded-full bg-white/20 text-sm font-semibold">B</span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">Barbería Don Lucho</p>
          <p className="text-xs opacity-80">cuenta de empresa · vista previa</p>
        </div>
      </div>
      <ul className="max-h-[32rem] space-y-3 overflow-y-auto pr-1">
        {messages.map((message) => (
          <li key={message.id}>
            <p className="mb-1 text-center text-[11px] text-foreground/60">
              {message.label} · para {message.customer} · {message.time}
            </p>
            <div className="rounded-xl rounded-tl-none bg-white p-3 text-sm text-neutral-900 shadow-sm">
              <p>{message.body}</p>
              <p className="mt-1 flex items-center justify-end gap-1 text-[11px] text-neutral-500">
                simulado <CheckCheck className="size-3.5 text-sky-500" aria-hidden="true" />
              </p>
              {message.canceled ? (
                <p className="mt-2 rounded-lg bg-neutral-100 px-3 py-2 text-center text-xs font-medium">El turno fue cancelado</p>
              ) : (
                <div className="mt-2 space-y-1.5">
                  {message.buttons.map((button) => {
                    const done = button.action === "confirm" && message.confirmed;
                    const className = "block w-full rounded-lg border border-neutral-200 px-3 py-2 text-center text-[13px] font-medium text-[#075e54] disabled:opacity-60";
                    if (button.kind === "link") {
                      return (
                        <a key={button.label} href={`/turno/${message.token}`} target="_blank" rel="noopener noreferrer" className={className}>
                          {button.label}
                        </a>
                      );
                    }
                    return (
                      <button key={button.label} type="button" className={className} disabled={pending || done} onClick={() => run(message, button)}>
                        {done ? (
                          <span className="inline-flex items-center gap-1">
                            <Check className="size-4" aria-hidden="true" /> Confirmaste que vas
                          </span>
                        ) : (
                          button.label
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
      {note && (
        <p role="alert" className="mt-2 rounded-lg bg-red-100 px-3 py-2 text-xs text-red-900">
          {note}
        </p>
      )}
    </div>
  );
}
