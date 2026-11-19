import { NextResponse } from "next/server";
import { processWebhook, verifyHandshake } from "@/modules/whatsapp/webhook";

/**
 * Webhook de la WhatsApp Cloud API (una sola URL para todos los negocios).
 *  - GET: verificación inicial de Meta (token que se carga al configurar el webhook).
 *  - POST: estados de entrega y respuestas; la firma `X-Hub-Signature-256` se valida con el secreto de la aplicación de
 *    Meta del negocio al que pertenece el número (modules/whatsapp/webhook.ts). Un fallo de procesamiento responde 500
 *    para que Meta reintente (hasta 7 días); los reenvíos son inofensivos (idempotente).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const challenge = await verifyHandshake({
    mode: url.searchParams.get("hub.mode"),
    token: url.searchParams.get("hub.verify_token"),
    challenge: url.searchParams.get("hub.challenge"),
  });
  if (challenge === null) return new NextResponse("forbidden", { status: 403 });
  return new NextResponse(challenge, { status: 200, headers: { "content-type": "text/plain" } });
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  try {
    const result = await processWebhook(rawBody, request.headers.get("x-hub-signature-256"));
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error("[webhook:whatsapp] error procesando el evento", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "processing_failed" }, { status: 500 });
  }
}
