import { createHash } from "node:crypto";
import { describe, it, expect, afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";
import { db } from "@/lib/db";
import { addDays, todayInTz, zonedTimeToUtc } from "@/lib/time";
import { createSchedulableOrganization, uniqueSuffix } from "./helpers";

/**
 * «Consultá tus turnos»: el cliente pide por email un enlace temporal para
 * ver sus reservas en un negocio. Se prueba el módulo y la acción pública
 * real; solo se reemplazan las funciones de Next que necesitan una request.
 */

const request = vi.hoisted(() => ({ ip: "198.51.100.1", pending: [] as Array<Promise<unknown>> }));

vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": request.ip }) }));
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  // `after` corre al terminar la respuesta: acá se ejecuta y se guarda para esperarlo.
  after: (task: () => Promise<unknown>) => void request.pending.push(task()),
}));

import { cancelAppointment, createAppointment } from "@/modules/appointments/service";
import { requestAppointmentsLinkAction } from "@/modules/booking/actions";
import {
  listUpcomingAppointments,
  requestAppointmentsLink,
  resolveAccessToken,
  revokeAccessTokens,
} from "@/modules/public-page/lookup";

type Tenant = Awaited<ReturnType<typeof createSchedulableOrganization>>;

let a: Tenant;
let b: Tenant;
let email: string;

const tokenOf = (link: string | undefined) => link?.split("/").pop() ?? "";
const at = (tenant: Tenant, daysAhead: number, minutes: number) =>
  zonedTimeToUtc(addDays(todayInTz(tenant.organization.timezone), daysAhead), minutes, tenant.organization.timezone);

async function book(tenant: Tenant, customerEmail: string, daysAhead: number, minutes: number, name = "Clara Cliente") {
  const result = await createAppointment({
    organization: tenant.organization,
    serviceId: tenant.service.id,
    startsAt: at(tenant, daysAhead, minutes),
    customer: { name, email: customerEmail, phone: null },
    actor: "customer",
  });
  if (!result.ok) throw new Error(result.message);
  return result.appointment;
}

function lookupForm(tenant: Tenant, value: string, extra: Record<string, string> = {}) {
  const data = new FormData();
  data.set("slug", tenant.organization.slug);
  data.set("email", value);
  for (const [key, v] of Object.entries(extra)) data.set(key, v);
  return data;
}

function stubResend() {
  const spy = vi.fn(async (_url: unknown, _init?: RequestInit) => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", spy);
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("EMAIL_FROM", "Agendia <turnos@example.com>");
  return spy;
}

const sentEmails = (spy: ReturnType<typeof stubResend>) =>
  spy.mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as { from: string; to: string[]; subject: string; html: string; text: string });

const settle = async () => {
  await Promise.all(request.pending.splice(0));
};

beforeAll(async () => {
  a = await createSchedulableOrganization();
  b = await createSchedulableOrganization();
  await db.organization.updateMany({
    where: { id: { in: [a.organization.id, b.organization.id] } },
    data: { onboardingCompletedAt: new Date() },
  });
  a.organization = await db.organization.update({
    where: { id: a.organization.id },
    data: { name: 'Estudio "Luna" <b>', themePrimary: "#a8456a" },
  });
});

afterAll(async () => {
  await db.rateLimit.deleteMany({ where: { key: { startsWith: "lookup:" } } });
  await a.cleanup();
  await b.cleanup();
});

beforeEach(() => {
  email = `clara-${uniqueSuffix()}@example.com`;
  request.ip = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
});

afterEach(async () => {
  await settle();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await db.rateLimit.deleteMany({ where: { key: { startsWith: "lookup:" } } });
});

