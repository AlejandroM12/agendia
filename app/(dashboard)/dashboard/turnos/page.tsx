import type { Metadata } from "next";
import type { AppointmentStatus, Prisma } from "@prisma/client";
import { AppointmentList } from "@/components/appointments/appointment-list";
import { STATUS_LABEL } from "@/components/appointments/status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, PageHeader } from "@/components/dashboard/page-header";
import { db } from "@/lib/db";
import { requireOrganization } from "@/lib/dal";
import { appointmentScope } from "@/modules/access/scope";
import { addDays, isValidDateStr, zonedTimeToUtc } from "@/lib/time";

export const metadata: Metadata = { title: "Buscar turnos" };

const STATUSES = Object.keys(STATUS_LABEL) as AppointmentStatus[];
const PAGE_SIZE = 60;

export default async function AppointmentsSearchPage(props: PageProps<"/dashboard/turnos">) {
  const context = await requireOrganization();
  const { organization } = context;
  const tz = organization.timezone;
  const params = await props.searchParams;

  const q = typeof params.q === "string" ? params.q.trim().slice(0, 80) : "";
  const status = STATUSES.find((s) => s === params.estado);
  const from = isValidDateStr(params.desde) ? params.desde : "";
  const to = isValidDateStr(params.hasta) ? params.hasta : "";
  const hasFilters = Boolean(q || status || from || to);

  const where: Prisma.AppointmentWhereInput = {
    // Un profesional solo busca entre SUS turnos.
    ...appointmentScope(context),
    ...(status ? { status } : {}),
    ...(from || to
      ? {
          startsAt: {
            ...(from ? { gte: zonedTimeToUtc(from, 0, tz) } : {}),
            ...(to ? { lt: zonedTimeToUtc(addDays(to, 1), 0, tz) } : {}),
          },
        }
      : {}),
    ...(q
      ? {
          OR: [
            { customer: { name: { contains: q, mode: "insensitive" } } },
            { customer: { email: { contains: q, mode: "insensitive" } } },
            { customer: { phone: { contains: q } } },
            { service: { name: { contains: q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  // Sin filtros se muestran los próximos turnos; con filtros, los más recientes primero.
  const appointments = await db.appointment.findMany({
    where: hasFilters ? where : { ...where, startsAt: { gte: new Date() }, status: "confirmed" },
    orderBy: { startsAt: hasFilters ? "desc" : "asc" },
    take: PAGE_SIZE,
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
      <PageHeader title={context.restrictedProfessionalId ? "Mis turnos" : "Buscar turnos"} back={{ href: "/dashboard/agenda", label: "Agenda" }} />

      <form className="mb-6 grid gap-3 rounded-2xl border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-[1fr_auto_auto_auto_auto]" role="search">
        <Input name="q" type="search" defaultValue={q} placeholder="Cliente, teléfono o servicio" aria-label="Buscar" />
        <select name="estado" defaultValue={status ?? ""} className="field" aria-label="Estado">
          <option value="">Todos los estados</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <input type="date" name="desde" defaultValue={from} className="field" aria-label="Desde" />
        <input type="date" name="hasta" defaultValue={to} className="field" aria-label="Hasta" />
        <Button type="submit">Buscar</Button>
      </form>

      <h2 className="mb-3 text-sm font-medium text-muted-foreground">
        {hasFilters
          ? `${appointments.length}${appointments.length === PAGE_SIZE ? "+" : ""} resultado${appointments.length === 1 ? "" : "s"}`
          : "Próximos turnos"}
      </h2>

      {appointments.length === 0 ? (
        <EmptyState
          title={hasFilters ? "Sin resultados" : "No hay próximos turnos"}
          description={hasFilters ? "Probá con otro nombre o ampliá las fechas." : "Cuando tengas turnos agendados, los vas a ver acá."}
        />
      ) : (
        <AppointmentList appointments={appointments} timeZone={tz} showDate />
      )}
    </>
  );
}
