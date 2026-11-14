// Captura las pantallas reales de Agendia (con los datos de seed-demo.mjs)
// y las guarda en marketing/lanzamiento/fuentes/capturas/.
//
//   node marketing/lanzamiento/fuentes/demo/capturar.mjs
//
// Requiere la app corriendo en DEMO_BASE_URL con la base local ya sembrada.

import { mkdirSync } from "node:fs";
import { chromium, devices } from "@playwright/test";

const BASE = process.env.DEMO_BASE_URL ?? "http://localhost:3100";
const OUT = "marketing/lanzamiento/fuentes/capturas";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const common = { locale: "es-AR", timezoneId: "America/Argentina/Buenos_Aires" };
const phone = { ...devices["Pixel 7"], viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, ...common };
const desktop = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, ...common };

async function login(context, email) {
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill("DemoAgendia2026");
  await page.getByRole("button", { name: "Ingresar" }).click();
  await page.waitForURL(/dashboard/);
  return page;
}
const settle = (page, ms = 700) => page.waitForTimeout(ms);
const shot = (page, name, options = {}) => page.screenshot({ path: `${OUT}/${name}.png`, ...options });

/* ---------- páginas públicas, como las ve un cliente en el celular ---------- */
for (const [slug, label] of [["mora-estetica", "mora"], ["navaja-barberia", "navaja"], ["kine-integral", "kine"]]) {
  const context = await browser.newContext(phone);
  const page = await context.newPage();
  await page.goto(`${BASE}/${slug}`);
  await settle(page, 1200);
  await shot(page, `publica-${label}-inicio`);
  if (label === "mora") {
    // Flujo de reserva paso a paso.
    await page.getByRole("button", { name: /Limpieza facial/ }).click();
    const slots = page.getByRole("radiogroup", { name: "Horario" }).getByRole("radio");
    await slots.first().waitFor();
    await settle(page, 900);
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, "reserva-1-servicio-horarios");
    await page.locator("[role=tab]:not([disabled])").nth(2).click();
    await slots.nth(3).click();
    await page.getByLabel("Nombre y apellido").fill("Lucía Fernández");
    await page.getByLabel("Email").fill("lucia.fernandez@example.com");
    await page.getByLabel("WhatsApp o teléfono").fill("370 400 0101");
    await settle(page, 800);
    await page.getByLabel("Nombre y apellido").scrollIntoViewIfNeeded();
    await page.evaluate(() => {
      const section = document.querySelector("#paso-datos");
      if (section) window.scrollTo(0, section.getBoundingClientRect().top + window.scrollY - 24);
    });
    await settle(page, 400);
    await shot(page, "reserva-2-datos");
    // Selección de día con horarios (sin ir a datos).
    await page.evaluate(() => {
      const section = document.querySelector("#paso-horario");
      if (section) window.scrollTo(0, section.getBoundingClientRect().top + window.scrollY - 24);
    });
    await settle(page, 400);
    await shot(page, "reserva-3-horarios");
  }
  await context.close();
}

/* ---------- panel de la estética ---------- */
const mobileContext = await browser.newContext(phone);
const mobile = await login(mobileContext, "demo-mora@example.com");
await mobile.goto(`${BASE}/dashboard`);
await settle(mobile, 1200);
await shot(mobile, "panel-hoy-movil");
await mobile.goto(`${BASE}/dashboard/agenda`);
await settle(mobile, 1000);
await shot(mobile, "agenda-movil");
await mobile.goto(`${BASE}/dashboard/clientes`);
await settle(mobile, 800);
await shot(mobile, "clientes-movil");
await mobileContext.close();

const desktopContext = await browser.newContext(desktop);
const page = await login(desktopContext, "demo-mora@example.com");
const monday = await page.evaluate(() => {
  const d = new Date(Date.now() + 2 * 86400000);
  return d.toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
});
await page.goto(`${BASE}/dashboard`);
await settle(page, 1200);
await shot(page, "panel-hoy-escritorio");
await page.goto(`${BASE}/dashboard/agenda?fecha=${monday}`);
await settle(page, 1200);
await shot(page, "agenda-escritorio");
await page.goto(`${BASE}/dashboard/turnos`);
await settle(page, 900);
await shot(page, "turnos-escritorio");
await page.goto(`${BASE}/dashboard/clientes`);
await settle(page, 900);
await shot(page, "clientes-escritorio");
await page.goto(`${BASE}/dashboard/pagina`);
await page.getByRole("img", { name: /Código QR/ }).waitFor();
await settle(page, 2500);
await shot(page, "pagina-editor-escritorio");
await page.locator("[data-testid=public-url]").first().scrollIntoViewIfNeeded();
await shot(page, "pagina-compartir", { clip: { x: 220, y: 70, width: 1000, height: 200 } });
await desktopContext.close();

await browser.close();
console.log("Capturas guardadas en " + OUT);
