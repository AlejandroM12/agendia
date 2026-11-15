// Prueba una instalación independiente (licencia) completa, en una base y un puerto LOCALES y descartables.
//
//   node scripts/check-standalone-install.mjs            # ambos niveles (profesional y equipo)
//   node scripts/check-standalone-install.mjs equipo     # uno solo
//
// Requiere la build hecha (`npm run build`). Crea una base nueva en el PostgreSQL local, la migra, arranca la
// aplicación con DEPLOYMENT_MODE=standalone y el LICENSE_TIER indicado, recorre la instalación con un
// navegador real (primera cuenta, onboarding, alta de profesionales hasta el tope de la licencia) y verifica
// lo que una licencia NO debe tener (precios, panel de plataforma, «Mi plan», un segundo registro, enlaces de
// invitación sin correo). Después borra la base y detiene el servidor. No toca la base de desarrollo, no usa
// servicios externos, no crea servidores ni dominios.

import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "@playwright/test";
import pg from "pg";

if (!process.env.DATABASE_URL && existsSync(".env.local")) {
  const { config } = await import("dotenv");
  config({ path: ".env.local", quiet: true });
}
const base = process.env.DATABASE_URL ?? "";
const host = (() => {
  try {
    return new URL(base).hostname;
  } catch {
    return "";
  }
})();
if (!["localhost", "127.0.0.1"].includes(host)) {
  console.error(`Rechazado: DATABASE_URL apunta a "${host || "(vacía)"}". Solo corre contra una base local.`);
  process.exit(1);
}
if (!existsSync(".next/BUILD_ID")) {
  console.error("Falta la build: corré `npm run build` primero.");
  process.exit(1);
}

const withDb = (name) => {
  const url = new URL(base);
  url.pathname = `/${name}`;
  return url.toString();
};
const PORT = Number(process.env.STANDALONE_CHECK_PORT ?? 3121);
const results = [];
const check = (ok, label, detail = "") => {
  results.push({ ok, label, detail });
  console.log(`${ok ? "  ✔" : "  ✘"} ${label}${detail ? ` — ${detail}` : ""}`);
};

