import { createHash, randomBytes } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";
import sharp from "sharp";
import { registerAndOnboard, sql } from "./helpers";

const shot = (page: Page, name: string) =>
  page.screenshot({ path: `e2e/.artifacts/${test.info().project.name}-pagina-${name}.png`, fullPage: true });

const guestPage = async (browser: Browser) => {
  const context = await browser.newContext({ ...test.info().project.use, storageState: undefined });
  return context.newPage();
};

const currentSlug = async (page: Page) => {
  await page.goto("/dashboard/pagina");
  return page.locator("#slug").inputValue();
};

/** Contraste WCAG entre el texto y el fondo efectivo de un elemento, medido en el navegador. */
async function contrastOf(page: Page, selector: string): Promise<number> {
  return page.locator(selector).first().evaluate((element) => {
    const parse = (value: string) => (value.match(/[\d.]+/g) ?? []).map(Number);
    const luminance = ([r, g, b]: number[]) => {
      const [lr, lg, lb] = [r, g, b].map((v) => {
        const s = v / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
    };
    const text = parse(getComputedStyle(element).color);
    let background = [255, 255, 255];
    for (let node: Element | null = element; node; node = node.parentElement) {
      const color = parse(getComputedStyle(node).backgroundColor);
      if (color.length >= 3 && (color[3] ?? 1) > 0.95) {
        background = color;
        break;
      }
    }
    const [a, b] = [luminance(text), luminance(background)];
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
}

test("cada negocio personaliza su página: identidad, colores, imágenes y metadata propia", async ({ page, browser }) => {
  const suffix = `${test.info().project.name}-${Date.now()}`;
  await registerAndOnboard(page, `e2e-brand-${suffix}@example.com`, `Barbería Central ${suffix}`);

  // «Mi página pública» está en el menú y muestra el enlace, el QR y la vista previa.
  await page.goto("/dashboard/mas");
  await page.getByRole("link", { name: /Mi página pública/ }).first().click();
  await expect(page).toHaveURL(/\/dashboard\/pagina/);
  await expect(page.getByRole("heading", { level: 1, name: "Mi página pública" })).toBeVisible();
  const slug = await page.locator("#slug").inputValue();
  await expect(page.getByTestId("public-url")).toContainText(slug);
  await expect(page.getByRole("link", { name: "Compartir por WhatsApp" })).toHaveAttribute(
    "href",
    new RegExp(`^https://wa\\.me/\\?text=.*${encodeURIComponent(`/${slug}`)}`),
  );
  await expect(page.getByRole("img", { name: /Código QR/ })).toBeVisible();

  // Identidad, contacto y estilo.
  await page.getByLabel("Especialidad o categoría").fill("Barbería clásica");
  await page.getByLabel("Descripción").fill("Cortes, barba y afeitado a navaja.");
  await page.getByLabel("Dirección").fill("Av. Corrientes 1234, CABA");
  await page.getByLabel("WhatsApp").fill("11 5555 0000");
  await page.getByLabel("Instagram").fill("@barberia.central");
  await page.getByRole("button", { name: /Barbería/ }).click();
  await expect(page.locator("#themePrimary")).toHaveValue("#1c1917");

  // La vista previa refleja los cambios antes de guardarlos.
  const preview = page.frameLocator('iframe[title="Vista previa de tu página pública"]');
  await expect(preview.getByText("Barbería clásica")).toBeVisible();
  await expect(preview.getByRole("link", { name: "@barberia.central" })).toBeVisible();
  const frame = page.locator('iframe[title="Vista previa de tu página pública"]');
  await expect(frame).toHaveCSS("width", "390px");
  await page.getByRole("button", { name: "Escritorio" }).click();
  await expect(frame).toHaveCSS("width", "1280px");
  await page.getByRole("button", { name: "Celular" }).click();

  // Logo y portada: se suben, se procesan y quedan aplicados.
  const logo = await sharp({ create: { width: 640, height: 640, channels: 4, background: "#b8893b" } }).png().toBuffer();
  const cover = await sharp({ create: { width: 2000, height: 1200, channels: 3, background: "#3a322c" } }).jpeg().toBuffer();
  await page.getByLabel("Elegir archivo: Logo").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: logo });
  await expect(page.getByRole("img", { name: "Logo actual" })).toBeVisible();
  await page.getByLabel("Elegir archivo: Imagen de portada").setInputFiles({ name: "portada.jpg", mimeType: "image/jpeg", buffer: cover });
  await expect(page.getByRole("img", { name: "Imagen de portada actual" })).toBeVisible();

  // Un archivo que no es una imagen se rechaza y la portada no cambia.
  await page.getByLabel("Elegir archivo: Imagen de portada").setInputFiles({
    name: "falsa.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from("esto no es una imagen"),
  });
  await expect(page.getByText(/Formato no admitido/)).toBeVisible();

  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByText("Cambios guardados. Tu página ya está actualizada.")).toBeVisible();
  await shot(page, "01-editor");

  // Persistencia: al volver a entrar, todo sigue ahí.
  await page.reload();
  await expect(page.getByLabel("Especialidad o categoría")).toHaveValue("Barbería clásica");
  await expect(page.getByLabel("WhatsApp")).toHaveValue("5491155550000");
  await expect(page.locator("#themeFont")).toHaveValue("fuerte");

  // La página publicada, como la ve un cliente.
  const guest = await guestPage(browser);
  await guest.goto(`/${slug}`);
  await expect(guest.getByRole("heading", { level: 1 })).toHaveText(`Barbería Central ${suffix}`);
  await expect(guest.getByText("Barbería clásica")).toBeVisible();
  await expect(guest.getByText("Cortes, barba y afeitado a navaja.")).toBeVisible();
  await expect(guest.getByRole("img", { name: `Logo de Barbería Central ${suffix}` })).toBeVisible();
  await expect(guest.getByRole("link", { name: "WhatsApp" })).toHaveAttribute("href", "https://wa.me/5491155550000");
  await expect(guest.getByRole("link", { name: "@barberia.central" })).toHaveAttribute("href", "https://www.instagram.com/barberia.central");
  await expect(guest.getByRole("link", { name: /Av\. Corrientes 1234/ })).toHaveAttribute("href", /google\.com\/maps/);
  await expect(guest.getByText("Reservas online con")).toBeVisible();
  const themed = guest.locator("h1").locator("xpath=ancestor::div[contains(@style,'--primary')][1]");
  expect(await themed.evaluate((el) => getComputedStyle(el).getPropertyValue("--primary").trim())).toBe("#1c1917");
  await shot(guest, "02-publica");

  // Sin desbordes horizontales en el ancho del dispositivo.
  expect(await guest.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  // Metadata: la vista previa del enlace representa al negocio, no a la plataforma.
  await expect(guest).toHaveTitle(new RegExp(`^Barbería Central ${suffix} · Barbería clásica`));
  const meta = (property: string) => guest.locator(`meta[property="${property}"]`).getAttribute("content");
  expect(await meta("og:title")).toContain(`Barbería Central ${suffix}`);
  expect(await meta("og:site_name")).toBe(`Barbería Central ${suffix}`);
  expect(await meta("og:description")).toBe("Cortes, barba y afeitado a navaja.");
  expect(await guest.locator('link[rel="canonical"]').getAttribute("href")).toMatch(new RegExp(`/${slug}$`));
  expect(await guest.locator('link[rel="icon"]').first().getAttribute("href")).toMatch(/\/api\/media\//);
  const ogImage = await guest.request.get((await meta("og:image"))!);
  expect(ogImage.status()).toBe(200);
  expect(ogImage.headers()["content-type"]).toBe("image/png");

  // El logo se sirve optimizado y cacheable.
  const logoResponse = await guest.request.get((await guest.getByRole("img", { name: /^Logo de/ }).getAttribute("src"))!);
  expect(logoResponse.headers()["content-type"]).toBe("image/webp");
  expect(logoResponse.headers()["cache-control"]).toContain("immutable");

  // El QR se descarga solo con sesión.
  const qr = await page.request.get("/dashboard/pagina/qr?formato=png&descargar=1");
  expect(qr.headers()["content-type"]).toBe("image/png");
  expect(qr.headers()["content-disposition"]).toContain(`qr-${slug}.png`);
  expect((await page.request.get("/dashboard/pagina/qr?formato=svg")).headers()["content-type"]).toContain("image/svg+xml");
  expect((await guest.request.get("/dashboard/pagina/qr", { maxRedirects: 0 })).status()).toBeGreaterThanOrEqual(300);
  // La vista previa tampoco existe para quien no es el dueño.
  await guest.goto("/vista-previa?name=Otro");
  await expect(guest).toHaveURL(/\/login/);

  // Otro negocio conserva la identidad por defecto: la personalización es por negocio.
  const other = await guestPage(browser);
  const owner = await other.context().newPage();
  await registerAndOnboard(owner, `e2e-brand2-${suffix}@example.com`, `Consultorio Integral ${suffix}`);
  const otherSlug = await currentSlug(owner);
  await other.goto(`/${otherSlug}`);
  await expect(other.getByRole("heading", { level: 1 })).toHaveText(`Consultorio Integral ${suffix}`);
  await expect(other.getByText("Barbería clásica")).toHaveCount(0);
  await expect(other.getByRole("img", { name: /^Logo de/ })).toHaveCount(0);
  const otherTheme = other.locator("h1").locator("xpath=ancestor::div[contains(@style,'--primary')][1]");
  expect(await otherTheme.evaluate((el) => getComputedStyle(el).getPropertyValue("--primary").trim())).not.toBe("#1c1917");
  expect(await other.locator('meta[property="og:site_name"]').getAttribute("content")).toBe(`Consultorio Integral ${suffix}`);
  await other.context().close();
  await guest.context().close();
});

test("al cambiar el identificador, los enlaces ya compartidos siguen funcionando", async ({ page, browser }) => {
  const suffix = `${test.info().project.name}-${Date.now()}`;
  await registerAndOnboard(page, `e2e-slug-${suffix}@example.com`, `Bella Estética ${suffix}`);
  const original = await currentSlug(page);
  const renamed = `bella-nueva-${suffix}`;

  // Un identificador reservado o con formato inválido no se acepta.
  await page.locator("#slug").fill("dashboard");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByText(/Algunos nombres están reservados/)).toBeVisible();

  // Se normaliza lo que se escribe: mayúsculas, espacios y acentos.
  await page.locator("#slug").fill(`Bella Nueva ${suffix}`);
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByText("Cambios guardados. Tu página ya está actualizada.")).toBeVisible();
  await expect(page.getByTestId("public-url")).toContainText(renamed.toLowerCase());

  const guest = await guestPage(browser);
  await guest.goto(`/${original}`);
  await expect(guest).toHaveURL(new RegExp(`/${renamed.toLowerCase()}$`));
  await expect(guest.getByRole("heading", { level: 1 })).toHaveText(`Bella Estética ${suffix}`);
  await guest.goto(`/${original}/mis-turnos`);
  await expect(guest).toHaveURL(new RegExp(`/${renamed.toLowerCase()}/mis-turnos$`));
  await expect(guest.getByRole("heading", { name: "Consultá tus turnos" })).toBeVisible();
  await guest.context().close();
});

test("un color muy claro no vuelve ilegible la página", async ({ page, browser }) => {
  const suffix = `${test.info().project.name}-${Date.now()}`;
  await registerAndOnboard(page, `e2e-contrast-${suffix}@example.com`, `Sol Amarillo ${suffix}`);
  await page.goto("/dashboard/pagina");
  const slug = await page.locator("#slug").inputValue();

  await page.locator("#themePrimary").fill("#f2d21b");
  await page.locator("#themeSecondary").fill("#ffffff");
  await page.getByLabel("Especialidad o categoría").fill("Clases de yoga");
  // El panel avisa que el color se ajusta para texto.
  await expect(page.getByTestId("contrast-check")).toContainText("Es un color claro");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByText("Cambios guardados. Tu página ya está actualizada.")).toBeVisible();

  const guest = await guestPage(browser);
  await guest.goto(`/${slug}`);
  // El color elegido se usa tal cual en la marca...
  const themed = guest.locator("h1").locator("xpath=ancestor::div[contains(@style,'--primary')][1]");
  expect(await themed.evaluate((el) => getComputedStyle(el).getPropertyValue("--primary").trim())).toBe("#f2d21b");

  // ...y todo texto que lo usa cumple AA (4,5:1) contra su fondo real.
  expect(await contrastOf(guest, "h1 + p")).toBeGreaterThanOrEqual(4.5); // especialidad, en color de marca
  const slots = guest.getByRole("radiogroup", { name: "Horario" }).getByRole("radio");
  await expect(slots.first()).toBeVisible();
  expect(await contrastOf(guest, '[role="tab"][aria-selected="true"]')).toBeGreaterThanOrEqual(4.5); // día elegido, sobre el color
  await slots.first().click();
  expect(await contrastOf(guest, '[role="radio"][aria-checked="true"]')).toBeGreaterThanOrEqual(4.5);
  expect(await contrastOf(guest, 'button[type="submit"]')).toBeGreaterThanOrEqual(4.5); // botón principal
  await shot(guest, "03-color-claro");
  await guest.context().close();
});

