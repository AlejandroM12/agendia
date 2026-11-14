import { expect, test, type Browser, type Page } from "@playwright/test";
import { registerAndOnboard, resetRateLimits, sql } from "./helpers";

/**
 * Regresión de formularios: ninguno pierde lo escrito ante un error de
 * validación, del servidor o de red, y los errores detectables se muestran
 * sin enviar nada.
 */

const shot = (page: Page, name: string) =>
  page.screenshot({ path: `e2e/.artifacts/${test.info().project.name}-forms-${name}.png`, fullPage: true });

/** Cuenta los envíos de server actions (POST con cabecera next-action). */
function countSubmissions(page: Page) {
  const counter = { count: 0 };
  page.on("request", (request) => {
    if (request.method() === "POST" && request.headers()["next-action"]) counter.count++;
  });
  return counter;
}

const guestPage = async (browser: Browser) => {
  const context = await browser.newContext({ ...test.info().project.use, storageState: undefined });
  return context.newPage();
};

const NETWORK_ERROR = /No pudimos conectarnos/;

test("no quedan mensajes comerciales sobre tarjetas, y la prueba de 14 días se sigue comunicando", async ({ page }) => {
  for (const path of ["/", "/precios", "/registro", "/login", "/licencia"]) {
    await page.goto(path);
    const text = (await page.locator("body").innerText()).toLowerCase();
    expect(text, path).not.toMatch(/sin tarjeta|no requiere tarjeta|tarjeta de crédito|ninguna tarjeta|no necesitás (una )?tarjeta/);
  }
  await page.goto("/");
  await expect(page.getByText(/14 días gratis/).first()).toBeVisible();
  await page.goto("/registro");
  await expect(page.getByText(/gratis durante 14 días/)).toBeVisible();
});

