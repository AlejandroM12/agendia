import { expect, test } from "@playwright/test";
import { registerAndOnboard, sql } from "./helpers";

/**
 * Con la prueba vencida el negocio queda en solo lectura (no crea turnos), pero la pantalla de planes sigue siendo
 * accesible y ofrece cómo contratar. En estos servidores Mercado Pago no está configurado, así que la alternativa es
 * el contacto; los botones de pago con Mercado Pago configurado se cubren en test/billing-pages.test.ts.
 */
test("prueba vencida: el negocio queda en solo lectura pero «Mi plan» ofrece cómo contratar; una cuenta suspendida no", async ({ page }) => {
  const suffix = `${test.info().project.name}-${Date.now()}`;
  const email = `e2e-billing-${suffix}@example.com`;
  await registerAndOnboard(page, email, `Contratar E2E ${suffix}`);
  const orgOf = `(SELECT m."organizationId" FROM memberships m JOIN users u ON u.id = m."userId" WHERE u.email = $1)`;

  await sql(`UPDATE organizations SET "trialEndsAt" = now() - interval '1 day' WHERE id IN ${orgOf}`, [email]);

  // Lo operativo sigue bloqueado.
  await page.goto("/dashboard");
  await expect(page.getByText("Tu prueba gratuita terminó.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Nuevo turno" })).toHaveCount(0);

  // Pero se puede ver cómo contratar.
  await page.getByRole("link", { name: "Ver mi plan" }).first().click();
  await expect(page).toHaveURL(/\/dashboard\/facturacion/);
  await expect(page.getByTestId("plan-profesional")).toBeVisible();
  await expect(page.getByTestId("plan-profesional").getByText("El pago online todavía no está habilitado")).toBeVisible();
  await expect(page.getByTestId("plan-profesional").getByRole("link", { name: /escribinos|@/i }).first()).toBeVisible();

  // Una cuenta suspendida no ve la oferta de contratación (decisión de la plataforma).
  await sql(`UPDATE organizations SET status = 'suspended' WHERE id IN ${orgOf}`, [email]);
  await page.goto("/dashboard/facturacion");
  await expect(page.getByTestId("plan-profesional")).toBeVisible();
  await expect(page.getByText("El pago online todavía no está habilitado")).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Elegir Plan/ })).toHaveCount(0);
});
