"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { shrinkImage } from "@/components/public-page/image-uploader";
import { removeProfessionalPhotoAction, uploadProfessionalPhotoAction } from "@/modules/team/actions";
import { ProfessionalAvatar } from "./professional-avatar";

const MAX_BYTES = 8 * 1024 * 1024;

/** Foto del profesional: se achica en el navegador y el servidor la valida y la vuelve a procesar. */
export function ProfessionalPhoto({
  professionalId,
  name,
  color,
  photoImageId,
  disabled,
}: {
  professionalId: string;
  name: string;
  color: string;
  photoImageId: string | null;
  disabled: boolean;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function finish(result: { ok: true } | { ok: false; message: string }) {
    if (!result.ok) return setError(result.message);
    setError(null);
    router.refresh();
  }

  function upload(file: File | undefined) {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Formato no admitido. Subí una imagen JPG, PNG o WebP.");
      return;
    }
    startTransition(async () => {
      const prepared = await shrinkImage(file, false);
      if (prepared.size > MAX_BYTES) return setError("La imagen pesa demasiado. El máximo es 8 MB.");
      const data = new FormData();
      data.set("file", prepared);
      try {
        finish(await uploadProfessionalPhotoAction(professionalId, data));
      } catch {
        setError("No pudimos subir la foto. Revisá tu conexión e intentá de nuevo.");
      }
    });
  }

  function remove() {
    startTransition(async () => {
      try {
        finish(await removeProfessionalPhotoAction(professionalId));
      } catch {
        setError("No pudimos quitar la foto. Revisá tu conexión e intentá de nuevo.");
      }
    });
  }

  return (
    <div>
      <div className="flex items-center gap-4">
        <ProfessionalAvatar name={name} color={color} photoImageId={photoImageId} className="size-20 text-3xl" />
        <div className="space-y-2">
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            aria-label="Elegir archivo: foto del profesional"
            disabled={disabled || pending}
            onChange={(event) => {
              upload(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" disabled={disabled || pending} onClick={() => input.current?.click()}>
              <ImagePlus aria-hidden="true" /> {pending ? "Procesando…" : photoImageId ? "Cambiar foto" : "Subir foto"}
            </Button>
            {photoImageId && (
              <Button type="button" size="sm" variant="ghost" disabled={disabled || pending} onClick={remove}>
                <Trash2 aria-hidden="true" /> Quitar
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">JPG, PNG o WebP, de al menos 160 × 160 píxeles. Se recorta en cuadrado.</p>
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
