import type { Metadata } from "next";
import { PageHeader } from "@/components/dashboard/page-header";
import { CustomerForm } from "@/components/customers/customer-form";
import { requirePagePermission } from "@/lib/dal";
import { createCustomerAction } from "@/modules/customers/actions";

export const metadata: Metadata = { title: "Nuevo cliente" };

export default async function NewCustomerPage() {
  await requirePagePermission("customers.manage");
  return (
    <>
      <PageHeader title="Nuevo cliente" back={{ href: "/dashboard/clientes", label: "Clientes" }} />
      <CustomerForm action={createCustomerAction} submitLabel="Guardar cliente" />
    </>
  );
}
