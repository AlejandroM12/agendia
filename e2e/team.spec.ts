import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";
import { registerAndOnboard, sql } from "./helpers";

const TZ = "America/Argentina/Buenos_Aires";
const shot = (page: Page, name: string) =>
  page.screenshot({ path: `e2e/.artifacts/${test.info().project.name}-${name}.png`, fullPage: true });
const dayFromNow = (days: number) => new Date(Date.now() + days * 86_400_000).toLocaleDateString("en-CA", { timeZone: TZ });

const png = (size: number) =>
  sharp({ create: { width: size, height: size, channels: 3, background: "#3a7" } }).png().toBuffer();

async function teamAccount(page: Page, label: string) {
  const suffix = `${test.info().project.name}-${Date.now()}`;
  const email = `e2e-team-${label}-${suffix}@example.com`;
  await registerAndOnboard(page, email, `Barbería ${label} ${suffix}`);
  const { rows } = await sql(
    `SELECT m."organizationId" AS id FROM memberships m JOIN users u ON u.id = m."userId" WHERE u.email = $1`,
    [email],
  );
  return { email, organizationId: rows[0].id as string };
}

const enableTeam = (organizationId: string) =>
  sql(`UPDATE organizations SET "teamModeEnabled" = true WHERE id = $1`, [organizationId]);

