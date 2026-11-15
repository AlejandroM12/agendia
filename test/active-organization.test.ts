import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * La organización activa, el rol y los permisos se resuelven en el servidor en
 * cada pedido (lib/dal.ts), contra PostgreSQL real. Solo se reemplaza lo que
 * necesita una request: la lectura de la sesión (Auth.js), las cookies y las
 * redirecciones.
 */

const state = vi.hoisted(() => ({
  session: null as null | { user: { id: string; sessionVersion: number } },
  cookies: new Map<string, string>(),
}));

vi.mock("@/auth", () => ({ auth: async () => state.session }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (state.cookies.has(name) ? { name, value: state.cookies.get(name)! } : undefined),
    set: (name: string, value: string) => void state.cookies.set(name, value),
  }),
  headers: async () => new Headers(),
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

import { ACTIVE_ORGANIZATION_COOKIE, listWorkspaces, requireContext, requireOrganization, requirePagePermission, requireScopedWrite, requireWriteContext } from "@/lib/dal";
import { switchWorkspaceAction } from "@/modules/auth/workspace-actions";
import { addProfessional, createSchedulableOrganization } from "./helpers";

type Tenant = Awaited<ReturnType<typeof createSchedulableOrganization>>;

let a: Tenant; // la persona es propietaria
let b: Tenant; // la misma persona es profesional
let outsider: Tenant;
let userId: string;
let professionalInB: string;

const signIn = (id = userId, sessionVersion = 0) => {
  state.session = { user: { id, sessionVersion } };
};
const redirectOf = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};

beforeAll(async () => {
  a = await createSchedulableOrganization();
  b = await createSchedulableOrganization();
  outsider = await createSchedulableOrganization();
  userId = a.userId;
  for (const tenant of [a, b, outsider]) {
    await db.organization.update({ where: { id: tenant.organization.id }, data: { onboardingCompletedAt: new Date(), teamModeEnabled: true } });
  }
  // La persona de A también es profesional en B (un solo usuario, varios negocios).
  await db.membership.create({ data: { organizationId: b.organization.id, userId, role: "professional", notifyBookings: true } });
  const professional = await addProfessional(b.organization.id, { displayName: "Ana en B" });
  await db.professional.update({ where: { id: professional.id }, data: { userId } });
  professionalInB = professional.id;
});

beforeEach(() => {
  state.cookies.clear();
  signIn();
});

afterAll(async () => {
  await a?.cleanup();
  await b?.cleanup();
  await outsider?.cleanup();
});

describe("organización activa", () => {
  it("sin pista entra a su primera membresía, como siempre (propietaria, ve todo el negocio)", async () => {
    const context = await requireContext();
    expect(context.organization.id).toBe(a.organization.id);
    expect(context.role).toBe("owner");
    expect(context.restrictedProfessionalId).toBeNull();
    expect(context.permissions.has("billing.manage")).toBe(true);
  });

  it("la cookie es solo una pista: cambia de negocio si hoy es miembro, con otro rol y otros permisos", async () => {
    state.cookies.set(ACTIVE_ORGANIZATION_COOKIE, b.organization.id);
    const context = await requireContext();
    expect(context.organization.id).toBe(b.organization.id);
    expect(context.role).toBe("professional");
    expect(context.professional?.id).toBe(professionalInB);
    expect(context.restrictedProfessionalId).toBe(professionalInB);
    expect(context.permissions.has("own.agenda.view")).toBe(true);
    expect(context.permissions.has("billing.manage")).toBe(false);
    expect(context.permissions.has("team.manage")).toBe(false);
    // La misma cuenta, en el otro negocio, sigue siendo propietaria.
    state.cookies.set(ACTIVE_ORGANIZATION_COOKIE, a.organization.id);
    expect((await requireContext()).role).toBe("owner");
  });

  it("una pista de un negocio al que no pertenece (o inventada) se ignora", async () => {
    for (const value of [outsider.organization.id, "no-existe", "", "' OR 1=1 --"]) {
      state.cookies.set(ACTIVE_ORGANIZATION_COOKIE, value);
      expect((await requireContext()).organization.id).toBe(a.organization.id);
    }
  });

  it("el selector lista sus negocios con rol, y marca el activo", async () => {
    state.cookies.set(ACTIVE_ORGANIZATION_COOKIE, b.organization.id);
    const workspaces = await listWorkspaces(userId, (await requireContext()).organization.id);
    expect(workspaces.map((w) => [w.organizationId, w.role, w.active])).toEqual([
      [a.organization.id, "owner", false],
      [b.organization.id, "professional", true],
    ]);
  });

  it("cambiar de negocio solo funciona con una membresía vigente", async () => {
    await redirectOf(() => switchWorkspaceAction(b.organization.id));
    expect(state.cookies.get(ACTIVE_ORGANIZATION_COOKIE)).toBe(b.organization.id);
    expect((await requireContext()).organization.id).toBe(b.organization.id);

    state.cookies.clear();
    expect(await redirectOf(() => switchWorkspaceAction(outsider.organization.id))).toBeNull(); // no hace nada
    expect(state.cookies.has(ACTIVE_ORGANIZATION_COOKIE)).toBe(false);
    expect(await redirectOf(() => switchWorkspaceAction("x".repeat(200)))).toBeNull();
    expect(state.cookies.has(ACTIVE_ORGANIZATION_COOKIE)).toBe(false);
  });
});

