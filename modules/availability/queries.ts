import "server-only";

import { db } from "@/lib/db";
import { addDays, dateStrToDbDate, dbDateToDateStr, todayInTz, zonedTimeToUtc } from "@/lib/time";
import { computeDaySlots } from "./slots";

export type DayAvailability = { dateStr: string; slots: Date[] };

type OrgSchedulingSettings = {
  id: string;
  timezone: string;
  slotIntervalMinutes: number;
  bufferMinutes: number;
  minNoticeMinutes: number;
  maxAdvanceDays: number;
};

/**
 * Disponibilidad real de un servicio para un rango de días, calculada con
 * las reglas, los bloqueos y los turnos existentes de la organización.
 *
 * `ignoreAppointmentId` excluye un turno del cálculo (para reprogramarlo
 * sin que choque consigo mismo). `applyNotice: false` es para la agenda
 * interna, donde el profesional puede agendar sin anticipación mínima.
 */
export async function getAvailability(params: {
  organization: OrgSchedulingSettings;
  durationMinutes: number;
  fromDateStr: string;
  days: number;
  now?: Date;
  ignoreAppointmentId?: string;
  applyNotice?: boolean;
}): Promise<DayAvailability[]> {
  const { organization: org, durationMinutes, days } = params;
  const now = params.now ?? new Date();
  const applyNotice = params.applyNotice ?? true;

  const earliest = applyNotice ? new Date(now.getTime() + org.minNoticeMinutes * 60000) : now;
  const lastBookableDay = addDays(todayInTz(org.timezone, now), org.maxAdvanceDays);
  const latest = zonedTimeToUtc(addDays(lastBookableDay, 1), 0, org.timezone);

  const fromDateStr = params.fromDateStr;
  const toDateStr = addDays(fromDateStr, days - 1);
  const rangeStart = zonedTimeToUtc(fromDateStr, 0, org.timezone);
  const rangeEnd = zonedTimeToUtc(addDays(toDateStr, 1), 0, org.timezone);

  const [rules, exceptions, appointments] = await Promise.all([
    db.availabilityRule.findMany({
      where: { organizationId: org.id },
      select: { weekday: true, startMinute: true, endMinute: true },
    }),
    db.availabilityException.findMany({
      where: {
        organizationId: org.id,
        date: { gte: dateStrToDbDate(fromDateStr), lte: dateStrToDbDate(toDateStr) },
      },
      select: { date: true, startMinute: true, endMinute: true },
    }),
    db.appointment.findMany({
      where: {
        organizationId: org.id,
        status: { not: "canceled" },
        startsAt: { lt: rangeEnd },
        endsAt: { gt: rangeStart },
        ...(params.ignoreAppointmentId ? { id: { not: params.ignoreAppointmentId } } : {}),
      },
      select: { startsAt: true, endsAt: true },
    }),
  ]);

  const busy = appointments.map((a) => ({ start: a.startsAt, end: a.endsAt }));
  const result: DayAvailability[] = [];

  for (let i = 0; i < days; i++) {
    const dateStr = addDays(fromDateStr, i);
    result.push({
      dateStr,
      slots: computeDaySlots({
        dateStr,
        timeZone: org.timezone,
        rules,
        exceptions: exceptions.filter((e) => dbDateToDateStr(e.date) === dateStr),
        busy,
        durationMinutes,
        slotIntervalMinutes: org.slotIntervalMinutes,
        bufferMinutes: org.bufferMinutes,
        earliest,
        latest,
      }),
    });
  }

  return result;
}