test("registro: requisitos de contraseña a la vista, validación sin enviar y datos que no se pierden", async ({ page }) => {
  await resetRateLimits();
  const suffix = `${test.info().project.name}-${Date.now()}`;
  const takenEmail = `e2e-form-taken-${suffix}@example.com`;
  const email = `e2e-form-${suffix}@example.com`;
  await sql(
    `INSERT INTO users (id, email, "passwordHash", name, "updatedAt") VALUES (gen_random_uuid(), $1, 'x', 'Ya Registrada', now())`,
    [takenEmail],
  );

  await page.goto("/registro");
  await expect(page.getByRole("heading", { level: 1, name: "Tu agenda, más simple." })).toBeVisible();
  await expect(page.getByText("Creá tu cuenta y empezá a organizar tus turnos. Probá Agendia gratis durante 14 días.")).toBeVisible();
  // Beneficios: en el panel lateral (escritorio) o debajo del formulario (celular).
  await expect(page.getByText("Reservas online con tu marca").filter({ visible: true })).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  // Los requisitos están desde el principio, todos pendientes.
  const rules = page.getByTestId("password-rules").getByRole("listitem");
  await expect(rules).toHaveCount(3);
  await expect(rules).toContainText(["Al menos 8 caracteres", "Al menos una letra", "Al menos un número"]);
  for (const rule of await rules.all()) await expect(rule).toHaveAttribute("data-met", "false");
  await expect(rules.first()).toContainText("(falta)");
  await shot(page, "01-registro");

  // Se actualizan mientras se escribe, de a uno.
  const password = page.getByLabel("Contraseña", { exact: true });
  await password.pressSequentially("abc");
  await expect(rules.nth(0)).toHaveAttribute("data-met", "false");
  await expect(rules.nth(1)).toHaveAttribute("data-met", "true");
  await expect(rules.nth(1)).toContainText("(cumplido)");
  await expect(rules.nth(2)).toHaveAttribute("data-met", "false");
  await password.pressSequentially("defgh");
  await expect(rules.nth(0)).toHaveAttribute("data-met", "true");
  await password.pressSequentially("1");
  for (const rule of await rules.all()) await expect(rule).toHaveAttribute("data-met", "true");

  // Mostrar y ocultar.
  await expect(password).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "Mostrar contraseña" }).click();
  await expect(password).toHaveAttribute("type", "text");
  await expect(password).toHaveValue("abcdefgh1");
  await page.getByRole("button", { name: "Ocultar contraseña" }).click();
  await expect(password).toHaveAttribute("type", "password");
  // Gestores de contraseñas y autocompletado.
  await expect(password).toHaveAttribute("autocomplete", "new-password");
  await expect(page.getByLabel("Email")).toHaveAttribute("autocomplete", "email");

  // Contraseña que no cumple + email mal escrito: nada viaja al servidor.
  const submissions = countSubmissions(page);
  const submit = page.getByRole("button", { name: "Crear mi cuenta gratis" });
  await page.getByLabel("Tu nombre").fill("Ana Formulario");
  await page.getByLabel("Email").fill("ana@");
  await password.fill("abcdefgh");
  await submit.click();
  await expect(page.getByText("Ingresá un email válido, como nombre@ejemplo.com.")).toBeVisible();
  await expect(page.getByText("Debe contener al menos un número.")).toBeVisible();
  expect(submissions.count).toBe(0);
  // Lo ya escrito sigue ahí y el foco va al primer campo con error.
  await expect(page.getByLabel("Tu nombre")).toHaveValue("Ana Formulario");
  await expect(page.getByLabel("Email")).toHaveValue("ana@");
  await expect(password).toHaveValue("abcdefgh");
  await expect(page.getByLabel("Email")).toBeFocused();
  await expect(page.getByLabel("Email")).toHaveAttribute("aria-invalid", "true");
  await shot(page, "02-registro-errores");

  // Al corregir un campo se va su error; el del otro queda.
  await page.getByLabel("Email").fill(takenEmail);
  await expect(page.getByText("Ingresá un email válido, como nombre@ejemplo.com.")).toHaveCount(0);
  await expect(page.getByText("Debe contener al menos un número.")).toBeVisible();
  await password.fill("abcdefgh1");
  await expect(page.getByText("Debe contener al menos un número.")).toHaveCount(0);

  // Error del servidor (email ya registrado): debajo del campo y sin perder nada.
  await submit.click();
  await expect(page.getByText(/Ya existe una cuenta con ese email/)).toBeVisible();
  expect(submissions.count).toBe(1);
  await expect(page.getByLabel("Tu nombre")).toHaveValue("Ana Formulario");
  await expect(page.getByLabel("Email")).toHaveValue(takenEmail);
  await expect(password).toHaveValue("abcdefgh1");
  await expect(page.getByLabel("Email")).toBeFocused();

  // Error de red: mensaje claro, datos intactos, y se puede reintentar.
  await page.getByLabel("Email").fill(email);
  await expect(page.getByText(/Ya existe una cuenta con ese email/)).toHaveCount(0);
  await page.route("**/registro", (route) => (route.request().method() === "POST" ? route.abort("failed") : route.continue()));
  await submit.click();
  await expect(page.getByText(NETWORK_ERROR)).toBeVisible();
  await expect(page.getByLabel("Tu nombre")).toHaveValue("Ana Formulario");
  await expect(page.getByLabel("Email")).toHaveValue(email);
  await expect(password).toHaveValue("abcdefgh1");
  await expect(submit).toBeEnabled();
  await page.unroute("**/registro");

  // Doble clic: una sola cuenta. Solo se corrigió el email; el resto no se volvió a escribir.
  await submit.dblclick();
  await expect(page).toHaveURL(/\/onboarding/);
  const created = await sql(`SELECT count(*)::int AS n FROM users WHERE email = $1`, [email]);
  expect(created.rows[0].n).toBe(1);

  // La contraseña nunca se guarda en el navegador.
  const stored = await page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }, document.cookie]));
  expect(stored).not.toContain("abcdefgh1");

  // Onboarding: mismo comportamiento.
  await page.getByLabel("¿Cómo se llama tu negocio?").fill("");
  await page.getByLabel("¿A qué te dedicás?").selectOption("salud");
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByText("Completá este campo.")).toBeVisible();
  await expect(page.getByLabel("¿A qué te dedicás?")).toHaveValue("salud");
  await expect(page).toHaveURL(/\/onboarding$/);

  await sql(`DELETE FROM users WHERE email = $1`, [takenEmail]);
});

test("ingreso: un error no borra lo escrito", async ({ page }) => {
  await resetRateLimits();
  await page.goto("/login");
  await expect(page.getByRole("heading", { level: 1, name: "Hola de nuevo" })).toBeVisible();
  const submissions = countSubmissions(page);

  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page.getByText("Completá este campo.")).toHaveCount(2);
  expect(submissions.count).toBe(0);

  await page.getByLabel("Email").fill("nadie-existe@example.com");
  await page.getByLabel("Contraseña", { exact: true }).fill("ClaveEquivocada1");
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page.getByText("Email o contraseña incorrectos.")).toBeVisible();
  await expect(page.getByLabel("Email")).toHaveValue("nadie-existe@example.com");
  await expect(page.getByLabel("Contraseña", { exact: true })).toHaveValue("ClaveEquivocada1");
  await expect(page.getByLabel("Contraseña", { exact: true })).toHaveAttribute("autocomplete", "current-password");

});

