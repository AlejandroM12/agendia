"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { removePublicImageAction, uploadPublicImageAction } from "@/modules/public-page/actions";

const MAX_BYTES = 8 * 1024 * 1024;
/** Por encima de este peso la foto se reduce en el navegador antes de subirla. */
const SHRINK_ABOVE_BYTES = 1.5 * 1024 * 1024;
const SHRINK_MAX_SIDE = 2400;

/**
 * Las fotos de celular pesan varios MB: se achican en el navegador para que
 * la subida sea rápida con datos móviles. Es solo una cortesía; el servidor
 * valida y vuelve a procesar la imagen igual (modules/public-page/images.ts).
 */
export async function shrinkImage(file: File, keepTransparency: boolean): Promise<File> {
  if (file.size <= SHRINK_ABOVE_BYTES) return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const ratio = Math.min(1, SHRINK_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * ratio);
    canvas.height = Math.round(bitmap.height * ratio);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const type = keepTransparency && file.type !== "image/jpeg" ? "image/png" : "image/jpeg";
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.9));
    return blob && blob.size < file.size ? new File([blob], file.name, { type }) : file;
  } catch {
    return file;
  }
}

export function ImageUploader({
  kind,
  label,
  hint,
  url,
  fallback,
  disabled,
  onChanged,
}: {
  kind: "logo" | "cover";
  label: string;
  hint: string;
  url: string | null;
  /** Nombre del negocio: su inicial se muestra cuando no hay imagen. */
  fallback: string;
  disabled: boolean;
  onChanged: () => void;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function finish(result: { ok: true } | { ok: false; message: string }) {
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setError(null);
    onChanged();
    router.refresh();
  }

  function upload(file: File | undefined) {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Formato no admitido. Subí una imagen JPG, PNG o WebP.");
      return;
    }
    startTransition(async () => {
      const prepared = await shrinkImage(file, kind === "logo");
      if (prepared.size > MAX_BYTES) {
        setError("La imagen pesa demasiado. El máximo es 8 MB.");
        return;
      }
      const data = new FormData();
      data.set("file", prepared);
      try {
        finish(await uploadPublicImageAction(kind, data));
      } catch {
        setError("No pudimos subir la imagen. Revisá tu conexión e intentá de nuevo.");
      }
    });
  }

  function remove() {
    startTransition(async () => {
      try {
        finish(await removePublicImageAction(kind));
      } catch {
        setError("No pudimos quitar la imagen. Revisá tu conexión e intentá de nuevo.");
      }
    });
  }

  return (
    <div>
      <p className="text-sm font-medium">{label}</p>
      <div
        className={cn(
          "mt-1.5 flex items-center justify-center overflow-hidden rounded-xl border border-border bg-muted",
          kind === "logo" ? "size-24" : "aspect-[2/1] w-full",
        )}
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={`${label} actual`} className={cn("size-full", kind === "logo" ? "bg-card object-contain" : "object-cover")} />
        ) : kind === "logo" ? (
          <span aria-hidden="true" className="flex size-full items-center justify-center bg-primary font-display text-4xl font-semibold text-primary-foreground uppercase">
            {fallback.trim().slice(0, 1)}
          </span>
        ) : (
          <span className="px-3 text-center text-xs text-muted-foreground">Sin portada: se usan tus colores</span>
        )}
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          aria-label={`Elegir archivo: ${label}`}
          disabled={disabled || pending}
          onChange={(event) => {
            upload(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        <Button type="button" size="sm" variant="outline" disabled={disabled || pending} onClick={() => input.current?.click()}>
          <ImagePlus aria-hidden="true" /> {pending ? "Procesando…" : url ? "Reemplazar" : "Subir"}
        </Button>
        {url && (
          <Button type="button" size="sm" variant="ghost" disabled={disabled || pending} onClick={remove} aria-label={`Quitar ${label.toLowerCase()}`}>
            <Trash2 aria-hidden="true" /> Quitar
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
