import type { Metadata } from "next";
import { PublicPage } from "@/components/booking/public-page";
import { db } from "@/lib/db";
import { canPerformWriteActions } from "@/lib/organization-access";
import { findPublicOrganization, loadPublicOrganization } from "@/modules/public-page/load";
import { loadPublicTeamView } from "@/modules/public-page/team";

// Disponibilidad en tiempo real: siempre se renderiza por request.
export const instant = false;

/**
 * Metadata propia de cada negocio: al compartir el enlace por WhatsApp o
 * redes, la vista previa muestra su nombre, su descripción y su imagen, no
 * la marca de la plataforma.
 */
export async function generateMetadata(props: PageProps<"/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const found = await findPublicOrganization(slug);
  if (!found) return { title: "Página no encontrada", robots: { index: false } };

  const { organization, profile, images } = found;
  if (organization.isDemo) return { title: "Demo — Reservá tu turno", robots: { index: false, follow: false } };
  const title = profile.specialty ? `${profile.name} · ${profile.specialty}` : profile.name;
  const description =
    profile.description ?? `Reservá tu turno online en ${profile.name}: elegí servicio, día y horario en un minuto.`;
  // La imagen cambia cuando cambia la configuración: la versión evita que
  // WhatsApp y las redes sigan mostrando una vista previa vieja.
  const version = `${organization.updatedAt.getTime().toString(36)}${images.logoId?.slice(0, 4) ?? ""}${images.coverId?.slice(0, 4) ?? ""}`;

  return {
    title: { absolute: `${title} — Reservá tu turno` },
    description,
    alternates: { canonical: `/${profile.slug}` },
    ...(images.logoUrl ? { icons: { icon: images.logoUrl, apple: images.logoUrl } } : {}),
    openGraph: {
      type: "website",
      locale: "es_AR",
      url: `/${profile.slug}`,
      siteName: profile.name,
      title: `${title} — Reservá tu turno`,
      description,
      images: [{ url: `/${profile.slug}/og?v=${version}`, width: 1200, height: 630, alt: profile.name }],
    },
    twitter: { card: "summary_large_image", title: `${title} — Reservá tu turno`, description },
  };
}

export default async function PublicBookingPage(props: PageProps<"/[slug]">) {
  const { slug } = await props.params;
  const { organization, profile, images } = await loadPublicOrganization(slug);

  const bookable = canPerformWriteActions(organization);
  const services = bookable
    ? await db.service.findMany({
        where: { organizationId: organization.id, active: true },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: { id: true, name: true, description: true, durationMinutes: true, price: true },
      })
    : [];

  const team = bookable ? await loadPublicTeamView(organization) : undefined;
  const whatsapp = bookable ? await db.whatsappConnection.findUnique({ where: { organizationId: organization.id }, select: { enabled: true, status: true } }) : null;
  const whatsappConsent = Boolean(whatsapp?.enabled && whatsapp.status === "connected") || (organization.isDemo && organization.demoKind === "public");

  return (
    <>
      {organization.isDemo && (
        <p role="status" className="bg-amber-100 px-4 py-2 text-center text-sm text-amber-950">
          <strong>Demo:</strong> negocio ficticio. Podés reservar para probar: no se envía ningún mensaje real.
        </p>
      )}
      <PublicPage profile={profile} images={images} services={services} team={team} bookable={bookable} whatsappConsent={whatsappConsent} />
    </>
  );
}
