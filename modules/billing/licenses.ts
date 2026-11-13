import "server-only";

import type { LicenseOrder } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { brand, formatMoney, licenseRenewalText, licenseTerms, offers, pricing } from "@/lib/brand";
import { isEmailConfigured, sendEmail } from "@/modules/notifications/email";
import { renderEmail } from "@/modules/notifications/templates";
import {
  createPreference,
  isMercadoPagoConfigured,
  searchPaymentsByReference,
  type Payment,
} from "./mercadopago";

/**
 * Compra de la licencia independiente (pago único por Mercado Pago).
 *
 * Igual que con las suscripciones, una orden solo pasa a "pagada" a partir
 * de un pago consultado a la API de Mercado Pago — nunca por lo que diga el
 * navegador al volver del checkout ni el cuerpo de un webhook.
 */

const REFERENCE_PREFIX = "license:";

export const licenseReference = (orderId: string) => `${REFERENCE_PREFIX}${orderId}`;

export const licenseOrderSchema = z.object({
  name: z.string().trim().min(2, "Ingresá tu nombre.").max(120),
  email: z.email("Ingresá un email válido.").trim().toLowerCase(),
  phone: z
    .string()
    .trim()
    .max(40)
    .optional()
    .transform((value) => value || undefined),
  businessName: z.string().trim().min(2, "Ingresá el nombre de tu negocio.").max(120),
});

export type LicenseOrderInput = z.infer<typeof licenseOrderSchema>;

export type CreateLicenseOrderResult = { ok: true; orderId: string; checkoutUrl: string } | { ok: false; error: string };

/** Crea la orden y el checkout de Mercado Pago. La orden queda pendiente. */
export async function createLicenseOrder(input: LicenseOrderInput): Promise<CreateLicenseOrderResult> {
  if (!isMercadoPagoConfigured()) {
    return { ok: false, error: "El pago online todavía no está habilitado. Escribinos y lo coordinamos." };
  }

  const order = await db.licenseOrder.create({
    data: { ...input, amount: pricing.oneTime, currency: pricing.currency },
  });

  try {
    const preference = await createPreference({
      externalReference: licenseReference(order.id),
      title: `${brand.name} — ${offers.license}`,
      amount: order.amount,
      currency: order.currency,
      payer: { email: order.email, name: order.name },
      returnUrl: `${brand.url}/licencia/orden/${order.id}`,
    });
    if (!preference.init_point) throw new Error("Mercado Pago no devolvió el enlace de pago.");

    await db.licenseOrder.update({ where: { id: order.id }, data: { providerPreferenceId: preference.id } });
    return { ok: true, orderId: order.id, checkoutUrl: preference.init_point };
  } catch (error) {
    console.error("[billing] no se pudo iniciar la compra de la licencia", order.id, error);
    // Sin checkout la orden no sirve: no se deja una pendiente huérfana.
    await db.licenseOrder.delete({ where: { id: order.id } }).catch(() => undefined);
    return { ok: false, error: "No pudimos conectar con Mercado Pago. Probá de nuevo en unos minutos." };
  }
}

async function notifyLicensePaid(order: LicenseOrder): Promise<void> {
  if (!isEmailConfigured()) {
    console.error("[billing] licencia pagada sin canal de email: avisar a mano al comprador", order.id);
    return;
  }
  const amount = formatMoney(order.amount, order.currency);
  const messages = [
    {
      to: order.email,
      subject: `Recibimos tu pago: ${offers.license} de ${brand.name}`,
      ...renderEmail({
        heading: "Recibimos tu pago",
        paragraphs: [
          `Hola ${order.name}, gracias por comprar la ${offers.license.toLowerCase()} de ${brand.name}.`,
          `Te vamos a escribir a este email para coordinar la instalación y la configuración de ${order.businessName}.`,
          licenseRenewalText(),
        ],
        details: [
          ["Compra", offers.license],
          ["Importe", amount],
          ["Incluye", `Instalación, configuración y ${licenseTerms.includedServiceMonths} meses de hosting, dominio y soporte`],
          ["Número de orden", order.id],
        ],
        footer: `Si tenés alguna duda, respondé a ${brand.contactEmail}.`,
      }),
    },
    {
      to: brand.contactEmail,
      subject: `Licencia vendida: ${order.businessName} (${amount})`,
      ...renderEmail({
        heading: "Se vendió una licencia",
        paragraphs: ["Mercado Pago confirmó el pago. Falta coordinar la instalación con el cliente."],
        details: [
          ["Negocio", order.businessName],
          ["Cliente", order.name],
          ["Email", order.email],
          ["Teléfono", order.phone ?? "—"],
          ["Importe", amount],
          ["Orden", order.id],
          ["Pago", order.providerPaymentId ?? "—"],
        ],
      }),
    },
  ];
  for (const message of messages) {
    const result = await sendEmail(message);
    if (!result.ok) console.error("[billing] no se pudo enviar el aviso de licencia a", message.to, result.error);
  }
}

