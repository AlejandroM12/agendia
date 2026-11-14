import "server-only";

import { db } from "@/lib/db";
import { addDays, dateStrToDbDate, dbDateToDateStr, todayInTz, zonedTimeToUtc } from "@/lib/time";
import { getOrCreatePrimaryProfessional } from "@/modules/team/eligibility";
import { computeDaySlots, type MinuteRange } from "./slots";

export type DayAvailability = { dateStr: string; slots: Date[] };

/** Un horario de inicio y los profesionales libres para tomarlo (en el orden en que se pidieron). */
export type SlotOffer = { start: Date; professionalIds: string[] };
export type TeamDayAvailability = { dateStr: string; slots: SlotOffer[] };

type OrgSchedulingSettings = {
  id: string;
  timezone: string;
  slotIntervalMinutes: number;
  bufferMinutes: number;
  minNoticeMinutes: number;
  maxAdvanceDays: number;
};

/**
 * Disponibilidad real de un servicio para un rango de días, calculada
 * **por profesional**: cada uno con sus horarios, los bloqueos generales
 * del negocio más los suyos, y sus propios turnos. Un profesional ocupado
 * no resta disponibilidad a otro.
 *
 * Reutiliza `computeDaySlots` (función pura) para cada profesional y día.
 * Las consultas son tres, agrupadas para todo el equipo (horarios, bloqueos
 * y turnos), sin una consulta por profesional ni por día. Todas están
 * acotadas por `organizationId`: un identificador de profesional de otro
 * negocio simplemente no tiene horarios ni turnos que traer.
 *
 * Devuelve, por día, cada horario de inicio **una sola vez** con la lista
 * de profesionales libres para ese horario: la unión para «cualquier
 * profesional» y la base de la asignación automática.
 *
 * `ignoreAppointmentId` excluye un turno del cálculo (para reprogramarlo
 * sin que choque consigo mismo). `applyNotice: false` es para la agenda
 * interna, donde se puede agendar sin anticipación mínima.
 */
