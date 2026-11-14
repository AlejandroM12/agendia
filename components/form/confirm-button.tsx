"use client";

import { useTransition } from "react";
import { unstable_rethrow } from "next/navigation";
import { Button } from "@/components/ui/button";
import { NETWORK_ERROR_MESSAGE } from "./use-form";

type Props = Omit<React.ComponentProps<typeof Button>, "onClick" | "action"> & {
  action: () => Promise<unknown>;
  confirmMessage: string;
};

/** Botón para acciones que conviene confirmar (cancelar un turno, eliminar algo). */
export function ConfirmButton({ action, confirmMessage, children, variant = "destructive", ...props }: Props) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant={variant}
      disabled={pending}
      onClick={() => {
        if (!window.confirm(confirmMessage)) return;
        startTransition(async () => {
          try {
            await action();
          } catch (error) {
            // Las redirecciones de Next viajan como excepción: siguen su camino.
            unstable_rethrow(error);
            window.alert(NETWORK_ERROR_MESSAGE);
          }
        });
      }}
      {...props}
    >
      {pending ? "Un momento…" : children}
    </Button>
  );
}
