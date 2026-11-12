import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BookingFlow } from "@/components/booking/booking-flow";
import { PublicShell } from "@/components/booking/public-shell";
import { db } from "@/lib/db";
import { brand } from "@/lib/brand";
import { canPerformWriteActions } from "@/lib/organization-access";
import { isValidSlugFormat } from "@/lib/slug";

// Disponibilidad en tiempo real: siempre se renderiza por request.
export const instant = false;

async function loadOrganization(slug: string) {
  if (!isValidSlugFormat(slug)) return null;
  const organization = await db.organization.findUnique({ where: { slug } });
  return organization?.onboardingCompletedAt ? organization : null;
}

export async function generateMetadata(props: PageProps<"/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const organization = await loadOrganization(slug);
  if (!organization) return { title: "Página no encontrada" };
  return {
    title: { absolute: `Reservá tu turno en ${organization.name}` },
    description: organization.description ?? `Elegí servicio, día y horario, y reservá online en ${organization.name}.`,
    openGraph: { title: `Reservá tu turno en ${organization.name}`, siteName: brand.name },
  };
}

export default async function PublicBookingPage(props: PageProps<"/[slug]">) {
  const { slug } = await props.params;
  const organization = await loadOrganization(slug);
  if (!organization) notFound();

  const services = canPerformWriteActions(organization)
    ? await db.service.findMany({
        where: { organizationId: organization.id, active: true },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: { id: true, name: true, description: true, durationMinutes: true, price: true },
      })
    : [];

  return (
    <PublicShell organization={organization}>
      {services.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-input bg-card/60 px-6 py-10 text-center">
          <p className="font-display text-lg font-semibold">Reservas online no disponibles</p>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {organization.name} no está tomando reservas online en este momento.
            {organization.phone ? " Podés comunicarte por teléfono." : ""}
          </p>
        </div>
      ) : (
        <BookingFlow slug={organization.slug} businessName={organization.name} services={services} />
      )}
    </PublicShell>
  );
}
