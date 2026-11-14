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
import { appointmentScope, findCustomerFor } from "@/modules/access/scope";
import { deleteCustomerAction, updateCustomerAction } from "@/modules/customers/actions";

export const metadata: Metadata = { title: "Cliente" };

export default async function CustomerPage(props: PageProps<"/dashboard/clientes/[id]">) {
  const context = await requireOrganization();
  const { organization, canWrite, permissions } = context;
  const { id } = await props.params;

  // Un identificador de cliente no alcanza: un profesional solo accede a quienes tienen turnos con él.
  const customer = await findCustomerFor(context, id);
  if (!customer) notFound();
  const restricted = context.restrictedProfessionalId !== null;
  if (restricted && !permissions.has("own.customers.contact")) notFound();

  const appointments = await db.appointment.findMany({
    where: { ...appointmentScope(context), customerId: customer.id },
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
        back={{ href: "/dashboard/clientes", label: restricted ? "Mis clientes" : "Clientes" }}
        action={
          canWrite && (permissions.has("appointments.manage") || permissions.has("own.appointments.create")) && (
            <ButtonLink href={`/dashboard/turnos/nuevo?cliente=${customer.id}`}>
                  <Plus aria-hidden="true" /> Agendar turno
                </ButtonLink>
          )
        }
      />

      <div className="space-y-10">
        {restricted ? (
          // Un profesional ve lo mínimo para atender: nombre y teléfono. Sin email, sin notas del negocio.
          <Section title="Contacto">
            <p className="font-medium">{customer.name}</p>
            <p className="text-muted-foreground">{customer.phone ?? "Sin teléfono cargado"}</p>
          </Section>
        ) : (
          <Section title="Datos">
            <CustomerForm
              action={updateCustomerAction.bind(null, customer.id)}
              customer={customer}
              submitLabel="Guardar cambios"
              disabled={!canWrite || !permissions.has("customers.manage")}
            />
          </Section>
        )}

        <Section title={restricted ? "Tus turnos con este cliente" : "Historial de turnos"}>
          {appointments.length === 0 ? (
            <p className="text-sm text-muted-foreground">Todavía no tiene turnos.</p>
          ) : (
            <AppointmentList appointments={appointments} timeZone={organization.timezone} showDate />
          )}
        </Section>

        {canWrite && !restricted && permissions.has("customers.manage") && appointments.length === 0 && (
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
