import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "@/lib/dal";
import { db } from "@/lib/db";
import { createSchedulableOrganization, fakeContext, refreshOrganization } from "./helpers";

/**
 * Las PANTALLAS de contratación (no solo las acciones): con la prueba vencida, el bloqueo o la baja el propietario tiene
 * que ver los botones para contratar; una cuenta suspendida no; sin Mercado Pago se ofrece el contacto. Se renderizan las
 * páginas reales con la sesión simulada: era el defecto que ocultaba la contratación en solo lectura.
 */

const session = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/dal", async () => (await import("./dal-mock")).createDalMock(() => session.current as AppContext));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

import BillingPage from "@/app/(dashboard)/dashboard/facturacion/page";
import ChangePlanPage from "@/app/(dashboard)/dashboard/facturacion/cambiar/page";

type Ctx = Awaited<ReturnType<typeof createSchedulableOrganization>>;
let ctx: Ctx;
const DAY = 86400000;

const props = (search: Record<string, string> = {}) => ({ params: Promise.resolve({}), searchParams: Promise.resolve(search) }) as never;
const html = async () => renderToStaticMarkup((await BillingPage(props())) as never);
async function actAs(role: AppContext["role"] = "owner") {
  const organization = await refreshOrganization(ctx.organization.id);
  session.current = fakeContext({ userId: ctx.userId, email: ctx.ownerEmail, organization, role });
}
const setStatus = (data: Record<string, unknown>) => db.organization.update({ where: { id: ctx.organization.id }, data });
const run = async (fn: () => Promise<unknown>) => {
  try {
    return await fn();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};

const READ_ONLY: Record<string, () => Promise<unknown>> = {
  "prueba vencida": () => setStatus({ status: "trial_readonly", trialEndsAt: new Date(Date.now() - 2 * DAY) }),
  bloqueada: () => setStatus({ status: "trial_readonly", trialEndsAt: new Date(Date.now() - 60 * DAY), readonlyUntil: new Date(Date.now() - 30 * DAY) }),
  "baja (cancelada)": () => setStatus({ status: "canceled" }),
};

beforeEach(async () => {
  ctx = await createSchedulableOrganization();
  vi.stubEnv("MERCADOPAGO_ACCESS_TOKEN", "APP_USR-simulado");
  vi.stubEnv("MERCADOPAGO_WEBHOOK_SECRET", "secret");
  vi.stubEnv("MERCADOPAGO_MODE", "live");
  vi.stubEnv("PUBLISH_TEAM_PLANS", "1");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await db.auditLog.deleteMany({ where: { organizationId: ctx.organization.id } });
  await ctx.cleanup();
});

describe("/dashboard/facturacion", () => {
  it("con la prueba vigente muestra los botones para elegir Profesional y Equipo", async () => {
    await actAs("owner");
    const page = await html();
    expect(page).toContain("/dashboard/facturacion/cambiar?plan=profesional");
    expect(page).toContain("/dashboard/facturacion/cambiar?plan=equipo");
  });

  for (const [name, prepare] of Object.entries(READ_ONLY)) {
    it(`${name}: el propietario sigue viendo los botones de contratación (Profesional y Equipo)`, async () => {
      await prepare();
      await actAs("owner");
      expect((session.current as AppContext).canWrite, "precondición: solo lectura").toBe(false);
      const page = await html();
      expect(page).toContain("/dashboard/facturacion/cambiar?plan=profesional");
      expect(page).toContain("/dashboard/facturacion/cambiar?plan=equipo");
      expect(page).toContain("Elegir Plan Profesional");
    });
  }

  it("sin el Plan Equipo publicado solo se ofrece el Profesional, también en solo lectura", async () => {
    vi.stubEnv("PUBLISH_TEAM_PLANS", "");
    await READ_ONLY["prueba vencida"]();
    await actAs("owner");
    const page = await html();
    expect(page).toContain("cambiar?plan=profesional");
    expect(page).not.toContain("cambiar?plan=equipo");
  });

  it("con Mercado Pago sin configurar se muestra la alternativa de contacto, también en solo lectura, y ningún botón de pago", async () => {
    vi.stubEnv("MERCADOPAGO_ACCESS_TOKEN", "");
    vi.stubEnv("MERCADOPAGO_WEBHOOK_SECRET", "");
    await READ_ONLY["prueba vencida"]();
    await actAs("owner");
    const page = await html();
    expect(page).toContain("El pago online todavía no está habilitado");
    expect(page).toContain("mailto:");
    expect(page).not.toContain("/dashboard/facturacion/cambiar?plan=");
  });

  it("una cuenta suspendida no ve botones de contratación ni el bloque de contacto", async () => {
    await setStatus({ status: "suspended" });
    await actAs("owner");
    const page = await html();
    expect(page).not.toContain("/dashboard/facturacion/cambiar?plan=");
    expect(page).not.toContain("El pago online todavía no está habilitado");
  });

  it("sin billing.manage la pantalla no existe (administrador y profesional)", async () => {
    await READ_ONLY["prueba vencida"]();
    for (const role of ["admin", "professional"] as const) {
      await actAs(role);
      expect(await run(() => BillingPage(props()))).toMatch(/REDIRECT|NOT_FOUND/);
    }
  });
});

describe("/dashboard/facturacion/cambiar", () => {
  const open = (plan: string) => ChangePlanPage(props({ plan }));

  for (const [name, prepare] of Object.entries(READ_ONLY)) {
    it(`${name}: el formulario de contratación se abre (no redirige a la pantalla anterior)`, async () => {
      await prepare();
      await actAs("owner");
      for (const plan of ["profesional", "equipo"]) {
        const result = await run(async () => renderToStaticMarkup((await open(plan)) as never));
        expect(String(result), plan).not.toMatch(/^REDIRECT:/);
        expect(String(result), plan).toContain("<form");
      }
    });
  }

  it("una cuenta suspendida vuelve a la pantalla de planes", async () => {
    await setStatus({ status: "suspended" });
    await actAs("owner");
    expect(await run(() => open("profesional"))).toBe("REDIRECT:/dashboard/facturacion");
  });

  it("con Mercado Pago sin configurar vuelve a la pantalla de planes", async () => {
    vi.stubEnv("MERCADOPAGO_ACCESS_TOKEN", "");
    vi.stubEnv("MERCADOPAGO_WEBHOOK_SECRET", "");
    await READ_ONLY["prueba vencida"]();
    await actAs("owner");
    expect(await run(() => open("profesional"))).toBe("REDIRECT:/dashboard/facturacion");
  });

  it("un plan desconocido o el Equipo sin publicar no existen", async () => {
    await actAs("owner");
    expect(await run(() => open("gratis"))).toBe("NOT_FOUND");
    vi.stubEnv("PUBLISH_TEAM_PLANS", "");
    expect(await run(() => open("equipo"))).toBe("NOT_FOUND");
  });
});
