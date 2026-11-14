import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Clock } from "lucide-react";
import { ButtonLink } from "@/components/ui/button-link";
import { ProfessionalPhoto } from "@/components/team/professional-photo";
import { ProfessionalForm, ProfessionalServicesForm } from "@/components/team/team-forms";
import { ActivateButton, DeactivateButton, IsMeToggle } from "@/components/team/team-actions-buttons";
import { PageHeader } from "@/components/dashboard/page-header";
import { Section } from "@/components/dashboard/section";
import { db } from "@/lib/db";
import { requirePagePermission } from "@/lib/dal";
import { isTeamModeEnabled } from "@/lib/features";
import { updateProfessionalAction } from "@/modules/team/actions";
import { getProfessionalServices, getTeamOverview } from "@/modules/team/team-admin";

export const metadata: Metadata = { title: "Profesional" };

export default async function ProfessionalPage(props: PageProps<"/dashboard/equipo/[id]">) {
  const { organization, user, canWrite } = await requirePagePermission("team.manage");
  if (!isTeamModeEnabled(organization)) redirect("/dashboard/equipo");
  const { id } = await props.params;

  const professional = await db.professional.findFirst({ where: { id, organizationId: organization.id } });
  if (!professional) notFound();

  const [services, overview] = await Promise.all([
    getProfessionalServices(organization.id, professional.id),
    getTeamOverview(organization),
  ]);
  const member = overview.members.find((m) => m.id === professional.id);
  const futureAppointments = member?.futureAppointments ?? 0;
  const isMe = professional.userId === user.id;

  return (
    <>
      <PageHeader
        title={professional.displayName}
        description={professional.active ? undefined : "Desactivado: no recibe turnos ni ocupa cupo."}
        back={{ href: "/dashboard/equipo", label: "Equipo" }}
      />

      <div className="space-y-10">
        <Section title="Foto">
          <ProfessionalPhoto
            professionalId={professional.id}
            name={professional.displayName}
            color={professional.color}
            photoImageId={professional.photoImageId}
            disabled={!canWrite}
          />
        </Section>

        <Section title="Datos">
          <ProfessionalForm
            action={updateProfessionalAction.bind(null, professional.id)}
            initial={{
              displayName: professional.displayName,
              description: professional.description,
              color: professional.color,
              bookableOnline: professional.bookableOnline,
            }}
            submitLabel="Guardar cambios"
            disabled={!canWrite}
            defaultColor={professional.color}
          />
          <div className="mt-6 max-w-lg">
            <IsMeToggle professionalId={professional.id} isMe={isMe} disabled={!canWrite} />
          </div>
        </Section>

        <Section title="Servicios que realiza" description="Elegí cuáles puede atender. Un servicio sin ningún profesional no se puede reservar.">
          <ProfessionalServicesForm professionalId={professional.id} services={services} disabled={!canWrite} />
        </Section>

        <Section title="Horarios" description="Sus días y horarios de atención, descansos, vacaciones y ausencias.">
          <ButtonLink variant="outline" href={`/dashboard/disponibilidad?profesional=${professional.id}`}>
            <Clock aria-hidden="true" /> Editar sus horarios
          </ButtonLink>
        </Section>

        {canWrite && (
          <Section
            title={professional.active ? "Desactivar" : "Activar"}
            description={
              professional.active
                ? "Deja de recibir turnos y libera un cupo. Su historial y sus turnos pasados se conservan."
                : "Vuelve a recibir turnos. Ocupa un cupo de tu plan."
            }
          >
            {professional.active ? (
              <div className="space-y-3">
                <DeactivateButton professionalId={professional.id} name={professional.displayName} futureAppointments={futureAppointments} />
                {futureAppointments > 0 && (
                  <ButtonLink href={`/dashboard/equipo/${professional.id}/desactivar`}>Resolver sus turnos</ButtonLink>
                )}
              </div>
            ) : (
              <ActivateButton professionalId={professional.id} name={professional.displayName} />
            )}
          </Section>
        )}
      </div>
    </>
  );
}
