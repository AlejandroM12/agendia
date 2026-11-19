// Estado del entorno local de pruebas: suscripciones, órdenes de licencia y eventos de pago (sin datos personales ni credenciales).
import { readFileSync } from "node:fs";
import pg from "pg";
import { mp } from "./api.mjs";

const st = JSON.parse(readFileSync(".mp-sandbox/state.json", "utf8"));
const db = new pg.Client({ connectionString: st.databaseUrl });
await db.connect();
const subs = (await db.query(`select u.email, o.status org, s.status sub, s."contractedAmount" amount, s."lastPaymentAt" is not null as paid,
   s."pendingKind" pending, p.code plan, s."providerSubscriptionId" mp
   from subscriptions s join organizations o on o.id=s."organizationId" join plans p on p.id=s."planId"
   join memberships m on m."organizationId"=o.id join users u on u.id=m."userId" order by s."createdAt"`)).rows;
for (const s of subs) {
  const remote = (await mp("GET", `/preapproval/${s.mp}`)).json;
  console.log(`${s.email.padEnd(24)} org=${s.org.padEnd(8)} sub=${s.sub.padEnd(9)} plan=${s.plan.padEnd(8)} pagó=${String(s.paid).padEnd(5)} MP=${remote.status} cobros=${remote.summarized?.charged_quantity ?? "-"} pendiente=${s.pending ?? "-"}`);
}
const orders = (await db.query('select status, tier, amount, "paidAt" is not null as paid from license_orders order by "createdAt"')).rows;
console.log("licencias:", JSON.stringify(orders));
const ev = (await db.query("select type, count(*)::int n, count(processed_at)::int ok from (select type, \"processedAt\" processed_at from payment_events) t group by type order by type")).rows;
console.log("eventos:", JSON.stringify(ev));
const bad = (await db.query('select type, error from payment_events where "processedAt" is null')).rows;
if (bad.length) console.log("sin procesar:", JSON.stringify(bad.map((b) => ({ type: b.type, error: String(b.error).slice(0, 100) }))));
await db.end();