async function runTier(tier, expectedLimit) {
  console.log(`\n== Licencia ${tier} (hasta ${expectedLimit} profesionales activos) ==`);
  const name = `agendia_standalone_${tier}_${randomBytes(3).toString("hex")}`;
  const admin = new pg.Client({ connectionString: withDb("postgres") });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: withDb(name) }, stdio: "ignore" });

  const origin = `http://localhost:${PORT}`;
  const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(PORT)], {
    stdio: "ignore",
    env: {
      ...process.env,
      DATABASE_URL: withDb(name),
      DEPLOYMENT_MODE: "standalone",
      LICENSE_TIER: tier,
      AUTH_URL: origin,
      APP_URL: origin,
      AUTH_SECRET: randomBytes(24).toString("hex"),
      ALLOW_REGISTRATION_WITHOUT_EMAIL: "1",
      // Nada de claves de prueba: sin correo, sin Mercado Pago, sin interruptores de equipo.
      RESEND_API_KEY: "",
      MERCADOPAGO_ACCESS_TOKEN: "",
      TEAM_MODE_ENABLED: "",
      TEAM_ACCOUNTS_ENABLED: "",
      PUBLISH_TEAM_PLANS: "",
      ALLOW_INVITATIONS_WITHOUT_EMAIL: "1", // aun así, una licencia nunca muestra el enlace
    },
  });
  let browser;
  try {
    for (let i = 0; i < 90; i++) {
      try {
        if ((await fetch(`${origin}/api/health`)).ok) break;
      } catch {
        /* todavía no */
      }
      await sleep(1000);
    }
    const status = async (path) => (await fetch(`${origin}${path}`, { redirect: "manual" })).status;
    check((await status("/api/health")) === 200, "la aplicación arranca y responde /api/health");
    check([307, 308].includes(await status("/precios")), "no hay página de precios del SaaS (/precios redirige al ingreso)");
    check([307, 308].includes(await status("/licencia")), "no se venden licencias desde la instalación (/licencia redirige al ingreso)");
    check([307, 308, 302, 404].includes(await status("/admin")) && (await status("/admin")) !== 200, "no hay panel de plataforma (/admin no responde 200)");
    check((await status("/registro")) === 200, "el registro de la primera cuenta está abierto");

    browser = await chromium.launch();
    const context = await browser.newContext({ baseURL: origin, locale: "es-AR" });
    const page = await context.newPage();

    await page.goto("/registro");
    await page.getByLabel("Tu nombre").fill("Dueña Licencia");
    await page.getByLabel("Email").fill("duena@example.com");
    await page.getByLabel("Contraseña", { exact: true }).fill("Contrasena123");
    await page.getByRole("button", { name: "Crear mi cuenta" }).click();
    await page.waitForURL(/\/onboarding/, { timeout: 30000 });
    check(true, "la primera cuenta se crea y entra al onboarding");
    check((await page.getByText(/días de prueba|prueba gratuita/i).count()) === 0, "no se habla de prueba gratuita en una licencia");

    await page.getByLabel("¿Cómo se llama tu negocio?").fill("Estudio Licencia");
    await page.getByLabel("¿A qué te dedicás?").selectOption("otro");
    check(await page.getByTestId("work-mode").isVisible(), "el onboarding pregunta «¿Cómo trabajás?» (la licencia incluye equipos)");
    await page.getByLabel("Trabajo con otras personas").check();
    await page.getByRole("button", { name: "Continuar" }).click();
    await page.getByRole("button", { name: "Completar más tarde" }).click();
    await page.getByRole("heading", { name: "Tus servicios" }).waitFor();
    await page.getByRole("button", { name: "Continuar" }).click();
    await page.getByRole("button", { name: "Terminar y ver mi agenda" }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 30000 });
    check(true, "el onboarding termina y abre la agenda");

    const billing = await page.goto("/dashboard/facturacion");
    check(billing?.status() === 404 || (await page.getByText("No encontramos esta página").count()) > 0, "no existe «Mi plan» (sin suscripción en una licencia)");
    await page.goto("/dashboard/mas");
    check((await page.getByRole("link", { name: /Mi plan/ }).count()) === 0, "el menú no ofrece «Mi plan»");

    // Alta de profesionales hasta el tope del nivel.
    let created = 0;
    for (let n = 2; n <= expectedLimit; n++) {
      await page.goto("/dashboard/equipo/nuevo");
      await page.getByLabel("Nombre", { exact: true }).fill(`Profesional ${n}`);
      await page.getByRole("button", { name: "Crear profesional" }).click();
      await page.waitForURL(/\/dashboard\/equipo\/[0-9a-f-]{36}$/, { timeout: 30000 });
      created++;
    }
    check(created === expectedLimit - 1, `se pudieron dar de alta ${expectedLimit} profesionales activos en total`);
    await page.goto("/dashboard/equipo/nuevo");
    check((await page.getByText("Ya usás todos los cupos").count()) > 0, `el profesional ${expectedLimit + 1} se rechaza: tope de la licencia`);
    await page.goto("/dashboard/equipo");
    const quotaText = await page.getByTestId("team-quota").innerText();
    check(quotaText.includes(`Usás ${expectedLimit} de ${expectedLimit}`), `el cupo informado es ${expectedLimit}`, quotaText.split("\n")[0]);

    // Invitaciones: sin correo configurado, una licencia nunca muestra el enlace en pantalla.
    await page.goto("/dashboard/equipo/accesos");
    check((await page.locator('a[href^="/invitacion/"], :text("/invitacion/")').count()) === 0, "no se muestra ningún enlace de invitación sin el flujo de correo");

    // Un segundo registro está cerrado.
    const second = await context.newPage();
    const other = await browser.newContext({ baseURL: origin });
    const registro = await other.newPage();
    await registro.goto("/registro");
    check((await registro.getByText("Registro cerrado").count()) > 0, "el registro queda cerrado después de la primera cuenta");
    await other.close();
    await second.close();

    const db = new pg.Client({ connectionString: withDb(name) });
    await db.connect();
    const counts = (await db.query(`SELECT (SELECT count(*) FROM subscriptions)::int AS subs, (SELECT count(*) FROM license_orders)::int AS orders, (SELECT count(*) FROM professionals WHERE active)::int AS pros`)).rows[0];
    await db.end();
    check(counts.subs === 0 && counts.orders === 0, "no hay suscripciones ni órdenes de licencia: no depende de Agendia SaaS", JSON.stringify(counts));
    check(counts.pros === expectedLimit, "la base tiene exactamente los profesionales activos permitidos");
  } finally {
    await browser?.close();
    server.kill();
    await sleep(1500);
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`).catch(() => undefined);
    await admin.end();
  }
}

const requested = process.argv[2];
try {
  if (!requested || requested === "profesional") await runTier("profesional", 2);
  if (!requested || requested === "equipo") await runTier("equipo", 5);
} catch (error) {
  check(false, "la verificación se interrumpió", error instanceof Error ? error.message.split("\n")[0] : String(error));
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} comprobaciones correctas.`);
process.exit(failed.length === 0 ? 0 : 1);
