import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { callingCodeForTimezone, toWhatsAppNumber, whatsAppUrl } from "@/lib/phone";
import { buildWhatsAppActions } from "@/modules/whatsapp/links";
import { availableKinds, buildWhatsAppMessage, firstName, type MessageInput } from "@/modules/whatsapp/messages";
import { zonedTimeToUtc } from "@/lib/time";

const TZ = "America/Argentina/Buenos_Aires";

describe("normalización de teléfonos para wa.me", () => {
  const ok = (raw: string, expected: string, code = "54") => {
    const result = toWhatsAppNumber(raw, code);
    expect(result, raw).toEqual({ ok: true, digits: expected });
  };
  const bad = (raw: string | null | undefined, reason: "missing" | "invalid", code = "54") =>
    expect(toWhatsAppNumber(raw, code), String(raw)).toEqual({ ok: false, reason });

  it("móviles argentinos escritos de las formas habituales", () => {
    ok("1155550000", "5491155550000"); // característica + número
    ok("11 5555 0000", "5491155550000");
    ok("011 5555-0000", "5491155550000");
    ok("011 15 5555-0000", "5491155550000"); // 0 de llamada + 15
    ok("15 5555 0000".replace("15 ", "11 15 "), "5491155550000");
    ok("(011) 15-5555-0000", "5491155550000");
    ok("0351 15 512 3456", "5493515123456"); // Córdoba: 0 + área de 3 dígitos + 15
    ok("351 512 3456", "5493515123456");
    ok("02966 15 123456", "5492966123456"); // área de 4 dígitos
    ok("2966123456", "5492966123456");
  });

  it("números argentinos con código de país", () => {
    ok("+54 9 11 5555-0000", "5491155550000");
    ok("+5491155550000", "5491155550000");
    ok("+54 11 5555 0000", "5491155550000"); // WhatsApp exige el 9 de móvil: se agrega
    ok("+54 351 512 3456", "5493515123456");
    ok("5491155550000", "5491155550000"); // sin «+»
    ok("0054 9 11 5555 0000", "5491155550000");
  });

  it("teléfonos internacionales: se respetan tal cual", () => {
    ok("+598 99 123 456", "59899123456");
    ok("+1 (415) 555-2671", "14155552671");
    ok("+34 612 34 56 78", "34612345678");
    ok("+55 11 91234-5678", "5511912345678");
    ok("00598 99 123 456", "59899123456");
  });

  it("números sin «+» se interpretan en el país del negocio", () => {
    ok("099 123 456", "59899123456", "598");
    ok("9 1234 5678", "56912345678", "56");
    ok("612 345 678", "34612345678", "34");
    expect(callingCodeForTimezone("America/Montevideo")).toBe("598");
    expect(callingCodeForTimezone("America/Argentina/Cordoba")).toBe("54");
    expect(callingCodeForTimezone("Europe/Madrid")).toBe("34");
  });

  it("rechaza lo que no sirve para armar un enlace", () => {
    bad(null, "missing");
    bad(undefined, "missing");
    bad("", "missing");
    bad("   ", "missing");
    bad("12345", "invalid"); // muy corto
    bad("5555 0000", "invalid"); // falta la característica
    bad("1155550", "invalid");
    bad("115555000012345", "invalid"); // demasiado largo
    bad("abc 1155550000", "invalid");
    bad("11-5555-0000 int. 4", "invalid");
    bad("+0 1155550000", "invalid");
    bad("+54 11 5555", "invalid");
    bad("+1234567890123456", "invalid"); // más de 15 dígitos
    bad("<script>alert(1)</script>", "invalid");
  });

  it("el enlace codifica los caracteres especiales del mensaje", () => {
    const url = whatsAppUrl("5491155550000", "Hola, Ñandú & Co.\nFecha: 18/11 — ¡Te esperamos! 100% 😀 #1");
    expect(url.startsWith("https://wa.me/5491155550000?text=")).toBe(true);
    const text = new URL(url).searchParams.get("text");
    expect(text).toBe("Hola, Ñandú & Co.\nFecha: 18/11 — ¡Te esperamos! 100% 😀 #1");
    expect(url).not.toContain(" ");
    expect(url).not.toContain("\n");
    expect(url.split("?").length).toBe(2);
  });
});

