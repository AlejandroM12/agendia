"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";

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
        if (window.confirm(confirmMessage)) startTransition(async () => void (await action()));
      }}
      {...props}
    >
      {pending ? "Un momento…" : children}
    </Button>
  );
}
