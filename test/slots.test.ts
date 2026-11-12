import { describe, it, expect } from "vitest";
import { computeDaySlots, subtractRanges, workingWindows } from "@/modules/availability/slots";
import { formatTime, toZoned, tzOffsetMinutes, weekdayOf, zonedTimeToUtc } from "@/lib/time";

const TZ = "America/Argentina/Buenos_Aires";
const DAY = "2030-03-13"; // miércoles
const WEEKDAY = weekdayOf(DAY);

const base = {
  dateStr: DAY,
  timeZone: TZ,
  rules: [{ weekday: WEEKDAY, startMinute: 9 * 60, endMinute: 12 * 60 }],
  exceptions: [],
  busy: [],
  durationMinutes: 30,
  slotIntervalMinutes: 30,
  bufferMinutes: 0,
  earliest: new Date("2030-01-01T00:00:00Z"),
  latest: new Date("2031-01-01T00:00:00Z"),
};

const labels = (slots: Date[], tz = TZ) => slots.map((s) => formatTime(s, tz));

describe("zonas horarias", () => {
  it("convierte hora local de Buenos Aires (UTC-3) a UTC", () => {
    expect(zonedTimeToUtc(DAY, 9 * 60, TZ).toISOString()).toBe("2030-03-13T12:00:00.000Z");
    expect(tzOffsetMinutes(new Date("2030-03-13T12:00:00Z"), TZ)).toBe(-180);
  });

  it("respeta el horario de verano de otras zonas", () => {
    // Madrid: UTC+1 en invierno, UTC+2 en verano.
    expect(zonedTimeToUtc("2030-01-15", 10 * 60, "Europe/Madrid").toISOString()).toBe("2030-01-15T09:00:00.000Z");
    expect(zonedTimeToUtc("2030-07-15", 10 * 60, "Europe/Madrid").toISOString()).toBe("2030-07-15T08:00:00.000Z");
  });

  it("toZoned es la inversa de zonedTimeToUtc", () => {
    const instant = zonedTimeToUtc(DAY, 23 * 60 + 30, TZ);
    expect(toZoned(instant, TZ)).toEqual({ dateStr: DAY, minutes: 23 * 60 + 30 });
  });
});

describe("subtractRanges", () => {
  it("parte una ventana cuando el bloqueo cae en el medio", () => {
    expect(
      subtractRanges([{ startMinute: 540, endMinute: 1080 }], [{ startMinute: 720, endMinute: 780 }]),
    ).toEqual([
      { startMinute: 540, endMinute: 720 },
      { startMinute: 780, endMinute: 1080 },
    ]);
  });
});

describe("computeDaySlots", () => {
  it("ofrece los horarios del día según el intervalo", () => {
    expect(labels(computeDaySlots(base))).toEqual(["09:00", "09:30", "10:00", "10:30", "11:00", "11:30"]);
  });

  it("no ofrece un horario si el servicio no termina dentro de la ventana", () => {
    const slots = computeDaySlots({ ...base, durationMinutes: 60 });
    expect(labels(slots)).toEqual(["09:00", "09:30", "10:00", "10:30", "11:00"]);
  });

  it("no ofrece nada un día sin atención", () => {
    expect(computeDaySlots({ ...base, rules: [{ weekday: (WEEKDAY + 1) % 7, startMinute: 540, endMinute: 720 }] })).toEqual([]);
  });

  it("excluye horarios ocupados por turnos existentes", () => {
    const slots = computeDaySlots({
      ...base,
      busy: [{ start: zonedTimeToUtc(DAY, 10 * 60, TZ), end: zonedTimeToUtc(DAY, 11 * 60, TZ) }],
    });
    expect(labels(slots)).toEqual(["09:00", "09:30", "11:00", "11:30"]);
  });

  it("respeta el margen entre turnos", () => {
    const slots = computeDaySlots({
      ...base,
      bufferMinutes: 15,
      busy: [{ start: zonedTimeToUtc(DAY, 10 * 60, TZ), end: zonedTimeToUtc(DAY, 10 * 60 + 30, TZ) }],
    });
    // 09:30 terminaría 10:00 (sin margen antes del turno) y 10:30 empezaría pegado al final.
    expect(labels(slots)).toEqual(["09:00", "11:00", "11:30"]);
  });

  it("un bloqueo de día completo deja el día sin horarios", () => {
    expect(computeDaySlots({ ...base, exceptions: [{ startMinute: null, endMinute: null }] })).toEqual([]);
  });

  it("un bloqueo parcial quita solo esa franja", () => {
    const slots = computeDaySlots({ ...base, exceptions: [{ startMinute: 9 * 60, endMinute: 10 * 60 + 30 }] });
    expect(labels(slots)).toEqual(["10:30", "11:00", "11:30"]);
    expect(workingWindows({ ...base, exceptions: [{ startMinute: 540, endMinute: 630 }] })).toEqual([
      { startMinute: 630, endMinute: 720 },
    ]);
  });

  it("aplica la anticipación mínima y máxima", () => {
    const slots = computeDaySlots({
      ...base,
      earliest: zonedTimeToUtc(DAY, 10 * 60 + 10, TZ),
      latest: zonedTimeToUtc(DAY, 11 * 60, TZ),
    });
    expect(labels(slots)).toEqual(["10:30", "11:00"]);
  });

  it("soporta horario cortado (dos franjas el mismo día)", () => {
    const slots = computeDaySlots({
      ...base,
      durationMinutes: 60,
      slotIntervalMinutes: 60,
      rules: [
        { weekday: WEEKDAY, startMinute: 9 * 60, endMinute: 11 * 60 },
        { weekday: WEEKDAY, startMinute: 16 * 60, endMinute: 18 * 60 },
      ],
    });
    expect(labels(slots)).toEqual(["09:00", "10:00", "16:00", "17:00"]);
  });
});
