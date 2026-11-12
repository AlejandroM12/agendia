import { describe, it, expect, afterEach } from "vitest";
import { registerOrganization } from "@/modules/organizations/register";
import { db } from "@/lib/db";
import { trialPolicy } from "@/lib/brand";
import { cleanupOrganization, cleanupUser, uniqueSuffix } from "./helpers";

describe("registerOrganization — alta atómica + activación de la prueba gratuita", () => {
  let userId: string | undefined;
  let organizationId: string | undefined;

  afterEach(async () => {
    await cleanupUser(userId);
    await cleanupOrganization(organizationId);
    userId = undefined;
    organizationId = undefined;
  });

  it("crea Organization + User + Membership(owner) en una sola operación", async () => {
    const suffix = uniqueSuffix();
    const result = await registerOrganization({
      businessName: `Estudio Test ${suffix}`,
      name: "Ana Owner",
      email: `ana-${suffix}@example.com`,
      password: "Contrasena123",
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    userId = result.userId;

    const user = await db.user.findUniqueOrThrow({
      where: { id: result.userId },
      include: { memberships: { include: { organization: true } } },
    });
    organizationId = user.memberships[0]?.organizationId;

    expect(user.email).toBe(`ana-${suffix}@example.com`);
    expect(user.memberships).toHaveLength(1);
    expect(user.memberships[0].role).toBe("owner");

    const organization = user.memberships[0].organization;
    expect(organization.name).toBe(`Estudio Test ${suffix}`);
    expect(organization.slug).toContain("estudio-test");
  });

  it(`activa la prueba gratuita de ${trialPolicy.trialDays} días, calculada en servidor`, async () => {
    const suffix = uniqueSuffix();
    const before = Date.now();
    const result = await registerOrganization({
      businessName: `Consultorio Test ${suffix}`,
      name: "Luis Owner",
      email: `luis-${suffix}@example.com`,
      password: "Contrasena123",
    });
    const after = Date.now();

    expect(result.success).toBe(true);
    if (!result.success) return;
    userId = result.userId;

    const membership = await db.membership.findFirstOrThrow({
      where: { userId: result.userId },
      include: { organization: true },
    });
    organizationId = membership.organizationId;
    const org = membership.organization;

    expect(org.status).toBe("trial");
    const expectedMinMs = before + trialPolicy.trialDays * 24 * 60 * 60 * 1000;
    const expectedMaxMs = after + trialPolicy.trialDays * 24 * 60 * 60 * 1000;
    expect(org.trialEndsAt.getTime()).toBeGreaterThanOrEqual(expectedMinMs - 1000);
    expect(org.trialEndsAt.getTime()).toBeLessThanOrEqual(expectedMaxMs + 1000);
  });

  it("rechaza el registro si el email ya existe", async () => {
    const suffix = uniqueSuffix();
    const email = `dup-${suffix}@example.com`;

    const first = await registerOrganization({
      businessName: `Primero ${suffix}`,
      name: "Primero",
      email,
      password: "Contrasena123",
    });
    expect(first.success).toBe(true);
    if (first.success) {
      userId = first.userId;
      const membership = await db.membership.findFirstOrThrow({ where: { userId } });
      organizationId = membership.organizationId;
    }

    const second = await registerOrganization({
      businessName: `Segundo ${suffix}`,
      name: "Segundo",
      email,
      password: "OtraContrasena123",
    });

    expect(second.success).toBe(false);
    if (!second.success) {
      expect(second.error).toMatch(/ya existe/i);
    }

    // No debió haberse creado una segunda organización para ese intento.
    const orgs = await db.organization.findMany({ where: { name: `Segundo ${suffix}` } });
    expect(orgs).toHaveLength(0);
  });

  it("genera slugs únicos cuando dos negocios tienen el mismo nombre", async () => {
    const suffix = uniqueSuffix();
    const businessName = `Nombre Repetido ${suffix}`;

    const first = await registerOrganization({
      businessName,
      name: "Primero",
      email: `rep1-${suffix}@example.com`,
      password: "Contrasena123",
    });
    expect(first.success).toBe(true);

    const second = await registerOrganization({
      businessName,
      name: "Segundo",
      email: `rep2-${suffix}@example.com`,
      password: "Contrasena123",
    });
    expect(second.success).toBe(true);

    if (first.success) {
      const m1 = await db.membership.findFirstOrThrow({
        where: { userId: first.userId },
        include: { organization: true },
      });
      if (second.success) {
        const m2 = await db.membership.findFirstOrThrow({
          where: { userId: second.userId },
          include: { organization: true },
        });
        expect(m1.organization.slug).not.toBe(m2.organization.slug);

        // Limpieza manual: este test crea dos usuarios/orgs, no solo uno.
        await cleanupUser(first.userId);
        await cleanupOrganization(m1.organizationId);
        await cleanupUser(second.userId);
        await cleanupOrganization(m2.organizationId);
      }
    }
  });
});
