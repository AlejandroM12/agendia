// Crea una orden de licencia desde la página pública (/licencia) del entorno local y muestra el enlace de pago de Checkout Pro.
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
import pg from "pg";
import { mp } from "./api.mjs";

const st = JSON.parse(readFileSync(".mp-sandbox/state.json", "utf8"));
const tier = process.argv[2] ?? "profesional";
const email = process.argv[3] ?? "mp-pro@agendia.test";
const db = new pg.Client({ connectionString: st.databaseUrl });
await db.connect();
await db.query('DELETE FROM "rate_limits"');
const browser = await chromium.launch();
const page = await (await browser.newContext({ baseURL: st.tunnelUrl, locale: "es-AR" })).newPage();
await page.goto(`/licencia?nivel=${tier}`);
await page.getByLabel("Tu nombre").fill("Cliente Licencia");
await page.getByLabel("Nombre de tu negocio").fill("Negocio Licencia Sandbox");
await page.getByLabel("Email", { exact: true }).fill(email);
await page.locator("input[name=acceptTerms]").check();
await page.locator("form button[type=submit]").last().click();
await page.waitForURL((u) => !u.href.startsWith(st.tunnelUrl), { timeout: 45000 }).catch(() => {});
console.log("destino:", new URL(page.url()).host + new URL(page.url()).pathname);
await browser.close();
const order = (await db.query('select id, status, tier, amount, currency, "providerPreferenceId" pref from license_orders order by "createdAt" desc limit 1')).rows[0];
console.log("orden local:", JSON.stringify({ ...order, pref: order.pref ? "<definida>" : null }));
const pref = await mp("GET", `/checkout/preferences/${order.pref}`);
console.log("preferencia en Mercado Pago: HTTP", pref.status, JSON.stringify({ items: pref.json.items?.map((i) => ({ title: i.title, unit_price: i.unit_price, currency_id: i.currency_id })), external_reference: pref.json.external_reference, sandbox_init_point: Boolean(pref.json.sandbox_init_point), init_point_host: pref.json.init_point && new URL(pref.json.init_point).host }));
console.log("ENLACE_PAGO:", pref.json.init_point);
await db.end();