describe("sesiones abiertas: lo que cambia en la base vale de inmediato", () => {
  it("un cambio de rol se aplica en el siguiente pedido, sin volver a iniciar sesión", async () => {
    const membership = await db.membership.findFirstOrThrow({ where: { organizationId: a.organization.id, userId } });
    await db.membership.update({ where: { id: membership.id }, data: { role: "admin" } });
    try {
      const context = await requireContext();
      expect(context.role).toBe("admin");
      expect(context.permissions.has("billing.manage")).toBe(false);
      expect(context.permissions.has("permissions.configure")).toBe(false);
      expect(context.permissions.has("team.manage")).toBe(true);
    } finally {
      await db.membership.update({ where: { id: membership.id }, data: { role: "owner" } });
    }
  });

  it("al revocar la membresía del negocio activo, la sesión abierta pasa a otro negocio válido; sin ninguno, a «sin acceso»", async () => {
    state.cookies.set(ACTIVE_ORGANIZATION_COOKIE, b.organization.id);
    expect((await requireContext()).organization.id).toBe(b.organization.id);

    const inB = await db.membership.findFirstOrThrow({ where: { organizationId: b.organization.id, userId } });
    await db.membership.delete({ where: { id: inB.id } });
    // El trigger de la base soltó al profesional, que conserva su perfil.
    expect((await db.professional.findUniqueOrThrow({ where: { id: professionalInB } })).userId).toBeNull();
    expect((await requireContext()).organization.id).toBe(a.organization.id);

    // Una persona que se queda sin ningún negocio llega a una pantalla que lo explica.
    const solo = await createSchedulableOrganization();
    try {
      signIn(solo.userId);
      await db.membership.deleteMany({ where: { userId: solo.userId } });
      expect(await redirectOf(() => requireContext())).toBe("REDIRECT:/sin-acceso");
    } finally {
      await solo.cleanup();
    }

    // Se restaura lo que usan las demás pruebas.
    await db.membership.create({ data: { organizationId: b.organization.id, userId, role: "professional" } });
    await db.professional.update({ where: { id: professionalInB }, data: { userId } });
  });

  it("una sesión invalidada (cambio de contraseña) o sin email verificado no entra", async () => {
    signIn(userId, 99);
    expect(await redirectOf(() => requireContext())).toBe("REDIRECT:/logout");
    signIn();
    await db.user.update({ where: { id: userId }, data: { emailVerifiedAt: null } });
    try {
      expect(await redirectOf(() => requireContext())).toBe("REDIRECT:/verificar-email");
    } finally {
      await db.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
    }
    state.session = null;
    expect(await redirectOf(() => requireContext())).toBe("REDIRECT:/login");
  });

  it("los permisos del profesional los decide el propietario y valen en el siguiente pedido", async () => {
    state.cookies.set(ACTIVE_ORGANIZATION_COOKIE, b.organization.id);
    const base = await requireContext();
    expect(base.permissions.has("own.appointments.cancel")).toBe(false); // predeterminado: requiere autorización
    expect(base.permissions.has("own.appointments.create")).toBe(true);
    expect(base.permissions.has("own.hours.manage")).toBe(false);

    await db.organization.update({ where: { id: b.organization.id }, data: { professionalPermissions: { cancelAppointments: true, createAppointments: false } } });
    const org = await requireContext();
    expect(org.permissions.has("own.appointments.cancel")).toBe(true);
    expect(org.permissions.has("own.appointments.create")).toBe(false);

    // La excepción individual le gana a la del negocio.
    await db.professional.update({ where: { id: professionalInB }, data: { permissionOverrides: { cancelAppointments: false, manageHours: true } } });
    const overridden = await requireContext();
    expect(overridden.permissions.has("own.appointments.cancel")).toBe(false);
    expect(overridden.permissions.has("own.hours.manage")).toBe(true);

    await db.organization.update({ where: { id: b.organization.id }, data: { professionalPermissions: Prisma.DbNull } });
    await db.professional.update({ where: { id: professionalInB }, data: { permissionOverrides: Prisma.DbNull } });
  });
});

describe("los guardianes de acciones y páginas usan el rol real", () => {
  it("un profesional no pasa los guardianes de gestión, y sí los propios", async () => {
    state.cookies.set(ACTIVE_ORGANIZATION_COOKIE, b.organization.id);
    expect(await requireWriteContext("team.manage")).toMatchObject({ ok: false });
    expect(await requireWriteContext("billing.manage")).toMatchObject({ ok: false });
    expect(await requireWriteContext("settings.manage")).toMatchObject({ ok: false });
    expect(await requireScopedWrite("appointments.manage", "own.appointments.create")).toMatchObject({ ok: true });
    expect(await requireScopedWrite("appointments.manage", "own.appointments.cancel")).toMatchObject({ ok: false });
    for (const permission of ["team.manage", "services.manage", "publicpage.manage", "settings.manage", "billing.manage"] as const) {
      expect(await redirectOf(() => requirePagePermission(permission)), permission).toBe("REDIRECT:/dashboard");
    }
    expect((await requireOrganization()).restrictedProfessionalId).toBe(professionalInB);
  });
});