test("reserva pública: falta el contacto, se corrige un solo campo y se reserva sin empezar de nuevo", async ({ page, browser }) => {
  const suffix = `${test.info().project.name}-${Date.now()}`;
  await registerAndOnboard(page, `e2e-form-book-${suffix}@example.com`, `Formularios ${suffix}`);
  await page.goto("/dashboard/pagina");
  const slug = await page.locator("#slug").inputValue();

  const guest = await guestPage(browser);
  await guest.goto(`/${slug}`);
  const slots = guest.getByRole("radiogroup", { name: "Horario" }).getByRole("radio");
  await expect(slots.first()).toBeVisible();
  await guest.getByRole("tab").nth(1).click();
  const chosenDay = await guest.getByRole("tab", { selected: true }).getAttribute("aria-label");
  await slots.nth(2).click();
  const chosenTime = (await slots.nth(2).textContent())!.trim();

  const name = guest.getByLabel("Nombre y apellido");
  const email = guest.getByLabel("Email");
  const phone = guest.getByLabel("WhatsApp o teléfono");
  const confirm = guest.getByRole("button", { name: "Confirmar reserva" });
  // Obligatorios y opcionales, identificados; teclados adecuados en el celular.
  await expect(guest.getByText("obligatorio")).toBeVisible();
  await expect(guest.getByText("Completá al menos uno de los dos.")).toBeVisible();
  await expect(email).toHaveAttribute("inputmode", "email");
  await expect(phone).toHaveAttribute("inputmode", "tel");
  await expect(phone).toHaveAttribute("type", "tel");

  const submissions = countSubmissions(guest);
  const stillSelected = async () => {
    await expect(guest.getByRole("tab", { selected: true })).toHaveAttribute("aria-label", chosenDay!);
    await expect(guest.getByRole("radio", { name: chosenTime, exact: true })).toHaveAttribute("aria-checked", "true");
  };

  // Solo el nombre: faltan email y WhatsApp.
  await name.fill("Marina Sin Contacto");
  await confirm.click();
  await expect(guest.getByText("Dejanos un email o un WhatsApp para poder avisarte.")).toHaveCount(2);
  expect(submissions.count).toBe(0);
  await expect(name).toHaveValue("Marina Sin Contacto");
  await expect(email).toBeFocused();
  await stillSelected();
  await shot(guest, "03-reserva-sin-contacto");

  // Email con formato inválido.
  await email.fill("marina@");
  await expect(guest.getByText("Dejanos un email o un WhatsApp para poder avisarte.")).toHaveCount(0);
  await confirm.click();
  await expect(guest.getByText("Ingresá un email válido, como nombre@ejemplo.com.")).toBeVisible();
  expect(submissions.count).toBe(0);

  // WhatsApp inválido (sin email).
  await email.fill("");
  await phone.fill("123");
  await confirm.click();
  await expect(guest.getByText(/Ingresá un teléfono válido, con característica/)).toBeVisible();
  expect(submissions.count).toBe(0);
  await expect(name).toHaveValue("Marina Sin Contacto");
  await stillSelected();

  // Sin nombre.
  await name.fill("");
  await phone.fill("11 5555 0000");
  await expect(guest.getByText(/Ingresá un teléfono válido/)).toHaveCount(0);
  await confirm.click();
  await expect(guest.getByText("Ingresá tu nombre y apellido.")).toBeVisible();
  await expect(name).toBeFocused();
  await expect(phone).toHaveValue("11 5555 0000");

  // Error de red al confirmar: nada se pierde.
  await name.fill("Marina Sin Contacto");
  await guest.route(`**/${slug}`, (route) => (route.request().method() === "POST" ? route.abort("failed") : route.continue()));
  await confirm.click();
  await expect(guest.getByText(NETWORK_ERROR)).toBeVisible();
  await expect(name).toHaveValue("Marina Sin Contacto");
  await expect(phone).toHaveValue("11 5555 0000");
  await stillSelected();
  await guest.unroute(`**/${slug}`);

  // Se corrigió solo lo necesario: doble clic, una sola reserva.
  await confirm.dblclick();
  await expect(guest.getByRole("heading", { name: "¡Turno confirmado!" })).toBeVisible();
  const booked = await sql(
    `SELECT count(*)::int AS n FROM appointments a JOIN customers c ON c.id = a."customerId" WHERE c.name = 'Marina Sin Contacto' AND c.phone = '1155550000' AND a."organizationId" = (SELECT id FROM organizations WHERE slug = $1)`,
    [slug],
  );
  expect(booked.rows[0].n).toBe(1);
  await guest.context().close();
});

