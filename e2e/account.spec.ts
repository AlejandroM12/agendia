import { expect, test } from "@playwright/test";
import { registerAndOnboard, sql } from "./helpers";

test("prueba vencida: la cuenta queda en solo lectura y la página pública deja de tomar reservas", async ({ page, browser }) => {
  const suffix = `${test.info().project.name}-${Date.now()}`;
  const email = `e2e-trial-${suffix}@example.com`;
  await registerAndOnboard(page, email, `Vencida E2E ${suffix}`);

  await page.goto("/dashboard/pagina");
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