const base = (overrides: Partial<MessageInput> = {}): MessageInput => ({
  customerName: "Nicolás Pérez",
  businessName: "Barbería Avenida",
  businessPhone: "11 4444-5555",
  timeZone: TZ,
  startsAt: zonedTimeToUtc("2026-11-18", 16 * 60, TZ),
  professionalName: "Lucas",
  manageUrl: "https://agendia.test/turno/abc123token",
  publicUrl: "https://agendia.test/barberia-avenida",
  now: zonedTimeToUtc("2026-11-17", 10 * 60, TZ),
  ...overrides,
});

describe("mensajes de WhatsApp", () => {
  it("el recordatorio sigue el texto acordado, con fecha, horario en la zona del negocio, profesional y enlace", () => {
    const text = buildWhatsAppMessage("reminder", base({ businessPhone: null }));
    expect(text).toBe(
      [
        "Hola, Nicolás. Te recordamos que mañana tenés un turno en Barbería Avenida.",
        "",
        "Fecha: 18 de noviembre.",
        "Horario: 16:00 hs.",
        "Profesional: Lucas.",
        "",
        "Podés consultar o gestionar tu turno desde el siguiente enlace:",
        "",
        "https://agendia.test/turno/abc123token",
        "",
        "¡Te esperamos!",
      ].join("\n"),
    );
  });

  it("usa «hoy», «mañana» o la fecha según corresponda, siempre en la zona horaria del negocio", () => {
    expect(buildWhatsAppMessage("reminder", base({ now: zonedTimeToUtc("2026-11-18", 8 * 60, TZ) }))).toContain("que hoy tenés");
    expect(buildWhatsAppMessage("reminder", base({ now: zonedTimeToUtc("2026-11-10", 8 * 60, TZ) }))).toContain("que el miércoles 18 de noviembre tenés");
    // 23:30 en Buenos Aires es ya el día siguiente en UTC: el turno sigue siendo «mañana» para el negocio.
    const lateNight = base({ startsAt: zonedTimeToUtc("2026-11-18", 23 * 60 + 30, TZ), now: zonedTimeToUtc("2026-11-17", 21 * 60, TZ) });
    const text = buildWhatsAppMessage("reminder", lateNight);
    expect(text).toContain("mañana");
    expect(text).toContain("Horario: 23:30 hs.");
    // Mismo turno, otra zona horaria del negocio: otra hora en pantalla.
    const madrid = base({ timeZone: "Europe/Madrid", now: zonedTimeToUtc("2026-11-17", 10 * 60, "Europe/Madrid") });
    expect(buildWhatsAppMessage("reminder", madrid)).toContain("Horario: 20:00 hs.");
  });

  it("cada situación tiene su texto: confirmación, cambio, cancelación y contacto", () => {
    const confirmation = buildWhatsAppMessage("confirmation", base());
    expect(confirmation).toContain("Tu turno en Barbería Avenida quedó confirmado.");
    expect(confirmation).toContain("https://agendia.test/turno/abc123token");
    expect(confirmation).toContain("Si necesitás algo, podés escribirnos o llamarnos al 11 4444-5555.");

    const reschedule = buildWhatsAppMessage("reschedule", base());
    expect(reschedule).toContain("tu turno cambió");
    expect(reschedule).toContain("Fecha: 18 de noviembre.");

    const cancellation = buildWhatsAppMessage("cancellation", base());
    expect(cancellation).toContain("fue cancelado");
    expect(cancellation).toContain("https://agendia.test/barberia-avenida"); // para reservar de nuevo
    expect(cancellation).not.toContain("/turno/abc123token"); // un turno cancelado no se gestiona

    const contact = buildWhatsAppMessage("contact", base());
    expect(contact).toContain("Te escribimos de Barbería Avenida por tu turno mañana a las 16:00 hs.");
  });

  it("el aviso de cambio de profesional nombra al nuevo profesional, salvo en el modo discreto", () => {
    const text = buildWhatsAppMessage("professional_change", base({ professionalName: "Martín" }));
    expect(text).toContain("tu turno sigue mañana a las 16:00 hs, pero cambió quién te atiende: ahora te atiende Martín.");
    expect(text).toContain("Profesional: Martín.");
    expect(text).toContain("https://agendia.test/turno/abc123token");
    const discreet = buildWhatsAppMessage("professional_change", base({ professionalName: "Martín", discreet: true }));
    expect(discreet).not.toContain("Martín");
    expect(discreet).toContain("cambió quién te atiende.");
    // Solo se ofrece en negocios con equipo y turnos por venir.
    const now = new Date("2026-11-17T12:00:00Z");
    expect(availableKinds({ status: "confirmed", startsAt: new Date("2026-11-18T12:00:00Z") }, now, false)).not.toContain("professional_change");
    expect(availableKinds({ status: "canceled", startsAt: new Date("2026-11-18T12:00:00Z") }, now, true)).not.toContain("professional_change");
  });

  it("sin profesional (negocio individual) no hay línea de profesional; el mensaje discreto tampoco nombra al profesional ni da contacto", () => {
    expect(buildWhatsAppMessage("confirmation", base({ professionalName: null }))).not.toContain("Profesional");
    const discreet = buildWhatsAppMessage("confirmation", base({ discreet: true }));
    expect(discreet).not.toContain("Profesional");
    expect(discreet).not.toContain("Lucas");
    expect(discreet).not.toContain("11 4444-5555");
    expect(discreet).toContain("Fecha: 18 de noviembre.");
  });

  it("nunca incluye datos sensibles: ni servicio, ni notas, ni precio, ni diagnóstico", () => {
    for (const kind of ["contact", "confirmation", "reminder", "reschedule", "cancellation"] as const) {
      const text = buildWhatsAppMessage(kind, base());
      expect(text).not.toMatch(/servicio|nota|precio|\$|consulta por|diagn|motivo/i);
    }
    // El módulo ni siquiera recibe esos datos: solo nombre, negocio, horario, profesional y enlaces.
    const source = readFileSync(join("modules", "whatsapp", "messages.ts"), "utf8");
    expect(source).not.toMatch(/notes|serviceName|price/);
  });

  it("los enlaces no llevan datos personales ni credenciales más allá del token de gestión del turno", () => {
    const text = buildWhatsAppMessage("reminder", base());
    const urls = text.match(/https?:\/\/\S+/g) ?? [];
    expect(urls).toEqual(["https://agendia.test/turno/abc123token"]);
    expect(urls[0]).not.toMatch(/@|nicol|telefono|phone|email|password|clave/i);
  });

  it("saluda aunque falte el nombre y toma solo el primer nombre", () => {
    expect(firstName("  María  José  Gómez ")).toBe("María");
    expect(buildWhatsAppMessage("contact", base({ customerName: "" })).startsWith("Hola.")).toBe(true);
  });

  it("solo ofrece los mensajes que tienen sentido para el estado del turno", () => {
    const now = new Date("2026-11-17T12:00:00Z");
    const future = new Date("2026-11-18T12:00:00Z");
    const past = new Date("2026-11-16T12:00:00Z");
    expect(availableKinds({ status: "confirmed", startsAt: future }, now)).toEqual(["confirmation", "reminder", "reschedule", "contact"]);
    expect(availableKinds({ status: "confirmed", startsAt: past }, now)).toEqual(["contact"]);
    expect(availableKinds({ status: "canceled", startsAt: future }, now)).toEqual(["contact", "cancellation"]);
    expect(availableKinds({ status: "canceled", startsAt: past }, now)).toEqual(["contact"]);
    expect(availableKinds({ status: "completed", startsAt: past }, now)).toEqual(["contact"]);
    expect(availableKinds({ status: "no_show", startsAt: past }, now)).toEqual(["contact"]);
  });
});

