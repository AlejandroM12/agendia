import { expect, test } from "@playwright/test";
import { registerAndOnboard, sql } from "./helpers";

/**
 * WhatsApp automático desde el negocio: sin conexión se ofrecen los beneficios y el pedido de activación; el pedido
 * queda registrado y el negocio no puede conectar nada por su cuenta. Con la integración activa ve consumo e historial.
 */
test("Integraciones: pedir la activación y, ya conectado, ver el consumo y el historial sin credenciales", async ({ page }) => {
  const suffix = `${test.info().project.name}-${Date.now()}`;
  const email = `e2e-wa-${suffix}@example.com`;
  await registerAndOnboard(page, email, `WhatsApp E2E ${suffix}`);

  // Se llega desde Configuración.
  await page.goto("/dashboard/configuracion");
  await page.getByRole("link", { name: /Integraciones/ }).click();
  await expect(page).toHaveURL(/\/dashboard\/configuracion\/integraciones/);
  await expect(page.getByRole("heading", { name: "WhatsApp automático" })).toBeVisible();
  await expect(page.getByText(/Confirmación automática por WhatsApp/)).toBeVisible();
  // No se publica ningún precio de WhatsApp.
  await expect(page.getByText(/\$\s?\d|USD|US\$/)).toHaveCount(0);

  // Pedir la activación: queda registrado.
  await page.getByRole("button", { name: "Solicitar activación" }).click();
  await expect(page.getByText(/Tu solicitud|Recibimos tu solicitud/)).toBeVisible();
  const organizationId = (await sql(`SELECT m."organizationId" AS id FROM memberships m JOIN users u ON u.id = m."userId" WHERE u.email = $1`, [email])).rows[0].id as string;
  const requests = await sql(`SELECT count(*)::int AS n FROM audit_logs WHERE "organizationId" = $1 AND action = 'whatsapp.activation_requested'`, [organizationId]);
  expect(requests.rows[0].n).toBe(1);

  // AtajoLab la conecta (se simula con la base): ahora el negocio ve su estado, el consumo y el historial.
  await sql(
    `INSERT INTO whatsapp_connections (id, "organizationId", enabled, status, "phoneNumberId", "wabaId", "displayPhone", credentials, "credentialsHint", "monthlyLimit", "templatesStatus", "updatedAt")
     VALUES (gen_random_uuid()::text, $1, true, 'connected', $2, '1', '+54 9 11 5555-0000', 'no-es-un-secreto-real', '…9876', 40, '{}'::jsonb, now())`,
    [organizationId, `e2e${Date.now()}`],
  );
  await sql(
    `INSERT INTO whatsapp_messages (id, "organizationId", direction, kind, phone, status, "providerMessageId", "updatedAt")
     VALUES (gen_random_uuid()::text, $1, 'outbound', 'reminder', '5491155550123', 'delivered', $2, now())`,
    [organizationId, `wamid.e2e.${Date.now()}`],
  );
  await page.reload();
  await expect(page.getByText("Activo", { exact: true })).toBeVisible();
  await expect(page.getByText("1 de 40")).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Recordatorio · 549" }).or(page.getByRole("listitem").filter({ hasText: /Recordatorio · .*0123/ }))).toBeVisible();
  await expect(page.getByText("Entregado")).toBeVisible();
  // El teléfono aparece enmascarado y no hay rastro de credenciales ni del límite editable.
  await expect(page.getByText("5491155550123")).toHaveCount(0);
  await expect(page.getByText("no-es-un-secreto-real")).toHaveCount(0);
  await expect(page.getByLabel(/límite/i)).toHaveCount(0);

  // Preferencias: se guardan.
  await page.getByLabel("Aviso de cancelación").uncheck();
  await page.getByRole("button", { name: "Guardar preferencias" }).click();
  await expect(page.getByText(/Preferencias guardadas/)).toBeVisible();
  const saved = await sql(`SELECT "sendCancellations" FROM whatsapp_connections WHERE "organizationId" = $1`, [organizationId]);
  expect(saved.rows[0].sendCancellations).toBe(false);
});
