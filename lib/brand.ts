/**
 * Configuración centralizada de marca.
 *
 * Cambiar el nombre, el eslogan o la paleta de Agendia implica editar
 * únicamente este archivo (y, si cambia la paleta, los tokens CSS en
 * app/globals.css). Ningún componente debe hardcodear el nombre del
 * producto o sus colores directamente.
 *
 * Ver docs/DECISIONS.md (identidad comercial) y docs/PRODUCT_PLAN.md.
 */
export const brand = {
  name: "Agendia",
  tagline: "Tu agenda, más simple",
  description:
    "Agendia permite a profesionales independientes organizar sus turnos, recibir reservas online y enviar recordatorios automáticos desde una plataforma sencilla y accesible desde cualquier dispositivo.",
} as const;

/**
 * Duración de la prueba gratuita y del período de solo lectura posterior.
 * Ver docs/DECISIONS.md (D-07).
 */
export const trialPolicy = {
  trialDays: 7,
  readonlyGraceDays: 30,
} as const;

/**
 * Planes comerciales. Los precios se mantienen configurables y sin valores
 * definitivos (ver docs/DECISIONS.md, D-08) hasta que se apruebe la
 * estrategia de pricing.
 */
export const plans = [
  {
    id: "mensual",
    name: "Suscripción mensual",
    priceMonthly: null as number | null,
    description: "Hosting, base de datos e infraestructura a nuestro cargo.",
  },
  {
    id: "standalone",
    name: "Compra única — instalación independiente",
    priceMonthly: null as number | null,
    description:
      "Licencia de uso del software, instalado en infraestructura propia.",
  },
] as const;
