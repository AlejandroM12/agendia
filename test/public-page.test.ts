import { describe, it, expect, afterAll, beforeAll, beforeEach, vi } from "vitest";
import sharp from "sharp";
import type { AppContext } from "@/lib/dal";
import { db } from "@/lib/db";
import { generateUniqueOrganizationSlug, isValidSlugFormat, slugify } from "@/lib/slug";
import { createSchedulableOrganization, fakeContext, uniqueSuffix } from "./helpers";

/**
 * Página pública personalizable: validación de la configuración,
 * identificadores de URL con enlaces anteriores, imágenes y aislamiento
 * entre negocios. Las acciones se ejecutan de verdad; solo se reemplaza la
 * lectura de la sesión (lib/dal).
 */

const session = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("@/lib/dal", () => {
  const context = () => session.current as AppContext;
  return {
    READ_ONLY_MESSAGE: "solo lectura",
    requireContext: async () => context(),
    requireOrganization: async () => context(),
    requireWriteContext: async () =>
      context().canWrite ? { ok: true, context: context() } : { ok: false, message: "solo lectura" },
  };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { GET as serveMedia } from "@/app/api/media/[id]/route";
import { removePublicImageAction, updatePublicPageAction, uploadPublicImageAction } from "@/modules/public-page/actions";
import { getOrganizationImages, processImage, sniffImageFormat } from "@/modules/public-page/images";
import { normalizeInstagram, normalizeWhatsapp, publicPageSchema, readPublicPageInput } from "@/modules/public-page/settings";
import { changeOrganizationSlug, resolvePublicSlug } from "@/modules/public-page/slug";

type Tenant = Awaited<ReturnType<typeof createSchedulableOrganization>>;

let a: Tenant;
let b: Tenant;

async function signInAs(tenant: Tenant, canWrite = true) {
  const organization = await db.organization.findUniqueOrThrow({ where: { id: tenant.organization.id } });
  session.current = fakeContext({ userId: tenant.userId, email: tenant.ownerEmail, organization, canWrite }) satisfies AppContext;
  return organization;
}

const organizationOf = (tenant: Tenant) => db.organization.findUniqueOrThrow({ where: { id: tenant.organization.id } });

function pageForm(base: { name: string; slug: string }, overrides: Record<string, string> = {}) {
  const data = new FormData();
  const values: Record<string, string> = {
    name: base.name,
    slug: base.slug,
    specialty: "",
    description: "",
    address: "",
    phone: "",
    whatsapp: "",
    instagram: "",
    themePrimary: "#1f4d3f",
    themeSecondary: "#c8643c",
    themeFont: "clasica",
    showAddress: "on",
    showPhone: "on",
    showWhatsapp: "on",
    showInstagram: "on",
    showPrices: "on",
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) if (value !== "off") data.set(key, value);
  return data;
}

const png = (width: number, height: number, background = "#a8456a") =>
  sharp({ create: { width, height, channels: 4, background } }).png().toBuffer();
const jpeg = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: "#e3b9a4" } }).jpeg().toBuffer();

function upload(bytes: Uint8Array, name = "imagen.png", type = "image/png") {
  const data = new FormData();
  data.set("file", new File([new Uint8Array(bytes)], name, { type }));
  return data;
}

const media = (id: string) => serveMedia(new Request(`http://localhost/api/media/${id}`), { params: Promise.resolve({ id }) });

beforeAll(async () => {
  a = await createSchedulableOrganization();
  b = await createSchedulableOrganization();
  await db.organization.updateMany({
    where: { id: { in: [a.organization.id, b.organization.id] } },
    data: { onboardingCompletedAt: new Date() },
  });
});

afterAll(async () => {
  await db.rateLimit.deleteMany({ where: { key: { startsWith: "image-upload:" } } });
  await a.cleanup();
  await b.cleanup();
});

beforeEach(async () => {
  await signInAs(a);
});

