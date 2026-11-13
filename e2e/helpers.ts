import { expect, type Page } from "@playwright/test";
import { config } from "dotenv";
import pg from "pg";

config({ path: ".env.local", quiet: true });

/** Consulta directa a la base local, para simular lo que no se puede hacer desde la interfaz. */
export async function sql(query: string, params: unknown[] = []) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await client.query(query, params);
  } finally {
    await client.end();
  }
}

/**
 * Las pruebas registran muchas cuentas desde la misma IP: se vacían los
 * contadores para no chocar con los límites reales, que siguen activos.
 */
export const resetRateLimits = () => sql('DELETE FROM "rate_limits"');

export async function registerAndOnboard(page: Page, email: string, business: string) {
  await resetRateLimits();
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
  await page.getByRole("checkbox", { name: "sábado" }).check();
  await page.getByRole("checkbox", { name: "domingo" }).check();
  await page.getByRole("button", { name: "Terminar y ver mi agenda" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}
