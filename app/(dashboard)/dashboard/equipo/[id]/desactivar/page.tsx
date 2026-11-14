import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AffectedAppointments, type AffectedItem } from "@/components/team/affected-appointments";
import { DeactivateButton } from "@/components/team/team-actions-buttons";
import { ButtonLink } from "@/components/ui/button-link";
import { PageHeader } from "@/components/dashboard/page-header";
import { db } from "@/lib/db";
import { requireOrganization } from "@/lib/dal";
import { isTeamModeEnabled } from "@/lib/features";
import { formatTime, toZoned } from "@/lib/time";
import { listAffectedAppointments } from "@/modules/team/team-admin";

export const metadata: Metadata = { title: "Resolver turnos" };

/**
 * Antes de desactivar a un profesional: los turnos por venir se pasan a otro
 * profesional o se cancelan, por decisión de quien administra. Nada se
 * reasigna ni se cancela solo.
 */
export default async function DeactivateProfessionalPage(props: PageProps<"/dashboard/equipo/[id]/desactivar">) {
  const { organization, canWrite } = await requireOrganization();
  if (!isTeamModeEnabled(organization)) redirect("/dashboard/equipo");
  const { id } = await props.params;

  const professional = await db.professional.findFirst({ where: { id, organizationId: organization.id } });
  if (!professional) notFound();
  if (!professional.active || !canWrite) redirect(`/dashboard/equipo/${professional.id}`);

  const [affected, others] = await Promise.all([
    listAffectedAppointments(organization, professional.id),
    db.professional.findMany({
      where: { organizationId: organization.id, active: true, id: { not: professional.id } },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      select: { id: true, displayName: true },
    }),
  ]);

  const tz = organization.timezone;
  const items: AffectedItem[] = affected.map((a) => ({
    id: a.id,
    dateStr: toZoned(a.startsAt, tz).dateStr,
    whenLabel: `${formatTime(a.startsAt, tz)} a ${formatTime(a.endsAt, tz)}`,
    customerName: a.customerName,
    customerHasEmail: a.customerHasEmail,
    serviceName: a.serviceName,
    options: a.options,
  }));

  return (
    <>
      <PageHeader
        title={`Turnos de ${professional.displayName}`}
        description="Antes de desactivarlo, decidí qué pasa con sus turnos por venir. No cambiamos ninguno sin que lo elijas."
        back={{ href: `/dashboard/equipo/${professional.id}`, label: professional.displayName }}
      />

      {items.length === 0 ? (
        <div className="space-y-4">
          <p className="text-muted-foreground">Ya no tiene turnos por venir. Podés desactivarlo.</p>
          <DeactivateButton professionalId={professional.id} name={professional.displayName} futureAppointments={0} />
          <div>
            <ButtonLink variant="ghost" href={`/dashboard/equipo/${professional.id}`}>Volver</ButtonLink>
          </div>
        </div>
      ) : (
        <AffectedAppointments professionalId={professional.id} professionalName={professional.displayName} items={items} others={others} />
      )}
    </>
  );
}
