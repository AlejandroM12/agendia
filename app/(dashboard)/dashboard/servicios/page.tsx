import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDown, ArrowUp, Plus } from "lucide-react";
import { ButtonLink } from "@/components/ui/button-link";
import { EmptyState, PageHeader } from "@/components/dashboard/page-header";
import { db } from "@/lib/db";
import { requireOrganization } from "@/lib/dal";
import { formatMoney } from "@/lib/brand";
import { formatDuration } from "@/lib/time";
import { cn } from "@/lib/utils";
import { moveServiceAction, setServiceActiveAction } from "@/modules/services/actions";

export const metadata: Metadata = { title: "Servicios" };

export default async function ServicesPage() {
  const { organization, canWrite } = await requireOrganization();
  const services = await db.service.findMany({
    where: { organizationId: organization.id },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });

  const newButton = canWrite && (
    <ButtonLink href="/dashboard/servicios/nuevo">
          <Plus aria-hidden="true" /> Nuevo servicio
        </ButtonLink>
  );

  return (
    <>
      <PageHeader
        title="Servicios"
        description="Lo que tus clientes pueden reservar. El orden es el que ven en tu página."
        action={newButton}
      />

      {services.length === 0 ? (
        <EmptyState
          title="Todavía no cargaste servicios"
          description="Agregá al menos uno para poder recibir reservas."
          action={newButton}
        />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
          {services.map((service, index) => (
            <li key={service.id} className="flex items-center gap-3 px-4 py-3.5">
              {canWrite && (
                <div className="flex flex-col">
                  <form action={moveServiceAction.bind(null, service.id, "up")}>
                    <button
                      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
                      disabled={index === 0}
                      aria-label={`Subir ${service.name}`}
                    >
                      <ArrowUp className="size-4" />
                    </button>
                  </form>
                  <form action={moveServiceAction.bind(null, service.id, "down")}>
                    <button
                      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
                      disabled={index === services.length - 1}
                      aria-label={`Bajar ${service.name}`}
                    >
                      <ArrowDown className="size-4" />
                    </button>
                  </form>
                </div>
              )}
              <Link href={`/dashboard/servicios/${service.id}`} className="min-w-0 flex-1">
                <p className={cn("truncate font-medium", !service.active && "text-muted-foreground line-through")}>
                  {service.name}
                </p>
                <p className="text-sm text-muted-foreground">
                  {formatDuration(service.durationMinutes)}
                  {service.price !== null && ` · ${formatMoney(service.price)}`}
                  {!service.active && " · No se ofrece online"}
                </p>
              </Link>
              {canWrite && (
                <form action={setServiceActiveAction.bind(null, service.id, !service.active)}>
                  <button
                    role="switch"
                    aria-checked={service.active}
                    aria-label={`${service.name}: disponible para reservar`}
                    className={cn(
                      "relative h-7 w-12 rounded-full transition-colors",
                      service.active ? "bg-primary" : "bg-input",
                    )}
                  >
                    <span
                      className={cn(
                        "absolute top-1 left-1 size-5 rounded-full bg-white shadow transition-transform",
                        service.active && "translate-x-5",
                      )}
                    />
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
