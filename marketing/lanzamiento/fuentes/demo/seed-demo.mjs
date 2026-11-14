// Datos de demostración para las capturas de la campaña.
//
// Crea tres negocios ficticios (una estética, una barbería y un consultorio de
// kinesiología) en una base de datos LOCAL de desarrollo, usando la propia
// aplicación para registrarlos, configurarlos y subir su logo y portada, y SQL
// para cargar servicios, clientes y turnos de ejemplo.
//
// Requisitos: la app corriendo en DEMO_BASE_URL (por defecto
// http://localhost:3100), con ALLOW_REGISTRATION_WITHOUT_EMAIL=1, y
// DATABASE_URL apuntando a una base local. Se niega a correr contra
// cualquier otra base: nunca debe tocar producción.
//
//   node marketing/lanzamiento/fuentes/demo/seed-demo.mjs
//
// Todos los nombres, emails y teléfonos son inventados (emails @example.com).

import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { chromium } from "@playwright/test";
import pg from "pg";
import sharp from "sharp";

if (!process.env.DATABASE_URL && existsSync(".env.local")) {
  const { config } = await import("dotenv");
  config({ path: ".env.local", quiet: true });
}
const databaseUrl = process.env.DATABASE_URL ?? "";
const host = (() => {
  try {
    return new URL(databaseUrl).hostname;
  } catch {
    return "";
  }
})();
if (!["localhost", "127.0.0.1"].includes(host)) {
  console.error(`Rechazado: DATABASE_URL apunta a "${host || "(vacía)"}". Este script solo corre contra una base local.`);
  process.exit(1);
}

const BASE = process.env.DEMO_BASE_URL ?? "http://localhost:3100";
const PASSWORD = "DemoAgendia2026";

const db = new pg.Client({ connectionString: databaseUrl });
await db.connect();
const sql = (text, params = []) => db.query(text, params);

/* ---------- imágenes de demostración (generadas, sin fotos de personas) ---------- */

const svgPng = (svg, size) => sharp(Buffer.from(svg)).resize(size.w, size.h).png().toBuffer();
const svgJpg = (svg, size) => sharp(Buffer.from(svg)).resize(size.w, size.h).jpeg({ quality: 88 }).toBuffer();

const petals = Array.from({ length: 8 }, (_, i) => `<ellipse cx="300" cy="190" rx="52" ry="118" transform="rotate(${i * 45} 300 300)" fill="#fff" fill-opacity="${i % 2 ? 0.55 : 0.9}"/>`).join("");

