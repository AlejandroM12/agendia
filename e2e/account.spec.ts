import { expect, test, type Page } from "@playwright/test";
import { config } from "dotenv";
import pg from "pg";

config({ path: ".env.local" });

async function sql(query: string, params: unknown[]) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await client.query(query, params);
  } finally {
    await client.end();
  }
}

async function registerAndOnboard(page: Page, email: string, business: string) {
  await page.goto("/registro");
  await page.getByLabel("Tu nombre").fill("Ana Prueba");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Contraseña").fill("Contrasena123");
  await page.getByRole("button", { name: "Empezar gratis" }).click();
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByLabel("¿Cómo se llama tu negocio?").fill(business);
  await page.getByLabel("¿A qué te dedicás?").selectOption("otro");
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByRole("heading", { name: "Tus servicios" })).toBeVisible();
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByRole("heading", { name: "Tus horarios" })).toBeVisible();
  await page.getByRole("button", { name: "Terminar y ver mi agenda" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test("prueba vencida: la cuenta queda en solo lectura y la página pública deja de tomar reservas", async ({ page, browser }) => {
  const suffix = `${test.info().project.name}-${Date.now()}`;
  const email = `e2e-trial-${suffix}@example.com`;
  await registerAndOnboard(page, email, `Vencida E2E ${suffix}`);

  await page.goto("/dashboard/configuracion");
  const slug = await page.locator("#slug").inputValue();

  // Se simula el paso del tiempo: la prueba venció ayer.
  await sql(
    `UPDATE organizations SET "trialEndsAt" = now() - interval '1 day'
     WHERE id IN (SELECT m."organizationId" FROM memberships m JOIN users u ON u.id = m."userId" WHERE u.email = $1)`,
    [email],
  );

  // El estado se recalcula en el servidor al entrar: aviso + sin alta de turnos.
  await page.goto("/dashboard");
  await expect(page.getByText("Tu prueba gratuita terminó.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Nuevo turno" })).toHaveCount(0);

  // Aunque se fuerce la URL, el servidor no deja crear turnos.
  await page.goto("/dashboard/turnos/nuevo");
  await expect(page).toHaveURL(/\/dashboard\/facturacion/);
  await expect(page.getByText("Tu prueba gratuita terminó", { exact: true })).toBeVisible();

  // Los datos siguen accesibles en modo lectura.
  await page.goto("/dashboard/servicios");
  await expect(page.getByText("Turno", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Nuevo servicio" })).toHaveCount(0);

  // La página pública existe, pero no ofrece reservas.
  const guest = await (await browser.newContext()).newPage();
  await guest.goto(`/${slug}`);
  await expect(guest.getByText("Reservas online no disponibles")).toBeVisible();
  await guest.context().close();
});

test("cambiar la contraseña cierra la sesión y la anterior deja de servir", async ({ page }) => {
  const suffix = `${test.info().project.name}-${Date.now()}`;
  const email = `e2e-pass-${suffix}@example.com`;
  await registerAndOnboard(page, email, `Clave E2E ${suffix}`);

  await page.goto("/dashboard/configuracion");
  await page.getByLabel("Contraseña actual").fill("Contrasena123");
  await page.getByLabel("Contraseña nueva").fill("OtraContrasena456");
  await page.getByRole("button", { name: "Cambiar contraseña" }).click();
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: "Hola de nuevo" })).toBeVisible();

  const login = async (password: string) => {
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Contraseña", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Ingresar" }).click();
  };

  await login("Contrasena123");
  await expect(page.getByText("Email o contraseña incorrectos.")).toBeVisible();

  await login("OtraContrasena456");
  await expect(page).toHaveURL(/\/dashboard/);
});
