import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminsPanel, GeneralPermissionsForm } from "@/components/team/permissions-forms";
import { PageHeader } from "@/components/dashboard/page-header";
import { Section } from "@/components/dashboard/section";
import { db } from "@/lib/db";
import { requirePagePermission } from "@/lib/dal";
import { isAccountsEnabled, isTeamModeEnabled } from "@/lib/features";
import { resolveProfessionalPermissions } from "@/lib/permissions";

export const metadata: Metadata = { title: "Accesos y permisos" };

const dateLabel = (date: Date) => new Intl.DateTimeFormat("es-AR", { dateStyle: "long", timeZone: "America/Argentina/Buenos_Aires" }).format(date);

/**
 * Qué pueden hacer los profesionales con cuenta propia y quiénes administran el
 * negocio. Solo el propietario: ni un administrador ve ni cambia esto.
 */
export default async function AccessPage() {
  const { organization, canWrite } = await requirePagePermission("permissions.configure");
  if (!isTeamModeEnabled(organization)) redirect("/dashboard/equipo");

  const [admins, pending] = await Promise.all([
    db.membership.findMany({
      where: { organizationId: organization.id, role: "admin" },
      orderBy: { createdAt: "asc" },
      select: { notifyBookings: true, user: { select: { id: true, name: true, email: true } } },
    }),
    db.invitation.findMany({
      where: { organizationId: organization.id, role: "admin", status: "pending" },
      orderBy: { createdAt: "asc" },
      select: { id: true, email: true, expiresAt: true },
    }),
  ]);

  return (
    <>
      <PageHeader title="Accesos y permisos" back={{ href: "/dashboard/equipo", label: "Equipo" }} description="Quién puede entrar a tu negocio y qué puede hacer." />
      <div className="space-y-10">
        <Section title="Qué pueden hacer los profesionales" description="Vale para todos los profesionales con cuenta propia. Podés hacer excepciones desde el perfil de cada uno.">
          <GeneralPermissionsForm values={resolveProfessionalPermissions(organization.professionalPermissions, null)} disabled={!canWrite} />
        </Section>

        <Section title="Administradores" description="Ayudan con la operación diaria: turnos, clientes, profesionales, horarios, servicios y tu página. No ven la facturación.">
          <AdminsPanel
            admins={admins.map((m) => ({ userId: m.user.id, name: m.user.name, email: m.user.email, notifyBookings: m.notifyBookings }))}
            pending={pending.map((p) => ({ id: p.id, email: p.email, expiresLabel: dateLabel(p.expiresAt) }))}
            accountsEnabled={isAccountsEnabled(organization)}
            disabled={!canWrite}
          />
        </Section>
      </div>
    </>
  );
}
