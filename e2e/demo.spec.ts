import { expect, test } from "@playwright/test";
import { resetRateLimits, sql } from "./helpers";

/**
 * Recorrido completo de la demo pública: abrirla, reservar como cliente con un correo «real», ver el aviso de
 * WhatsApp (simulado), confirmar asistencia desde el botón, y comprobar que no hay facturación y que no salió nada.
 */
test("demo pública: de /demo a una reserva y su aviso de WhatsApp simulado, sin facturación y sin envíos", async ({ page, browser }) => {
  await resetRateLimits();

  // 1. La página de la demo explica qué es y qué no hace.
  await page.goto("/demo");
  await expect(page.getByRole("heading", { name: /sin registrarte/ })).toBeVisible();
  await expect(page.getByText(/No se envía ningún mensaje real/)).toBeVisible();

  // 2. Un clic y el visitante está dentro de SU negocio de demostración.
  await page.getByRole("button", { name: "Probar la demo ahora" }).click();
  await expect(page).toHaveURL(/\/dashboard\/demo/, { timeout: 60_000 });
  await expect(page.getByText("DEMO", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Avisos automáticos por WhatsApp" })).toBeVisible();

  // La vista previa ya trae avisos de ejemplo, claramente simulados.
  await expect(page.getByText("simulado").first()).toBeVisible();

  // 3. No hay facturación ni invitaciones en una demo.
  await page.goto("/dashboard/facturacion");
  await expect(page).not.toHaveURL(/facturacion/);
  await expect(page.getByRole("link", { name: /Mi plan|Facturación/ })).toHaveCount(0);

  // 4. Reserva como cliente, con un correo y un teléfono que parecen reales.
  const slug = (await sql(`SELECT slug FROM organizations WHERE "isDemo" ORDER BY "createdAt" DESC LIMIT 1`)).rows[0].slug as string;
  const guestContext = await browser.newContext({ locale: "es-AR", timezoneId: "America/Argentina/Buenos_Aires" });
  const guest = await guestContext.newPage();
  await guest.goto(`/${slug}`);
  await expect(guest.getByText(/negocio ficticio/)).toBeVisible();
  // Paso 1: con varios servicios se elige uno de la lista.
  await guest.getByRole("button", { name: /Corte clásico/ }).first().click();
  const picker = guest.getByRole("radiogroup", { name: "Profesional" });
  await picker.getByRole("radio").last().click(); // «Cualquier profesional»
  const slots = guest.getByRole("radiogroup", { name: "Horario" }).getByRole("radio");
  await expect(slots.first()).toBeVisible({ timeout: 30_000 });
  await slots.first().click();
  await guest.getByLabel("Nombre y apellido").fill("Visitante Demo");
  await guest.getByLabel("Email").fill("visitante.real@gmail.com");
  await guest.getByLabel("WhatsApp o teléfono").fill("11 5555-0199");
  await guest.getByRole("button", { name: "Confirmar reserva" }).click();
  await expect(guest.getByText(/Tu turno quedó confirmado|¡Listo!|reserva/i).first()).toBeVisible({ timeout: 30_000 });
  await guestContext.close();

  // 5. El aviso de WhatsApp de esa reserva aparece en la vista previa, simulado.
  await expect(async () => {
    await page.goto("/dashboard/demo");
    await expect(page.getByText(/para Visitante Demo/).first()).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 90_000, intervals: [3_000] });

  // 6. Los botones del mensaje actúan sobre el turno: «Confirmo» deja registrada la asistencia.
  const message = page.getByRole("listitem").filter({ hasText: "para Visitante Demo" }).first();
  await message.getByRole("button", { name: "Confirmo" }).click();
  await expect(message.getByText("Confirmaste que vas")).toBeVisible({ timeout: 15_000 });
  const confirmed = await sql(
    `SELECT a."attendanceConfirmedAt" IS NOT NULL AS ok FROM appointments a JOIN customers c ON c.id = a."customerId"
     JOIN organizations o ON o.id = a."organizationId" WHERE c.name = 'Visitante Demo' AND o."isDemo" ORDER BY a."createdAt" DESC LIMIT 1`,
  );
  expect(confirmed.rows[0].ok).toBe(true);

  // 7. Nada salió de verdad: todo aviso de la demo está registrado como simulado (o todavía pendiente).
  const real = await sql(
    `SELECT count(*)::int AS n FROM notifications n JOIN organizations o ON o.id = n."organizationId"
     WHERE o."isDemo" AND n.status = 'sent' AND coalesce(n."lastError", '') NOT LIKE 'simulado%'`,
  );
  expect(real.rows[0].n).toBe(0);
});