describe("acciones de WhatsApp de un turno", () => {
  const organization = { name: "Barbería Avenida", slug: "barberia-avenida", phone: null, timezone: TZ };
  const appointment = { status: "confirmed", startsAt: zonedTimeToUtc("2026-11-18", 16 * 60, TZ), manageToken: "tok123" };
  const now = zonedTimeToUtc("2026-11-17", 10 * 60, TZ);

  it("arma un enlace wa.me por mensaje y una versión discreta", () => {
    const actions = buildWhatsAppActions({ organization, appointment, customer: { name: "Nicolás", phone: "11 5555-0000" }, professionalName: "Lucas", now });
    expect(actions.status).toBe("ok");
    if (actions.status !== "ok") return;
    expect(actions.options.map((o) => o.kind)).toEqual(["confirmation", "reminder", "reschedule", "professional_change", "contact"]); // con equipo se suma el aviso de cambio de profesional
    for (const option of actions.options) {
      expect(option.url.startsWith("https://wa.me/5491155550000?text=")).toBe(true);
      expect(option.discreetUrl.startsWith("https://wa.me/5491155550000?text=")).toBe(true);
    }
    const reminder = actions.options.find((o) => o.kind === "reminder")!;
    expect(decodeURIComponent(reminder.url)).toContain("Profesional: Lucas.");
    expect(decodeURIComponent(reminder.discreetUrl)).not.toContain("Lucas");
  });

  it("sin teléfono no hay acciones; con un teléfono inválido se avisa y no se genera ningún enlace", () => {
    expect(buildWhatsAppActions({ organization, appointment, customer: { name: "A", phone: null }, now })).toEqual({ status: "no_phone" });
    expect(buildWhatsAppActions({ organization, appointment, customer: { name: "A", phone: "" }, now })).toEqual({ status: "no_phone" });
    expect(buildWhatsAppActions({ organization, appointment, customer: { name: "A", phone: "5555" }, now })).toEqual({ status: "invalid_phone" });
    expect(buildWhatsAppActions({ organization, appointment, customer: { name: "A", phone: "+54 11" }, now })).toEqual({ status: "invalid_phone" });
  });

  it("usa el país del negocio para interpretar números sin «+» y respeta los números internacionales", () => {
    const uruguay = { ...organization, timezone: "America/Montevideo" };
    const local = buildWhatsAppActions({ organization: uruguay, appointment, customer: { name: "A", phone: "099123456" }, now });
    expect(local.status === "ok" && local.options[0].url).toContain("wa.me/59899123456?");
    const foreign = buildWhatsAppActions({ organization, appointment, customer: { name: "A", phone: "+34612345678" }, now });
    expect(foreign.status === "ok" && foreign.options[0].url).toContain("wa.me/34612345678?");
  });
});

describe("WhatsApp manual no envía nada", () => {
  it("armar mensajes y enlaces no hace ninguna llamada de red", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    buildWhatsAppActions({
      organization: { name: "X", slug: "x", phone: null, timezone: TZ },
      appointment: { status: "confirmed", startsAt: new Date(Date.now() + 86_400_000), manageToken: "t" },
      customer: { name: "A", phone: "1155550000" },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("el WhatsApp MANUAL no tiene proveedor, base de datos ni red: no registra ningún envío", () => {
    // El automático vive en su propio módulo (crypto, meta, service, webhook…) y se prueba aparte; estos archivos son solo del manual.
    for (const file of [join("modules", "whatsapp", "links.ts"), join("modules", "whatsapp", "messages.ts"), join("lib", "phone.ts")]) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/\bfetch\(|axios|XMLHttpRequest|node:https?|graph\.facebook|twilio|\.create\(|\.update\(|prisma|from "@\/lib\/db"/);
    }
  });
});
