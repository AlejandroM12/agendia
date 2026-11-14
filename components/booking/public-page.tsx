import { BookingFlow, type BookableService } from "@/components/booking/booking-flow";
import type { PublicTeamView } from "@/components/booking/professional-picker";
import { LookupLink, PublicFooter, PublicHero, PublicTheme, type PublicImages } from "@/components/booking/public-shell";
import type { PublicProfile } from "@/modules/public-page/settings";

/**
 * Página pública de reservas de un negocio. La usan la ruta real (`/[slug]`)
 * y la vista previa del panel, que le pasa la configuración sin guardar.
 */
export function PublicPage({
  profile,
  images,
  services,
  team,
  bookable,
  preview = false,
}: {
  profile: PublicProfile;
  images: PublicImages;
  services: BookableService[];
  /** Quiénes atienden cada servicio online (ver modules/public-page/team.ts). */
  team?: PublicTeamView;
  /** `false` si el negocio no está tomando reservas (cuenta en solo lectura o sin servicios activos). */
  bookable: boolean;
  preview?: boolean;
}) {
  // Ocultar precios es una decisión del negocio: directamente no se envían al navegador.
  const shown = profile.showPrices ? services : services.map((service) => ({ ...service, price: null }));

  return (
    <PublicTheme profile={profile}>
      <PublicHero profile={profile} images={images} />

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-8 pb-10 sm:px-6 lg:grid lg:grid-cols-[minmax(0,1fr)_19rem] lg:items-start lg:gap-10">
        <div className="min-w-0">
          {bookable && shown.length > 0 ? (
            <BookingFlow slug={profile.slug} businessName={profile.name} services={shown} team={team} preview={preview} />
          ) : (
            <div className="rounded-3xl border border-dashed border-input bg-card/60 px-6 py-10 text-center">
              <p className="font-display text-lg font-semibold">Reservas online no disponibles</p>
              <p className="mt-1.5 text-sm text-muted-foreground">
                {profile.name} no está tomando reservas online en este momento.
                {(profile.showPhone && profile.phone) || (profile.showWhatsapp && profile.whatsapp)
                  ? " Podés comunicarte por los medios de contacto de arriba."
                  : ""}
              </p>
            </div>
          )}
        </div>

        <aside className="mt-10 lg:sticky lg:top-6 lg:mt-0">
          <LookupLink slug={profile.slug} />
        </aside>
      </main>

      <PublicFooter />
    </PublicTheme>
  );
}