/**
 * Lleva una orden al estado que indica un pago de Mercado Pago.
 *
 * Idempotente: el mismo pago aplicado dos veces no cambia nada ni repite
 * avisos (la transición a "pagada" es un UPDATE condicionado al estado).
 * Un pago que no es de una licencia de esta instalación se ignora.
 */
export async function applyLicensePayment(payment: Payment): Promise<"applied" | "ignored"> {
  const reference = payment.external_reference ?? "";
  if (!reference.startsWith(REFERENCE_PREFIX)) return "ignored";

  const order = await db.licenseOrder.findUnique({ where: { id: reference.slice(REFERENCE_PREFIX.length) } });
  if (!order) return "ignored";

  const paymentId = String(payment.id);

  if (payment.status === "approved") {
    if (payment.currency_id !== order.currency || (payment.transaction_amount ?? 0) < order.amount) {
      console.error("[billing] pago de licencia con importe o moneda inesperados", order.id, paymentId);
      return "ignored";
    }
    const approvedAt = payment.date_approved ? new Date(payment.date_approved) : new Date();
    // Un rechazo previo no impide que un intento posterior se apruebe.
    const updated = await db.licenseOrder.updateMany({
      where: { id: order.id, status: { in: ["pending", "rejected"] } },
      data: {
        status: "paid",
        providerPaymentId: paymentId,
        paidAt: Number.isNaN(approvedAt.getTime()) ? new Date() : approvedAt,
      },
    });
    if (updated.count === 0) return "ignored";

    await db.auditLog.create({
      data: { action: "license.paid", entityType: "license_order", entityId: order.id, metadata: { paymentId } },
    });
    await notifyLicensePaid({ ...order, status: "paid", providerPaymentId: paymentId });
    return "applied";
  }

  if (payment.status === "refunded" || payment.status === "charged_back") {
    const updated = await db.licenseOrder.updateMany({
      where: { id: order.id, status: "paid", providerPaymentId: paymentId },
      data: { status: "refunded" },
    });
    if (updated.count === 0) return "ignored";
    await db.auditLog.create({
      data: {
        action: "license.refunded",
        entityType: "license_order",
        entityId: order.id,
        metadata: { paymentId, providerStatus: payment.status },
      },
    });
    return "applied";
  }

  if (payment.status === "rejected" || payment.status === "cancelled") {
    const updated = await db.licenseOrder.updateMany({
      where: { id: order.id, status: "pending" },
      data: { status: "rejected" },
    });
    return updated.count === 0 ? "ignored" : "applied";
  }

  return "ignored"; // pending / in_process: todavía no hay nada que registrar
}

/** Consulta en Mercado Pago los pagos de una orden y aplica el que corresponda. */
export async function syncLicenseOrder(orderId: string): Promise<void> {
  if (!isMercadoPagoConfigured()) return;
  const payments = await searchPaymentsByReference(licenseReference(orderId));
  // Un pago aprobado manda sobre cualquier intento rechazado anterior.
  const relevant = payments.find((payment) => payment.status === "approved") ?? payments[0];
  if (relevant) await applyLicensePayment(relevant);
}

/** Red de seguridad frente a webhooks perdidos: órdenes recientes sin resolver. */
export async function reconcileLicenseOrders(limit = 10): Promise<{ checked: number; errors: number }> {
  const result = { checked: 0, errors: 0 };
  if (!isMercadoPagoConfigured()) return result;

  const now = Date.now();
  const open = await db.licenseOrder.findMany({
    where: {
      status: { in: ["pending", "rejected"] },
      createdAt: { gt: new Date(now - 3 * 24 * 3600000) },
      updatedAt: { lt: new Date(now - 30 * 60000) },
    },
    orderBy: { updatedAt: "asc" },
    take: limit,
    select: { id: true },
  });

  for (const order of open) {
    result.checked++;
    try {
      await syncLicenseOrder(order.id);
      // Marca la revisión aunque no haya habido cambios.
      await db.licenseOrder.update({ where: { id: order.id }, data: { updatedAt: new Date() } });
    } catch (error) {
      result.errors++;
      console.error("[billing] no se pudo reconciliar la orden de licencia", order.id, error);
    }
  }
  return result;
}
