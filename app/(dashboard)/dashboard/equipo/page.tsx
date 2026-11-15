import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock, Clock, Plus, Scissors } from "lucide-react";
import { MoveButtons } from "@/components/team/team-actions-buttons";
import { ProfessionalAvatar } from "@/components/team/professional-avatar";
import { ButtonLink } from "@/components/ui/button-link";
import { EmptyState, PageHeader } from "@/components/dashboard/page-header";
import { Section } from "@/components/dashboard/section";
import { requirePagePermission } from "@/lib/dal";
import { isAccountsEnabled } from "@/lib/features";
import { AccessBadge } from "@/components/team/access-panel";
import { ACCESS_STATE_LABEL, getAccessStates, type AccessState } from "@/modules/team/invitations";
import { isTeamModeEnabled } from "@/lib/features";
import { brand } from "@/lib/brand";
import { getTeamOverview, type TeamMember } from "@/modules/team/team-admin";

export const metadata: Metadata = { title: "Equipo" };

function Badge({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "primary" | "warning" }) {
  const styles = {
    muted: "bg-secondary text-muted-foreground",
    primary: "bg-accent text-accent-foreground",
    warning: "bg-warning-soft text-warning",
  } as const;
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles[tone]}`}>{children}</span>;
}

function MemberCard({
  member,
  isMe,
  position,
  count,
  canWrite,
  access,
}: {
  access?: AccessState;
  member: TeamMember;
  isMe: boolean;
  position: number;
  count: number;
  canWrite: boolean;
}) {
  return (
    <li className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4">
      {member.active && count > 1 && (
        <MoveButtons professionalId={member.id} name={member.displayName} canUp={position > 0} canDown={position < count - 1} disabled={!canWrite} />
      )}
      <ProfessionalAvatar name={member.displayName} color={member.color} photoImageId={member.photoImageId} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link href={`/dashboard/equipo/${member.id}`} className="font-semibold hover:underline">
            {member.displayName}
          </Link>
          {isMe && <Badge tone="primary">Sos vos</Badge>}
          {!member.active && <Badge>Desactivado</Badge>}
          {member.active && !member.bookableOnline && <Badge>Sin reservas online</Badge>}
          {access && access !== "none" && <AccessBadge state={access} label={ACCESS_STATE_LABEL[access]} />}
          {member.active && member.hoursRules === 0 && <Badge tone="warning">Sin horarios cargados</Badge>}
        </div>
        {member.description && <p className="mt-0.5 truncate text-sm text-muted-foreground">{member.description}</p>}
        <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <CalendarClock className="size-3.5" aria-hidden="true" />
            {member.futureAppointments === 0 ? "Sin turnos por venir" : `${member.futureAppointments} ${member.futureAppointments === 1 ? "turno por venir" : "turnos por venir"}`}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Scissors className="size-3.5" aria-hidden="true" />
            {member.serviceCount} {member.serviceCount === 1 ? "servicio" : "servicios"}
          </span>
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <ButtonLink size="sm" variant="outline" href={`/dashboard/equipo/${member.id}`}>
            Editar
          </ButtonLink>
          {member.active && (
            <ButtonLink size="sm" variant="outline" href={`/dashboard/disponibilidad?profesional=${member.id}`}>
              <Clock aria-hidden="true" /> Horarios
            </ButtonLink>
          )}
        </div>
      </div>
    </li>
  );
}

export default async function TeamPage() {
  const { organization, user, canWrite, permissions } = await requirePagePermission("team.manage");

  if (!isTeamModeEnabled(organization)) {
    return (
      <>
        <PageHeader title="Equipo" />
        <EmptyState
          title="Esta función todavía no está habilitada en tu cuenta"
          description={`Trabajar con varios profesionales, cada uno con su agenda, se está habilitando de a poco. Si lo necesitás, escribinos a ${brand.contactEmail}.`}
        />
      </>
    );
  }

  const [{ members, quota }, accessStates] = await Promise.all([getTeamOverview(organization), getAccessStates(organization.id)]);
  const accountsOn = isAccountsEnabled(organization);
  const active = members.filter((m) => m.active);
  const inactive = members.filter((m) => !m.active);
  const meLinked = members.some((m) => m.userId === user.id);

  return (
    <>
      <PageHeader
        title="Equipo"
        description="Cada profesional tiene su propia agenda, sus horarios y sus servicios."
        action={
          canWrite &&
          quota.canAdd && (
            <ButtonLink href="/dashboard/equipo/nuevo">
              <Plus aria-hidden="true" /> Agregar profesional
            </ButtonLink>
          )
        }
      />

      <div className="mb-6 rounded-2xl border border-border bg-card p-4" data-testid="team-quota">
        <p className="font-medium">
          Usás {quota.active} de {quota.limit} {quota.limit === 1 ? "cupo" : "cupos"} de profesionales
        </p>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-secondary" role="presentation">
          <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, (quota.active / Math.max(1, quota.limit)) * 100)}%` }} />
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {quota.overLimit
            ? "Tenés más profesionales activos que cupos. No se puede agregar ni activar a nadie hasta desactivar a alguno; no se borra ni se cancela nada automáticamente."
            : quota.canAdd
              ? `Podés sumar ${quota.available} ${quota.available === 1 ? "profesional más" : "profesionales más"}.`
              : "Ya usás todos los cupos. Para sumar a otro profesional tenés que desactivar a alguien o ampliar tu plan."}{" "}
          Solo cuentan los profesionales activos: una cuenta que administra pero no atiende clientes no ocupa cupo.
        </p>
        {permissions.has("billing.manage") && (quota.overLimit || !quota.canAdd) && (
          <p className="mt-2 text-sm">
            <Link href="/dashboard/facturacion" className="font-medium text-primary underline-offset-4 hover:underline">
              Ver mi plan
            </Link>{" "}
            <span className="text-muted-foreground">· cambiá de plan o elegí quiénes siguen recibiendo reservas.</span>
          </p>
        )}
      </div>

      {permissions.has("permissions.configure") && (
        <p className="mb-6 text-sm">
          <Link href="/dashboard/equipo/accesos" className="font-medium text-primary underline-offset-4 hover:underline">
            Accesos y permisos
          </Link>{" "}
          <span className="text-muted-foreground">· qué pueden hacer los profesionales con cuenta propia y quiénes administran.</span>
        </p>
      )}

      <Section title="Profesionales activos">
        {active.length === 0 ? (
          <EmptyState
            title="Todavía no tenés profesionales activos"
            description="Agregá a quien atiende a tus clientes para empezar a recibir turnos."
            action={canWrite && quota.canAdd && <ButtonLink href="/dashboard/equipo/nuevo">Agregar profesional</ButtonLink>}
          />
        ) : (
          <ul className="space-y-3">
            {active.map((member, index) => (
              <MemberCard key={member.id} member={member} isMe={member.userId === user.id} position={index} count={active.length} canWrite={canWrite} access={accountsOn ? accessStates.get(member.id)?.state : undefined} />
            ))}
          </ul>
        )}
        {!meLinked && active.length > 0 && (
          <p className="mt-3 text-sm text-muted-foreground">
            Si vos también atendés clientes, abrí tu perfil y marcá «Soy yo» para identificar tu agenda.
          </p>
        )}
      </Section>

      {inactive.length > 0 && (
        <div className="mt-10">
          <Section title="Desactivados" description="No reciben turnos ni ocupan cupo. Su historial se conserva.">
            <ul className="space-y-3">
              {inactive.map((member) => (
                <MemberCard key={member.id} member={member} isMe={member.userId === user.id} position={0} count={0} canWrite={canWrite} />
              ))}
            </ul>
          </Section>
        </div>
      )}
    </>
  );
}
