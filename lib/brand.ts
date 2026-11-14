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
  trialDays: 14,
  readonlyGraceDays: 30,
} as const;

/**
 * Precios de referencia. El precio mensual efectivo se guarda en la tabla
 * `plans` (editable desde /admin); este valor es el inicial y el que
 * muestra la landing.
 */
export const pricing = {
  currency: "ARS",
  monthly: Number(process.env.PRICE_MONTHLY ?? 9900),
  oneTime: Number(process.env.PRICE_ONE_TIME ?? 149000),
} as const;

/**
 * Oferta multiprofesional FUTURA. Está definida acá para que la fuente de
 * verdad sea una sola, pero NO se publica ni se cobra: ninguna página, correo
 * ni integración de pago la usa hasta completar las etapas 3 a 5 de
 * docs/MULTI_PROFESSIONAL.md. Todos los importes en ARS.
 */
export const futurePricing = {
  teamMonthly: 19900,
  licenseProfessional: 149000,
  licenseTeam: 249000,
} as const;

/** Nombres comerciales de las dos modalidades. */
export const offers = {
  monthly: "Plan Profesional",
  license: "Licencia independiente",
} as const;

/**
 * Condiciones de la licencia independiente. La licencia de uso es
 * permanente; hosting, dominio y soporte están incluidos los primeros 12
 * meses y desde el segundo año se renuevan por separado. El valor de esa
 * renovación todavía no está definido: solo se publica si se carga
 * PRICE_LICENSE_RENEWAL; sin ese dato se informa por escrito antes de la compra.
 */
const renewalPrice = Number(process.env.PRICE_LICENSE_RENEWAL ?? 0);
export const licenseTerms = {
  includedServiceMonths: 12,
  renewalPrice: Number.isFinite(renewalPrice) && renewalPrice > 0 ? renewalPrice : null,
} as const;

/** Aclaración visible de lo que incluye el primer año y de lo que se renueva después. */
export function licenseRenewalText(): string {
  const months = licenseTerms.includedServiceMonths;
  const value = licenseTerms.renewalPrice
    ? `Su valor es de ${formatMoney(licenseTerms.renewalPrice)} por año.`
    : "Te informamos el valor por escrito antes de que compres.";
  return `Desde el segundo año, el alojamiento, dominio y soporte se renuevan por separado. La licencia de uso no vence y esos servicios están incluidos durante los primeros ${months} meses. ${value}`;
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

