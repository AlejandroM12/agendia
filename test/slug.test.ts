import { describe, it, expect, afterEach } from "vitest";
import { slugify, generateUniqueOrganizationSlug } from "@/lib/slug";
import { db } from "@/lib/db";
import { uniqueSuffix } from "./helpers";

describe("slugify", () => {
  it("normaliza espacios, mayúsculas y acentos", () => {
    expect(slugify("Estética María José")).toBe("estetica-maria-jose");
  });

  it("quita caracteres que no son letras, números o guiones", () => {
    expect(slugify("Turnos & Más!! ")).toBe("turnos-mas");
  });
});

describe("generateUniqueOrganizationSlug", () => {
  const createdOrgIds: string[] = [];

  afterEach(async () => {
    if (createdOrgIds.length) {
      await db.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
      createdOrgIds.length = 0;
    }
  });

  it("agrega un sufijo numérico cuando el slug base ya existe", async () => {
    const suffix = uniqueSuffix();
    const businessName = `Negocio Duplicado ${suffix}`;

    const firstSlug = await generateUniqueOrganizationSlug(businessName);
    const org = await db.organization.create({
      data: {
        name: businessName,
        slug: firstSlug,
        trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    createdOrgIds.push(org.id);

    const secondSlug = await generateUniqueOrganizationSlug(businessName);

    expect(secondSlug).not.toBe(firstSlug);
    expect(secondSlug.startsWith(firstSlug)).toBe(true);
  });
});
