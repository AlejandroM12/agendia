import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { ButtonLink } from "@/components/ui/button-link";
import { Input } from "@/components/ui/input";
import { EmptyState, PageHeader } from "@/components/dashboard/page-header";
import { db } from "@/lib/db";
import { requireOrganization } from "@/lib/dal";

export const metadata: Metadata = { title: "Clientes" };

const PAGE_SIZE = 100;

export default async function CustomersPage(props: PageProps<"/dashboard/clientes">) {
  const { organization, canWrite } = await requireOrganization();
  const params = await props.searchParams;
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 80) : "";
  const digits = q.replace(/\D/g, "");

  const [customers, total] = await Promise.all([
    db.customer.findMany({
      where: {
        organizationId: organization.id,
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { email: { contains: q, mode: "insensitive" } },
                ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
              ],
            }
          : {}),
      },
      orderBy: { name: "asc" },
      take: PAGE_SIZE,
      select: { id: true, name: true, phone: true, email: true, _count: { select: { appointments: true } } },
    }),
    db.customer.count({ where: { organizationId: organization.id } }),
  ]);

  const newButton = canWrite && (
    <ButtonLink href="/dashboard/clientes/nuevo">
          <Plus aria-hidden="true" /> Nuevo cliente
        </ButtonLink>
  );

  return (
    <>
      <PageHeader
        title="Clientes"
        description={total > 0 ? `${total} ${total === 1 ? "persona" : "personas"} en tu agenda.` : undefined}
        action={newButton}
      />

      {total === 0 ? (
        <EmptyState
          title="Todavía no tenés clientes"
          description="Se agregan solos cuando alguien reserva o cuando agendás un turno. También podés cargarlos a mano."
          action={newButton}
        />
      ) : (
        <>
          <form role="search" className="mb-4">
            <Input name="q" type="search" defaultValue={q} placeholder="Buscar por nombre, teléfono o email" aria-label="Buscar clientes" />
          </form>
          {customers.length === 0 ? (
            <EmptyState title="Sin resultados" description={`No encontramos clientes que coincidan con "${q}".`} />
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
              {customers.map((customer) => (
                <li key={customer.id}>
                  <Link href={`/dashboard/clientes/${customer.id}`} className="flex items-center gap-3 px-4 py-3.5 hover:bg-accent/50">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent font-semibold text-accent-foreground uppercase">
                      {customer.name.slice(0, 1)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{customer.name}</span>
                      <span className="block truncate text-sm text-muted-foreground">
                        {customer.phone ?? customer.email ?? "Sin contacto"}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm text-muted-foreground">
                      {customer._count.appointments} {customer._count.appointments === 1 ? "turno" : "turnos"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}