test("reservar eligiendo entre varios días y consultar los turnos con el enlace del email", async ({ page, browser }) => {
  const suffix = `${test.info().project.name}-${Date.now()}`;
  const customerEmail = `cliente-${suffix}@example.com`;
  await registerAndOnboard(page, `e2e-lookup-${suffix}@example.com`, `Osteópata Especializado ${suffix}`);
  const slug = await currentSlug(page);

  const guest = await guestPage(browser);
  await guest.goto(`/${slug}`);

  // Disponibilidad de varios días a la vista, con cuántos horarios tiene cada uno.
  const days = guest.getByRole("tablist", { name: "Día" }).getByRole("tab");
  await expect(days).toHaveCount(7);
  await expect(days.filter({ hasText: /\d/ }).first()).toBeVisible();
  await expect(guest.getByRole("tab", { name: /horarios libres/ }).first()).toBeVisible();
  await expect(guest.getByRole("button", { name: "Días anteriores" })).toBeDisabled();

  // Navegación a fechas posteriores y vuelta.
  const firstWeek = await days.first().getAttribute("aria-label");
  await guest.getByRole("button", { name: "Días siguientes" }).click();
  await expect(days.first()).not.toHaveAttribute("aria-label", firstWeek!);
  await guest.getByRole("button", { name: "Días siguientes" }).click();
  await guest.getByRole("button", { name: "Días siguientes" }).click();
  await expect(guest.getByRole("tab", { selected: true })).toBeVisible();
  const slots = guest.getByRole("radiogroup", { name: "Horario" }).getByRole("radio");
  await expect(slots.first()).toBeVisible();
  const chosenDay = await guest.getByRole("tab", { selected: true }).getAttribute("aria-label");
  await slots.nth(1).click();

  await guest.getByLabel("Nombre y apellido").fill("Camila Cliente");
  await guest.getByLabel("Email").fill(customerEmail);
  await shot(guest, "04-reserva");
  await guest.getByRole("button", { name: "Confirmar reserva" }).click();
  await expect(guest.getByRole("heading", { name: "¡Turno confirmado!" })).toBeVisible();
  await expect(guest.getByText(new RegExp(chosenDay!.split(",")[0], "i")).first()).toBeVisible();

  // «Consultá tus turnos» está enlazado desde la página.
  await guest.goto(`/${slug}`);
  await guest.getByRole("link", { name: /Consultá tus turnos/ }).click();
  await expect(guest).toHaveURL(new RegExp(`/${slug}/mis-turnos$`));
  await expect(guest.getByRole("heading", { name: "Consultá tus turnos" })).toBeVisible();
  // Estas pruebas corren sin canal de email: no se ofrece un envío que no puede ocurrir.
  await expect(guest.getByText(/La consulta por email no está disponible/)).toBeVisible();
  expect(await guest.locator('meta[name="robots"]').getAttribute("content")).toContain("noindex");

  // Un enlace inventado o vencido no muestra nada.
  await guest.goto(`/${slug}/mis-turnos/${randomBytes(32).toString("base64url")}`);
  await expect(guest).toHaveURL(new RegExp(`/${slug}/mis-turnos\\?enlace=vencido`));
  await expect(guest.getByText("Ese enlace venció o ya no es válido. Pedí uno nuevo.")).toBeVisible();
  await expect(guest.getByText("Camila Cliente")).toHaveCount(0);

  // Se emite un enlace como el que llega por email (acá no hay quien lo entregue).
  const issue = async (minutes: number) => {
    const token = randomBytes(32).toString("base64url");
    await sql(
      `INSERT INTO customer_access_tokens (id, "organizationId", email, "tokenHash", "expiresAt")
       SELECT gen_random_uuid(), id, $2, $3, now() + make_interval(mins => $4) FROM organizations WHERE slug = $1`,
      [slug, customerEmail, createHash("sha256").update(token).digest("hex"), minutes],
    );
    return token;
  };
  const expired = await issue(-5);
  await guest.goto(`/${slug}/mis-turnos/${expired}`);
  await expect(guest).toHaveURL(/enlace=vencido/);

  const token = await issue(30);

  // El enlace de un negocio no sirve en la página de otro.
  const otherOwner = await (await browser.newContext({ ...test.info().project.use, storageState: undefined })).newPage();
  await registerAndOnboard(otherOwner, `e2e-lookup2-${suffix}@example.com`, `Otro Negocio ${suffix}`);
  const otherSlug = await currentSlug(otherOwner);
  await otherOwner.context().close();
  await guest.goto(`/${otherSlug}/mis-turnos/${token}`);
  await expect(guest).toHaveURL(new RegExp(`/${otherSlug}/mis-turnos\\?enlace=vencido`));

  // Con el enlace válido: sus turnos, y desde ahí reprogramar o cancelar.
  await guest.goto(`/${slug}/mis-turnos/${token}`);
  await expect(guest.getByRole("heading", { name: "Tus turnos" })).toBeVisible();
  await expect(guest.getByText(customerEmail)).toBeVisible();
  const items = guest.getByRole("link", { name: /Ver, reprogramar o cancelar/ });
  await expect(items).toHaveCount(1);
  expect(await guest.locator('meta[name="robots"]').getAttribute("content")).toContain("noindex");
  await shot(guest, "05-mis-turnos");

  await items.first().click();
  await expect(guest).toHaveURL(/\/turno\//);
  const time = guest.locator("p.tabular-nums").first();
  const before = (await time.textContent())!.trim();
  await guest.getByRole("button", { name: "Reprogramar" }).click();
  const newSlots = guest.getByRole("radiogroup", { name: "Horario" }).getByRole("radio");
  await expect(newSlots.first()).toBeVisible();
  await newSlots.last().click();
  await guest.getByRole("button", { name: /^Pasar al/ }).click();
  await expect(guest.getByRole("button", { name: "Reprogramar" })).toBeVisible();
  await expect(time).not.toHaveText(before);

  guest.once("dialog", (dialog) => dialog.accept());
  await guest.getByRole("button", { name: "Cancelar turno" }).click();
  await expect(guest.getByText("Cancelado", { exact: true })).toBeVisible();

  // El enlace sigue vigente y ya no lista el turno cancelado.
  await guest.goto(`/${slug}/mis-turnos/${token}`);
  await expect(guest.getByText("No tenés turnos próximos")).toBeVisible();
  await guest.context().close();

  // El profesional ve la cancelación en su agenda.
  await page.goto("/dashboard/turnos?estado=canceled");
  await page.getByRole("link", { name: /Camila Cliente/ }).first().click();
  await expect(page.getByText("Cancelado por el cliente")).toBeVisible();
});
