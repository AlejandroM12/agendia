import type { Metadata } from "next";
import { PageHeader } from "@/components/dashboard/page-header";
import { ServiceForm } from "@/components/services/service-form";
import { requireOrganization } from "@/lib/dal";
import { createServiceAction } from "@/modules/services/actions";

export const metadata: Metadata = { title: "Nuevo servicio" };

export default async function NewServicePage() {
  await requireOrganization();
  return (
    <>
      <PageHeader title="Nuevo servicio" back={{ href: "/dashboard/servicios", label: "Servicios" }} />
      <ServiceForm action={createServiceAction} submitLabel="Crear servicio" />
    </>
  );
}
