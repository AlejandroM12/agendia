// Inicia un cambio de plan (o una contratación) desde la interfaz local y muestra el enlace de autorización de Mercado Pago.
// Uso: change-plan.mjs <email> <profesional|equipo> <ahora|periodo>
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
import pg from "pg";
import { env, mp } from "./api.mjs";

const st = JSON.parse(readFileSync(".mp-sandbox/state.json", "utf8"));
const [email, plan, when = "periodo"] = process.argv.slice(2);
const db = new pg.Client({ connectionString: st.databaseUrl });
await db.connect();
await db.query('DELETE FROM "rate_limits"');
const browser = await chromium.launch();
const page = await (await browser.newContext({ baseURL: st.tunnelUrl, locale: "es-AR" })).newPage();
await page.goto("/login");
await page.getByLabel("Email").fill(email);
await page.getByLabel("Contraseña", { exact: true }).fill("Contrasena123");
await page.getByRole("button", { name: "Ingresar" }).click();
await page.waitForURL(/dashboard|onboarding/);
await page.goto(`/dashboard/facturacion/cambiar?plan=${plan}${when === "ahora" ? "&cuando=ahora" : ""}`);
console.log("pantalla:", (await page.locator("h1").first().innerText()).slice(0, 90));
await page.getByLabel("Email de tu cuenta de Mercado Pago").fill(env.MP_BUYER_EMAIL);
await page.locator("form button[type=submit]").last().click();
await page.waitForURL((u) => !u.href.startsWith(st.tunnelUrl), { timeout: 45000 }).catch(() => {});
await browser.close();
const row = (await db.query(`select s."pendingProviderSubscriptionId" pend, s."providerSubscriptionId" cur, s."pendingKind" kind from subscriptions s
  join memberships m on m."organizationId"=s."organizationId" join users u on u.id=m."userId" where u.email=$1`, [email])).rows[0];
const id = row?.pend ?? row?.cur;
const remote = (await mp("GET", `/preapproval/${id}`)).json;
console.log(`${email}: ${row?.pend ? "cambio pendiente (" + row.kind + ")" : "suscripción nueva"} | MP=${remote.status} importe=${remote.auto_recurring?.transaction_amount} inicio=${remote.auto_recurring?.start_date}`);
console.log("ENLACE:", remote.init_point);
await db.end();
