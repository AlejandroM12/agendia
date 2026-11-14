import Link from "next/link";
import { AtSign, CalendarSearch, MapPin, MessageCircle, Phone } from "lucide-react";
import { brand } from "@/lib/brand";
import { isStandalone } from "@/lib/deployment";
import { fontCssVariables, publicFontClasses } from "@/lib/public-fonts";
import { resolveTheme, themeCssVariables } from "@/lib/theme";
import { cn } from "@/lib/utils";
import type { PublicProfile } from "@/modules/public-page/settings";

export type PublicImages = { logoUrl: string | null; coverUrl: string | null };

/**
 * Aplica la identidad del negocio (colores y tipografía) a todo lo que
 * contiene. Los valores salen de lib/theme.ts: colores hexadecimales
 * calculados con contraste garantizado, nunca CSS escrito por el usuario.
 */
export function PublicTheme({
  profile,
  className,
  children,
}: {
  profile: Pick<PublicProfile, "themePrimary" | "themeSecondary" | "themeFont">;
  className?: string;
  children: React.ReactNode;
}) {
  const theme = resolveTheme({
    primary: profile.themePrimary,
    secondary: profile.themeSecondary,
    font: profile.themeFont,
  });
  const style = { ...themeCssVariables(theme), ...fontCssVariables(theme.font) } as React.CSSProperties;
  return (
    <div style={style} className={cn(publicFontClasses, "flex min-h-dvh flex-col bg-background font-sans", className)}>
      {children}
    </div>
  );
}

/** Logo del negocio o, si no cargó uno, su inicial sobre el color principal. */
export function BusinessLogo({ name, logoUrl, className }: { name: string; logoUrl: string | null; className?: string }) {
  if (logoUrl) {
    return (
      // Imagen ya optimizada y servida por la app (modules/public-page/images.ts).
      // eslint-disable-next-line @next/next/no-img-element
      <img src={logoUrl} alt={`Logo de ${name}`} className={cn("bg-card object-contain", className)} />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex items-center justify-center bg-primary font-display font-semibold text-primary-foreground uppercase",
        className,
      )}
    >
      {name.trim().slice(0, 1)}
    </span>
  );
}

type Contact = { key: string; href: string; label: string; icon: typeof MapPin; external?: boolean };

function contactsOf(profile: PublicProfile): Contact[] {
  const contacts: Contact[] = [];
  if (profile.showAddress && profile.address) {
    contacts.push({
      key: "address",
      href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(profile.address)}`,
      label: profile.address,
      icon: MapPin,
      external: true,
    });
  }
  if (profile.showWhatsapp && profile.whatsapp) {
    contacts.push({
      key: "whatsapp",
      href: `https://wa.me/${profile.whatsapp}`,
      label: "WhatsApp",
      icon: MessageCircle,
      external: true,
    });
  }
  if (profile.showInstagram && profile.instagram) {
    contacts.push({
      key: "instagram",
      href: `https://www.instagram.com/${profile.instagram}`,
      label: `@${profile.instagram}`,
      icon: AtSign,
      external: true,
    });
  }
  if (profile.showPhone && profile.phone) {
    contacts.push({ key: "phone", href: `tel:${profile.phone.replace(/[^\d+]/g, "")}`, label: profile.phone, icon: Phone });
  }
  return contacts;
}

/** Portada + identidad del negocio: lo primero que ve un cliente. */
export function PublicHero({ profile, images }: { profile: PublicProfile; images: PublicImages }) {
  const contacts = contactsOf(profile);
  return (
    <header>
      <div className="relative h-32 overflow-hidden bg-primary sm:h-48 lg:h-56">
        {images.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={images.coverUrl} alt="" className="size-full object-cover" />
        ) : (
          // Sin portada: un fondo con los dos colores del negocio.
          <div
            aria-hidden="true"
            className="size-full bg-[radial-gradient(120%_140%_at_100%_0%,var(--highlight)_0%,transparent_55%)] opacity-70"
          />
        )}
      </div>

      <div className="mx-auto w-full max-w-5xl px-4 sm:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:gap-5">
          <BusinessLogo
            name={profile.name}
            logoUrl={images.logoUrl}
            className="relative -mt-12 size-24 shrink-0 rounded-3xl text-4xl shadow-md ring-4 ring-background sm:-mt-14 sm:size-28"
          />
          <div className="min-w-0 sm:pt-3">
            <h1 className="font-display text-3xl leading-tight font-semibold break-words sm:text-4xl">{profile.name}</h1>
            {profile.specialty && <p className="mt-1 font-medium text-brand-text">{profile.specialty}</p>}
          </div>
        </div>

        {profile.description && (
          <p className="mt-4 max-w-2xl whitespace-pre-line text-muted-foreground">{profile.description}</p>
        )}

        {contacts.length > 0 && (
          <ul className="mt-4 flex flex-wrap gap-2">
            {contacts.map((contact) => (
              <li key={contact.key} className="max-w-full">
                <a
                  href={contact.href}
                  {...(contact.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                  className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-sm font-medium transition-colors hover:border-brand-border"
                >
                  <contact.icon className="size-4 shrink-0 text-brand-text" aria-hidden="true" />
                  <span className="truncate">{contact.label}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </header>
  );
}

/** Encabezado compacto para las páginas secundarias (mi turno, mis turnos). */
export function PublicCompactHeader({ profile, images }: { profile: Pick<PublicProfile, "name" | "slug" | "specialty">; images: PublicImages }) {
  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex w-full max-w-xl items-center gap-3.5 px-4 py-4">
        <Link href={`/${profile.slug}`} className="flex min-w-0 items-center gap-3.5">
          <BusinessLogo name={profile.name} logoUrl={images.logoUrl} className="size-12 shrink-0 rounded-2xl text-xl" />
          <span className="min-w-0">
            <span className="block truncate font-display text-xl leading-tight font-semibold">{profile.name}</span>
            {profile.specialty && <span className="block truncate text-sm text-muted-foreground">{profile.specialty}</span>}
          </span>
        </Link>
      </div>
    </header>
  );
}

/** Firma discreta de la plataforma, al pie de toda página pública. */
export function PublicFooter() {
  return (
    <footer className="mt-auto py-6 text-center text-xs text-muted-foreground">
      Reservas online con{" "}
      {isStandalone() ? (
        <span className="font-medium text-foreground">{brand.name}</span>
      ) : (
        <Link href="/" className="font-medium text-foreground underline-offset-4 hover:underline">
          {brand.name}
        </Link>
      )}
    </footer>
  );
}

/** Enlace a «Consultá tus turnos». */
export function LookupLink({ slug, className }: { slug: string; className?: string }) {
  return (
    <Link
      href={`/${slug}/mis-turnos`}
      className={cn(
        "flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3.5 transition-colors hover:border-brand-border",
        className,
      )}
    >
      <CalendarSearch className="size-5 shrink-0 text-brand-text" aria-hidden="true" />
      <span className="min-w-0">
        <span className="block font-medium">Consultá tus turnos</span>
        <span className="block text-sm text-muted-foreground">¿Ya reservaste? Mirá, reprogramá o cancelá tus turnos.</span>
      </span>
    </Link>
  );
}

/** Marco de las páginas públicas secundarias de un negocio. */
export function PublicShell({
  profile,
  images,
  children,
}: {
  profile: PublicProfile;
  images: PublicImages;
  children: React.ReactNode;
}) {
  return (
    <PublicTheme profile={profile}>
      <PublicCompactHeader profile={profile} images={images} />
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">{children}</main>
      <PublicFooter />
    </PublicTheme>
  );
}