describe("configuración de la página: validación", () => {
  const parse = (overrides: Record<string, string>) =>
    publicPageSchema.safeParse(readPublicPageInput((name) => pageForm({ name: "Negocio", slug: "negocio-x" }, overrides).get(name)));

  it("normaliza WhatsApp e Instagram escritos de distintas formas", () => {
    expect(normalizeWhatsapp("11 5555-0000")).toBe("5491155550000");
    expect(normalizeWhatsapp("+54 9 11 5555 0000")).toBe("5491155550000");
    expect(normalizeWhatsapp("0054 9 351 555 0000")).toBe("5493515550000");
    expect(normalizeWhatsapp("123")).toBeNull();
    expect(normalizeInstagram("@Bella.Estetica")).toBe("bella.estetica");
    expect(normalizeInstagram("https://www.instagram.com/bella.estetica/?hl=es")).toBe("bella.estetica");
    expect(normalizeInstagram("bella estetica")).toBeNull();
    expect(normalizeInstagram("javascript:alert(1)")).toBeNull();
  });

  it("acepta una configuración completa y deja en null lo que se dejó vacío", () => {
    const result = parse({ specialty: "Osteopatía", whatsapp: "11 5555 0000", instagram: "@osteo", themePrimary: "#ABC", showPrices: "off" });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toMatchObject({
      specialty: "Osteopatía",
      description: null,
      whatsapp: "5491155550000",
      instagram: "osteo",
      themePrimary: "#aabbcc",
      showPrices: false,
      showAddress: true,
    });
  });

  it("rechaza colores, tipografías e identificadores que no son de la lista permitida", () => {
    const invalid: Array<Record<string, string>> = [
      { themePrimary: "red; background: url(https://evil.example)" },
      { themeSecondary: "</style><script>alert(1)</script>" },
      { themeFont: "Comic Sans" },
      { themeFont: "clasica; } body { display:none" },
      { slug: "admin" },
      { slug: "mis-turnos" },
      { slug: "a" },
      { whatsapp: "no es un número" },
      { instagram: "con espacios y /barras" },
      { name: "x" },
      { description: "d".repeat(301) },
    ];
    for (const overrides of invalid) {
      expect(parse(overrides).success, JSON.stringify(overrides)).toBe(false);
    }
  });

  it("el HTML en los textos se guarda como texto: no hay campo que acepte marcado", () => {
    const result = parse({ description: '<img src=x onerror="alert(1)">', specialty: "<b>Barbería</b>" });
    expect(result.success).toBe(true);
    // React lo escapa al mostrarlo; acá se verifica que no se interpreta ni transforma.
    if (result.success) expect(result.data.description).toBe('<img src=x onerror="alert(1)">');
  });

  it("normaliza el identificador de URL (acentos, espacios y mayúsculas)", () => {
    expect(slugify("  Osteópata  Especializado ")).toBe("osteopata-especializado");
    expect(slugify("Barbería_Central!!")).toBe("barberia-central");
    const result = parse({ slug: "Bella Estética" });
    expect(result.success && result.data.slug).toBe("bella-estetica");
    for (const reserved of ["dashboard", "api", "login", "turno", "media", "vista-previa", "licencia", "precios"]) {
      expect(isValidSlugFormat(reserved), reserved).toBe(false);
    }
  });
});

