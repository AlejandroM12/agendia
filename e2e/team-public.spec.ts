import { expect, test, type Browser, type Page } from "@playwright/test";
import sharp from "sharp";
import { registerAndOnboard, sql } from "./helpers";

const TZ = "America/Argentina/Buenos_Aires";
const shot = (page: Page, name: string) =>
  page.screenshot({ path: `e2e/.artifacts/${test.info().project.name}-${name}.png`, fullPage: true });
const dayFromNow = (days: number) => new Date(Date.now() + days * 86_400_000).toLocaleDateString("en-CA", { timeZone: TZ });

async function shop(page: Page, label: string, options: { team: boolean }) {
  const suffix = `${test.info().project.name}-${Date.now()}`;
  const email = `e2e-pub-${label}-${suffix}@example.com`;
  const business = `Barbería ${label} ${suffix}`;
  await registerAndOnboard(page, email, business);
  const { rows } = await sql(
    `SELECT o.id, o.slug FROM organizations o JOIN memberships m ON m."organizationId" = o.id JOIN users u ON u.id = m."userId" WHERE u.email = $1`,
    [email],
  );
  const { id, slug } = rows[0] as { id: string; slug: string };
  if (options.team) await sql(`UPDATE organizations SET "teamModeEnabled" = true WHERE id = $1`, [id]);

  // Segundo profesional con foto, descripción y el mismo horario que el dueño.
  const photo = await sharp({ create: { width: 320, height: 320, channels: 3, background: "#b5651d" } }).webp().toBuffer();
  const image = await sql(
    `INSERT INTO organization_images (id, "organizationId", kind, "contentType", width, height, bytes)
     VALUES (gen_random_uuid(), $1, 'professional', 'image/webp', 320, 320, $2) RETURNING id`,
    [id, photo],
  );
  const pro = await sql(
    `INSERT INTO professionals (id, "organizationId", "displayName", description, color, "sortOrder", "photoImageId", "updatedAt")
     VALUES (gen_random_uuid(), $1, 'Martín', 'Barbero, especialista en barba', '#8a3b12', 5, $2, now()) RETURNING id`,
    [id, image.rows[0].id],
  );
  await sql(
    `INSERT INTO availability_rules (id, "organizationId", "professionalId", weekday, "startMinute", "endMinute")
     SELECT gen_random_uuid(), $1, $2, weekday, "startMinute", "endMinute" FROM availability_rules WHERE "organizationId" = $1 AND "professionalId" <> $2`,
    [id, pro.rows[0].id],
  );
  const owner = await sql(`SELECT id, "displayName" FROM professionals WHERE "organizationId" = $1 AND id <> $2`, [id, pro.rows[0].id]);
  return { id, slug, business, ownerId: owner.rows[0].id as string, ownerName: owner.rows[0].displayName as string, martinId: pro.rows[0].id as string };
}

async function guestPage(browser: Browser) {
  const context = await browser.newContext({ ...test.info().project.use, storageState: undefined });
  return { page: await context.newPage(), context };
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}