export async function getTeamAvailability(params: {
  organization: OrgSchedulingSettings;
  professionalIds: string[];
  durationMinutes: number;
  fromDateStr: string;
  days: number;
  now?: Date;
  ignoreAppointmentId?: string;
  applyNotice?: boolean;
}): Promise<TeamDayAvailability[]> {
  const { organization: org, professionalIds, durationMinutes, days } = params;
  const now = params.now ?? new Date();
  const applyNotice = params.applyNotice ?? true;

  const earliest = applyNotice ? new Date(now.getTime() + org.minNoticeMinutes * 60000) : now;
  const lastBookableDay = addDays(todayInTz(org.timezone, now), org.maxAdvanceDays);
  const latest = zonedTimeToUtc(addDays(lastBookableDay, 1), 0, org.timezone);

  const fromDateStr = params.fromDateStr;
  const toDateStr = addDays(fromDateStr, days - 1);
  const rangeStart = zonedTimeToUtc(fromDateStr, 0, org.timezone);
  const rangeEnd = zonedTimeToUtc(addDays(toDateStr, 1), 0, org.timezone);

  const empty = (): TeamDayAvailability[] =>
    Array.from({ length: days }, (_, i) => ({ dateStr: addDays(fromDateStr, i), slots: [] }));
  if (professionalIds.length === 0) return empty();

  const [rules, exceptions, appointments] = await Promise.all([
    db.availabilityRule.findMany({
      where: { organizationId: org.id, professionalId: { in: professionalIds } },
      select: { professionalId: true, weekday: true, startMinute: true, endMinute: true },
    }),
    db.availabilityException.findMany({
      where: {
        organizationId: org.id,
        OR: [{ professionalId: null }, { professionalId: { in: professionalIds } }],
        date: { gte: dateStrToDbDate(fromDateStr), lte: dateStrToDbDate(toDateStr) },
      },
      select: { professionalId: true, date: true, startMinute: true, endMinute: true },
    }),
    db.appointment.findMany({
      where: {
        organizationId: org.id,
        professionalId: { in: professionalIds },
        status: { not: "canceled" },
        startsAt: { lt: rangeEnd },
        endsAt: { gt: rangeStart },
        ...(params.ignoreAppointmentId ? { id: { not: params.ignoreAppointmentId } } : {}),
      },
      select: { professionalId: true, startsAt: true, endsAt: true },
    }),
  ]);

  const rulesByProfessional = new Map<string, Array<MinuteRange & { weekday: number }>>();
  for (const rule of rules) {
    if (!rule.professionalId) continue; // transitorio; lo cierra la migración de cierre (docs/MULTI_PROFESSIONAL.md)
    const list = rulesByProfessional.get(rule.professionalId) ?? [];
    list.push({ weekday: rule.weekday, startMinute: rule.startMinute, endMinute: rule.endMinute });
    rulesByProfessional.set(rule.professionalId, list);
  }
  const busyByProfessional = new Map<string, Array<{ start: Date; end: Date }>>();
  for (const appointment of appointments) {
    const list = busyByProfessional.get(appointment.professionalId) ?? [];
    list.push({ start: appointment.startsAt, end: appointment.endsAt });
    busyByProfessional.set(appointment.professionalId, list);
  }

  const result: TeamDayAvailability[] = [];
  for (let i = 0; i < days; i++) {
    const dateStr = addDays(fromDateStr, i);
    const dayExceptions = exceptions.filter((e) => dbDateToDateStr(e.date) === dateStr);
    const offers = new Map<number, string[]>();

    for (const professionalId of professionalIds) {
      const slots = computeDaySlots({
        dateStr,
        timeZone: org.timezone,
        rules: rulesByProfessional.get(professionalId) ?? [],
        // Bloqueos generales (sin profesional) y los de este profesional.
        exceptions: dayExceptions.filter((e) => e.professionalId === null || e.professionalId === professionalId),
        busy: busyByProfessional.get(professionalId) ?? [],
        durationMinutes,
        slotIntervalMinutes: org.slotIntervalMinutes,
        bufferMinutes: org.bufferMinutes,
        earliest,
        latest,
      });
      for (const slot of slots) {
        const key = slot.getTime();
        const list = offers.get(key);
        if (list) list.push(professionalId);
        else offers.set(key, [professionalId]);
      }
    }

    result.push({
      dateStr,
      slots: [...offers.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([time, ids]) => ({ start: new Date(time), professionalIds: ids })),
    });
  }
  return result;
}

/** Los horarios de inicio de la unión de varios profesionales, sin repetir. */
export function unionSlots(days: TeamDayAvailability[]): DayAvailability[] {
  return days.map((day) => ({ dateStr: day.dateStr, slots: day.slots.map((slot) => slot.start) }));
}

/**
 * Disponibilidad de la agenda «de siempre» del negocio (el profesional
 * principal), con la forma que tenía antes de los equipos. Se conserva para
 * el código y las pruebas anteriores a los equipos, que así verifican que un
 * negocio individual obtiene exactamente los mismos horarios que antes.
 * Con `professionalIds` calcula la unión de esos profesionales.
 */
export async function getAvailability(params: {
  organization: OrgSchedulingSettings & { name?: string };
  durationMinutes: number;
  fromDateStr: string;
  days: number;
  now?: Date;
  ignoreAppointmentId?: string;
  applyNotice?: boolean;
  professionalIds?: string[];
}): Promise<DayAvailability[]> {
  let professionalIds = params.professionalIds;
  if (!professionalIds) {
    const primary = await getOrCreatePrimaryProfessional(db, {
      id: params.organization.id,
      name: params.organization.name ?? "",
    });
    professionalIds = primary ? [primary.id] : [];
  }
  return unionSlots(await getTeamAvailability({ ...params, professionalIds }));
}
