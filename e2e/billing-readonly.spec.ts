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

test("primer pago pendiente: autorizar en Mercado Pago no activa el plan y «Mi plan» lo explica", async ({ page }) => {
  const suffix = `${test.info().project.name}-${Date.now()}`;
  const email = `e2e-firstpay-${suffix}@example.com`;
  await registerAndOnboard(page, email, `Primer pago E2E ${suffix}`);
  const orgOf = `(SELECT m."organizationId" FROM memberships m JOIN users u ON u.id = m."userId" WHERE u.email = $1)`;
  await sql(`UPDATE organizations SET "trialEndsAt" = now() - interval '1 day' WHERE id IN ${orgOf}`, [email]);

  // Los planes se crean al abrir «Mi plan» por primera vez.
  await page.goto("/dashboard/facturacion");
  await expect(page.getByTestId("plan-profesional")).toBeVisible();
  const plan = (await sql(`SELECT id FROM plans WHERE code = 'mensual' LIMIT 1`)).rows[0]?.id as string | undefined;
  test.skip(!plan, "el catálogo de planes no está disponible en esta base");

  // La suscripción quedó autorizada en Mercado Pago, pero todavía no hay un primer cobro aprobado.
  await sql(
    `INSERT INTO subscriptions (id, "organizationId", "planId", status, "providerSubscriptionId", "contractedAmount", "contractedCurrency", "updatedAt")
     VALUES (gen_random_uuid()::text, ${orgOf}, $2, 'pending', $3, 9900, 'ARS', now())`,
    [email, plan, `pre-e2e-${Date.now()}`],
  );
  await page.reload();
  await expect(page.getByTestId("first-payment")).toContainText("Esperando la confirmación de tu primer pago");
  await expect(page.getByTestId("plan-status")).toContainText("Tu prueba gratuita terminó");
  await expect(page.getByText("Plan activo")).toHaveCount(0);

  // Y si el cobro fue rechazado, lo dice.
  await sql(`UPDATE subscriptions SET "lastChargeStatus" = 'rejected' WHERE "organizationId" IN ${orgOf}`, [email]);
  await page.reload();
  await expect(page.getByTestId("first-payment")).toContainText("No pudimos cobrar tu primer pago");
});
