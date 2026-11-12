import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Plus } from "lucide-react";
import { AppointmentList } from "@/components/appointments/appointment-list";
import { CustomerForm } from "@/components/customers/customer-form";
import { ButtonLink } from "@/components/ui/button-link";
import { PageHeader } from "@/components/dashboard/page-header";
import { Section } from "@/components/dashboard/section";
import { ConfirmButton } from "@/components/form/confirm-button";
import { db } from "@/lib/db";
import { requireOrganization } from "@/lib/dal";
import { deleteCustomerAction, updateCustomerAction } from "@/modules/customers/actions";

export const metadata: Metadata = { title: "Cliente" };

export default async function CustomerPage(props: PageProps<"/dashboard/clientes/[id]">) {
  const { organization, canWrite } = await requireOrganization();
  const { id } = await props.params;

  const customer = await db.customer.findFirst({ where: { id, organizationId: organization.id } });
  if (!customer) notFound();

  const appointments = await db.appointment.findMany({
    where: { customerId: customer.id, organizationId: organization.id },
    orderBy: { startsAt: "desc" },
    take: 50,
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
      status: true,
      customer: { select: { name: true } },
      service: { select: { name: true } },
    },
  });

  return (
    <>
      <PageHeader
        title={customer.name}
        back={{ href: "/dashboard/clientes", label: "Clientes" }}
        action={
          canWrite && (
            <ButtonLink href={`/dashboard/turnos/nuevo?cliente=${customer.id}`}>
                  <Plus aria-hidden="true" /> Agendar turno
                </ButtonLink>
          )
        }
      />

      <div className="space-y-10">
        <Section title="Datos">
          <CustomerForm
            action={updateCustomerAction.bind(null, customer.id)}
            customer={customer}
            submitLabel="Guardar cambios"
            disabled={!canWrite}
          />
        </Section>

        <Section title="Historial de turnos">
          {appointments.length === 0 ? (
            <p className="text-sm text-muted-foreground">Todavía no tiene turnos.</p>
          ) : (
            <AppointmentList appointments={appointments} timeZone={organization.timezone} showDate />
          )}
        </Section>

        {canWrite && appointments.length === 0 && (
          <ConfirmButton
            action={deleteCustomerAction.bind(null, customer.id)}
            confirmMessage={`¿Eliminar a ${customer.name}?`}
            variant="outline"
          >
            Eliminar cliente
          </ConfirmButton>
        )}
      </div>
    </>
  );
}
