import "server-only";

import type { Prisma } from "@prisma/client";
import type { AppContext } from "@/lib/app-context";
import { db } from "@/lib/db";

/**
 * Alcance de lo que cada rol puede ver: LA regla, en un solo lugar.
 *
 * - Propietario y administrador: todo lo de SU negocio.
 * - Profesional: solo lo de SU agenda. Un cliente es visible para él únicamente
 *   si tiene (o tuvo) turnos con ÉL; de ese cliente ve solo esos turnos.
 *
 * Toda consulta de turnos o clientes hecha en nombre de una persona con sesión
 * arma su filtro con estas funciones (nunca con un identificador que llegue
 * del navegador) y todo recurso pedido por identificador se busca con
 * `findAppointmentFor` / `findCustomerFor`: un identificador por sí solo no da acceso.
 */

/** Turnos que la persona puede ver. */
export function appointmentScope(context: Pick<AppContext, "organization" | "restrictedProfessionalId">): Prisma.AppointmentWhereInput {
  return {
    organizationId: context.organization.id,
    ...(context.restrictedProfessionalId ? { professionalId: context.restrictedProfessionalId } : {}),
  };
}

/** Clientes que la persona puede ver. */
export function customerScope(context: Pick<AppContext, "organization" | "restrictedProfessionalId">): Prisma.CustomerWhereInput {
  return {
    organizationId: context.organization.id,
    ...(context.restrictedProfessionalId ? { appointments: { some: { professionalId: context.restrictedProfessionalId } } } : {}),
  };
}

/** Un turno por identificador, solo si está dentro del alcance de la persona. */
export async function findAppointmentFor<T extends Prisma.AppointmentInclude | undefined = undefined>(
  context: Pick<AppContext, "organization" | "restrictedProfessionalId">,
  id: string,
  include?: T,
) {
  return db.appointment.findFirst({
    where: { ...appointmentScope(context), id: String(id).slice(0, 64) },
    ...(include ? { include } : {}),
  }) as Promise<Awaited<ReturnType<typeof db.appointment.findFirst<{ include: T }>>>>;
}

/** Un cliente por identificador, solo si está dentro del alcance de la persona. */
export async function findCustomerFor(context: Pick<AppContext, "organization" | "restrictedProfessionalId">, id: string) {
  return db.customer.findFirst({ where: { ...customerScope(context), id: String(id).slice(0, 64) } });
}

/** ¿Es esta agenda la propia del profesional (o la persona ve todo el negocio)? */
export function canActOnProfessional(context: Pick<AppContext, "restrictedProfessionalId">, professionalId: string): boolean {
  return context.restrictedProfessionalId === null || context.restrictedProfessionalId === professionalId;
}
