import { expect, test, type Browser, type Page } from "@playwright/test";
import { resetRateLimits, sql } from "./helpers";

/**
 * Oferta comercial con equipos, con los planes publicados (PUBLISH_TEAM_PLANS=1, segundo servidor de la
 * misma build): landing y precios, registro con intención de plan, onboarding «¿Cómo trabajás?», Mi plan,
 * sesiones revocables y la vista de plataforma. Mercado Pago no está configurado en estas pruebas: no se
 * ofrece un pago que no puede ocurrir, y nada de lo que se ve acá cobra.
 */

const shot = (page: Page, name: string) => page.screenshot({ path: `e2e/.artifacts/${test.info().project.name}-${name}.png`, fullPage: true });
const unique = () => `${test.info().project.name}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function register(page: Page, email: string, plan?: "equipo" | "profesional") {
  await resetRateLimits();
  await page.goto(plan ? `/registro?plan=${plan}` : "/registro");
  await page.getByLabel("Tu nombre").fill("Ana Prueba");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill("Contrasena123");
  await page.getByRole("button", { name: "Crear mi cuenta gratis" }).click();
  await expect(page).toHaveURL(/\/onboarding/);
}

async function login(page: Page, email: string) {
  await resetRateLimits();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill("Contrasena123");
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test("precios: dos planes mensuales con el mismo contenido y las licencias aparte, sin prometer lo que no existe", async ({ page }) => {
  await page.goto("/precios");
  const pro = page.locator("div", { has: page.getByRole("heading", { name: "Plan Profesional" }) }).last();
  const team = page.locator("div", { has: page.getByRole("heading", { name: "Plan Equipo" }) }).last();

  await expect(pro).toContainText("9.900");
  await expect(pro).toContainText("Hasta 2 profesionales activos");
  await expect(team).toContainText("19.900");
  await expect(team).toContainText("Hasta 5 profesionales activos");
  for (const plan of [pro, team]) {
    await expect(plan).toContainText("14 días gratis");
    await expect(plan).toContainText("Una agenda propia para cada profesional");
    await expect(plan).toContainText("WhatsApp manual");
    await expect(plan).toContainText("Cancelás cuando quieras");
  }

  // Las licencias van en una sección secundaria, con sus condiciones.
  const licenses = page.getByRole("region", { name: /pagar una sola vez/i });
  await expect(licenses).toContainText("Licencia Profesional");
  await expect(licenses).toContainText("149.000");
  await expect(licenses).toContainText("Licencia Equipo");
  await expect(licenses).toContainText("249.000");
  await expect(licenses).toContainText("Desde el segundo año, el alojamiento, dominio y soporte se renuevan por separado");
  await expect(licenses).toContainText("no incluye el código fuente");

  const body = (await page.locator("body").innerText()).toLowerCase();
  expect(body).not.toMatch(/google calendar|whatsapp automático|recordatorios automáticos por whatsapp|seña|app nativa|descuento|oferta|últimos lugares|ahorrá/);
  expect(body).not.toMatch(/ctualizaciones (gratis|de por vida)/);
  await noHorizontalScroll(page);
  await shot(page, "precios-equipo");
});

test("landing: situaciones reales de equipos y las preguntas frecuentes sobre profesionales, cuentas y planes", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Si atienden varias personas/ })).toBeVisible();
  await expect(page.getByText("Turnos simultáneos sin pisarse")).toBeVisible();
  for (const question of ["¿Pago por cada profesional?", "¿Los recordatorios por WhatsApp son automáticos?", "¿Qué incluye la licencia?", "¿La licencia incluye el código fuente?"]) {
    await expect(page.locator("summary", { hasText: question })).toBeVisible();
  }
  await page.getByText("¿Los recordatorios por WhatsApp son automáticos?").click();
  await expect(page.getByText(/Lo único automático son los correos electrónicos/)).toBeVisible();
  await noHorizontalScroll(page);
  await shot(page, "landing-equipos");

  // El CTA del Plan Equipo conserva la intención hasta el registro.
  await page.goto("/precios");
  await page.getByRole("link", { name: "Empezar gratis con el Plan Equipo" }).click();
  await expect(page).toHaveURL(/\/registro\?plan=equipo/);
  await expect(page.getByTestId("team-intent")).toContainText("sin ningún cobro");
  await expect(page.getByTestId("team-intent")).toContainText("hasta 2 profesionales activos");
});

test("registro con intención de Plan Equipo: prueba de 14 días sin cobro; onboarding de equipo, opcional y dentro del cupo", async ({ page }) => {
  const email = `e2e-team-${unique()}@example.com`;
  await register(page, email, "equipo");

  // Se guardó solo la intención: sin suscripción y con la prueba.
  const org = (await sql(`SELECT o."intendedPlan", o.status, (SELECT count(*) FROM subscriptions s WHERE s."organizationId" = o.id)::int AS subs FROM organizations o JOIN memberships m ON m."organizationId" = o.id JOIN users u ON u.id = m."userId" WHERE u.email = $1`, [email])).rows[0];
  expect(org).toMatchObject({ intendedPlan: "equipo", status: "trial", subs: 0 });

  await expect(page.getByTestId("work-mode")).toBeVisible();
  await page.getByLabel("¿Cómo se llama tu negocio?").fill(`Equipo E2E ${unique()}`);
  await page.getByLabel("¿A qué te dedicás?").selectOption("belleza");
  await page.getByLabel("Trabajo con otras personas").check();
  await shot(page, "onboarding-como-trabajas");
  await page.getByRole("button", { name: "Continuar" }).click();

  // Paso «Tu equipo»: más que el cupo de la prueba se rechaza con una explicación.
  await expect(page.getByRole("heading", { name: "Tu equipo" })).toBeVisible();
  await page.getByLabel("¿Quiénes más atienden?").fill("Lucía\nMartín");
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByText(/admite hasta 2 profesionales activos/)).toBeVisible();
  await expect(page.getByLabel("¿Quiénes más atienden?")).toHaveValue("Lucía\nMartín"); // no se pierde lo escrito

  await page.getByLabel("¿Quiénes más atienden?").fill("Lucía");
  await shot(page, "onboarding-equipo");
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByRole("heading", { name: "Tus servicios" })).toBeVisible();
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByRole("heading", { name: "Tus horarios" })).toBeVisible();
  await page.getByRole("button", { name: "Terminar y ver mi agenda" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  // Equipo: 2 de 2 lugares, y el horario habitual quedó también para la segunda profesional.
  await page.goto("/dashboard/equipo");
  await expect(page.getByTestId("team-quota")).toContainText("Usás 2 de 2");
  const hours = (await sql(`SELECT count(DISTINCT p.id)::int AS n FROM professionals p JOIN availability_rules r ON r."professionalId" = p.id JOIN memberships m ON m."organizationId" = p."organizationId" JOIN users u ON u.id = m."userId" WHERE u.email = $1`, [email])).rows[0].n;
  expect(hours).toBe(2);

  // Mi plan: lugares usados, el plan Equipo como opción y ninguna promesa de activación inmediata.
  await page.goto("/dashboard/facturacion");
  await expect(page.getByTestId("seat-usage")).toContainText("Estás utilizando 2 de 2 profesionales");
  await expect(page.getByTestId("seat-usage")).toContainText("Necesitás más espacio");
  await expect(page.getByTestId("seat-usage")).toContainText("hasta 5 profesionales");
  await expect(page.getByTestId("plan-equipo")).toContainText("19.900");
  await expect(page.getByTestId("plan-equipo")).toContainText("El pago online todavía no está habilitado");
  await noHorizontalScroll(page);
  await shot(page, "mi-plan-prueba");
});

test("trabajo por mi cuenta: onboarding corto, sin paso de equipo", async ({ page }) => {
  await register(page, `e2e-solo-${unique()}@example.com`);
  await page.getByLabel("¿Cómo se llama tu negocio?").fill(`Solo E2E ${unique()}`);
  await page.getByLabel("¿A qué te dedicás?").selectOption("psicologia");
  await expect(page.getByLabel("Trabajo por mi cuenta")).toBeChecked();
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByRole("heading", { name: "Tus servicios" })).toBeVisible();
  await expect(page.getByTestId("team-step")).toHaveCount(0);
});

test("sesiones: cerrar la de otro dispositivo la deja sin acceso y la actual sigue", async ({ page, browser }: { page: Page; browser: Browser }) => {
  const email = `e2e-sesion-${unique()}@example.com`;
  await register(page, email);
  await sql(`UPDATE organizations SET "onboardingCompletedAt" = now() WHERE id IN (SELECT m."organizationId" FROM memberships m JOIN users u ON u.id = m."userId" WHERE u.email = $1)`, [email]);
  // `page` ya quedó con la sesión abierta por el registro; la otra es un dispositivo distinto.
  const other = await browser.newContext({ baseURL: test.info().project.use.baseURL, locale: "es-AR" });
  const otherPage = await other.newPage();
  await login(otherPage, email);

  await page.goto("/dashboard/perfil");
  const sessions = page.getByTestId("sessions");
  await expect(sessions.getByText("Este dispositivo")).toHaveCount(1);
  await shot(page, "sesiones");
  page.once("dialog", (dialog) => dialog.accept());
  await sessions.getByRole("button", { name: "Cerrar las demás sesiones" }).click();
  // La acción es asíncrona: se espera a que las demás estén cerradas antes de probar el otro dispositivo.
  await expect
    .poll(async () => (await sql(`SELECT count(*)::int AS n FROM user_sessions s JOIN users u ON u.id = s."userId" WHERE u.email = $1 AND s."revokedAt" IS NULL`, [email])).rows[0].n)
    .toBe(1);

  await otherPage.goto("/dashboard");
  await expect(otherPage).toHaveURL(/\/login/);
  await page.goto("/dashboard/perfil");
  await expect(page.getByTestId("sessions").getByText("Este dispositivo")).toHaveCount(1);
  await other.close();
});

test("plataforma: el catálogo muestra los precios y la ficha de un negocio no revela datos de clientes", async ({ page }) => {
  const email = `e2e-admin-${unique()}@example.com`;
  await register(page, email);
  await sql(`UPDATE organizations SET "onboardingCompletedAt" = now() WHERE id IN (SELECT m."organizationId" FROM memberships m JOIN users u ON u.id = m."userId" WHERE u.email = $1)`, [email]);
  await sql(`UPDATE users SET "isPlatformAdmin" = true WHERE email = $1`, [email]);

  await page.goto("/admin");
  await expect(page.getByTestId("catalog")).toContainText("Plan Profesional");
  await expect(page.getByTestId("catalog")).toContainText("19.900");
  await expect(page.getByTestId("catalog")).toContainText("ENCENDIDA");
  await page.getByRole("link", { name: /Ana Prueba|Prueba|Negocio/ }).first().click().catch(() => undefined);

  const org = (await sql(`SELECT o.id FROM organizations o JOIN memberships m ON m."organizationId" = o.id JOIN users u ON u.id = m."userId" WHERE u.email = $1`, [email])).rows[0].id as string;
  await page.goto(`/admin/negocios/${org}`);
  const view = page.getByTestId("admin-org");
  await expect(view).toContainText("Equipo y cupos");
  await expect(view).toContainText("1 / 2");
  await expect(view.getByTestId("billing-needed")).toContainText("prueba");
  await shot(page, "admin-negocio");
  await noHorizontalScroll(page);
  expect(await view.innerText()).not.toMatch(/Contrasena123|passwordHash/);
});
