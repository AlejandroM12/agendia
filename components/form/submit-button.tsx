"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

type Props = React.ComponentProps<typeof Button> & {
  pendingLabel?: string;
  /** Estado del envío cuando el formulario usa `useForm` (form.pending). */
  pending?: boolean;
};

/** Botón de envío: se deshabilita y avisa mientras la solicitud está en curso. */
export function SubmitButton({ children, pendingLabel, pending: pendingProp, disabled, ...props }: Props) {
  const status = useFormStatus();
  const pending = pendingProp ?? status.pending;
  return (
    <Button type="submit" disabled={pending || disabled} aria-busy={pending} {...props}>
      {pending ? (pendingLabel ?? "Guardando…") : children}
    </Button>
  );
}
