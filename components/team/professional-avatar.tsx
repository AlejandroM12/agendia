import { cn } from "@/lib/utils";
import { imageUrl } from "@/modules/public-page/images-client";

/** Foto del profesional; sin foto, su inicial sobre su color. Es solo presentación: el nombre siempre va escrito al lado. */
export function ProfessionalAvatar({
  name,
  color,
  photoImageId,
  className,
}: {
  name: string;
  color: string;
  photoImageId: string | null;
  className?: string;
}) {
  return photoImageId ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={imageUrl(photoImageId)} alt="" className={cn("size-12 shrink-0 rounded-full bg-muted object-cover", className)} />
  ) : (
    <span
      aria-hidden="true"
      style={{ backgroundColor: color }}
      className={cn(
        "flex size-12 shrink-0 items-center justify-center rounded-full font-display text-lg font-semibold text-white uppercase",
        className,
      )}
    >
      {name.trim().slice(0, 1)}
    </span>
  );
}
