import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/dashboard/page-header";
import { ConfirmButton } from "@/components/form/confirm-button";
import { ServiceForm } from "@/components/services/service-form";
import { db } from "@/lib/db";
import { requirePagePermission } from "@/lib/dal";
import { deleteServiceAction, updateServiceAction } from "@/modules/services/actions";

export const metadata: Metadata = { title: "Editar servicio" };

export default async function EditServicePage(props: PageProps<"/dashboard/servicios/[id]">) {
  const { organization, canWrite } = await requirePagePermission("services.manage");
  const { id } = await props.params;

  const service = await db.service.findFirst({ where: { id, organizationId: organization.id } });
  if (!service) notFound();

  const appointments = await db.appointment.count({ where: { serviceId: service.id } });

  return (
    <>
      <PageHeader title={service.name} back={{ href: "/dashboard/servicios", label: "Servicios" }} />
      <ServiceForm action={updateServiceAction.bind(null, service.id)} service={service} submitLabel="Guardar cambios" />

      {canWrite && (
        <div className="mt-10 max-w-lg border-t border-border pt-6">
          <p className="text-sm text-muted-foreground">
            {appointments > 0
              ? "Este servicio tiene turnos asociados: al quitarlo se desactiva y se conserva el historial."
              : "Este servicio no tiene turnos asociados."}
          </p>
          <ConfirmButton
            className="mt-3"
            action={deleteServiceAction.bind(null, service.id)}
            confirmMessage={`¿Quitar el servicio "${service.name}"?`}
          >
            {appointments > 0 ? "Desactivar servicio" : "Eliminar servicio"}
          </ConfirmButton>
        </div>
      )}
    </>
  );
}
