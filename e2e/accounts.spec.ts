import { expect, test, type Browser, type Page } from "@playwright/test";
import { registerAndOnboard, resetRateLimits, sql } from "./helpers";

const TZ = "America/Argentina/Buenos_Aires";
const shot = (page: Page, name: string) =>
  page.screenshot({ path: `e2e/.artifacts/${test.info().project.name}-${name}.png`, fullPage: true });
const dayFromNow = (days: number) => new Date(Date.now() + days * 86_400_000).toLocaleDateString("en-CA", { timeZone: TZ });
const mobile = () => test.info().project.name === "mobile";

/** Negocio con equipo y cuentas individuales habilitadas, un segundo profesional con un turno y el propietario con otro. */
async function teamShop(page: Page, label: string) {
  const suffix = `${test.info().project.name}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const email = `e2e-acc-${label}-${suffix}@example.com`;
  const business = `Barbería ${label} ${suffix}`;
  await registerAndOnboard(page, email, business);
  const { rows } = await sql(
    `SELECT o.id FROM organizations o JOIN memberships m ON m."organizationId" = o.id JOIN users u ON u.id = m."userId" WHERE u.email = $1`,
    [email],
  );
  const id = rows[0].id as string;
  await sql(`UPDATE organizations SET "teamModeEnabled" = true, "teamAccountsEnabled" = true WHERE id = $1`, [id]);
  const owner = (await sql(`SELECT id, "displayName" FROM professionals WHERE "organizationId" = $1`, [id])).rows[0];
  const martin = (
    await sql(
      `INSERT INTO professionals (id, "organizationId", "displayName", "sortOrder", "updatedAt") VALUES (gen_random_uuid(), $1, 'Martín', 5, now()) RETURNING id`,
      [id],
    )
  ).rows[0].id as string;
  await sql(
    `INSERT INTO availability_rules (id, "organizationId", "professionalId", weekday, "startMinute", "endMinute")
     SELECT gen_random_uuid(), $1, $2, weekday, "startMinute", "endMinute" FROM availability_rules WHERE "organizationId" = $1 AND "professionalId" <> $2`,
    [id, martin],
  );
  const service = (await sql(`SELECT id FROM services WHERE "organizationId" = $1 LIMIT 1`, [id])).rows[0].id as string;

  async function appointment(professionalId: string, name: string, phone: string, hour: number) {
    const customer = (
      await sql(`INSERT INTO customers (id, "organizationId", name, phone, email, notes, "updatedAt") VALUES (gen_random_uuid(), $1, $2, $3, $4, 'nota privada del negocio', now()) RETURNING id`, [id, name, phone, `${phone}@example.com`])
    ).rows[0].id as string;
    const start = new Date(`${dayFromNow(1)}T${String(hour).padStart(2, "0")}:00:00-03:00`);
    const appt = (
      await sql(
        `INSERT INTO appointments (id, "organizationId", "professionalId", "serviceId", "customerId", "startsAt", "endsAt", "manageToken", notes, "updatedAt")
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5::timestamptz, $5::timestamptz + interval '30 minutes', $6, 'nota interna del turno', now()) RETURNING id`,
        [id, professionalId, service, customer, start.toISOString(), `tok-${phone}-${Date.now()}-largo-largo`],
      )
    ).rows[0].id as string;
    return { customer, appt };
  }
  const martinAppt = await appointment(martin, "Cliente de Martín", "1155550101", 10);
  const ownerAppt = await appointment(owner.id, "Cliente de la dueña", "1155550202", 11);
  return { id, email, business, martin, owner, martinAppt, ownerAppt };
}

async function guest(browser: Browser) {
  const context = await browser.newContext({ ...test.info().project.use, storageState: undefined });
  return { page: await context.newPage(), context };
}

async function invite(page: Page, professionalId: string, to: string) {
  await page.goto(`/dashboard/equipo/${professionalId}`);
  await expect(page.getByText("Sin acceso individual")).toBeVisible();
  await page.getByLabel("Invitar a Agendia").fill(to);
  await page.getByRole("button", { name: "Enviar invitación" }).click();
  const link = page.locator('a[href^="/invitacion/"]').first();
  await expect(link).toBeVisible();
  await expect(page.getByText("Invitación pendiente")).toBeVisible({ timeout: 15_000 }).catch(() => undefined);
  return (await link.getAttribute("href"))!;
}

test("invitación de un profesional: acepta sin cuenta, ve solo lo suyo, y al revocarle el acceso se corta de inmediato", async ({ page, browser }) => {
  const shopInfo = await teamShop(page, "inv");
  const proEmail = `e2e-pro-${Date.now()}-${test.info().project.name}@example.com`;
  page.on("dialog", (dialog) => dialog.accept());

  // 1. El propietario invita a Martín: queda «pendiente» y el enlace de prueba aparece (sin correo configurado).
  const link = await invite(page, shopInfo.martin, proEmail);
  await shot(page, "a1-invitar");
  await page.goto(`/dashboard/equipo/${shopInfo.martin}`);
  await expect(page.getByText("Invitación pendiente")).toBeVisible();
  await expect(page.getByRole("button", { name: "Reenviar invitación" })).toBeVisible();
  // El panel nunca muestra el token: solo el correo y el vencimiento.
  expect(await page.content()).not.toContain(link.split("/").pop()!);

  // 2. Martín abre el enlace sin cuenta: ve el negocio, elige contraseña y entra directo.
  const { page: pro, context } = await guest(browser);
  await pro.goto(link);
  await expect(pro.getByRole("heading", { name: new RegExp(`Te invitaron a ${shopInfo.business}`) })).toBeVisible();
  expect(await pro.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await expect((await pro.request.get(pro.url())).headers()["referrer-policy"]).toBe("no-referrer");
  await shot(pro, "a2-aceptar");
  await pro.getByLabel("Tu nombre").fill("Martín Gómez");
  await pro.getByLabel("Elegí una contraseña").fill("ContrasenaMartin123");
  await pro.getByRole("button", { name: "Aceptar y entrar a mi agenda" }).click();
  await expect(pro).toHaveURL(/\/dashboard$/);
  await expect(pro.getByText(`Tu agenda en ${shopInfo.business}`)).toBeVisible();
  await shot(pro, "a3-hoy-profesional");

  // 3. Su panel es el del profesional: sin secciones de gestión.
  if (mobile()) {
    await expect(pro.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Turnos" })).toBeVisible();
    await pro.goto("/dashboard/mas");
    await expect(pro.getByRole("link", { name: /Servicios|Equipo|Mi plan|Configuración/ })).toHaveCount(0);
    await expect(pro.getByRole("link", { name: /Mi perfil/ })).toBeVisible();
  } else {
    const nav = pro.getByRole("navigation", { name: "Principal" });
    await expect(nav.getByRole("link", { name: "Mi agenda" })).toBeVisible();
    await expect(nav.getByRole("link", { name: /Servicios|Equipo|Mi plan|Configuración|Mi página pública|Recordatorios/ })).toHaveCount(0);
  }
  for (const path of ["/dashboard/servicios", "/dashboard/equipo", "/dashboard/facturacion", "/dashboard/configuracion", "/dashboard/pagina", "/dashboard/recordatorios", "/dashboard/equipo/accesos"]) {
    await pro.goto(path);
    await expect(pro, path).toHaveURL(/\/dashboard$/);
  }

  // 4. Solo ve su agenda y sus clientes; un identificador ajeno no abre nada.
  await pro.goto(`/dashboard/agenda?fecha=${dayFromNow(1)}`);
  await expect(pro.getByRole("link", { name: /Cliente de Martín/ })).toBeVisible();
  await expect(pro.getByText("Cliente de la dueña")).toHaveCount(0);
  await expect(pro.getByRole("navigation", { name: "Profesional" })).toHaveCount(0); // sin permiso para ver compañeros
  await pro.goto("/dashboard/clientes");
  await expect(pro.getByRole("link", { name: /Cliente de Martín/ })).toBeVisible();
  await expect(pro.getByText("Cliente de la dueña")).toHaveCount(0);
  await pro.goto(`/dashboard/turnos/${shopInfo.ownerAppt.appt}`);
  await expect(pro.getByRole("heading", { name: "No encontramos esta página" })).toBeVisible();
  await expect(pro.getByText("Cliente de la dueña")).toHaveCount(0);
  await pro.goto(`/dashboard/clientes/${shopInfo.ownerAppt.customer}`);
  await expect(pro.getByRole("heading", { name: "No encontramos esta página" })).toBeVisible();

  // 5. En su turno: datos mínimos, WhatsApp, sin notas internas y sin cancelar (permiso predeterminado).
  await pro.goto(`/dashboard/turnos/${shopInfo.martinAppt.appt}`);
  await expect(pro.getByRole("button", { name: "Reprogramar" })).toBeVisible();
  await expect(pro.getByRole("button", { name: "Cancelar turno" })).toHaveCount(0);
  await expect(pro.getByText("Nota interna")).toHaveCount(0);
  await expect(pro.getByText("nota interna del turno")).toHaveCount(0);
  await expect(pro.getByText("nota privada del negocio")).toHaveCount(0);
  await expect(pro.getByRole("link", { name: /@example.com/ })).toHaveCount(0); // sin el correo del cliente
  await pro.getByRole("button", { name: "WhatsApp" }).click();
  expect(await pro.getByRole("link", { name: "Enviar recordatorio" }).getAttribute("href")).toMatch(/^https:\/\/wa\.me\/5491155550101\?text=/);
  await shot(pro, "a4-turno-profesional");

  // 6. Mi perfil: su cuenta y lo que puede hacer.
  await pro.goto("/dashboard/perfil");
  await expect(pro.getByRole("heading", { level: 1, name: "Mi perfil" })).toBeVisible();
  await expect(pro.getByText("Cancelar turnos propios")).toBeVisible();
  await shot(pro, "a5-perfil");

  // 7. El propietario ve «Cuenta vinculada» y puede cambiar lo que Martín puede hacer.
  await page.goto(`/dashboard/equipo/${shopInfo.martin}`);
  await expect(page.getByText("Cuenta vinculada")).toBeVisible();
  await expect(page.getByText(proEmail)).toBeVisible();
  await page.goto("/dashboard/equipo/accesos");
  await page.getByLabel("Cancelar turnos propios").check();
  await page.getByRole("button", { name: "Guardar permisos" }).click();
  await expect(page.getByText(/Permisos guardados/)).toBeVisible();
  await shot(page, "a6-permisos");
  // Se aplica de inmediato, con la sesión de Martín ya abierta.
  await pro.goto(`/dashboard/turnos/${shopInfo.martinAppt.appt}`);
  await expect(pro.getByRole("button", { name: "Cancelar turno" })).toBeVisible();

  // 8. Revocar el acceso: la sesión abierta de Martín deja de servir en el siguiente pedido.
  await page.goto(`/dashboard/equipo/${shopInfo.martin}`);
  await page.getByRole("button", { name: "Revocar acceso" }).click();
  await expect(page.getByText(/Acceso revocado/).first()).toBeVisible();
  await pro.goto("/dashboard");
  await expect(pro).toHaveURL(/\/sin-acceso$/);
  await expect(pro.getByRole("heading", { name: "Tu cuenta no tiene acceso a ningún negocio" })).toBeVisible();
  await pro.goto(`/dashboard/turnos/${shopInfo.martinAppt.appt}`);
  await expect(pro).toHaveURL(/\/sin-acceso$/);
  await expect(pro.getByText("Cliente de Martín")).toHaveCount(0);
  await shot(pro, "a7-sin-acceso");
  // Nada se perdió: el perfil, el turno y el cliente siguen, y la agenda sigue a cargo del negocio.
  expect((await sql(`SELECT active FROM professionals WHERE id = $1`, [shopInfo.martin])).rows[0].active).toBe(true);
  expect((await sql(`SELECT status::text AS s FROM appointments WHERE id = $1`, [shopInfo.martinAppt.appt])).rows[0].s).toBe("confirmed");
  expect((await sql(`SELECT count(*)::int AS n FROM memberships WHERE "organizationId" = $1`, [shopInfo.id])).rows[0].n).toBe(1);
  await page.goto(`/dashboard/agenda?fecha=${dayFromNow(1)}`);
  await expect(page.getByRole("link", { name: /Cliente de Martín/ }).filter({ visible: true }).first()).toBeVisible();
  await context.close();
});

test("una cuenta existente con varios negocios: acepta una invitación, cambia de negocio y cada uno conserva su rol", async ({ page, browser }) => {
  const host = await teamShop(page, "host");
  const { page: other, context } = await guest(browser);
  const otherEmail = `e2e-multi-${Date.now()}-${test.info().project.name}@example.com`;
  const ownBusiness = `Consultorio propio ${Date.now()}`;
  await registerAndOnboard(other, otherEmail, ownBusiness);
  page.on("dialog", (dialog) => dialog.accept());

  const link = await invite(page, host.martin, otherEmail);
  // Un enlace con un correo equivocado no sirve: ingresa con la cuenta correcta.
  await other.goto(link);
  await expect(other.getByRole("heading", { name: new RegExp(`Te invitaron a ${host.business}`) })).toBeVisible();
  await other.getByRole("button", { name: "Aceptar la invitación" }).click();
  await expect(other).toHaveURL(/\/dashboard$/);
  await expect(other.getByText(`Tu agenda en ${host.business}`)).toBeVisible();

  // Pertenece a dos negocios: el selector muestra nombre y rol, y marca el actual.
  const switcher = other.getByRole("button", { name: new RegExp(host.business) }).first();
  await expect(switcher).toContainText("Profesional");
  await switcher.click();
  const options = other.getByRole("listbox", { name: "Tus negocios" }).getByRole("option");
  await expect(options).toHaveCount(2);
  await expect(options.filter({ hasText: ownBusiness })).toContainText("Propietario");
  await shot(other, "a8-selector");
  await options.filter({ hasText: ownBusiness }).getByRole("button").click();
  // Espera a que el cambio termine: el selector pasa a mostrar el negocio propio, con el rol de propietaria.
  await expect(other.getByRole("listbox")).toHaveCount(0);
  await expect(other.getByRole("button", { name: new RegExp(ownBusiness) }).first()).toContainText("Propietario");
  // En su propio negocio sigue siendo propietaria: ve todo y no ve lo del otro.
  await other.goto("/dashboard/configuracion");
  await expect(other.getByRole("heading", { name: "Configuración" })).toBeVisible();
  await other.goto("/dashboard/clientes");
  await expect(other.getByText("Cliente de Martín")).toHaveCount(0);

  // Y vuelve al otro: su rol y su alcance son los de allá.
  await other.goto("/dashboard");
  await other.getByRole("button", { name: new RegExp(ownBusiness) }).first().click();
  await other.getByRole("listbox", { name: "Tus negocios" }).getByRole("option").filter({ hasText: host.business }).getByRole("button").click();
  await expect(other.getByRole("listbox")).toHaveCount(0);
  await expect(other.getByRole("button", { name: new RegExp(host.business) }).first()).toContainText("Profesional");
  await other.goto("/dashboard/servicios");
  await expect(other).toHaveURL(/\/dashboard$/);
  await other.goto(`/dashboard/agenda?fecha=${dayFromNow(1)}`);
  await expect(other.getByText("Cliente de la dueña")).toHaveCount(0);
  await expect(other.getByRole("link", { name: /Cliente de Martín/ })).toBeVisible();

  // Revocarle el acceso a ese negocio no toca el suyo: sigue entrando a su consultorio.
  await page.goto(`/dashboard/equipo/${host.martin}`);
  await page.getByRole("button", { name: "Revocar acceso" }).click();
  await expect(page.getByText(/Acceso revocado/).first()).toBeVisible();
  await other.goto("/dashboard");
  await expect(other).toHaveURL(/\/dashboard$/);
  await expect(other.getByRole("heading", { level: 1 })).toContainText(/Buen|Buenas/);
  await other.goto("/dashboard/configuracion");
  await expect(other.getByRole("heading", { name: "Configuración" })).toBeVisible();
  await context.close();
});

test("enlaces de invitación inválidos o de otra cuenta: mensajes claros y sin filtrar nada", async ({ page, browser }) => {
  const shopInfo = await teamShop(page, "bad");
  const link = await invite(page, shopInfo.martin, `e2e-bad-${Date.now()}-${test.info().project.name}@example.com`);
  const { page: stranger, context } = await guest(browser);

  for (const path of ["/invitacion/token-que-no-existe-0123456789", `${link}x`, "/invitacion/corto"]) {
    await stranger.goto(path);
    await expect(stranger.getByText("Esta invitación no es válida"), path).toBeVisible();
    await expect(stranger.getByText(shopInfo.business)).toHaveCount(0);
  }
  // Una vez revocada, el mismo enlace ya no sirve (y el mensaje es el mismo que para uno inventado).
  await page.goto(`/dashboard/equipo/${shopInfo.martin}`);
  page.on("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Cancelar invitación" }).click();
  await expect(page.getByText("Sin acceso individual")).toBeVisible();
  await stranger.goto(link);
  await expect(stranger.getByText("Esta invitación no es válida")).toBeVisible();

  // Con otra cuenta iniciada, avisa que es para otro correo (y no deja aceptar).
  const link2 = await invite(page, shopInfo.martin, `e2e-bad2-${Date.now()}-${test.info().project.name}@example.com`);
  const wrongEmail = `e2e-wrong-${Date.now()}-${test.info().project.name}@example.com`;
  await registerAndOnboard(stranger, wrongEmail, `Otro negocio ${Date.now()}`);
  await stranger.goto(link2);
  await expect(stranger.getByText("Ingresaste con otra cuenta")).toBeVisible();
  await expect(stranger.getByRole("button", { name: "Aceptar la invitación" })).toHaveCount(0);
  await shot(stranger, "a9-otra-cuenta");
  await context.close();
  // Sin el modo habilitado no hay invitaciones.
  await sql(`UPDATE organizations SET "teamAccountsEnabled" = false WHERE id = $1`, [shopInfo.id]);
  await page.goto(`/dashboard/equipo/${shopInfo.martin}`);
  await expect(page.getByText(/cuentas individuales todavía no están habilitadas/)).toBeVisible();
});
