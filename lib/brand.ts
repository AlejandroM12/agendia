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
  monthly: Number(process.env.PRICE_MONTHLY ?? 7900),
  oneTime: Number(process.env.PRICE_ONE_TIME ?? 99000),
} as const;

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

/** Planes que muestra la landing (se rediseña junto con la nueva landing). */
export const plans = [
  {
    id: "mensual",
    name: "Suscripción mensual",
    priceMonthly: pricing.monthly as number | null,
    description: "Hosting, base de datos e infraestructura a nuestro cargo.",
  },
  {
    id: "standalone",
    name: "Compra única — instalación independiente",
    priceMonthly: null as number | null,
    description: "Licencia de uso del software, instalado en infraestructura propia.",
  },
] as const;
