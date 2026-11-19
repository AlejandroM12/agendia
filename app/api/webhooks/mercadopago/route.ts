import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { verifyWebhookSignature } from "@/modules/billing/mercadopago";
import { processPaymentEvent } from "@/modules/billing/subscriptions";

function isUniqueViolation(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message} ${(error as { code?: string }).code ?? ""}` : String(error);
  return text.includes("P2002") || text.includes("23505") || /unique constraint/i.test(text);
}

/**
 * Registra el evento una sola vez. Mercado Pago puede entregar el mismo aviso varias veces y a la vez: con
 * `upsert` dos entregas simultáneas chocaban con la restricción única y una devolvía 500 sin cuerpo. Se crea y,
 * si otra entrega ya lo creó, se relee esa fila. Procesarlo dos veces es inofensivo (el estado sale siempre del
 * recurso consultado a la API y los cambios son idempotentes).
 */
async function registerEvent(data: { providerEventId: string; type: string; resourceId: string | null; payload: Prisma.InputJsonValue }) {
  try {
    return await db.paymentEvent.create({ data: { provider: "mercadopago", ...data } });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    return db.paymentEvent.findUniqueOrThrow({
      where: { provider_providerEventId: { provider: "mercadopago", providerEventId: data.providerEventId } },
    });
  }
}

/**
 * Webhook de Mercado Pago.
 *
 * 1. Valida la firma antes de hacer cualquier otra cosa (401 si no coincide).
 * 2. Registra el evento (único por id) antes de procesarlo: una entrega
 *    repetida de un evento ya procesado responde 200 sin repetir efectos.
 * 3. El estado real se consulta a la API de Mercado Pago; el cuerpo del
 *    webhook solo indica qué recurso cambió.
 * 4. Si el procesamiento falla responde 500, para que Mercado Pago reintente.
 */
export async function POST(request: Request) {
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  const url = new URL(request.url);
  const body = (await request.json().catch(() => null)) as {
    id?: number | string;
    type?: string;
    action?: string;
    data?: { id?: number | string };
  } | null;

  const dataId = url.searchParams.get("data.id") ?? (body?.data?.id != null ? String(body.data.id) : null);

  const valid = verifyWebhookSignature({
    signatureHeader: request.headers.get("x-signature"),
    requestId: request.headers.get("x-request-id"),
    dataId,
    secret,
  });
  if (!valid) return NextResponse.json({ error: "invalid_signature" }, { status: 401 });

  const type = String(body?.type ?? url.searchParams.get("type") ?? "unknown").slice(0, 80);
  const providerEventId = String(body?.id ?? `${type}:${dataId}:${body?.action ?? ""}`).slice(0, 190);

  const event = await registerEvent({
    providerEventId,
    type,
    resourceId: dataId,
    payload: (body ?? {}) as Prisma.InputJsonValue,
  });
  if (event.processedAt) return NextResponse.json({ ok: true, duplicate: true });

  try {
    await processPaymentEvent({ type: event.type, resourceId: event.resourceId });
    await db.paymentEvent.update({ where: { id: event.id }, data: { processedAt: new Date(), error: null } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    await db.paymentEvent.update({ where: { id: event.id }, data: { error: message.slice(0, 500) } });
    console.error("[webhook:mercadopago] error procesando evento", event.id, message);
    return NextResponse.json({ error: "processing_failed" }, { status: 500 });
  }
}
