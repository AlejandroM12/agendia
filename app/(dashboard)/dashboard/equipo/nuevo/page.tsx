import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ButtonLink } from "@/components/ui/button-link";
import { ProfessionalForm, PROFESSIONAL_COLORS } from "@/components/team/team-forms";
import { EmptyState, PageHeader } from "@/components/dashboard/page-header";
import { db } from "@/lib/db";
import { requireOrganization } from "@/lib/dal";
import { isTeamModeEnabled } from "@/lib/features";
import { createProfessionalAction } from "@/modules/team/actions";
import { getProfessionalQuota } from "@/modules/team/professionals";

export const metadata: Metadata = { title: "Nuevo profesional" };

export default async function NewProfessionalPage() {
  const { organization, user, canWrite } = await requireOrganization();
  if (!isTeamModeEnabled(organization)) redirect("/dashboard/equipo");
  if (!canWrite) redirect("/dashboard/equipo");

  const [quota, linked, total] = await Promise.all([
    getProfessionalQuota(db, organization),
    db.professional.count({ where: { organizationId: organization.id, userId: user.id } }),
    db.professional.count({ where: { organizationId: organization.id } }),
  ]);

  return (
    <>
      <PageHeader title="Nuevo profesional" back={{ href: "/dashboard/equipo", label: "Equipo" }} />
      {!quota.canAdd ? (
        <EmptyState
          title="Ya usás todos los cupos"
          description={`Tu plan admite hasta ${quota.limit} profesionales activos. Desactivá a alguien o ampliá tu plan para sumar a otro.`}
          action={<ButtonLink href="/dashboard/equipo">Volver al equipo</ButtonLink>}
        />
      ) : (
        <>
          <p className="mb-6 max-w-lg text-sm text-muted-foreground">
            No hace falta que tenga una cuenta: vos administrás su agenda. Después de crearlo vas a poder subir su foto, elegir sus servicios y cargar sus horarios.
          </p>
          <ProfessionalForm
            action={createProfessionalAction}
            submitLabel="Crear profesional"
            cancelHref="/dashboard/equipo"
            offerIsMe={linked === 0}
            defaultColor={PROFESSIONAL_COLORS[total % PROFESSIONAL_COLORS.length]}
          />
        </>
      )}
    </>
  );
}
