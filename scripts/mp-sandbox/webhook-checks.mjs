// Prueba el webhook local con eventos FIRMADOS con el secreto real, sobre la suscripción pendiente que existe en la base.
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { env } from "./api.mjs";

const st = JSON.parse(readFileSync(".mp-sandbox/state.json", "utf8"));
const db = new pg.Client({ connectionString: st.databaseUrl });
await db.connect();
const sub = (await db.query('select id, "providerSubscriptionId" mp, status from subscriptions order by "createdAt" desc limit 1')).rows[0];

function signed(dataId, { ts = Math.floor(Date.now() / 1000), secret = env.MERCADOPAGO_WEBHOOK_SECRET } = {}) {
  const requestId = randomUUID();
  const v1 = createHmac("sha256", secret).update(`id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`).digest("hex");
  return { "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": requestId, "content-type": "application/json" };
}
async function send(eventId, type, dataId, headers) {
  const r = await fetch(`http://127.0.0.1:${st.proxyPort}/api/webhooks/mercadopago?data.id=${dataId}&type=${type}`, {
    method: "POST", headers, body: JSON.stringify({ id: eventId, type, action: "updated", data: { id: dataId } }),
  });
  return `${r.status} ${(await r.text()).slice(0, 60)}`;
}
const out = {};
const e1 = Date.now();
out["firma válida, evento nuevo"] = await send(e1, "subscription_preapproval", sub.mp, signed(sub.mp));
out["mismo evento repetido"] = await send(e1, "subscription_preapproval", sub.mp, signed(sub.mp));
out["firma con secreto equivocado"] = await send(e1 + 1, "subscription_preapproval", sub.mp, signed(sub.mp, { secret: "otro-secreto" }));
out["firma vieja (>10 min)"] = await send(e1 + 2, "subscription_preapproval", sub.mp, signed(sub.mp, { ts: Math.floor(Date.now() / 1000) - 3600 }));
out["sin firma"] = await send(e1 + 3, "subscription_preapproval", sub.mp, { "content-type": "application/json" });
const e2 = e1 + 10;
const burst = await Promise.all(Array.from({ length: 8 }, () => send(e2, "subscription_preapproval", sub.mp, signed(sub.mp))));
out["8 entregas simultáneas del mismo evento"] = burst.reduce((a, r) => ({ ...a, [r]: (a[r] ?? 0) + 1 }), {});
console.log(JSON.stringify(out, null, 1));
const rows = await db.query('select "providerEventId", type, "processedAt" is not null as processed, error from payment_events order by "providerEventId"');
console.log("eventos guardados:", JSON.stringify(rows.rows));
console.log("estado local:", (await db.query('select status from subscriptions where id=$1', [sub.id])).rows[0].status);
await db.end();
