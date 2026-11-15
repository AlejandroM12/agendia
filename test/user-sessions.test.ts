import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

/**
 * Sesiones revocables: cerrar una sola, cerrar las demás, que las anteriores a la tabla sigan valiendo y
 * que nadie pueda revocar (ni usar) la sesión de otra persona. Contra PostgreSQL real; solo se reemplaza la
 * lectura de la sesión de Auth.js, las cookies y las redirecciones.
 */

const state = vi.hoisted(() => ({
  session: null as null | { user: { id: string; sessionVersion: number; sid?: string } },
}));

vi.mock("@/auth", () => ({ auth: async () => state.session }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => undefined }),
  headers: async () => new Headers({ "user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

import { requireContext } from "@/lib/dal";
import { createUserSession, describeDevice, isSessionActive, listSessions, pruneSessions, revokeOtherSessions, revokeSession } from "@/lib/sessions";
import { revokeOtherSessionsAction, revokeSessionAction } from "@/modules/auth/account-actions";
import { createSchedulableOrganization } from "./helpers";

type Tenant = Awaited<ReturnType<typeof createSchedulableOrganization>>;
let a: Tenant;
let b: Tenant;

const as = (userId: string, sid?: string, sessionVersion = 0) => {
  state.session = { user: { id: userId, sessionVersion, sid } };
};
const outcome = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
    return "ok";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};

beforeAll(async () => {
  a = await createSchedulableOrganization();
  b = await createSchedulableOrganization();
  for (const tenant of [a, b]) await db.organization.update({ where: { id: tenant.organization.id }, data: { onboardingCompletedAt: new Date() } });
});
beforeEach(async () => {
  await db.userSession.deleteMany({ where: { userId: { in: [a.userId, b.userId] } } });
  await db.user.updateMany({ where: { id: { in: [a.userId, b.userId] } }, data: { sessionVersion: 0 } });
});
afterAll(async () => {
  await a?.cleanup();
  await b?.cleanup();
});

describe("sesiones revocables", () => {
  it("cada inicio de sesión queda registrado con una descripción corta del dispositivo", async () => {
    const sid = await createUserSession(a.userId);
    const [row] = await listSessions(a.userId);
    expect(row).toMatchObject({ id: sid, device: "Chrome en Windows" });
    expect(describeDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit Safari/604.1")).toBe("Safari en iPhone/iPad");
    expect(describeDevice(null)).toBe("Navegador en otro sistema");
  });

  it("una sesión válida entra; una revocada deja de valer en el próximo pedido; las demás siguen", async () => {
    const phone = await createUserSession(a.userId);
    const laptop = await createUserSession(a.userId);

    as(a.userId, phone);
    expect((await requireContext()).user.id).toBe(a.userId);

    expect(await revokeSession(a.userId, phone)).toBe(true);
    as(a.userId, phone);
    expect(await outcome(() => requireContext())).toBe("REDIRECT:/logout");
    as(a.userId, laptop);
    expect(await outcome(() => requireContext())).toBe("ok");
  });

  it("una sesión anterior a la tabla (sin sid) sigue valiendo hasta que cambia la contraseña", async () => {
    as(a.userId, undefined);
    expect(await outcome(() => requireContext())).toBe("ok");
    await db.user.update({ where: { id: a.userId }, data: { sessionVersion: { increment: 1 } } });
    as(a.userId, undefined);
    expect(await outcome(() => requireContext())).toBe("REDIRECT:/logout");
  });

  it("cambiar la contraseña (sessionVersion) invalida también las sesiones con sid", async () => {
    const sid = await createUserSession(a.userId);
    await db.user.update({ where: { id: a.userId }, data: { sessionVersion: { increment: 1 } } });
    as(a.userId, sid, 0);
    expect(await outcome(() => requireContext())).toBe("REDIRECT:/logout");
  });

  it("el sid de otra persona no sirve: ni para entrar ni para revocar", async () => {
    const mine = await createUserSession(a.userId);
    const theirs = await createUserSession(b.userId);

    as(a.userId, theirs); // token propio con el sid ajeno
    expect(await outcome(() => requireContext())).toBe("REDIRECT:/logout");

    as(a.userId, mine);
    expect(await revokeSessionAction(theirs)).toMatchObject({ message: "No encontramos esa sesión." });
    expect(await isSessionActive(b.userId, theirs)).toBe(true);
    expect(await revokeSession(a.userId, theirs)).toBe(false);
  });

  it("cerrar las demás sesiones conserva la actual y no toca a nadie más", async () => {
    const current = await createUserSession(a.userId);
    await createUserSession(a.userId);
    await createUserSession(a.userId);
    const other = await createUserSession(b.userId);

    as(a.userId, current);
    expect(await revokeOtherSessionsAction()).toMatchObject({ ok: true, message: "Cerramos 2 sesiones." });
    expect(await isSessionActive(a.userId, current)).toBe(true);
    expect((await listSessions(a.userId)).map((s) => s.id)).toEqual([current]);
    expect(await isSessionActive(b.userId, other)).toBe(true);
    expect(await revokeOtherSessions(a.userId, current)).toBe(0);
  });

  it("desde la acción no se puede cerrar la sesión actual (para eso está «Cerrar sesión»)", async () => {
    const current = await createUserSession(a.userId);
    as(a.userId, current);
    expect(await revokeSessionAction(current)).toMatchObject({ message: expect.stringContaining("sesión actual") });
    expect(await isSessionActive(a.userId, current)).toBe(true);
  });

  it("la limpieza borra solo sesiones revocadas o inactivas hace más de 40 días", async () => {
    const fresh = await createUserSession(a.userId);
    const stale = await createUserSession(a.userId);
    const old = new Date(Date.now() - 50 * 86400000);
    await db.userSession.update({ where: { id: stale }, data: { lastSeenAt: old } });
    expect(await pruneSessions()).toBe(1);
    expect(await isSessionActive(a.userId, fresh)).toBe(true);
    expect(await db.userSession.count({ where: { id: stale } })).toBe(0);
  });
});
