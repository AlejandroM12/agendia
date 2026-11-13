import { expect, test, type Page } from "@playwright/test";
import { resetRateLimits } from "./helpers";

const shot = (page: Page, name: string) =>
  page.screenshot({ path: `e2e/.artifacts/${test.info().project.name}-${name}.png`, fullPage: true });

test("recorrido completo: registro → onboarding → agenda → reserva pública → cancelación", async ({ page, browser }) => {
  const suffix = `${test.info().project.name}-${Date.now()}`;
  const email = `e2e-${suffix}@example.com`;
  const business = `Estudio E2E ${suffix}`;

  await resetRateLimits();

  // 1. Landing: presenta el producto y lleva al registro.
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Tu agenda");
  await expect(page.getByRole("link", { name: "AtajoLab" })).toHaveAttribute("href", "https://atajolab.dev");
  await shot(page, "01-landing");
  await page.getByRole("link", { name: /Probar 7 días gratis/ }).click();

  // 2. Registro: tres campos.
  await expect(page).toHaveURL(/\/registro/);
  await page.getByLabel("Tu nombre").fill("Ana Prueba");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Contraseña").fill("Contrasena123");
  await shot(page, "02-registro");
  await page.getByRole("button", { name: "Empezar gratis" }).click();

  // 3. Onboarding en tres pasos.
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByLabel("¿Cómo se llama tu negocio?").fill(business);
  await page.getByLabel("¿A qué te dedicás?").selectOption("salud");
  await shot(page, "03-onboarding-negocio");
  await page.getByRole("button", { name: "Continuar" }).click();

  await expect(page.getByRole("heading", { name: "Tus servicios" })).toBeVisible();
  await expect(page.getByLabel("Nombre del servicio 1")).toHaveValue("Consulta");
  await shot(page, "04-onboarding-servicios");
  await page.getByRole("button", { name: "Continuar" }).click();

  await expect(page.getByRole("heading", { name: "Tus horarios" })).toBeVisible();
  // Se habilitan también sábado y domingo para que siempre haya horarios "mañana".
  await page.getByRole("checkbox", { name: "sábado" }).check();
  await page.getByRole("checkbox", { name: "domingo" }).check();
  await shot(page, "05-onboarding-horarios");
  await page.getByRole("button", { name: "Terminar y ver mi agenda" }).click();

  // 4. Dashboard con la prueba activa y el enlace público.
  await expect(page).toHaveURL(/\/dashboard\?bienvenida=1/);
  await expect(page.getByText("Tu agenda está lista")).toBeVisible();
  await shot(page, "06-dashboard");

  // Retomar el onboarding ya terminado vuelve al panel.
  await page.goto("/onboarding");
  await expect(page).toHaveURL(/\/dashboard/);

  // 5. Turno manual para mañana.
  const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toLocaleDateString("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  });
  await page.goto(`/dashboard/turnos/nuevo?fecha=${tomorrow}`);
  await page.getByLabel("Nombre del cliente").fill("Carlos Manual");
  await page.getByLabel("Teléfono (opcional)").fill("11 5555-0001");
  const firstSlot = page.getByRole("radiogroup", { name: "Horario" }).getByRole("radio").first();
  await expect(firstSlot).toBeVisible();
  const manualTime = (await firstSlot.textContent())!.trim();
  await firstSlot.click();
  await shot(page, "07-nuevo-turno");
  await page.getByRole("button", { name: "Agendar turno" }).click();

  await expect(page).toHaveURL(new RegExp(`/dashboard/agenda\\?fecha=${tomorrow}`));
  await expect(page.getByRole("link", { name: /Carlos Manual/ })).toBeVisible();
  await shot(page, "08-agenda");

  // 6. Reserva pública, como un cliente sin sesión.
  await page.goto("/dashboard/configuracion");
  const slug = await page.locator("#slug").inputValue();
  expect(slug.length).toBeGreaterThan(2);

  const guestContext = await browser.newContext({ ...test.info().project.use, storageState: undefined });
  const guest = await guestContext.newPage();
  await guest.goto(`/${slug}`);
  await expect(guest.getByRole("heading", { level: 1, name: business })).toBeVisible();
  await guest.getByRole("button", { name: /Consulta/ }).first().click();

  const publicSlots = guest.getByRole("radiogroup", { name: "Horario" }).getByRole("radio");
  await expect(publicSlots.first()).toBeVisible();
  // Mañana: el horario del turno manual ya no debe ofrecerse.
  await guest.getByRole("tab", { name: new RegExp(`${Number(tomorrow.slice(8))} de`) }).click();
  await expect(guest.getByRole("radio", { name: manualTime, exact: true })).toHaveCount(0);
  await shot(guest, "09-reserva-horarios");

  await publicSlots.first().click();
  await guest.getByLabel("Nombre y apellido").fill("Laura Online");
  await guest.getByLabel("Email").fill(`laura-${suffix}@example.com`);
  await shot(guest, "10-reserva-datos");
  await guest.getByRole("button", { name: "Confirmar reserva" }).click();
  await expect(guest.getByRole("heading", { name: "¡Turno confirmado!" })).toBeVisible();
  await shot(guest, "11-reserva-confirmada");

  // 7. El cliente gestiona su turno desde el enlace con token.
  await guest.getByRole("link", { name: "Ver mi turno" }).click();
  await expect(guest).toHaveURL(/\/turno\//);
  await expect(guest.getByText("Confirmado", { exact: true })).toBeVisible();
  await shot(guest, "12-mi-turno");

  // 8. La reserva aparece en la agenda del profesional.
  await page.goto(`/dashboard/agenda?fecha=${tomorrow}`);
  await expect(page.getByRole("link", { name: /Laura Online/ })).toBeVisible();

  // 9. El cliente cancela; el profesional lo ve cancelado.
  guest.once("dialog", (dialog) => dialog.accept());
  await guest.getByRole("button", { name: "Cancelar turno" }).click();
  await expect(guest.getByText("Cancelado", { exact: true })).toBeVisible();
  await guestContext.close();

  await page.reload();
  await page.getByRole("link", { name: /Laura Online/ }).click();
  await expect(page.getByText("Cancelado por el cliente")).toBeVisible();
  await shot(page, "13-turno-cancelado");

  // 10. Clientes y avisos registrados (sin canal de email: "No enviado", nunca "Enviado").
  await page.goto("/dashboard/clientes");
  await expect(page.getByRole("link", { name: /Carlos Manual/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Laura Online/ })).toBeVisible();
  await shot(page, "14-clientes");

  await page.goto("/dashboard/recordatorios");
  await expect(page.getByText("Confirmación de turno · Laura Online")).toBeVisible();
  await shot(page, "15-recordatorios");

  await page.goto("/dashboard/facturacion");
  await expect(page.getByText(/Prueba gratuita · 7 días restantes/)).toBeVisible();
  await shot(page, "16-plan");

  // 11. Sin sesión, el panel no es accesible.
  await page.goto("/logout");
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});

test("una ruta pública inexistente muestra la página de no encontrada y /admin no existe para usuarios comunes", async ({ page }) => {
  await page.goto("/negocio-que-no-existe-xyz");
  await expect(page.getByRole("heading", { name: "No encontramos esta página" })).toBeVisible();
  const admin = await page.goto("/admin");
  expect(admin?.url()).toContain("/login");
});
