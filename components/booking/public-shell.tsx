import Link from "next/link";
import { MapPin, Phone } from "lucide-react";
import { brand } from "@/lib/brand";

/** Marco de las páginas públicas de un negocio (reserva y gestión del turno). */
export function PublicShell({
  organization,
  children,
}: {
  organization: { name: string; description: string | null; phone: string | null; address: string | null };
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-border bg-card">
        <div className="mx-auto w-full max-w-xl px-4 py-6">
          <div className="flex items-center gap-4">
            <span
              className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-primary font-display text-2xl font-semibold text-primary-foreground uppercase"
              aria-hidden="true"
            >
              {organization.name.slice(0, 1)}
            </span>
            <div className="min-w-0">
              <h1 className="font-display text-2xl leading-tight font-semibold">{organization.name}</h1>
              {organization.description && (
                <p className="mt-0.5 text-sm text-muted-foreground">{organization.description}</p>
              )}
            </div>
          </div>
          {(organization.address || organization.phone) && (
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
              {organization.address && (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="size-4" aria-hidden="true" /> {organization.address}
                </span>
              )}
              {organization.phone && (
                <a href={`tel:${organization.phone}`} className="inline-flex items-center gap-1.5 hover:text-foreground">
                  <Phone className="size-4" aria-hidden="true" /> {organization.phone}
                </a>
              )}
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">{children}</main>

      <footer className="py-6 text-center text-xs text-muted-foreground">
        Reservas online con{" "}
        <Link href="/" className="font-medium text-foreground underline-offset-4 hover:underline">
          {brand.name}
        </Link>
      </footer>
    </div>
  );
}