const BUSINESSES = [
  {
    key: "mora",
    owner: "Valeria Mora",
    email: "demo-mora@example.com",
    name: "Mora Estética",
    industry: "unas",
    preset: /^Estética/,
    specialty: "Estética facial y corporal",
    description: "Tratamientos con turno previo, en un espacio tranquilo y con atención personalizada.",
    address: "Av. 25 de Mayo 450, Formosa",
    whatsapp: "370 400 0000",
    logo: await svgPng(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="#9d3f63"/>${petals}<circle cx="300" cy="300" r="46" fill="#e8b9a0"/></svg>`, { w: 600, h: 600 }),
    cover: await svgJpg(`<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="1000"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#f7e3d8"/><stop offset=".55" stop-color="#e3a8a0"/><stop offset="1" stop-color="#9d3f63"/></linearGradient></defs><rect width="2000" height="1000" fill="url(#g)"/><circle cx="1620" cy="230" r="360" fill="#fff" fill-opacity=".16"/><circle cx="1300" cy="760" r="220" fill="#fff" fill-opacity=".1"/><circle cx="260" cy="880" r="330" fill="#fff" fill-opacity=".12"/>${Array.from({ length: 9 }, (_, i) => `<path d="M-50 ${620 + i * 34} C 500 ${520 + i * 26}, 1100 ${760 + i * 18}, 2050 ${600 + i * 30}" stroke="#fff" stroke-opacity=".18" stroke-width="3" fill="none"/>`).join("")}</svg>`, { w: 2000, h: 1000 }),
    services: [
      ["Limpieza facial profunda", "Incluye limpieza, exfoliación y máscara hidratante.", 60, 18000],
      ["Manicura semipermanente", "Esmaltado de larga duración.", 60, 12000],
      ["Masaje descontracturante", "Para cuello, espalda y hombros.", 60, 15000],
      ["Perfilado de cejas", null, 30, 6000],
      ["Depilación definitiva · zona chica", "Sesión individual.", 30, 8000],
    ],
    rules: [[1, 540, 780], [1, 840, 1140], [2, 540, 780], [2, 840, 1140], [3, 540, 780], [3, 840, 1140], [4, 540, 780], [4, 840, 1140], [5, 540, 780], [5, 840, 1140], [6, 540, 780]],
  },
  {
    key: "navaja",
    owner: "Matías Ibarra",
    email: "demo-navaja@example.com",
    name: "Navaja Barbería",
    industry: "belleza",
    preset: /^Barbería/,
    specialty: "Barbería clásica",
    description: "Cortes, barba y afeitado a navaja. Reservá tu horario y llegá sin esperas.",
    address: "San Martín 780, Resistencia",
    whatsapp: "362 400 0000",
    logo: await svgPng(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="#1c1917"/><g fill="none" stroke="#c99a46" stroke-width="26" stroke-linecap="round"><circle cx="205" cy="415" r="58"/><circle cx="395" cy="415" r="58"/><path d="M243 368 L395 120"/><path d="M357 368 L205 120"/></g><circle cx="300" cy="262" r="20" fill="#c99a46"/></svg>`, { w: 600, h: 600 }),
    cover: await svgJpg(`<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="1000"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#2b2623"/><stop offset="1" stop-color="#4a3f36"/></linearGradient></defs><rect width="2000" height="1000" fill="url(#g)"/>${Array.from({ length: 16 }, (_, i) => `<path d="M${-200 + i * 170} 1000 L${300 + i * 170} 0" stroke="#c99a46" stroke-opacity="${i % 3 === 0 ? 0.5 : 0.18}" stroke-width="${i % 3 === 0 ? 10 : 4}"/>`).join("")}</svg>`, { w: 2000, h: 1000 }),
    services: [
      ["Corte clásico", "Tijera o máquina, con lavado.", 30, 9000],
      ["Corte + barba", "El combo completo.", 60, 14000],
      ["Perfilado de barba", null, 30, 6500],
      ["Afeitado a navaja", "Con toalla caliente.", 30, 8000],
    ],
    rules: [[2, 600, 1260], [3, 600, 1260], [4, 600, 1260], [5, 600, 1260], [6, 600, 1140]],
  },
  {
    key: "kine",
    owner: "Julieta Sosa",
    email: "demo-kine@example.com",
    name: "Kine Integral",
    industry: "salud",
    preset: /^Consultorio/,
    specialty: "Kinesiología y rehabilitación",
    description: "Atención con orden de profesionales, en consultorio.",
    address: "Mitre 320, Corrientes",
    whatsapp: "379 400 0000",
    logo: await svgPng(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="#1f5fa8"/><path d="M90 320 H210 L260 190 L340 430 L390 320 H510" fill="none" stroke="#fff" stroke-width="34" stroke-linecap="round" stroke-linejoin="round"/></svg>`, { w: 600, h: 600 }),
    cover: await svgJpg(`<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="1000"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#e5f1fb"/><stop offset=".6" stop-color="#7fb2de"/><stop offset="1" stop-color="#1f5fa8"/></linearGradient></defs><rect width="2000" height="1000" fill="url(#g)"/><circle cx="1500" cy="260" r="380" fill="#2a9d8f" fill-opacity=".28"/><circle cx="420" cy="860" r="300" fill="#fff" fill-opacity=".25"/></svg>`, { w: 2000, h: 1000 }),
    services: [
      ["Primera consulta", "Evaluación inicial.", 45, 16000],
      ["Sesión de kinesiología", null, 45, 12000],
      ["Rehabilitación deportiva", "Plan de trabajo individual.", 60, 15000],
    ],
    rules: [[1, 480, 720], [1, 840, 1080], [2, 480, 720], [2, 840, 1080], [3, 480, 720], [3, 840, 1080], [4, 480, 720], [4, 840, 1080], [5, 480, 720]],
  },
];

/* ---------- negocio: registro, onboarding y página pública, desde la propia app ---------- */

const browser = await chromium.launch();

async function createBusiness(cfg) {
  const existing = await sql("SELECT id FROM users WHERE email = $1", [cfg.email]);
  if (existing.rowCount) {
    console.log(`· ${cfg.name}: ya existe, se omite (borrá el usuario ${cfg.email} para recrearlo)`);
    return;
  }
  await sql('DELETE FROM rate_limits');
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "es-AR", timezoneId: "America/Argentina/Buenos_Aires" });
  const page = await context.newPage();

  await page.goto(`${BASE}/registro`);
  await page.getByLabel("Tu nombre").fill(cfg.owner);
  await page.getByLabel("Email").fill(cfg.email);
  await page.getByLabel("Contraseña", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Crear mi cuenta gratis" }).click();
  await page.waitForURL(/onboarding/);
  await page.getByLabel("¿Cómo se llama tu negocio?").fill(cfg.name);
  await page.getByLabel("¿A qué te dedicás?").selectOption(cfg.industry);
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByRole("heading", { name: "Tus servicios" }).waitFor();
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByRole("heading", { name: "Tus horarios" }).waitFor();
  await page.getByRole("button", { name: "Terminar y ver mi agenda" }).click();
  await page.waitForURL(/dashboard/);

  await page.goto(`${BASE}/dashboard/pagina`);
  await page.getByLabel("Especialidad o categoría").fill(cfg.specialty);
  await page.getByLabel("Descripción").fill(cfg.description);
  await page.getByLabel("Dirección").fill(cfg.address);
  await page.getByLabel("WhatsApp").fill(cfg.whatsapp);
  await page.getByRole("button", { name: cfg.preset }).click();
  await page.getByLabel("Elegir archivo: Logo").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: cfg.logo });
  await page.getByRole("img", { name: "Logo actual" }).waitFor();
  await page.getByLabel("Elegir archivo: Imagen de portada").setInputFiles({ name: "portada.jpg", mimeType: "image/jpeg", buffer: cfg.cover });
  await page.getByRole("img", { name: "Imagen de portada actual" }).waitFor();
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await page.getByText("Cambios guardados. Tu página ya está actualizada.").waitFor();
  await context.close();

  // Servicios y horarios de ejemplo (SQL: la interfaz solo ofrece los del rubro).
  const org = (await sql("SELECT m.\"organizationId\" AS id FROM memberships m JOIN users u ON u.id = m.\"userId\" WHERE u.email = $1", [cfg.email])).rows[0].id;
  await sql('DELETE FROM services WHERE "organizationId" = $1', [org]);
  let order = 0;
  for (const [name, description, minutes, price] of cfg.services) {
    await sql(
      `INSERT INTO services (id, "organizationId", name, description, "durationMinutes", price, active, "sortOrder", "updatedAt") VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, true, $6, now())`,
      [org, name, description, minutes, price, order++],
    );
  }
  await sql('DELETE FROM availability_rules WHERE "organizationId" = $1', [org]);
  for (const [weekday, start, end] of cfg.rules) {
    await sql(`INSERT INTO availability_rules (id, "organizationId", weekday, "startMinute", "endMinute") VALUES (gen_random_uuid(), $1, $2, $3, $4)`, [org, weekday, start, end]);
  }
  await sql('UPDATE organizations SET "minNoticeMinutes" = 60, "maxAdvanceDays" = 60 WHERE id = $1', [org]);
  console.log(`· ${cfg.name}: creado (${org})`);
}

