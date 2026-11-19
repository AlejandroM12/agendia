// Envía al webhook local un evento FIRMADO con el secreto real. Uso: send-event.mjs <tipo> <id-del-recurso> [veces]
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { env } from "./api.mjs";
const st = JSON.parse(readFileSync(".mp-sandbox/state.json", "utf8"));
const [type, dataId, times = "1"] = process.argv.slice(2);
const eventId = process.argv[5] ?? String(Date.now());
async function once() {
  const ts = Math.floor(Date.now() / 1000);
  const requestId = randomUUID();
  const v1 = createHmac("sha256", env.MERCADOPAGO_WEBHOOK_SECRET).update(`id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`).digest("hex");
  const r = await fetch(`http://127.0.0.1:${st.proxyPort}/api/webhooks/mercadopago?data.id=${dataId}&type=${type}`, {
    method: "POST",
    headers: { "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": requestId, "content-type": "application/json" },
    body: JSON.stringify({ id: eventId, type, action: "created", data: { id: dataId } }),
  });
  return `${r.status} ${(await r.text()).slice(0, 80)}`;
}
const results = await Promise.all(Array.from({ length: Number(times) }, once));
console.log(JSON.stringify(results.reduce((a, r) => ({ ...a, [r]: (a[r] ?? 0) + 1 }), {})));
