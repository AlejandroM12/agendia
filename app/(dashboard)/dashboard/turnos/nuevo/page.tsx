import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppointmentForm } from "@/components/appointments/appointment-form";
import { ButtonLink } from "@/components/ui/button-link";
import { EmptyState, PageHeader } from "@/components/dashboard/page-header";
import { db } from "@/lib/db";
import { requireOrganization } from "@/lib/dal";
import { findCustomerFor } from "@/modules/access/scope";
import { isTeamModeEnabled } from "@/lib/features";
import { isValidDateStr, todayInTz } from "@/lib/time";
import { listActiveProfessionals } from "@/modules/team/eligibility";

export const metadata: Metadata = { title: "Nuevo turno" };

export default async function NewAppointmentPage(props: PageProps<"/dashboard/turnos/nuevo">) {
  const context = await requireOrganization();
  const { organization, canWrite, permissions } = context;
  const restricted = context.restrictedProfessionalId;
  if (!permissions.has("appointments.manage") && !permissions.has("own.appointments.create")) redirect("/dashboard");
  if (!canWrite) redirect(restricted ? "/dashboard" : "/dashboard/facturacion");

  const params = await props.searchParams;
  const requestedDate = typeof params.fecha === "string" ? params.fecha : "";
  const customerId = typeof params.cliente === "string" ? params.cliente : "";

  const [services, customer, professionals] = await Promise.all([
    db.service.findMany({
      where: { organizationId: organization.id },
      orderBy: [{ active: "desc" }, { sortOrder: "asc" }],
      select: { id: true, name: true, durationMinutes: true, active: true, allProfessionals: true, professionals: { select: { professionalId: true } } },
    }),
    customerId ? findCustomerFor(context, customerId) : null,
    listActiveProfessionals(db, organization.id),
  ]);

  const whatsappState = await db.whatsappConnection.findUnique({ where: { organizationId: organization.id }, select: { enabled: true, status: true } });

  // Con varios profesionales activos, el turno se agenda eligiendo con quién (o «cualquiera»).
  const requestedProfessional = typeof params.profesional === "string" ? params.profesional : "";
  const team =
    !restricted && isTeamModeEnabled(organization) && professionals.length > 1
      ? {
          professionals: professionals.map((p) => ({ id: p.id, displayName: p.displayName })),
          performedBy: Object.fromEntries(
            services.map((s) => [
              s.id,
              s.allProfessionals ? professionals.map((p) => p.id) : s.professionals.map((l) => l.professionalId),
            ]),
          ),
          defaultProfessionalId: professionals.some((p) => p.id === requestedProfessional) ? requestedProfessional : null,
        }
      : undefined;

  return (
    <>
      <PageHeader title="Nuevo turno" back={{ href: "/dashboard/agenda", label: "Agenda" }} />
      {services.length === 0 ? (
        <EmptyState
          title="Primero cargá un servicio"
          description="Para agendar un turno necesitás al menos un servicio con su duración."
          action={<ButtonLink href="/dashboard/servicios/nuevo">Crear servicio</ButtonLink>}
        />
      ) : (
        <AppointmentForm
          services={services
            // Un profesional solo agenda los servicios que realiza.
            .filter((s) => !restricted || s.allProfessionals || s.professionals.some((l) => l.professionalId === restricted))
            .map(({ id, name, durationMinutes, active }) => ({ id, name, durationMinutes, active }))}
          team={team}
          whatsappConsent={Boolean(whatsappState?.enabled && whatsappState.status === "connected")}
          defaultDate={isValidDateStr(requestedDate) ? requestedDate : todayInTz(organization.timezone)}
          customer={customer ? { id: customer.id, name: customer.name, detail: restricted ? (customer.phone ?? "") : (customer.phone ?? customer.email ?? "") } : null}
        />
      )}
    </>
  );
}
