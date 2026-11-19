// Exploración: registra una cuenta en el entorno local, inicia la contratación y llega a la página de Mercado Pago.
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
import pg from "pg";
import { env } from "./api.mjs";

const state = JSON.parse(readFileSync(".mp-sandbox/state.json", "utf8"));
const email = process.argv[2] ?? "mp-pro@agendia.test";
const plan = process.argv[3] ?? "profesional";
const db = new pg.Client({ connectionString: state.databaseUrl });
await db.connect();
await db.query('DELETE FROM "rate_limits"');

const browser = await chromium.launch();
const ctx = await browser.newContext({ baseURL: state.tunnelUrl, locale: "es-AR" });
const page = await ctx.newPage();
await page.goto("/registro");
await page.getByLabel("Tu nombre").fill("Ana Prueba");
await page.getByLabel("Email").fill(email);
await page.getByLabel("Contraseña", { exact: true }).fill("Contrasena123");
await page.getByRole("button", { name: "Crear mi cuenta gratis" }).click();
await page.waitForURL(/onboarding/);
await page.getByLabel("¿Cómo se llama tu negocio?").fill(`Sandbox ${Date.now()}`);
await page.getByLabel("¿A qué te dedicás?").selectOption("otro");
await page.getByRole("button", { name: "Continuar" }).click();
await page.getByRole("heading", { name: "Tus servicios" }).waitFor();
await page.getByRole("button", { name: "Continuar" }).click();
await page.getByRole("heading", { name: "Tus horarios" }).waitFor();
await page.getByRole("button", { name: "Terminar y ver mi agenda" }).click();
await page.waitForURL(/dashboard/);
console.log("registrada:", email);

await page.goto(`/dashboard/facturacion/cambiar?plan=${plan}`);
console.log("página de contratación:", page.url().replace(state.tunnelUrl, ""));
await page.screenshot({ path: ".mp-sandbox/shots/01-contratar.png" });
await page.getByLabel("Email de tu cuenta de Mercado Pago").fill(env.MP_BUYER_EMAIL);
await page.locator("form button[type=submit]").last().click();
await page.waitForURL((u) => !u.href.startsWith(state.tunnelUrl), { timeout: 45000 }).catch(() => {});
console.log("destino:", new URL(page.url()).host + new URL(page.url()).pathname);
await page.waitForLoadState("domcontentloaded");
await page.screenshot({ path: ".mp-sandbox/shots/02-mercadopago.png" });
console.log("título:", await page.title());
console.log("texto visible:", (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 500));
const rows = await db.query('SELECT status, "providerSubscriptionId" IS NOT NULL AS has_mp, "contractedAmount" FROM subscriptions');
console.log("suscripciones locales:", JSON.stringify(rows.rows));
await browser.close();
await db.end();