describe("guardar la página", () => {
  it("persiste la personalización de un negocio sin tocar la de otro", async () => {
    const before = await organizationOf(b);
    const current = await organizationOf(a);

    const state = await updatePublicPageAction(
      undefined,
      pageForm(current, {
        name: "Barbería Central",
        specialty: "Barbería clásica",
        description: "Cortes y afeitado a navaja.",
        whatsapp: "351 555 0000",
        instagram: "@barberia.central",
        themePrimary: "#1c1917",
        themeSecondary: "#b8893b",
        themeFont: "fuerte",
        showPrices: "off",
        showPhone: "off",
      }),
    );

    expect(state).toMatchObject({ ok: true });
    expect(await organizationOf(a)).toMatchObject({
      name: "Barbería Central",
      specialty: "Barbería clásica",
      whatsapp: "5493515550000",
      instagram: "barberia.central",
      themePrimary: "#1c1917",
      themeSecondary: "#b8893b",
      themeFont: "fuerte",
      showPrices: false,
      showPhone: false,
      showAddress: true,
    });
    // El otro negocio conserva su nombre, su enlace y los valores por defecto.
    expect(await organizationOf(b)).toMatchObject({
      name: before.name,
      slug: before.slug,
      themePrimary: "#1f4d3f",
      themeFont: "clasica",
      showPrices: true,
    });
  });

  it("no guarda nada si un campo es inválido, e indica cuál", async () => {
    const current = await organizationOf(a);
    const state = await updatePublicPageAction(undefined, pageForm(current, { name: "Otro nombre", themePrimary: "nope" }));
    expect(state?.ok).toBeFalsy();
    expect(state?.errors?.themePrimary?.[0]).toBeTruthy();
    expect((await organizationOf(a)).name).toBe(current.name);
  });

  it("una cuenta en solo lectura no puede editar su página", async () => {
    const current = await signInAs(a, false);
    const state = await updatePublicPageAction(undefined, pageForm(current, { name: "Cambio no permitido" }));
    expect(state).toEqual({ message: "solo lectura" });
    expect((await organizationOf(a)).name).toBe(current.name);
  });

  it("un negocio existente sin personalizar tiene valores por defecto compatibles", async () => {
    const organization = await organizationOf(b);
    expect(organization).toMatchObject({
      specialty: null,
      whatsapp: null,
      instagram: null,
      themePrimary: "#1f4d3f",
      themeSecondary: "#c8643c",
      themeFont: "clasica",
      showAddress: true,
      showPhone: true,
      showPrices: true,
    });
    expect(await getOrganizationImages(organization.id)).toEqual({ logoId: null, coverId: null, logoUrl: null, coverUrl: null });
  });
});

