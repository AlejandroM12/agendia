import Link from "next/link";
import { cn } from "@/lib/utils";
import { brand } from "@/lib/brand";

/** Isotipo: una hoja de agenda con el día marcado. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn("size-8", className)}>
      <rect width="32" height="32" rx="9" fill="var(--brand-pine)" />
      <rect x="8" y="9" width="16" height="15" rx="3.5" fill="none" stroke="#fbf9f5" strokeWidth="2" />
      <path d="M12 7v4M20 7v4" stroke="#fbf9f5" strokeWidth="2" strokeLinecap="round" />
      <circle cx="19" cy="18.5" r="2.4" fill="var(--brand-terracotta)" />
    </svg>
  );
}

export function Logo({ href = "/", className }: { href?: string | null; className?: string }) {
  const content = (
    <>
      <LogoMark />
      <span className="font-display text-xl font-semibold tracking-tight text-foreground">{brand.name}</span>
    </>
  );
  if (href === null) return <span className={cn("inline-flex items-center gap-2", className)}>{content}</span>;
  return (
    <Link href={href} className={cn("inline-flex items-center gap-2", className)} aria-label={`${brand.name} — inicio`}>
      {content}
    </Link>
  );
}
