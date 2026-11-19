import type { Organization } from "@prisma/client";
import type { Permission } from "@/lib/permissions";

/**
 * Política de la demostración (docs/DEMO.md). Todo lo que decide «qué puede y qué no puede hacer una demo» vive
 * acá, en funciones puras, para que se pruebe sin base de datos y no se disperse por la aplicación.
 *
 * Una demo es un negocio ficticio y aislado (`Organization.isDemo`), uno por visitante, con vencimiento. Nunca:
 *  - envía un aviso real (correo ni WhatsApp), salvo una demo SUPERVISADA y solo a los destinatarios autorizados;
 *  - tiene facturación ni cobra nada, ni invita a nadie por correo;
 *  - toca a un negocio productivo (todo lo del visitante cuelga de su propio negocio de demo).
 */
export const DEMO = {
  /** Cuánto dura la demo pública antes de borrarse. */
  publicTtlHours: 3,
  /** Cuánto dura una demo supervisada. */
  supervisedTtlHours: 24,
  /** Demos públicas vivas a la vez (protege la base de un uso abusivo). */
  maxActivePublic: 80,
  /** Demos públicas que puede crear una misma IP por hora. */
  createsPerIpPerHour: 6,
  /** Tope de turnos y de clientes en una demo (los que trae más los que cargue el visitante). */
  maxAppointments: 60,
  maxCustomers: 80,
  /** Los usuarios de las demos usan un dominio inexistente: nunca pueden recibir un correo real. */
  emailDomain: "demo.agendia.invalid",
} as const;

export type DemoKind = "public" | "supervised";
export type DemoFields = Pick<Organization, "isDemo" | "demoKind" | "demoAllowedRecipients">;

export const isDemo = (organization: Pick<Organization, "isDemo">): boolean => organization.isDemo;

/** Permisos que una demo nunca concede, ni siquiera a su «propietario». */
export const DEMO_REMOVED_PERMISSIONS: readonly Permission[] = ["billing.manage", "team.invite", "members.manage_admins"];

/**
 * Qué hacer con un aviso saliente:
 *  - `live`: no es una demo, sale como siempre;
 *  - `simulate`: es una demo, no sale nada y el mensaje se muestra en la vista previa;
 *  - `send`: demo SUPERVISADA y el destinatario está autorizado expresamente.
 * Ante cualquier duda, `simulate`.
 */
export function demoDelivery(organization: DemoFields, recipient: string): "live" | "simulate" | "send" {
  if (!organization.isDemo) return "live";
  if (organization.demoKind !== "supervised") return "simulate";
  const wanted = recipient.trim().toLowerCase();
  return wanted !== "" && organization.demoAllowedRecipients.some((allowed) => allowed.trim().toLowerCase() === wanted) ? "send" : "simulate";
}

/** Marca con la que un aviso de demo se registra como «enviado» sin salir. */
export const DEMO_SIMULATED_NOTE = "simulado (demo): no se envió ningún mensaje real";

export function demoExpired(organization: Pick<Organization, "isDemo" | "demoExpiresAt">, now = new Date()): boolean {
  return organization.isDemo && organization.demoExpiresAt !== null && organization.demoExpiresAt.getTime() <= now.getTime();
}

export function demoRemainingMinutes(organization: Pick<Organization, "demoExpiresAt">, now = new Date()): number {
  if (!organization.demoExpiresAt) return 0;
  return Math.max(0, Math.round((organization.demoExpiresAt.getTime() - now.getTime()) / 60000));
}

export const DEMO_BLOCKED_MESSAGE = "Esto no está disponible en la demostración.";