describe("enlace de consulta", () => {
  it("solo se emite para un email que tiene turnos en ese negocio", async () => {
    expect(await requestAppointmentsLink(a.organization, email)).toEqual({ sent: false });
    expect(await db.customerAccessToken.count({ where: { email } })).toBe(0);

    await book(a, email, 2, 10 * 60);
    const result = await requestAppointmentsLink(a.organization, email.toUpperCase());
    expect(result.devLink).toMatch(new RegExp(`^/${a.organization.slug}/mis-turnos/[\\w-]{40,}$`));

    // El mismo email no tiene turnos en el otro negocio: ahí no se emite nada.
    expect(await requestAppointmentsLink(b.organization, email)).toEqual({ sent: false });
    expect(await db.customerAccessToken.count({ where: { organizationId: b.organization.id, email } })).toBe(0);
  });

  it("en la base se guarda solo el hash del token", async () => {
    await book(a, email, 2, 10 * 60 + 30);
    const token = tokenOf((await requestAppointmentsLink(a.organization, email)).devLink);

    const stored = await db.customerAccessToken.findFirstOrThrow({ where: { email } });
    expect(stored.tokenHash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(stored.expiresAt.getTime()).toBeGreaterThan(Date.now() + 50 * 60000);
    expect(stored.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 60 * 60000);
  });

  it("vale únicamente para el negocio que lo emitió", async () => {
    await book(a, email, 2, 11 * 60);
    await book(b, email, 2, 11 * 60);
    const token = tokenOf((await requestAppointmentsLink(a.organization, email)).devLink);

    expect(await resolveAccessToken(a.organization.id, token)).toEqual({ email });
    expect(await resolveAccessToken(b.organization.id, token)).toBeNull();
  });

  it("rechaza tokens vencidos, inexistentes o malformados", async () => {
    await book(a, email, 2, 11 * 60 + 30);
    const token = tokenOf((await requestAppointmentsLink(a.organization, email)).devLink);
    expect(await resolveAccessToken(a.organization.id, token)).not.toBeNull();

    await db.customerAccessToken.updateMany({ where: { email }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await resolveAccessToken(a.organization.id, token)).toBeNull();

    for (const invalid of ["", "corto", "x".repeat(43), "y".repeat(500), `${token.slice(0, -1)}_`]) {
      expect(await resolveAccessToken(a.organization.id, invalid), invalid.slice(0, 12)).toBeNull();
    }
  });

  it("pedir un enlace nuevo invalida el anterior, y se puede revocar", async () => {
    await book(a, email, 2, 12 * 60);
    const first = tokenOf((await requestAppointmentsLink(a.organization, email)).devLink);
    const second = tokenOf((await requestAppointmentsLink(a.organization, email)).devLink);

    expect(await resolveAccessToken(a.organization.id, first)).toBeNull();
    expect(await resolveAccessToken(a.organization.id, second)).toEqual({ email });
    // Dentro de su vigencia se puede abrir más de una vez.
    expect(await resolveAccessToken(a.organization.id, second)).toEqual({ email });

    await revokeAccessTokens(a.organization.id, email);
    expect(await resolveAccessToken(a.organization.id, second)).toBeNull();
  });
});

describe("turnos que se muestran", () => {
  it("solo los próximos y confirmados de ese email en ese negocio", async () => {
    const other = `otra-${uniqueSuffix()}@example.com`;
    const upcoming = await book(a, email, 3, 9 * 60);
    const later = await book(a, email, 4, 9 * 60);
    const canceled = await book(a, email, 3, 10 * 60);
    await cancelAppointment({ organization: a.organization, appointmentId: canceled.id, actor: "customer" });
    await book(a, other, 3, 11 * 60, "Otra Persona");
    await book(b, email, 3, 9 * 60);
    // Un turno que ya pasó.
    const past = await book(a, email, 5, 9 * 60);
    await db.appointment.update({
      where: { id: past.id },
      data: { startsAt: new Date(Date.now() - 3 * 3600000), endsAt: new Date(Date.now() - 2.5 * 3600000) },
    });

    const listed = await listUpcomingAppointments(a.organization.id, email);
    expect(listed.map((appointment) => appointment.id)).toEqual([upcoming.id, later.id]);
    expect(listed[0]).toMatchObject({ manageToken: upcoming.manageToken, service: { name: "Consulta" } });

    // Con el identificador de otro negocio no aparece nada de este.
    const inB = await listUpcomingAppointments(b.organization.id, email);
    expect(inB).toHaveLength(1);
    expect(inB[0].id).not.toBe(upcoming.id);
    expect(await listUpcomingAppointments(a.organization.id, "nadie@example.com")).toEqual([]);
  });
});

describe("acción pública", () => {
  it("responde lo mismo exista o no el email, y solo envía a quien tiene turnos", async () => {
    await book(a, email, 6, 9 * 60);
    const spy = stubResend();

    const known = await requestAppointmentsLinkAction(undefined, lookupForm(a, email));
    const unknown = await requestAppointmentsLinkAction(undefined, lookupForm(a, `nadie-${uniqueSuffix()}@example.com`));
    await settle();

    expect(known).toEqual(unknown);
    expect(known).toMatchObject({ ok: true });
    expect(JSON.stringify(known)).not.toContain("mis-turnos/");

    const emails = sentEmails(spy);
    expect(emails).toHaveLength(1);
    expect(emails[0].to).toEqual([email]);
  });

  it("el email lleva el nombre y el color del negocio, sin interpretar HTML", async () => {
    await book(a, email, 6, 10 * 60);
    const spy = stubResend();

    await requestAppointmentsLinkAction(undefined, lookupForm(a, email));
    await settle();

    const [message] = sentEmails(spy);
    expect(message.subject).toBe('Tus turnos en Estudio "Luna" <b>');
    // Remitente: el nombre del negocio, limpio de lo que rompería la cabecera.
    expect(message.from).toBe('"Estudio Luna b" <turnos@example.com>');
    expect(message.html).toContain("Estudio &quot;Luna&quot; &lt;b&gt;");
    expect(message.html).not.toContain("<b>");
    expect(message.html).toContain("background:#a8456a");
    expect(message.text).toMatch(new RegExp(`/${a.organization.slug}/mis-turnos/[\\w-]{40,}`));

    const token = message.text.match(/mis-turnos\/([\w-]+)/)![1];
    expect(await resolveAccessToken(a.organization.id, token)).toEqual({ email });
  });

  it("limita los pedidos por casilla sin delatarlo, y por origen", async () => {
    await book(a, email, 6, 11 * 60);
    const spy = stubResend();

    const responses = [];
    for (let i = 0; i < 5; i++) {
      // Cada pedido llega desde otro origen: el tope es por casilla.
      request.ip = `203.0.113.${i + 1}`;
      responses.push(await requestAppointmentsLinkAction(undefined, lookupForm(a, email)));
      await settle();
    }
    expect(new Set(responses.map((r) => JSON.stringify(r))).size).toBe(1);
    expect(sentEmails(spy)).toHaveLength(3);

    // Desde un mismo origen, a partir del noveno pedido se corta.
    request.ip = "203.0.113.77";
    let last;
    for (let i = 0; i < 9; i++) {
      last = await requestAppointmentsLinkAction(undefined, lookupForm(a, `x${i}-${uniqueSuffix()}@example.com`));
    }
    expect(last).toMatchObject({ ok: false, message: expect.stringMatching(/Demasiados intentos/) });
  });

  it("no envía nada ante un email inválido, un negocio inexistente o un bot", async () => {
    await book(a, email, 6, 12 * 60);
    const spy = stubResend();

    expect(await requestAppointmentsLinkAction(undefined, lookupForm(a, "no-es-un-email"))).toMatchObject({ ok: false });
    const missing = lookupForm(a, email);
    missing.set("slug", "negocio-que-no-existe-xyz");
    expect(await requestAppointmentsLinkAction(undefined, missing)).toMatchObject({ ok: false });
    // Campo trampa completo: se responde como si nada, sin hacer nada.
    expect(await requestAppointmentsLinkAction(undefined, lookupForm(a, email, { website: "spam" }))).toMatchObject({ ok: true });
    await settle();

    expect(spy).not.toHaveBeenCalled();
    expect(await db.customerAccessToken.count({ where: { email } })).toBe(0);
  });

  it("en producción sin canal de email no promete un envío", async () => {
    await book(a, email, 6, 13 * 60);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("EMAIL_FROM", "");

    const result = await requestAppointmentsLinkAction(undefined, lookupForm(a, email));

    expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/no está disponible/) });
    expect(await db.customerAccessToken.count({ where: { email } })).toBe(0);
  });
});