test("reserva pública: si el horario se ocupa, se elige otro sin volver a escribir los datos", async ({ page, browser }) => {
  const suffix = `${test.info().project.name}-${Date.now()}`;
  await registerAndOnboard(page, `e2e-form-race-${suffix}@example.com`, `Simultáneo ${suffix}`);
  await page.goto("/dashboard/pagina");
  const slug = await page.locator("#slug").inputValue();

  const slow = await guestPage(browser);
  const fast = await guestPage(browser);
  for (const guest of [slow, fast]) {
    await guest.goto(`/${slug}`);
    await expect(guest.getByRole("radiogroup", { name: "Horario" }).getByRole("radio").first()).toBeVisible();
    await guest.getByRole("tab").nth(2).click();
    await guest.getByRole("radiogroup", { name: "Horario" }).getByRole("radio").first().click();
  }
  const time = (await slow.getByRole("radio", { checked: true }).textContent())!.trim();
  // «martes 17 de noviembre» (sin la cantidad de horarios libres, que cambia al ocuparse uno).
  const chosenDay = (await slow.getByRole("tab", { selected: true }).getAttribute("aria-label"))!.split(",")[0];

  // La primera persona completa despacio…
  await slow.getByLabel("Nombre y apellido").fill("Lenta Pérez");
  await slow.getByLabel("Email").fill(`lenta-${suffix}@example.com`);
  await slow.getByLabel("WhatsApp o teléfono").fill("351 555 0000");

  // …mientras otra se queda con ese horario.
  await fast.getByLabel("Nombre y apellido").fill("Rápida Gómez");
  await fast.getByLabel("Email").fill(`rapida-${suffix}@example.com`);
  await fast.getByRole("button", { name: "Confirmar reserva" }).click();
  await expect(fast.getByRole("heading", { name: "¡Turno confirmado!" })).toBeVisible();
  await fast.context().close();

  await slow.getByRole("button", { name: "Confirmar reserva" }).click();
  await expect(slow.getByText(/Tus datos quedaron guardados: solo tenés que elegir otro horario/)).toBeVisible();
  // El servicio sigue elegido y el selector vuelve a cargar: en el día que se había elegido, el horario ocupado ya no se ofrece.
  const slots = slow.getByRole("radiogroup", { name: "Horario" }).getByRole("radio");
  await expect(slots.first()).toBeVisible();
  await slow.getByRole("tab", { name: new RegExp(`^${chosenDay}`) }).click();
  await expect(slow.getByRole("radio", { name: time, exact: true })).toHaveCount(0);
  await shot(slow, "04-horario-ocupado");

  await slots.first().click();
  await expect(slow.getByLabel("Nombre y apellido")).toHaveValue("Lenta Pérez");
  await expect(slow.getByLabel("Email")).toHaveValue(`lenta-${suffix}@example.com`);
  await expect(slow.getByLabel("WhatsApp o teléfono")).toHaveValue("351 555 0000");
  await slow.getByRole("button", { name: "Confirmar reserva" }).click();
  await expect(slow.getByRole("heading", { name: "¡Turno confirmado!" })).toBeVisible();
  await slow.context().close();

  // Dos turnos, en horarios distintos: no hubo reserva doble.
  const rows = await sql(
    `SELECT count(*)::int AS n, count(DISTINCT "startsAt")::int AS distinct_slots FROM appointments WHERE "organizationId" = (SELECT id FROM organizations WHERE slug = $1)`,
    [slug],
  );
  expect(rows.rows[0]).toEqual({ n: 2, distinct_slots: 2 });
});

