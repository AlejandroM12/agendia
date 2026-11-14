import type { Metadata } from "next";
import { AccountNameForm, MyNotificationsForm } from "@/components/account/account-forms";
import { PageHeader } from "@/components/dashboard/page-header";
import { Section } from "@/components/dashboard/section";
import { PasswordForm } from "@/components/settings/settings-forms";
import { ProfessionalAvatar } from "@/components/team/professional-avatar";
import { db } from "@/lib/db";
import { requireOrganization } from "@/lib/dal";
import { PROFESSIONAL_PERMISSION_LABELS, PROFESSIONAL_PERMISSION_KEYS } from "@/lib/permissions";
import { ROLE_LABEL } from "@/lib/roles";

export const metadata: Metadata = { title: "Mi perfil" };

/**
 * «Mi cuenta» / «Mi perfil»: los datos de la propia cuenta (acceso) y, para un
 * profesional, cómo figura en el negocio (lo administra el negocio: no puede
 * cambiar servicios, precios ni configuración desde acá).
 */
export default async function ProfilePage() {
  const { organization, user, role, membership, professional, professionalConfig } = await requireOrganization();
  const profile = professional
    ? await db.professional.findFirst({
        where: { id: professional.id, organizationId: organization.id },
        select: { displayName: true, description: true, color: true, photoImageId: true },
      })
    : null;
  const isProfessional = role === "professional";

  return (
    <>
      <PageHeader title={isProfessional ? "Mi perfil" : "Mi cuenta"} description={`${ROLE_LABEL[role]} en ${organization.name}`} />
      <div className="space-y-10">
        <Section title="Tu cuenta" description={`Ingresás con ${user.email}. Es la misma cuenta en todos los negocios a los que pertenecés.`}>
          <AccountNameForm name={user.name} />
        </Section>

        <Section title="Avisos por correo" description="Qué te avisamos por correo sobre los turnos.">
          <MyNotificationsForm
            enabled={membership.notifyBookings}
            label={isProfessional ? "Avisarme de mis turnos" : "Avisarme de las reservas del negocio"}
            hint={
              isProfessional
                ? "Cuando un cliente reserva, cambia o cancela un turno tuyo, o te asignan uno."
                : "Cuando un cliente reserva, cambia o cancela por su cuenta (si el negocio tiene activos estos avisos)."
            }
          />
        </Section>

        <Section title="Contraseña">
          <PasswordForm />
        </Section>

        {isProfessional && profile && (
          <Section title={`Cómo figurás en ${organization.name}`} description="Esto lo administra el negocio: lo ven los clientes al reservar.">
            <div className="flex max-w-md items-center gap-4 rounded-2xl border border-border bg-card p-4">
              <ProfessionalAvatar name={profile.displayName} color={profile.color} photoImageId={profile.photoImageId} className="size-16" />
              <div className="min-w-0">
                <p className="font-medium">{profile.displayName}</p>
                {profile.description && <p className="text-sm text-muted-foreground">{profile.description}</p>}
              </div>
            </div>
          </Section>
        )}

        {isProfessional && (
          <Section title="Qué podés hacer" description="Lo decide quien administra el negocio.">
            <ul className="max-w-md space-y-2 text-sm">
              <li>Ver tu agenda y tus turnos</li>
              {PROFESSIONAL_PERMISSION_KEYS.map((key) => (
                <li key={key} className={professionalConfig[key] ? "" : "text-muted-foreground line-through"}>
                  {PROFESSIONAL_PERMISSION_LABELS[key].label}
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>
    </>
  );
}
