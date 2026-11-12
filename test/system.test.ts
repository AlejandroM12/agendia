import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { isValidSlugFormat } from "@/lib/slug";
import { trialPolicy } from "@/lib/brand";
import { runTick } from "@/modules/system/tick";
import { createSchedulableOrganization, uniqueSuffix } from "./helpers";

const DAY = 24 * 3600000;

describe("trabajo periódico (tick)", () => {
  type Ctx = Awaited<ReturnType<typeof createSchedulableOrganization>>;
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await createSchedulableOrganization();
  });
  afterEach(async () => {
    await ctx.cleanup();
  });

  const status = async () => (await db.organization.findUniqueOrThrow({ where: { id: ctx.organization.id } })).status;

  it("no toca una prueba vigente", async () => {
    await runTick();
    expect(await status()).toBe("trial");
  });

  it("pasa a solo lectura las pruebas vencidas, con su fecha límite", async () => {
    const trialEndsAt = new Date(Date.now() - DAY);
    await db.organization.update({ where: { id: ctx.organization.id }, data: { trialEndsAt } });

    await runTick();

    const org = await db.organization.findUniqueOrThrow({ where: { id: ctx.organization.id } });
    expect(org.status).toBe("trial_readonly");
    expect(org.readonlyUntil?.getTime()).toBe(trialEndsAt.getTime() + trialPolicy.readonlyGraceDays * DAY);
  });

  it("pausa las cuentas cuyo período de solo lectura terminó, sin borrar sus datos", async () => {
    await db.organization.update({
      where: { id: ctx.organization.id },
      data: { status: "trial_readonly", trialEndsAt: new Date(Date.now() - 40 * DAY), readonlyUntil: new Date(Date.now() - DAY) },
    });

    await runTick();

    expect(await status()).toBe("locked");
    expect(await db.service.count({ where: { organizationId: ctx.organization.id } })).toBe(1);
  });
});

describe("rate limiting", () => {
  it("permite hasta el límite y bloquea el siguiente intento dentro de la ventana", async () => {
    const key = `test:${uniqueSuffix()}`;
    try {
      const results = [];
      for (let i = 0; i < 4; i++) results.push((await rateLimit(key, 3, 60)).allowed);
      expect(results).toEqual([true, true, true, false]);
    } finally {
      await db.rateLimit.deleteMany({ where: { key } });
    }
  });

  it("cuenta bien intentos simultáneos", async () => {
    const key = `test:${uniqueSuffix()}`;
    try {
      const results = await Promise.all(Array.from({ length: 10 }, () => rateLimit(key, 5, 60)));
      expect(results.filter((r) => r.allowed)).toHaveLength(5);
    } finally {
      await db.rateLimit.deleteMany({ where: { key } });
    }
  });

  it("vuelve a permitir cuando pasó la ventana", async () => {
    const key = `test:${uniqueSuffix()}`;
    try {
      await rateLimit(key, 1, 60);
      expect((await rateLimit(key, 1, 60)).allowed).toBe(false);
      await db.rateLimit.update({ where: { key }, data: { windowStart: new Date(Date.now() - 120000) } });
      expect((await rateLimit(key, 1, 60)).allowed).toBe(true);
    } finally {
      await db.rateLimit.deleteMany({ where: { key } });
    }
  });
});

describe("enlaces públicos", () => {
  it("no acepta slugs que choquen con rutas de la aplicación ni con formato inválido", () => {
    for (const slug of ["dashboard", "admin", "login", "api", "turno", "precios", "onboarding"]) {
      expect(isValidSlugFormat(slug)).toBe(false);
    }
    for (const slug of ["ab", "Con Espacios", "-guion", "guion-", "ñandú"]) {
      expect(isValidSlugFormat(slug)).toBe(false);
    }
    expect(isValidSlugFormat("estudio-martina")).toBe(true);
    expect(isValidSlugFormat("dashboard-pro")).toBe(true);
  });
});
