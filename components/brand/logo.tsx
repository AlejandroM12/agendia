import Link from "next/link";
import { cn } from "@/lib/utils";
import { brand } from "@/lib/brand";

/** Isotipo: una hoja de agenda con el día marcado. `inverted` es la versión para fondos oscuros. */
export function LogoMark({ className, inverted = false }: { className?: string; inverted?: boolean }) {
  const [background, line] = inverted ? ["#fbf9f5", "var(--brand-pine)"] : ["var(--brand-pine)", "#fbf9f5"];
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn("size-8", className)}>
      <rect width="32" height="32" rx="9" fill={background} />
      <rect x="8" y="9" width="16" height="15" rx="3.5" fill="none" stroke={line} strokeWidth="2" />
      <path d="M12 7v4M20 7v4" stroke={line} strokeWidth="2" strokeLinecap="round" />
      <circle cx="19" cy="18.5" r="2.4" fill="var(--brand-terracotta)" />
    </svg>
  );
}

export function Logo({
  href = "/",
  className,
  inverted = false,
}: {
  href?: string | null;
  className?: string;
  inverted?: boolean;
}) {
  const content = (
    <>
      <LogoMark inverted={inverted} />
      <span
        className={cn(
          "font-display text-xl font-semibold tracking-tight",
          inverted ? "text-primary-foreground" : "text-foreground",
        )}
      >
        {brand.name}
      </span>
    </>
  );
  if (href === null) return <span className={cn("inline-flex items-center gap-2", className)}>{content}</span>;
  return (
    <Link href={href} className={cn("inline-flex items-center gap-2", className)} aria-label={`${brand.name} — inicio`}>
      {content}
    </Link>
  );
}
