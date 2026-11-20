/**
 * Teléfonos para abrir un chat de WhatsApp (enlaces wa.me).
 *
 * wa.me necesita el número en formato internacional, solo dígitos y sin
 * «+» ni ceros iniciales: `5491155550000`. Los clientes escriben el número
 * como lo dicen en voz alta («011 15 5555-0000»), así que acá se normaliza.
 *
 * Alcance: se arma el número internacional y se valida su forma (largo y
 * dígitos). No se puede comprobar que la línea exista ni que tenga WhatsApp:
 * eso solo lo sabe WhatsApp al abrir el chat. Sin dependencias, para poder
 * usarlo también desde el navegador.
 */

/** Código de país por zona horaria del negocio: el país en el que se interpretan los números sin «+». */
const CALLING_CODE_BY_TIMEZONE_PREFIX: Array<[prefix: string, code: string]> = [
  ["America/Argentina/", "54"],
  ["America/Buenos_Aires", "54"],
  ["America/Montevideo", "598"],
  ["America/Santiago", "56"],
  ["America/Asuncion", "595"],
  ["America/La_Paz", "591"],
  ["America/Lima", "51"],
  ["America/Bogota", "57"],
  ["America/Mexico_City", "52"],
  ["Europe/Madrid", "34"],
];

export function callingCodeForTimezone(timeZone: string): string {
  return CALLING_CODE_BY_TIMEZONE_PREFIX.find(([prefix]) => timeZone.startsWith(prefix))?.[1] ?? "54";
}

export type WhatsAppNumber =
  | { ok: true; /** Solo dígitos, formato internacional. */ digits: string }
  | { ok: false; reason: "missing" | "invalid" };

const MIN_INTERNATIONAL = 8;
const MAX_INTERNATIONAL = 15; // E.164

/** Código de área argentino (sin el 0): 11 (AMBA) o 3 o 4 dígitos que empiezan con 2 o 3. */
function argentineAreaLength(national: string, at: number): boolean {
  if (at === 2) return national.startsWith("11");
  return /^[23]/.test(national) && (at === 3 || at === 4);
}

/**
 * Número móvil argentino a partir de la parte nacional: quita el 0 de
 * llamada, el «15» que se marca después de la característica, y devuelve
 * `9` + característica + número (10 dígitos), que es como lo pide WhatsApp.
 */
function argentineMobile(nationalInput: string): string | null {
  let national = nationalInput.replace(/^0+/, "");
  // «54» ya escrito (sin «+»): se sigue desde lo que viene después.
  if (national.startsWith("54") && national.length >= 12) national = national.slice(2);
  // Ya con el 9 de móvil: 9 + 10 dígitos.
  if (national.startsWith("9") && national.length === 11) national = national.slice(1);

  if (national.length === 12) {
    // característica + 15 + número de 6 a 8 dígitos
    for (const area of [2, 3, 4]) {
      if (argentineAreaLength(national, area) && national.slice(area, area + 2) === "15") {
        national = national.slice(0, area) + national.slice(area + 2);
        break;
      }
    }
  }
  return national.length === 10 && /^[1-9]/.test(national) ? `9${national}` : null;
}

/**
 * Normaliza un teléfono guardado (solo dígitos, con «+» inicial si el
 * cliente lo escribió) al formato de wa.me. Los números sin «+» se
 * interpretan en el país del negocio (`defaultCallingCode`); los que
 * empiezan con «+» son internacionales y no se tocan, salvo el 9 móvil
 * de Argentina que WhatsApp exige.
 */
export function toWhatsAppNumber(raw: string | null | undefined, defaultCallingCode = "54"): WhatsAppNumber {
  const text = (raw ?? "").trim();
  if (!text) return { ok: false, reason: "missing" };
  if (/[^\d+\s().-]/.test(text)) return { ok: false, reason: "invalid" };

  const international = text.startsWith("+") || text.replace(/\D/g, "").startsWith("00");
  const digits = text.replace(/\D/g, "");
  if (digits.length < 6) return { ok: false, reason: "invalid" };

  if (international) {
    const withoutPrefix = digits.replace(/^00/, "");
    if (withoutPrefix.startsWith("0") || withoutPrefix.length < MIN_INTERNATIONAL || withoutPrefix.length > MAX_INTERNATIONAL) {
      return { ok: false, reason: "invalid" };
    }
    if (withoutPrefix.startsWith("54")) {
      const mobile = argentineMobile(withoutPrefix);
      return mobile ? { ok: true, digits: `54${mobile}` } : { ok: false, reason: "invalid" };
    }
    return { ok: true, digits: withoutPrefix };
  }

  if (defaultCallingCode === "54") {
    const mobile = argentineMobile(digits);
    return mobile ? { ok: true, digits: `54${mobile}` } : { ok: false, reason: "invalid" };
  }

  // Otros países: sin «+», es un número nacional. Se saca el 0 de llamada y se antepone el código.
  const national = digits.replace(/^0+/, "");
  const full = national.startsWith(defaultCallingCode) && national.length > MAX_INTERNATIONAL - 3 ? national : `${defaultCallingCode}${national}`;
  if (full.length < MIN_INTERNATIONAL || full.length > MAX_INTERNATIONAL) return { ok: false, reason: "invalid" };
  return { ok: true, digits: full };
}

/**
 * Número tal como lo informa Meta en un mensaje ENTRANTE → formato interno (`549…`). Meta puede informar un móvil
 * argentino con o sin el 9 (`54` + 10 dígitos o `549` + 10 dígitos): se unifica para poder compararlo con el teléfono del
 * turno, la baja y el consentimiento, que se guardan como `549…`. El resto de los números no se toca.
 */
export function canonicalInboundNumber(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  const match = /^54([1-9]\d{9})$/.exec(digits);
  return match ? `549${match[1]}` : digits;
}

/** Enlace wa.me con el texto ya escrito: se abre el chat y la persona revisa y envía el mensaje. */
export function whatsAppUrl(digits: string, text: string): string {
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