test("panel: servicios, clientes, turnos, horarios y página pública conservan lo escrito ante un error", async ({ page }) => {
  const suffix = `${test.info().project.name}-${Date.now()}`;
  await registerAndOnboard(page, `e2e-form-dash-${suffix}@example.com`, `Panel ${suffix}`);

  // Servicio: falta el nombre.
  await page.goto("/dashboard/servicios/nuevo");
  const submissions = countSubmissions(page);
  await page.getByLabel("Descripción").fill("Incluye evaluación inicial.");
  await page.getByLabel("Precio").fill("15000");
  await page.getByRole("button", { name: /Crear|Guardar|Agregar/ }).click();
  await expect(page.getByText("Completá este campo.")).toBeVisible();
  expect(submissions.count).toBe(0);
  await expect(page.getByLabel("Descripción")).toHaveValue("Incluye evaluación inicial.");
  await expect(page.getByLabel("Precio")).toHaveValue("15000");
  await expect(page.getByLabel("Nombre")).toBeFocused();

  // Cliente: email y teléfono inválidos, y después un error de red.
  await page.goto("/dashboard/clientes/nuevo");
  await page.getByLabel("Nombre").fill("Cliente De Prueba");
  await page.getByLabel("Email").fill("cliente@@mal");
  await page.getByLabel("Teléfono").fill("12");
  await page.getByLabel("Observaciones").fill("Prefiere turnos por la mañana.");
  const save = page.getByRole("button", { name: /Crear|Guardar|Agregar/ });
  await save.click();
  await expect(page.getByText("Ingresá un email válido, como nombre@ejemplo.com.")).toBeVisible();
  await expect(page.getByText(/Ingresá un teléfono válido/)).toBeVisible();
  await expect(page.getByLabel("Observaciones")).toHaveValue("Prefiere turnos por la mañana.");
  await page.getByLabel("Email").fill("cliente@example.com");
  await page.getByLabel("Teléfono").fill("11 4444 0000");
  await page.route("**/dashboard/clientes/nuevo", (route) => (route.request().method() === "POST" ? route.abort("failed") : route.continue()));
  await save.click();
  await expect(page.getByText(NETWORK_ERROR)).toBeVisible();
  await expect(page.getByLabel("Nombre")).toHaveValue("Cliente De Prueba");
  await expect(page.getByLabel("Observaciones")).toHaveValue("Prefiere turnos por la mañana.");
  await page.unroute("**/dashboard/clientes/nuevo");
  await save.click();
  await expect(page).toHaveURL(/\/dashboard\/clientes\/[0-9a-f-]{36}/);

  // Turno manual sin cliente: la nota y el día elegidos no se pierden.
  const date = new Date(Date.now() + 3 * 24 * 3600 * 1000).toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
  await page.goto(`/dashboard/turnos/nuevo?fecha=${date}`);
  await page.getByLabel("Nota interna").fill("Trae estudios previos.");
  const firstSlot = page.getByRole("radiogroup", { name: "Horario" }).getByRole("radio").first();
  await expect(firstSlot).toBeVisible();
  await firstSlot.click();
  await page.getByRole("button", { name: "Agendar turno" }).click();
  await expect(page).toHaveURL(/\/dashboard\/turnos\/nuevo/);
  await expect(page.getByRole("alert").first()).toBeVisible();
  await expect(page.getByLabel("Nota interna")).toHaveValue("Trae estudios previos.");
  await expect(page.getByLabel("Día")).toHaveValue(date);

  // Bloqueo de horario sin fecha.
  await page.goto("/dashboard/disponibilidad");
  await page.getByLabel("Motivo").fill("Congreso");
  await page.getByRole("button", { name: "Agregar bloqueo" }).click();
  await expect(page.getByText("Completá este campo.")).toBeVisible();
  await expect(page.getByLabel("Motivo")).toHaveValue("Congreso");

  // Mi página pública: un WhatsApp inválido no borra el resto.
  await page.goto("/dashboard/pagina");
  await page.getByLabel("Especialidad o categoría").fill("Kinesiología");
  await page.getByLabel("WhatsApp").fill("abc");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByText(/Ingresá el número con característica/)).toBeVisible();
  await expect(page.getByLabel("Especialidad o categoría")).toHaveValue("Kinesiología");
  await page.getByLabel("WhatsApp").fill("11 5555 0000");
  await expect(page.getByText(/Ingresá el número con característica/)).toHaveCount(0);
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByText("Cambios guardados. Tu página ya está actualizada.")).toBeVisible();

  // Cambio de contraseña: requisitos visibles y validación antes de enviar.
  await page.goto("/dashboard/configuracion");
  await expect(page.getByTestId("password-rules").getByRole("listitem")).toHaveCount(3);
  await page.getByLabel("Contraseña actual").fill("Contrasena123");
  await page.getByLabel("Contraseña nueva").fill("corta");
  await page.getByRole("button", { name: "Cambiar contraseña" }).click();
  await expect(page.getByText("Debe tener al menos 8 caracteres.")).toBeVisible();
  await expect(page.getByLabel("Contraseña actual")).toHaveValue("Contrasena123");
  await expect(page).toHaveURL(/\/dashboard\/configuracion/);
});