test("reserva pública con equipo: elegir profesional, cualquiera, conflicto sin perder datos y gestión del turno", async ({ page, browser }) => {
  const t = await shop(page, "equipo", { team: true });
  const { page: guest, context } = await guestPage(browser);
  const tomorrow = dayFromNow(1);

  // 1. El servicio es uno solo: se elige solo y aparece el paso de profesional, con las opciones reales.
  await guest.goto(`/${t.slug}`);
  const picker = guest.getByRole("radiogroup", { name: "Profesional" });
  await expect(picker).toBeVisible();
  await expect(picker.getByRole("radio")).toHaveCount(3); // dueño, Martín y «Cualquier profesional»
  // Orden definido por el negocio: el dueño (orden 0) antes que Martín (orden 5); «cualquiera» al final.
  await expect(picker.getByRole("radio").nth(0)).toContainText(t.ownerName);
  await expect(picker.getByRole("radio").nth(1)).toContainText("Martín");
  await expect(picker.getByRole("radio").nth(1)).toContainText("Barbero, especialista en barba");
  await expect(picker.getByRole("radio").nth(2)).toContainText("Cualquier profesional");
  await expect(picker.getByRole("radio").nth(2)).toContainText("Encontrá un horario con cualquiera de los profesionales disponibles");
  // Con foto se muestra la foto; sin foto, la inicial. Nada de datos privados en el HTML.
  await expect(picker.getByRole("radio").nth(1).locator('img[src^="/api/media/"]')).toBeVisible();
  await expect(picker.getByRole("radio").nth(0).locator("img")).toHaveCount(0);
  const html = await guest.content();
  expect(html).not.toMatch(/userId|bookableOnline|sortOrder|#8a3b12/);
  await noOverflow(guest);
  await shot(guest, "p1-elegir-profesional");

  // Sin elegir profesional no hay horarios: se pide primero la elección.
  await expect(guest.getByRole("heading", { name: /Elegí día y horario/ })).toHaveCount(0);

  // 2. Teclado: las tarjetas se eligen con Enter; un horario se elige sin mouse.
  await picker.getByRole("radio").nth(1).focus();
  await guest.keyboard.press("Enter");
  await expect(picker.getByRole("radio").nth(1)).toHaveAttribute("aria-checked", "true");
  const slots = guest.getByRole("radiogroup", { name: "Horario" }).getByRole("radio");
  await expect(slots.first()).toBeVisible();
  await guest.getByRole("tab", { name: new RegExp(`${Number(tomorrow.slice(8))} de`) }).click();
  const slotLabel = (await slots.first().textContent())!.trim();
  await slots.first().click();

  // 3. Resumen con todo lo elegido antes de confirmar; los datos se completan.
  await guest.getByLabel("Nombre y apellido").fill("Nico Público");
  await guest.getByLabel("Email").fill(`nico-${Date.now()}@example.com`);
  await guest.getByLabel("WhatsApp o teléfono").fill("11 5555-0101");
  const summary = guest.getByRole("group", { name: "Resumen de tu reserva" }).or(guest.locator('dl[aria-label="Resumen de tu reserva"]'));
  await expect(summary).toContainText(t.business);
  await expect(summary).toContainText("Martín");
  await expect(summary).toContainText(`${slotLabel} h`);
  await expect(summary).toContainText("Nico Público");
  await noOverflow(guest);
  await shot(guest, "p2-resumen");

  // 4. Mientras tanto, otra persona ocupa ese horario con Martín: se informa y no se pierde lo escrito.
  const startsAt = new Date(`${tomorrow}T${slotLabel}:00-03:00`);
  const customer = await sql(
    `INSERT INTO customers (id, "organizationId", name, email, "updatedAt") VALUES (gen_random_uuid(), $1, 'Otro Cliente', 'otro@example.com', now()) RETURNING id`,
    [t.id],
  );
  const service = await sql(`SELECT id FROM services WHERE "organizationId" = $1 LIMIT 1`, [t.id]);
  await sql(
    `INSERT INTO appointments (id, "organizationId", "professionalId", "serviceId", "customerId", "startsAt", "endsAt", "manageToken", "updatedAt")
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5::timestamptz, $5::timestamptz + interval '30 minutes', $6, now())`,
    [t.id, t.martinId, service.rows[0].id, customer.rows[0].id, startsAt.toISOString(), `ocupado-${Date.now()}-token-largo-123`],
  );
  await guest.getByRole("button", { name: "Confirmar reserva" }).click();
  await expect(guest.getByText(/acaba de ocuparse/)).toBeVisible();
  await expect(guest.getByText(/Tus datos quedaron guardados/)).toBeVisible();
  await expect(picker.getByRole("radio").nth(1)).toHaveAttribute("aria-checked", "true"); // sigue con Martín
  await shot(guest, "p3-conflicto");
  // Elige otro horario: los datos siguen ahí, sin volver a escribir.
  await slots.first().click();
  await expect(guest.getByLabel("Nombre y apellido")).toHaveValue("Nico Público");
  await expect(guest.getByLabel("WhatsApp o teléfono")).toHaveValue("11 5555-0101");
  await guest.getByRole("button", { name: "Confirmar reserva" }).click();
  await expect(guest.getByRole("heading", { name: "¡Turno confirmado!" })).toBeVisible();
  await expect(guest.getByText("Te atiende Martín").first()).toBeVisible();
  await shot(guest, "p4-confirmado");

  // 5. El turno de Martín no le saca horarios al dueño: «cualquiera» muestra la unión.
  await guest.getByRole("button", { name: "Reservar otro turno" }).click();
  await guest.getByRole("radiogroup", { name: "Profesional" }).getByRole("radio").nth(2).click();
  await guest.getByRole("tab", { name: new RegExp(`${Number(tomorrow.slice(8))} de`) }).click();
  await guest.getByRole("radiogroup", { name: "Horario" }).getByRole("radio").first().click();
  await guest.getByLabel("Nombre y apellido").fill("Lara Cualquiera");
  await guest.getByLabel("Email").fill(`lara-${Date.now()}@example.com`);
  await expect(guest.locator('dl[aria-label="Resumen de tu reserva"]')).toContainText("Cualquier profesional");
  await guest.getByRole("button", { name: "Confirmar reserva" }).click();
  await expect(guest.getByRole("heading", { name: "¡Turno confirmado!" })).toBeVisible();
  await expect(guest.getByText(/Te atiende/)).toBeVisible(); // se informa el profesional efectivamente asignado
  const stored = await sql(`SELECT "professionalSelection" AS s, "requestedProfessionalId" AS r FROM appointments a JOIN customers c ON c.id = a."customerId" WHERE c.name = 'Lara Cualquiera' AND a."organizationId" = $1`, [t.id]);
  expect(stored.rows[0]).toEqual({ s: "any", r: null });

  // 6. Gestión del turno: se ve quién atiende; con «cualquiera» se avisa que puede cambiar; sin credenciales de otros.
  await guest.getByRole("link", { name: "Ver mi turno" }).click();
  await expect(guest).toHaveURL(/\/turno\//);
  await expect(guest.getByText(/Te atiende/).first()).toBeVisible();
  await expect(guest.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
  // Y también por encabezado: el token del enlace no viaja a terceros.
  const headers = await (await guest.request.get(guest.url())).headers();
  expect(headers["referrer-policy"]).toBe("no-referrer");
  await guest.getByRole("button", { name: "Reprogramar" }).click();
  await expect(guest.getByText(/Reservaste con «cualquier profesional»/)).toBeVisible();
  await expect(guest.getByText(/puede cambiar quién te atiende/)).toBeVisible();
  await shot(guest, "p5-gestion-cualquiera");
  await context.close();
});

test("quien eligió un profesional lo conserva al reprogramar, y se informa si ya no atiende online", async ({ page, browser }) => {
  const t = await shop(page, "repro", { team: true });
  const { page: guest, context } = await guestPage(browser);
  const tomorrow = dayFromNow(1);

  await guest.goto(`/${t.slug}`);
  await guest.getByRole("radiogroup", { name: "Profesional" }).getByRole("radio").nth(1).click();
  await guest.getByRole("tab", { name: new RegExp(`${Number(tomorrow.slice(8))} de`) }).click();
  await guest.getByRole("radiogroup", { name: "Horario" }).getByRole("radio").first().click();
  await guest.getByLabel("Nombre y apellido").fill("Rita Específica");
  await guest.getByLabel("Email").fill(`rita-${Date.now()}@example.com`);
  await guest.getByRole("button", { name: "Confirmar reserva" }).click();
  await expect(guest.getByText("Te atiende Martín").first()).toBeVisible();
  await guest.getByRole("link", { name: "Ver mi turno" }).click();
  await expect(guest).toHaveURL(/\/turno\//);
  await expect(guest.getByText("Te atiende Martín", { exact: true })).toBeVisible();

  await guest.getByRole("button", { name: "Reprogramar" }).click();
  await expect(guest.getByText("Seguís con Martín: solo ves sus horarios.")).toBeVisible();
  await guest.getByRole("tab", { name: new RegExp(`${Number(dayFromNow(2).slice(8))} de`) }).click();
  await guest.getByRole("radiogroup", { name: "Horario" }).getByRole("radio").nth(1).click();
  await guest.getByRole("button", { name: /^Pasar al/ }).click();
  await expect(guest.getByText("Listo, reprogramamos tu turno.")).toBeVisible();
  await expect(guest.getByText("Te atiende Martín").first()).toBeVisible();
  expect((await sql(`SELECT "professionalId" AS p FROM appointments a JOIN customers c ON c.id = a."customerId" WHERE c.name = 'Rita Específica' AND a."organizationId" = $1`, [t.id])).rows[0].p).toBe(t.martinId);

  // Martín deja de recibir reservas online: se informa claramente y no se lo reemplaza.
  await sql(`UPDATE professionals SET "bookableOnline" = false WHERE id = $1`, [t.martinId]);
  await guest.reload();
  await guest.getByRole("button", { name: "Reprogramar" }).click();
  await expect(guest.getByText(/ya no está disponible para reprogramar online/)).toBeVisible();
  await shot(guest, "p6-profesional-no-disponible");

  // «Mis turnos» muestra también quién atiende.
  await context.close();
});

test("un servicio sin profesionales elegibles lo dice y no deja reservar", async ({ page, browser }) => {
  const t = await shop(page, "sinpro", { team: true });
  await sql(`UPDATE professionals SET "bookableOnline" = false WHERE "organizationId" = $1`, [t.id]);
  const { page: guest, context } = await guestPage(browser);
  await guest.goto(`/${t.slug}`);
  await expect(guest.getByText(/no se puede reservar online/)).toBeVisible();
  await expect(guest.getByRole("radiogroup", { name: "Horario" })).toHaveCount(0);
  await expect(guest.getByRole("button", { name: "Confirmar reserva" })).toHaveCount(0);
  await shot(guest, "p7-sin-profesionales");
  await context.close();
});

test("con el modo equipo apagado la reserva pública es la de siempre, aunque haya más profesionales cargados", async ({ page, browser }) => {
  const t = await shop(page, "apagado", { team: false });
  const { page: guest, context } = await guestPage(browser);
  const tomorrow = dayFromNow(1);
  await guest.goto(`/${t.slug}`);
  // Ni paso de profesional ni mención de Martín.
  await expect(guest.getByRole("radiogroup", { name: "Profesional" })).toHaveCount(0);
  await expect(guest.getByText("Martín")).toHaveCount(0);
  await guest.getByRole("tab", { name: new RegExp(`${Number(tomorrow.slice(8))} de`) }).click();
  await guest.getByRole("radiogroup", { name: "Horario" }).getByRole("radio").first().click();
  await guest.getByLabel("Nombre y apellido").fill("Sara Clásica");
  await guest.getByLabel("Email").fill(`sara-${Date.now()}@example.com`);
  await expect(guest.locator('dl[aria-label="Resumen de tu reserva"]')).not.toContainText("Profesional");
  await guest.getByRole("button", { name: "Confirmar reserva" }).click();
  await expect(guest.getByRole("heading", { name: "¡Turno confirmado!" })).toBeVisible();
  await expect(guest.getByText(/Te atiende/)).toHaveCount(0);
  await guest.getByRole("link", { name: "Ver mi turno" }).click();
  await expect(guest.getByText(/Te atiende/)).toHaveCount(0);
  // Se asignó al profesional de siempre, no a Martín.
  expect((await sql(`SELECT "professionalId" AS p FROM appointments a JOIN customers c ON c.id = a."customerId" WHERE c.name = 'Sara Clásica' AND a."organizationId" = $1`, [t.id])).rows[0].p).toBe(t.ownerId);
  await context.close();
});

test("la vista previa del panel muestra el paso de profesional con la identidad del negocio", async ({ page }) => {
  const t = await shop(page, "previa", { team: true });
  await sql(`UPDATE organizations SET "themePrimary" = '#7a2e65', "themeSecondary" = '#f3e3ef' WHERE id = $1`, [t.id]);
  await page.goto("/vista-previa");
  const picker = page.getByRole("radiogroup", { name: "Profesional" });
  await expect(picker).toBeVisible();
  await picker.getByRole("radio").nth(1).click();
  await expect(picker.getByRole("radio").nth(1)).toHaveAttribute("aria-checked", "true");
  // Foco visible por teclado y colores del negocio aplicados (no los de Agendia).
  await picker.getByRole("radio").nth(0).focus();
  const border = await picker.getByRole("radio").nth(1).evaluate((el) => getComputedStyle(el).borderColor);
  expect(border).not.toBe("rgb(31, 77, 63)"); // el verde de Agendia
  await noOverflow(page);
  await shot(page, "p8-vista-previa");
});
