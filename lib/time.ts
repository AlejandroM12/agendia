/**
 * Utilidades de fecha/hora con zona horaria, sin dependencias.
 *
 * Convenciones:
 * - Los instantes se guardan y se comparan siempre en UTC (`Date`).
 * - Un "día" de agenda es un string `YYYY-MM-DD` interpretado en la zona
 *   horaria de la organización.
 * - Las horas del día son minutos desde la medianoche local (0–1440).
 */

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = partsFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsFormatters.set(timeZone, formatter);
  }
  return formatter;
}

function zonedFields(date: Date, timeZone: string) {
  const fields: Record<string, number> = {};
  for (const part of partsFormatter(timeZone).formatToParts(date)) {
    if (part.type !== "literal") fields[part.type] = Number(part.value);
  }
  return fields as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

/** Diferencia (en minutos) entre la hora local de `timeZone` y UTC en ese instante. */
export function tzOffsetMinutes(date: Date, timeZone: string): number {
  const f = zonedFields(date, timeZone);
  const asUtc = Date.UTC(f.year, f.month - 1, f.day, f.hour, f.minute, f.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/** Convierte "día local + minutos desde la medianoche" al instante UTC correspondiente. */
export function zonedTimeToUtc(dateStr: string, minutes: number, timeZone: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  const guess = Date.UTC(year, month - 1, day, 0, minutes);
  const firstOffset = tzOffsetMinutes(new Date(guess), timeZone);
  let utc = guess - firstOffset * 60000;
  const secondOffset = tzOffsetMinutes(new Date(utc), timeZone);
  if (secondOffset !== firstOffset) utc = guess - secondOffset * 60000;
  return new Date(utc);
}

/** Día local (`YYYY-MM-DD`) y minutos desde la medianoche de un instante. */
export function toZoned(date: Date, timeZone: string): { dateStr: string; minutes: number } {
  const f = zonedFields(date, timeZone);
  return {
    dateStr: `${f.year}-${String(f.month).padStart(2, "0")}-${String(f.day).padStart(2, "0")}`,
    minutes: f.hour * 60 + f.minute,
  };
}

export function todayInTz(timeZone: string, now: Date = new Date()): string {
  return toZoned(now, timeZone).dateStr;
}

export function isValidDateStr(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** 0 = domingo … 6 = sábado. */
export function weekdayOf(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** `Date` a medianoche UTC para columnas `@db.Date`. */
export function dateStrToDbDate(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

export function dbDateToDateStr(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function minutesToLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function labelToMinutes(label: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(label.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 24 || m > 59 || (h === 24 && m > 0)) return null;
  return h * 60 + m;
}

export function formatTime(date: Date, timeZone: string): string {
  return minutesToLabel(toZoned(date, timeZone).minutes);
}

export const WEEKDAY_NAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"] as const;
export const WEEKDAY_SHORT = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"] as const;
const MONTH_NAMES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
] as const;

/** "jueves 12 de noviembre" */
export function formatDateLong(dateStr: string): string {
  const [, m, d] = dateStr.split("-").map(Number);
  return `${WEEKDAY_NAMES[weekdayOf(dateStr)]} ${d} de ${MONTH_NAMES[m - 1]}`;
}

/** "12 nov" */
export function formatDateShort(dateStr: string): string {
  const [, m, d] = dateStr.split("-").map(Number);
  return `${d} ${MONTH_NAMES[m - 1].slice(0, 3)}`;
}

/** "jueves 12 de noviembre, 09:30" */
export function formatDateTime(date: Date, timeZone: string): string {
  const zoned = toZoned(date, timeZone);
  return `${formatDateLong(zoned.dateStr)}, ${minutesToLabel(zoned.minutes)}`;
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
