import { createHash, randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { registerAndOnboard, sql } from "./helpers";

test("la landing presenta las dos modalidades con sus precios y condiciones", async ({ page }) => {
  await page.goto("/");
  const monthly = page.locator("div", { has: page.getByRole("heading", { name: "Plan Profesional" }) }).last();
  const license = page.locator("div", { has: page.getByRole("heading", { name: "Licencia independiente" }) }).last();

  await expect(monthly).toContainText("14.000");
  await expect(monthly).toContainText("7 días gratis");
  await expect(monthly).toContainText("Hosting y soporte incluidos");
  await expect(license).toContainText("199.000");
  await expect(license).toContainText("Licencia de uso permanente");
  await expect(license).toContainText("Hosting, dominio y soporte incluidos durante 12 meses");
  await expect(license).toContainText("no incluye el código fuente");
  // Las condiciones de renovación están a la vista antes de contratar.
  await expect(page.getByText(/a partir del mes 13 su renovación es anual/).first()).toBeVisible();
  await expect(page.getByText(/ctualizaciones/)).toHaveCount(0);

  await license.getByRole("link", { name: "Comprar la licencia" }).click();
  await expect(page).toHaveURL(/\/licencia$/);
  await expect(page.getByRole("heading", { level: 1, name: "Licencia independiente" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Condiciones, antes de comprar" })).toBeVisible();
  // Estas pruebas corren sin credenciales de Mercado Pago: no se ofrece un pago que no puede ocurrir.
  await expect(page.getByText("El pago online todavía no está habilitado.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Pagar/ })).toHaveCount(0);

  await page.goto("/precios");
  await expect(page.getByRole("heading", { name: "Plan Profesional" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Licencia independiente" })).toBeVisible();

  // Una orden inexistente no revela nada.
  await page.goto("/licencia/orden/00000000-0000-4000-8000-000000000000");
  await expect(page.getByRole("heading", { name: "No encontramos esta página" })).toBeVisible();
});

test("sin confirmar el email no se puede usar la cuenta; el enlace la habilita", async ({ page }) => {
  const suffix = `${test.info().project.name}-${Date.now()}`;
  const email = `e2e-verify-${suffix}@example.com`;
  await registerAndOnboard(page, email, `Verifica E2E ${suffix}`);

  // Se deja la cuenta como queda en producción al registrarse: sin verificar
  // y con un enlace emitido (acá no hay canal de email que lo entregue).
  const token = randomBytes(32).toString("base64url");
  await sql(`UPDATE users SET "emailVerifiedAt" = NULL WHERE email = $1`, [email]);
  await sql(
    `INSERT INTO email_verification_tokens (id, "userId", "tokenHash", "expiresAt")
     SELECT gen_random_uuid(), id, $2, now() + interval '1 day' FROM users WHERE email = $1`,
    [email, createHash("sha256").update(token).digest("hex")],
  );

  for (const path of ["/dashboard", "/dashboard/clientes", "/onboarding"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/verificar-email$/);
  }
  await expect(page.getByRole("heading", { name: "Confirmá tu email" })).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();

  await page.goto("/verificar-email/un-enlace-que-no-existe");
  await expect(page).toHaveURL(/\/verificar-email\?enlace=invalido/);
  await expect(page.getByText("Ese enlace no es válido o ya venció. Pedí uno nuevo.")).toBeVisible();

  await page.goto(`/verificar-email/${token}`);
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("link", { name: "Nuevo turno" }).first()).toBeVisible();

  // El enlace es de un solo uso; con la cuenta ya confirmada, la pantalla de verificación sigue de largo.
  await page.goto("/verificar-email");
  await expect(page).toHaveURL(/\/dashboard/);
});

test("un cliente reprograma su turno desde su enlace", async ({ page, browser }) => {
  const suffix = `${test.info().project.name}-${Date.now()}`;
  await registerAndOnboard(page, `e2e-move-${suffix}@example.com`, `Reprograma E2E ${suffix}`);
  await page.goto("/dashboard/configuracion");
  const slug = await page.locator("#slug").inputValue();

  const guestContext = await browser.newContext({ ...test.info().project.use, storageState: undefined });
  const guest = await guestContext.newPage();
  await guest.goto(`/${slug}`);
  // Con un solo servicio, la página va directo a elegir el horario.
  const slots = guest.getByRole("radiogroup", { name: "Horario" }).getByRole("radio");
  await expect(slots.first()).toBeVisible();
  await slots.first().click();
  await guest.getByLabel("Nombre y apellido").fill("Rita Reprograma");
  await guest.getByLabel("Email").fill(`rita-${suffix}@example.com`);
  await guest.getByRole("button", { name: "Confirmar reserva" }).click();
  await expect(guest.getByRole("heading", { name: "¡Turno confirmado!" })).toBeVisible();

  await guest.getByRole("link", { name: "Ver mi turno" }).click();
  await expect(guest).toHaveURL(/\/turno\//);
  const time = guest.locator("p.tabular-nums").first();
  const before = (await time.textContent())!.trim();

  await guest.getByRole("button", { name: "Reprogramar" }).click();
  const newSlots = guest.getByRole("radiogroup", { name: "Horario" }).getByRole("radio");
  await expect(newSlots.first()).toBeVisible();
  // El último horario del día nunca coincide con el primero, que es el que se reservó.
  await newSlots.last().click();
  await guest.getByRole("button", { name: /^Pasar al/ }).click();

  await expect(guest.getByRole("button", { name: "Reprogramar" })).toBeVisible();
  await expect(time).not.toHaveText(before);
  await expect(guest.getByText("Confirmado", { exact: true })).toBeVisible();
  const after = (await time.textContent())!.trim().replace(" h", "");
  await guestContext.close();

  // El profesional ve el turno en su nuevo horario y el aviso de reprogramación registrado.
  await page.goto("/dashboard/turnos");
  await expect(page.getByRole("link", { name: /Rita Reprograma/ }).first()).toContainText(after);
});

test("la plataforma activa a mano el plan de una cuenta con la prueba vencida", async ({ page }) => {
  const suffix = `${test.info().project.name}-${Date.now()}`;
  const email = `e2e-admin-${suffix}@example.com`;
  await registerAndOnboard(page, email, `Activa E2E ${suffix}`);

  await sql(
    `UPDATE organizations SET "trialEndsAt" = now() - interval '1 day'
     WHERE id IN (SELECT m."organizationId" FROM memberships m JOIN users u ON u.id = m."userId" WHERE u.email = $1)`,
    [email],
  );
  await page.goto("/dashboard");
  await expect(page.getByText("Tu prueba gratuita terminó.")).toBeVisible();

  // Sin el permiso de plataforma, /admin no existe.
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "No encontramos esta página" })).toBeVisible();

  // El permiso se otorga desde el servidor (equivale a `npm run admin:grant`, sin cerrar la sesión).
  await sql(`UPDATE users SET "isPlatformAdmin" = true WHERE email = $1`, [email]);
  try {
    await page.goto(`/admin?q=${encodeURIComponent(email)}`);
    const row = page.getByRole("row", { name: new RegExp(`Activa E2E ${suffix}`) });
    await expect(row).toContainText("Prueba vencida");
    await row.getByRole("button", { name: "Activar" }).click();
    await expect(row).toContainText("Activa", { timeout: 15_000 });
    await expect(row.getByRole("button", { name: "Dar de baja" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Licencia independiente" })).toBeVisible();

    await page.goto("/dashboard/facturacion");
    await expect(page.getByText("Plan activo")).toBeVisible();
    await page.goto("/dashboard");
    await expect(page.getByText("Tu prueba gratuita terminó.")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Nuevo turno" }).first()).toBeVisible();
  } finally {
    await sql(`UPDATE users SET "isPlatformAdmin" = false WHERE email = $1`, [email]);
  }
});