describe("identificador de URL y enlaces anteriores", () => {
  const save = async (tenant: Tenant, slug: string) => {
    const current = await signInAs(tenant);
    return updatePublicPageAction(undefined, pageForm(current, { slug }));
  };

  it("al cambiar el identificador, el enlace anterior redirige al nuevo", async () => {
    const original = (await organizationOf(a)).slug;
    const next = `nuevo-${uniqueSuffix()}`;

    expect(await save(a, next)).toMatchObject({ ok: true, slug: next });

    expect(await resolvePublicSlug(next)).toMatchObject({ kind: "organization", organization: { id: a.organization.id } });
    expect(await resolvePublicSlug(original)).toEqual({ kind: "alias", currentSlug: next });
  });

  it("otro negocio no puede quedarse con un identificador en uso ni con un enlace anterior ajeno", async () => {
    const aSlug = (await organizationOf(a)).slug;
    const aAlias = (await db.organizationSlugAlias.findFirstOrThrow({ where: { organizationId: a.organization.id } })).slug;
    const bSlug = (await organizationOf(b)).slug;

    for (const wanted of [aSlug, aAlias]) {
      const state = await save(b, wanted);
      expect(state?.ok).toBeFalsy();
      expect(state?.errors?.slug?.[0]).toMatch(/en uso/);
    }
    expect((await organizationOf(b)).slug).toBe(bSlug);
    // Los enlaces de A siguen siendo de A.
    expect(await resolvePublicSlug(aAlias)).toEqual({ kind: "alias", currentSlug: aSlug });
    // Y los nombres generados automáticamente tampoco pisan un enlace anterior.
    expect(await generateUniqueOrganizationSlug(aAlias)).not.toBe(aAlias);
  });

  it("un negocio puede volver a un identificador anterior propio", async () => {
    const current = (await organizationOf(a)).slug;
    const previous = (await db.organizationSlugAlias.findFirstOrThrow({ where: { organizationId: a.organization.id } })).slug;

    expect(await save(a, previous)).toMatchObject({ ok: true });

    expect(await resolvePublicSlug(previous)).toMatchObject({ kind: "organization" });
    expect(await resolvePublicSlug(current)).toEqual({ kind: "alias", currentSlug: previous });
  });

  it("conserva solo los últimos enlaces anteriores y libera los más viejos", async () => {
    const organization = await organizationOf(a);
    let slug = organization.slug;
    const used: string[] = [];
    for (let i = 0; i < 8; i++) {
      const next = `rota-${i}-${uniqueSuffix()}`;
      await db.$transaction((tx) => changeOrganizationSlug(tx, { id: organization.id, slug }, next));
      used.push(slug);
      slug = next;
      // createdAt ordena los alias: se separan para que el orden sea determinista.
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const aliases = await db.organizationSlugAlias.findMany({ where: { organizationId: organization.id } });
    expect(aliases).toHaveLength(5);
    expect(aliases.map((alias) => alias.slug)).toEqual(expect.arrayContaining(used.slice(-5)));
    expect(await resolvePublicSlug(used[0])).toBeNull();
  });

  it("identificadores inexistentes, reservados o malformados no resuelven a ningún negocio", async () => {
    for (const slug of ["no-existe-este-negocio-xyz", "dashboard", "../etc/passwd", "A", ""]) {
      expect(await resolvePublicSlug(slug), slug).toBeNull();
    }
  });

  it("un negocio que no terminó el onboarding todavía no tiene página", async () => {
    const draft = await createSchedulableOrganization();
    try {
      expect(await resolvePublicSlug(draft.organization.slug)).toBeNull();
    } finally {
      await draft.cleanup();
    }
  });
});

describe("imágenes", () => {
  it("reconoce el formato por el contenido, no por el nombre", async () => {
    expect(sniffImageFormat(await png(10, 10))).toBe("png");
    expect(sniffImageFormat(await jpeg(10, 10))).toBe("jpeg");
    expect(sniffImageFormat(await sharp(await png(10, 10)).webp().toBuffer())).toBe("webp");
    expect(sniffImageFormat(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"))).toBeNull();
    expect(sniffImageFormat(Buffer.from("GIF89a..."))).toBeNull();
    expect(sniffImageFormat(Buffer.from("%PDF-1.7"))).toBeNull();
  });

  it("optimiza el logo: WebP, a lo sumo 512 px, sin metadatos", async () => {
    const source = await sharp(await png(1800, 1200))
      .withExif({ IFD0: { Copyright: "dato privado", Artist: "persona" } })
      .png()
      .toBuffer();
    const result = await processImage("logo", source);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.image).toMatchObject({ width: 512, height: 341, contentType: "image/webp" });
    const metadata = await sharp(result.image.bytes).metadata();
    expect(metadata.format).toBe("webp");
    expect(metadata.exif).toBeUndefined();
    expect(result.image.bytes.length).toBeLessThan(source.length);
  });

  it("recorta la portada a 2:1 y no agranda imágenes chicas", async () => {
    const big = await processImage("cover", await jpeg(3000, 2000));
    expect(big.ok && [big.image.width, big.image.height]).toEqual([1600, 800]);
    const small = await processImage("cover", await jpeg(800, 600));
    expect(small.ok && [small.image.width, small.image.height]).toEqual([800, 400]);
  });

  it("rechaza archivos que no son imágenes válidas, aunque digan serlo", async () => {
    const truncated = (await jpeg(800, 600)).subarray(0, 200);
    const cases: Array<[string, Uint8Array]> = [
      ["texto con extensión de imagen", Buffer.from("esto no es una imagen")],
      ["SVG con script", Buffer.from("<svg onload='alert(1)'></svg>")],
      ["JPEG truncado", truncated],
      ["cabecera PNG con basura", Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)])],
      ["vacío", new Uint8Array()],
    ];
    for (const [label, bytes] of cases) {
      expect((await processImage("logo", bytes)).ok, label).toBe(false);
    }
  });

  it("aplica límites de dimensiones y de peso", async () => {
    expect(await processImage("logo", await png(40, 40))).toMatchObject({ ok: false, message: expect.stringMatching(/muy chica/) });
    expect(await processImage("cover", await jpeg(400, 300))).toMatchObject({ ok: false, message: expect.stringMatching(/muy chica/) });
    const heavy = Buffer.alloc(8 * 1024 * 1024 + 1);
    expect(await processImage("logo", heavy)).toMatchObject({ ok: false, message: expect.stringMatching(/8 MB/) });
  });

  it("subir, servir, reemplazar y quitar: la imagen anterior no queda guardada", async () => {
    const first = await uploadPublicImageAction("logo", upload(await png(300, 300)));
    expect(first.ok).toBe(true);
    if (!first.ok || !first.id) return;

    const served = await media(first.id);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/webp");
    expect(served.headers.get("cache-control")).toContain("immutable");
    expect((await sharp(Buffer.from(await served.arrayBuffer())).metadata()).width).toBe(300);

    const second = await uploadPublicImageAction("logo", upload(await png(200, 200, "#0f4c5c")));
    expect(second.ok && second.id).toBeTruthy();
    expect((await media(first.id)).status).toBe(404);
    expect(await db.organizationImage.count({ where: { organizationId: a.organization.id, kind: "logo" } })).toBe(1);

    expect(await removePublicImageAction("logo")).toEqual({ ok: true, id: null });
    expect(await db.organizationImage.count({ where: { organizationId: a.organization.id } })).toBe(0);
    if (second.ok && second.id) expect((await media(second.id)).status).toBe(404);
  });

  it("la acción rechaza archivos inválidos y no guarda nada", async () => {
    const result = await uploadPublicImageAction("cover", upload(Buffer.from("<?php echo 1; ?>"), "portada.jpg", "image/jpeg"));
    expect(result.ok).toBe(false);
    // Un tipo que no existe tampoco pasa, aunque TypeScript no lo permita.
    expect((await uploadPublicImageAction("avatar" as never, upload(await png(300, 300)))).ok).toBe(false);
    expect(await db.organizationImage.count({ where: { organizationId: a.organization.id } })).toBe(0);
  });

  it("las imágenes de un negocio son suyas: otro negocio no las reemplaza ni las borra", async () => {
    await signInAs(a);
    const logoA = await uploadPublicImageAction("logo", upload(await png(256, 256)));
    expect(logoA.ok).toBe(true);

    await signInAs(b);
    const logoB = await uploadPublicImageAction("logo", upload(await png(128, 128, "#000000")));
    expect(logoB.ok).toBe(true);
    await removePublicImageAction("logo");
    await removePublicImageAction("cover");

    // B borró lo suyo; lo de A sigue intacto y servido.
    expect(await db.organizationImage.count({ where: { organizationId: b.organization.id } })).toBe(0);
    const images = await getOrganizationImages(a.organization.id);
    expect(logoA.ok && images.logoId).toBe(logoA.ok ? logoA.id : null);
    if (logoA.ok && logoA.id) expect((await media(logoA.id)).status).toBe(200);

    await signInAs(a, false);
    expect((await removePublicImageAction("logo")).ok).toBe(false); // solo lectura
    await signInAs(a);
    await removePublicImageAction("logo");
  });

  it("identificadores de imagen inexistentes o malformados devuelven 404", async () => {
    for (const id of ["00000000-0000-4000-8000-000000000000", "../../etc/passwd", "1 OR 1=1"]) {
      expect((await media(id)).status, id).toBe(404);
    }
  });
});
