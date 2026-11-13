/**
 * Configuración centralizada de marca y oferta comercial.
 *
 * Nombre, textos, marca creadora y precios de referencia viven acá; los
 * colores y tipografías, en app/globals.css y app/layout.tsx. Ningún
 * componente debe hardcodear estos valores.
 */
export const brand = {
  name: "Agendia",
  tagline: "Tu agenda, más simple",
  description:
    "Agendia organiza tus turnos, recibe reservas online las 24 horas y avisa a tus clientes por vos. Pensada para profesionales independientes.",
  url: process.env.APP_URL ?? process.env.AUTH_URL ?? "http://localhost:3000",
  contactEmail: process.env.CONTACT_EMAIL ?? "hola@atajolab.dev",
  maker: {
    name: "AtajoLab",
    url: "https://atajolab.dev",
  },
} as const;

/** Prueba gratuita y período de solo lectura posterior (docs/DECISIONS.md, D-07). */
export const trialPolicy = {
  trialDays: 7,
  readonlyGraceDays: 30,
} as const;

/**
 * Precios de referencia. El precio mensual efectivo se guarda en la tabla
 * `plans` (editable desde /admin); este valor es el inicial y el que
 * muestra la landing.
 */
export const pricing = {
  currency: "ARS",
  monthly: Number(process.env.PRICE_MONTHLY ?? 14000),
  oneTime: Number(process.env.PRICE_ONE_TIME ?? 199000),
} as const;

/** Nombres comerciales de las dos modalidades. */
export const offers = {
  monthly: "Plan Profesional",
  license: "Licencia independiente",
} as const;

/**
 * Condiciones de la licencia independiente. La licencia de uso es
 * permanente; hosting, dominio y soporte están incluidos el primer año y
 * después se renuevan por año. El valor de esa renovación se publica con
 * PRICE_LICENSE_RENEWAL; sin ese dato se informa por escrito antes de la compra.
 */
const renewalPrice = Number(process.env.PRICE_LICENSE_RENEWAL ?? 0);
export const licenseTerms = {
  includedServiceMonths: 12,
  renewalPrice: Number.isFinite(renewalPrice) && renewalPrice > 0 ? renewalPrice : null,
} as const;

export function licenseRenewalText(): string {
  const months = licenseTerms.includedServiceMonths;
  const value = licenseTerms.renewalPrice
    ? `tiene un valor de ${formatMoney(licenseTerms.renewalPrice)} por año`
    : "se hace al valor vigente en ese momento, que te informamos por escrito antes de que compres";
  return `La licencia de uso no vence. Hosting, dominio y soporte están incluidos durante los primeros ${months} meses; a partir del mes ${months + 1} su renovación es anual y ${value}.`;
}

export function formatMoney(amount: number, currency: string = pricing.currency): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

/** Rubros sugeridos en el onboarding, con servicios de ejemplo para arrancar rápido. */
export const industries: ReadonlyArray<{
  id: string;
  label: string;
  services: ReadonlyArray<{ name: string; durationMinutes: number }>;
}> = [
  {
    id: "belleza",
    label: "Peluquería, barbería y estética",
    services: [
      { name: "Corte", durationMinutes: 30 },
      { name: "Color", durationMinutes: 90 },
    ],
  },
  {
    id: "unas",
    label: "Manicura y pedicura",
    services: [
      { name: "Manicura", durationMinutes: 60 },
      { name: "Pedicura", durationMinutes: 60 },
    ],
  },
  {
    id: "salud",
    label: "Salud y consultorios",
    services: [
      { name: "Consulta", durationMinutes: 30 },
      { name: "Primera consulta", durationMinutes: 45 },
    ],
  },
  {
    id: "psicologia",
    label: "Psicología y terapias",
    services: [{ name: "Sesión", durationMinutes: 50 }],
  },
  {
    id: "bienestar",
    label: "Masajes y bienestar",
    services: [{ name: "Sesión de masajes", durationMinutes: 60 }],
  },
  {
    id: "fitness",
    label: "Entrenamiento personal",
    services: [{ name: "Clase individual", durationMinutes: 60 }],
  },
  {
    id: "educacion",
    label: "Clases particulares",
    services: [{ name: "Clase", durationMinutes: 60 }],
  },
  {
    id: "tecnico",
    label: "Servicios técnicos y a domicilio",
    services: [{ name: "Visita técnica", durationMinutes: 60 }],
  },
  {
    id: "otro",
    label: "Otra actividad",
    services: [{ name: "Turno", durationMinutes: 30 }],
  },
];