for (const cfg of BUSINESSES) await createBusiness(cfg);
await browser.close();

/* ---------- clientes y turnos de ejemplo para la estética ---------- */

const mora = (await sql(`SELECT o.id, o.slug FROM organizations o JOIN memberships m ON m."organizationId" = o.id JOIN users u ON u.id = m."userId" WHERE u.email = 'demo-mora@example.com'`)).rows[0];
const already = await sql('SELECT count(*)::int AS n FROM appointments WHERE "organizationId" = $1', [mora.id]);
if (already.rows[0].n > 0) {
  console.log("· Mora Estética: ya tiene turnos de ejemplo, se omiten");
} else {
  const professional = (await sql('SELECT id FROM professionals WHERE "organizationId" = $1 LIMIT 1', [mora.id])).rows[0].id;
  const services = Object.fromEntries((await sql('SELECT id, name, "durationMinutes" AS minutes, price FROM services WHERE "organizationId" = $1', [mora.id])).rows.map((s) => [s.name, s]));

  const customers = [
    ["Lucía Fernández", "lucia.fernandez@example.com", "3704000101"],
    ["Carolina Benítez", "carolina.benitez@example.com", "3704000102"],
    ["Sofía Ramírez", "sofia.ramirez@example.com", "3704000103"],
    ["Agustina Acosta", "agustina.acosta@example.com", "3704000104"],
    ["Mariana Giménez", "mariana.gimenez@example.com", "3704000105"],
    ["Florencia Sosa", "florencia.sosa@example.com", "3704000106"],
    ["Julieta Romero", "julieta.romero@example.com", "3704000107"],
    ["Camila Duarte", "camila.duarte@example.com", "3704000108"],
    ["Paula Villalba", "paula.villalba@example.com", "3704000109"],
    ["Natalia Escobar", "natalia.escobar@example.com", "3704000110"],
    ["Daniela Cabrera", null, "3704000111"],
    ["Romina Aguirre", "romina.aguirre@example.com", null],
    ["Belén Maidana", "belen.maidana@example.com", "3704000113"],
    ["Rocío Medina", "rocio.medina@example.com", "3704000114"],
  ];
  const customerId = {};
  for (const [name, email, phone] of customers) {
    customerId[name] = (await sql(
      `INSERT INTO customers (id, "organizationId", name, email, phone, "updatedAt") VALUES (gen_random_uuid(), $1, $2, $3, $4, now()) RETURNING id`,
      [mora.id, name, email, phone],
    )).rows[0].id;
  }

  const ymd = (d) => d.toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
  const day = (offset) => ymd(new Date(Date.now() + offset * 86400000));
  const at = (offset, hh, mm) => new Date(`${day(offset)}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00-03:00`);

  // [día relativo a hoy, hora, minutos, cliente, servicio, estado]
  const plan = [
    // Hoy (sábado): mañana atendida, tarde por delante.
    [0, 9, 0, "Natalia Escobar", "Manicura semipermanente", "completed"],
    [0, 10, 15, "Camila Duarte", "Limpieza facial profunda", "completed"],
    [0, 11, 30, "Paula Villalba", "Perfilado de cejas", "completed"],
    [0, 15, 30, "Lucía Fernández", "Limpieza facial profunda", "confirmed"],
    [0, 16, 45, "Carolina Benítez", "Manicura semipermanente", "confirmed"],
    [0, 17, 45, "Rocío Medina", "Masaje descontracturante", "confirmed"],
    // Lunes: día completo, para la vista de agenda.
    [2, 9, 0, "Sofía Ramírez", "Perfilado de cejas", "confirmed"],
    [2, 9, 45, "Agustina Acosta", "Masaje descontracturante", "confirmed"],
    [2, 11, 0, "Mariana Giménez", "Depilación definitiva · zona chica", "confirmed"],
    [2, 11, 45, "Belén Maidana", "Manicura semipermanente", "confirmed"],
    [2, 14, 0, "Florencia Sosa", "Limpieza facial profunda", "confirmed"],
    [2, 15, 15, "Julieta Romero", "Manicura semipermanente", "confirmed"],
    [2, 16, 30, "Romina Aguirre", "Perfilado de cejas", "confirmed"],
    [2, 17, 15, "Daniela Cabrera", "Masaje descontracturante", "confirmed"],
    // Martes y miércoles, más livianos.
    [3, 10, 0, "Lucía Fernández", "Masaje descontracturante", "confirmed"],
    [3, 15, 0, "Camila Duarte", "Perfilado de cejas", "confirmed"],
    [4, 9, 30, "Carolina Benítez", "Limpieza facial profunda", "confirmed"],
    [4, 16, 0, "Paula Villalba", "Manicura semipermanente", "confirmed"],
    // Historial de la semana pasada.
    [-3, 10, 0, "Lucía Fernández", "Limpieza facial profunda", "completed"],
    [-5, 15, 0, "Carolina Benítez", "Manicura semipermanente", "completed"],
    [-6, 11, 0, "Sofía Ramírez", "Perfilado de cejas", "completed"],
    [-9, 10, 30, "Lucía Fernández", "Masaje descontracturante", "completed"],
    [-12, 16, 0, "Agustina Acosta", "Manicura semipermanente", "no_show"],
  ];
  for (const [offset, hh, mm, customer, service, status] of plan) {
    const s = services[service];
    const starts = at(offset, hh, mm);
    const ends = new Date(starts.getTime() + s.minutes * 60000);
    await sql(
      `INSERT INTO appointments (id, "organizationId", "professionalId", "serviceId", "customerId", "startsAt", "endsAt", status, source, "manageToken", price, "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())`,
      // ISO en texto: node-pg serializa un Date en hora local y la columna guarda UTC sin zona.
      [mora.id, professional, s.id, customerId[customer], starts.toISOString(), ends.toISOString(), status, offset % 2 === 0 ? "public_booking" : "manual", randomBytes(24).toString("base64url"), s.price],
    );
  }
  console.log(`· Mora Estética: ${customers.length} clientes y ${plan.length} turnos de ejemplo`);
}

await db.end();
console.log("Listo. Cuentas de demostración (contraseña " + PASSWORD + "): " + BUSINESSES.map((b) => b.email).join(", "));
