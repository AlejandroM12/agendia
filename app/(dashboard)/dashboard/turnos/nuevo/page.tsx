import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppointmentForm } from "@/components/appointments/appointment-form";
import { ButtonLink } from "@/components/ui/button-link";
import { EmptyState, PageHeader } from "@/components/dashboard/page-header";
import { db } from "@/lib/db";
import { requireOrganization } from "@/lib/dal";
import { isValidDateStr, todayInTz } from "@/lib/time";

export const metadata: Metadata = { title: "Nuevo turno" };

export default async function NewAppointmentPage(props: PageProps<"/dashboard/turnos/nuevo">) {
  const { organization, canWrite } = await requireOrganization();
  if (!canWrite) redirect("/dashboard/facturacion");

  const params = await props.searchParams;
  const requestedDate = typeof params.fecha === "string" ? params.fecha : "";
  const customerId = typeof params.cliente === "string" ? params.cliente : "";

  const [services, customer] = await Promise.all([
    db.service.findMany({
      where: { organizationId: organization.id },
      orderBy: [{ active: "desc" }, { sortOrder: "asc" }],
      select: { id: true, name: true, durationMinutes: true, active: true },
    }),
    customerId
      ? db.customer.findFirst({
          where: { id: customerId, organizationId: organization.id },
          select: { id: true, name: true, phone: true, email: true },
        })
      : null,
  ]);

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
          services={services}
          defaultDate={isValidDateStr(requestedDate) ? requestedDate : todayInTz(organization.timezone)}
          customer={customer ? { id: customer.id, name: customer.name, detail: customer.phone ?? customer.email ?? "" } : null}
        />
      )}
    </>
  );
}
