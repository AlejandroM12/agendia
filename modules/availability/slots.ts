import { addDays, weekdayOf, zonedTimeToUtc } from "@/lib/time";

export type MinuteRange = { startMinute: number; endMinute: number };
export type BusyInterval = { start: Date; end: Date };

export type DayAvailabilityInput = {
  dateStr: string;
  timeZone: string;
  /** Reglas semanales de toda la semana; se filtran por el día pedido. */
  rules: ReadonlyArray<MinuteRange & { weekday: number }>;
  /** Bloqueos de ese día. `null` en ambos extremos = día completo. */
  exceptions: ReadonlyArray<{ startMinute: number | null; endMinute: number | null }>;
  /** Turnos no cancelados que tocan ese día. */
  busy: ReadonlyArray<BusyInterval>;
  durationMinutes: number;
  slotIntervalMinutes: number;
  bufferMinutes: number;
  /** No se ofrecen horarios antes de este instante (ahora + anticipación mínima). */
  earliest: Date;
  /** Ni después de este (ahora + anticipación máxima). */
  latest: Date;
};

/** Resta de rangos: lo que queda de `windows` al quitar `blocks`. */
export function subtractRanges(
  windows: ReadonlyArray<MinuteRange>,
  blocks: ReadonlyArray<MinuteRange>,
): MinuteRange[] {
  let result: MinuteRange[] = windows.map((w) => ({ ...w }));
  for (const block of blocks) {
    const next: MinuteRange[] = [];
    for (const window of result) {
      if (block.endMinute <= window.startMinute || block.startMinute >= window.endMinute) {
        next.push(window);
        continue;
      }
      if (block.startMinute > window.startMinute) {
        next.push({ startMinute: window.startMinute, endMinute: block.startMinute });
      }
      if (block.endMinute < window.endMinute) {
        next.push({ startMinute: block.endMinute, endMinute: window.endMinute });
      }
    }
    result = next;
  }
  return result.sort((a, b) => a.startMinute - b.startMinute);
}

/** Ventanas de atención efectivas de un día (reglas menos bloqueos). */
export function workingWindows(
  input: Pick<DayAvailabilityInput, "dateStr" | "rules" | "exceptions">,
): MinuteRange[] {
  const weekday = weekdayOf(input.dateStr);
  const windows = input.rules
    .filter((rule) => rule.weekday === weekday)
    .map(({ startMinute, endMinute }) => ({ startMinute, endMinute }));

  if (input.exceptions.some((e) => e.startMinute === null || e.endMinute === null)) return [];

  const blocks = input.exceptions.map((e) => ({
    startMinute: e.startMinute as number,
    endMinute: e.endMinute as number,
  }));
  return subtractRanges(windows, blocks);
}

/**
 * Horarios de inicio disponibles para un servicio en un día.
 *
 * Es una función pura: toda la información (reglas, bloqueos, turnos
 * existentes, "ahora") entra por parámetro. Es la única fuente de verdad
 * de la disponibilidad pública; la base de datos agrega además una
 * exclusion constraint como garantía final contra reservas simultáneas.
 */
export function computeDaySlots(input: DayAvailabilityInput): Date[] {
  const step = Math.max(5, input.slotIntervalMinutes);
  const bufferMs = input.bufferMinutes * 60000;
  const durationMs = input.durationMinutes * 60000;
  const slots: Date[] = [];

  for (const window of workingWindows(input)) {
    for (
      let minute = window.startMinute;
      minute + input.durationMinutes <= window.endMinute;
      minute += step
    ) {
      const start = zonedTimeToUtc(input.dateStr, minute, input.timeZone);
      const startMs = start.getTime();
      const endMs = startMs + durationMs;

      if (start < input.earliest || start > input.latest) continue;

      const collides = input.busy.some(
        (b) => startMs < b.end.getTime() + bufferMs && endMs > b.start.getTime() - bufferMs,
      );
      if (!collides) slots.push(start);
    }
  }

  return slots;
}

/** Límites UTC [inicio, fin) de un día local. */
export function dayBoundsUtc(dateStr: string, timeZone: string): { start: Date; end: Date } {
  return {
    start: zonedTimeToUtc(dateStr, 0, timeZone),
    end: zonedTimeToUtc(addDays(dateStr, 1), 0, timeZone),
  };
}