test("sin el modo equipo habilitado, la cuenta se ve y se comporta como siempre", async ({ page }) => {
  await teamAccount(page, "solo");

  await page.goto("/dashboard/equipo");
  await expect(page.getByText("Esta función todavía no está habilitada en tu cuenta")).toBeVisible();
  await expect(page.getByRole("link", { name: "Agregar profesional" })).toHaveCount(0);
  await page.goto("/dashboard/equipo/nuevo");
  await expect(page).toHaveURL(/\/dashboard\/equipo$/);

  // Ninguna entrada de menú, ningún selector de profesional.
  await page.goto("/dashboard/mas");
  await expect(page.getByRole("link", { name: /Equipo/ })).toHaveCount(0);
  await page.goto("/dashboard/agenda");
  await expect(page.getByRole("navigation", { name: "Profesional" })).toHaveCount(0);
  await page.goto("/dashboard/turnos/nuevo");
  await expect(page.getByLabel("Profesional", { exact: true })).toHaveCount(0);
  await page.goto("/dashboard/disponibilidad");
  await expect(page.getByRole("heading", { name: "Horario semanal", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Profesional" })).toHaveCount(0);
});

test("equipo: alta, foto, servicios, horarios, turnos simultáneos, WhatsApp manual y desactivación", async ({ page }) => {
  const { organizationId } = await teamAccount(page, "equipo");
  await enableTeam(organizationId);
  const mobile = test.info().project.name === "mobile";
  const tomorrow = dayFromNow(1);
  page.on("dialog", (dialog) => dialog.accept());

  // 1. La sección aparece en la navegación y muestra los cupos de la prueba (2).
  await page.goto(mobile ? "/dashboard/mas" : "/dashboard");
  await page.getByRole("link", { name: /^Equipo/ }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Equipo" })).toBeVisible();
  await expect(page.getByTestId("team-quota")).toContainText("Usás 1 de 2 cupos de profesionales");
  await shot(page, "t1-equipo");

  // 2. Alta de un profesional, sin cuenta propia.
  await page.getByRole("link", { name: "Agregar profesional" }).first().click();
  await page.getByLabel("Nombre", { exact: true }).fill("Martín");
  await page.getByLabel("Descripción").fill("Barbero");
  await page.getByRole("radio", { name: "Color #8a3b12" }).click();
  await shot(page, "t2-nuevo");
  await page.getByRole("button", { name: "Crear profesional" }).click();
  await expect(page).toHaveURL(/\/dashboard\/equipo\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1, name: "Martín" })).toBeVisible();
  const professionalId = page.url().split("/").pop()!;

  // 3. Foto: una imagen chica se rechaza con un mensaje claro; una válida se guarda y se puede quitar.
  const upload = page.locator('input[type="file"]');
  await upload.setInputFiles({ name: "chica.png", mimeType: "image/png", buffer: await png(60) });
  await expect(page.getByRole("alert").filter({ hasText: "muy chica" })).toBeVisible();
  await upload.setInputFiles({ name: "foto.png", mimeType: "image/png", buffer: await png(400) });
  await expect(page.locator('img[src^="/api/media/"]').first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Quitar" })).toBeVisible();
  await shot(page, "t3-perfil");

  // 4. Servicios: por defecto hace todos; se guarda sin errores.
  await expect(page.getByRole("checkbox", { name: /Turno/ })).toBeChecked();
  await page.getByRole("button", { name: "Guardar servicios" }).click();
  await expect(page.getByText("Servicios guardados.")).toBeVisible();

  // 5. Horarios propios: se copian los del dueño y se bloquean unas vacaciones solo para él.
  await page.goto(`/dashboard/disponibilidad?profesional=${professionalId}`);
  await expect(page.getByRole("heading", { name: "Horario semanal de Martín" })).toBeVisible();
  await page.getByRole("button", { name: "Copiar", exact: true }).click();
  await expect(page.getByText("Horarios copiados.")).toBeVisible();
  const from = dayFromNow(20);
  const until = dayFromNow(22);
  const individual = page.locator("section", { has: page.getByRole("heading", { name: /Vacaciones y ausencias de Martín/ }) });
  await individual.getByLabel("Fecha", { exact: true }).fill(from);
  await individual.getByLabel("Hasta").fill(until);
  await individual.getByLabel("Motivo").fill("Vacaciones");
  await individual.getByRole("button", { name: "Agregar bloqueo" }).click();
  await expect(page.getByText("3 días bloqueados.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Quitar bloqueo" })).toHaveCount(3);
  await shot(page, "t4-horarios");
  // Un cierre general se carga aparte y afecta a todos.
  await expect(page.getByRole("heading", { name: "Cierres de todo el negocio" })).toBeVisible();

  // 6. Los cupos se usaron: no se puede agregar a un tercero (ni escribiendo la dirección).
  await page.goto("/dashboard/equipo");
  await expect(page.getByTestId("team-quota")).toContainText("Usás 2 de 2 cupos de profesionales");
  await expect(page.getByRole("link", { name: "Agregar profesional" })).toHaveCount(0);
  await page.goto("/dashboard/equipo/nuevo");
  await expect(page.getByText("Ya usás todos los cupos")).toBeVisible();

  // 7. Turnos al mismo horario con profesionales distintos.
  async function book(client: string, phone: string, professional: string) {
    await page.goto(`/dashboard/turnos/nuevo?fecha=${tomorrow}`);
    await page.getByLabel("Nombre del cliente").fill(client);
    await page.getByLabel("Teléfono (opcional)").fill(phone);
    await page.getByLabel("Profesional", { exact: true }).selectOption({ label: professional });
    const firstSlot = page.getByRole("radiogroup", { name: "Horario" }).getByRole("radio").first();
    await expect(firstSlot).toBeVisible();
    const label = (await firstSlot.textContent())!.trim();
    await firstSlot.click();
    await page.getByRole("button", { name: "Agendar turno" }).click();
    await expect(page).toHaveURL(new RegExp(`/dashboard/agenda\\?fecha=${tomorrow}`));
    return label;
  }
  const martinSlot = await book("Nico Cliente", "11 5555-0002", "Martín");
  const ownerName = (await sql(`SELECT "displayName" AS n FROM professionals WHERE id <> $1 AND "organizationId" = $2`, [professionalId, organizationId])).rows[0].n as string;
  const ownerSlot = await book("Lara Cliente", "11 5555-0003", ownerName);
  expect(ownerSlot).toBe(martinSlot); // el mismo horario, dos profesionales a la vez

  // 8. Agenda del equipo: columnas en escritorio, lista con selector en celular.
  await page.goto(`/dashboard/agenda?fecha=${tomorrow}`);
  await expect(page.getByRole("navigation", { name: "Profesional" })).toBeVisible();
  if (mobile) {
    await expect(page.getByTestId("agenda-columns")).toBeHidden();
    await expect(page.getByRole("link", { name: /Nico Cliente/ })).toContainText("Martín");
    await expect(page.getByRole("link", { name: /Lara Cliente/ })).toContainText(ownerName);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  } else {
    await expect(page.getByTestId("agenda-columns")).toBeVisible();
    await expect(page.getByRole("region", { name: "Agenda de Martín" }).getByRole("link", { name: /Nico Cliente/ })).toBeVisible();
    await expect(page.getByRole("region", { name: `Agenda de ${ownerName}` }).getByRole("link", { name: /Lara Cliente/ })).toBeVisible();
  }
  await shot(page, "t5-agenda");
  // Filtrar por profesional deja solo sus turnos.
  await page.getByRole("navigation", { name: "Profesional" }).getByRole("link", { name: "Martín" }).click();
  await expect(page.getByRole("link", { name: /Nico Cliente/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Lara Cliente/ })).toHaveCount(0);
  await shot(page, "t6-agenda-filtrada");

  // 9. WhatsApp manual: enlaces wa.me con el mensaje armado; nada se envía solo.
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.getByRole("link", { name: /Nico Cliente/ }).click();
  await expect(page.getByText("Atiende Martín")).toBeVisible();
  await page.getByRole("button", { name: "WhatsApp" }).click();
  const reminder = page.getByRole("link", { name: "Enviar recordatorio" });
  const href = (await reminder.getAttribute("href"))!;
  expect(href).toMatch(/^https:\/\/wa\.me\/5491155550002\?text=/);
  expect(decodeURIComponent(href)).toContain("Te recordamos que mañana tenés un turno");
  expect(decodeURIComponent(href)).toContain("Profesional: Martín.");
  expect(decodeURIComponent(href)).toMatch(/\/turno\/[\w-]+/);
  await page.getByLabel("Mensaje discreto").check();
  expect(decodeURIComponent((await reminder.getAttribute("href"))!)).not.toContain("Martín");
  await expect(reminder).toHaveAttribute("target", "_blank");
  await expect(reminder).toHaveAttribute("rel", /noopener/);
  await expect(page.getByText("Agendia no lo envía")).toBeVisible();
  await shot(page, "t7-whatsapp");
  expect(requests.filter((url) => url.includes("wa.me"))).toEqual([]);
  expect(await sql(`SELECT 1 FROM notifications WHERE "organizationId" = $1 AND channel::text <> 'email'`, [organizationId])).toHaveProperty("rowCount", 0);

  // 10. Desactivar con turnos: primero hay que resolverlos.
  await page.goto(`/dashboard/equipo/${professionalId}`);
  await expect(page.getByText(/Tiene 1 turno por venir/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Desactivar profesional" })).toHaveCount(0);
  await page.getByRole("link", { name: "Resolver sus turnos" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Turnos de Martín" })).toBeVisible();
  await expect(page.getByText("Ningún otro profesional tiene libre ese horario.")).toBeVisible(); // el dueño está ocupado a esa hora
  await shot(page, "t8-resolver");

  // Se libera el horario del otro profesional cancelando su turno, y entonces se puede pasar.
  await sql(`UPDATE appointments SET status = 'canceled' WHERE "organizationId" = $1 AND "professionalId" <> $2`, [organizationId, professionalId]);
  await page.reload();
  await page.getByRole("button", { name: "Pasar turno" }).click();
  await expect(page.getByText("Ya no tiene turnos por venir")).toBeVisible();
  expect((await sql(`SELECT "professionalId" AS p FROM appointments WHERE "organizationId" = $1 AND status = 'confirmed'`, [organizationId])).rows[0].p).not.toBe(professionalId);

  await page.getByRole("button", { name: "Desactivar profesional" }).click();
  await expect(page).toHaveURL(/\/dashboard\/equipo$/);
  await expect(page.getByTestId("team-quota")).toContainText("Usás 1 de 2 cupos de profesionales");
  await expect(page.getByRole("heading", { name: "Desactivados" })).toBeVisible();
  // El historial se conserva: el profesional y el turno siguen en la base.
  expect((await sql(`SELECT active FROM professionals WHERE id = $1`, [professionalId])).rows[0].active).toBe(false);
  expect((await sql(`SELECT count(*)::int AS n FROM appointments WHERE "organizationId" = $1`, [organizationId])).rows[0].n).toBe(2);
  await shot(page, "t9-desactivado");
});
