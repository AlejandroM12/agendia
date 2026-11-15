import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { ensurePlan } from "@/modules/billing/catalog";
import { enqueueAccountNotice, renderAccountNotice, scanAccountNotices } from "@/modules/notifications/account-notices";
import { processDueNotifications } from "@/modules/notifications/process";
import { createSchedulableOrganization } from "./helpers";

type Ctx = Awaited<ReturnType<typeof createSchedulableOrganization>>;
let ctx: Ctx;
const DAY = 86400000;

beforeEach(async () => {
  ctx = await createSchedulableOrganization();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await ctx.cleanup();
});

const notices = () => db.notification.findMany({ where: { organizationId: ctx.organization.id, type: "account_notice" } });
const setTrialEnd = (ms: number, status: "trial" | "trial_readonly" = "trial") =>
  db.organization.update({ where: { id: ctx.organization.id }, data: { trialEndsAt: new Date(Date.now() + ms), status } });

describe("avisos de la cuenta", () => {
  it("avisa una sola vez, al propietario, cuando faltan 3 días o menos para terminar la prueba", async () => {
    await setTrialEnd(2 * DAY);
    await scanAccountNotices();
    await scanAccountNotices();
    const rows = await notices();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ recipient: ctx.ownerEmail, status: "pending", payload: { kind: "trial_ending" } });
  });

  it("no avisa si falta más, ni a quien ya contrató", async () => {
    await setTrialEnd(10 * DAY);
    await scanAccountNotices();
    expect(await notices()).toHaveLength(0);

    await setTrialEnd(1 * DAY);
    const plan = await ensurePlan("profesional");
    await db.subscription.create({ data: { organizationId: ctx.organization.id, planId: plan.id, status: "pending" } });
    await scanAccountNotices();
    expect(await notices()).toHaveLength(0);
    await db.subscription.deleteMany({ where: { organizationId: ctx.organization.id } });
  });

  it("al terminar la prueba manda un único aviso con lo que pasa y cómo recuperar el acceso", async () => {
    await setTrialEnd(-1 * DAY, "trial_readonly");
    await scanAccountNotices();
    await scanAccountNotices();
    const rows = await notices();
    expect(rows.map((row) => (row.payload as { kind: string }).kind)).toEqual(["trial_ended"]);
    const rendered = renderAccountNotice(rows[0], { name: ctx.organization.name, timezone: ctx.organization.timezone, trialEndsAt: new Date() })!;
    expect(rendered.text).toMatch(/siguen guardados/);
    expect(rendered.text).toMatch(/Plan Profesional: \$\s?9\.900/);
    // El Plan Equipo no se menciona mientras no esté publicado.
    expect(rendered.text).not.toMatch(/Plan Equipo/);
  });

  it("con los planes con equipo publicados, el aviso también presenta el Plan Equipo", async () => {
    vi.stubEnv("PUBLISH_TEAM_PLANS", "1");
    await enqueueAccountNotice(ctx.organization.id, "trial_ending", { key: "x" });
    const rendered = renderAccountNotice((await notices())[0], { name: "N", timezone: "America/Argentina/Buenos_Aires", trialEndsAt: new Date() })!;
    expect(rendered.text).toMatch(/Plan Equipo: \$\s?19\.900/);
  });

  it("el worker lo envía solo a un propietario vigente; si dejó de serlo, se cancela", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "m1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await enqueueAccountNotice(ctx.organization.id, "trial_ended", { key: "k" });
    await processDueNotifications(50);
    const sent = (await notices())[0];
    expect(["sent", "skipped"]).toContain(sent.status);

    await enqueueAccountNotice(ctx.organization.id, "capacity_grace", { key: "g", payload: { endsAt: new Date().toISOString() } });
    await db.membership.updateMany({ where: { organizationId: ctx.organization.id }, data: { role: "admin" } });
    await processDueNotifications(50);
    const second = (await notices()).find((row) => (row.payload as { kind: string }).kind === "capacity_grace")!;
    expect(second.status).toBe("canceled");
  });

  it("el aviso de exceso de cupo menciona la fecha límite y que no se borra nada", async () => {
    await enqueueAccountNotice(ctx.organization.id, "capacity_grace", { key: "g", payload: { endsAt: new Date(Date.now() + 7 * DAY).toISOString() } });
    const rendered = renderAccountNotice((await notices())[0], { name: "N", timezone: "America/Argentina/Buenos_Aires", trialEndsAt: new Date() })!;
    expect(rendered.text).toMatch(/No borramos ni desactivamos nada/);
    expect(rendered.text).toMatch(/Plan Equipo/);
  });
});
