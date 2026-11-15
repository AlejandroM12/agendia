import { describe, expect, it } from "vitest";
import {
  can,
  DEFAULT_PROFESSIONAL_PERMISSIONS,
  parsePermissionOverrides,
  permissionsFor,
  PROFESSIONAL_PERMISSION_KEYS,
  resolveProfessionalPermissions,
  type Permission,
} from "@/lib/permissions";

const BUSINESS: Permission[] = [
  "team.manage", "team.invite", "members.manage_admins", "permissions.configure", "schedule.manage", "appointments.manage",
  "services.manage", "customers.manage", "customers.contact", "publicpage.manage", "settings.manage", "stats.view", "billing.manage",
];

describe("matriz de permisos por rol", () => {
  it("el propietario puede todo", () => {
    for (const permission of BUSINESS) expect(can("owner", permission), permission).toBe(true);
  });

  it("el administrador opera el negocio pero no factura, no da permisos ni nombra administradores", () => {
    for (const permission of BUSINESS) {
      const denied = ["billing.manage", "permissions.configure", "members.manage_admins"].includes(permission);
      expect(can("admin", permission), permission).toBe(!denied);
    }
  });

  it("el profesional, por defecto, solo ve su agenda y lo que el negocio le habilita; nada de gestión", () => {
    const set = permissionsFor("professional");
    for (const permission of BUSINESS) expect(set.has(permission), permission).toBe(false);
    expect([...set].sort()).toEqual(
      ["own.agenda.view", "own.appointments.create", "own.appointments.outcome", "own.appointments.reschedule", "own.blocks.manage", "own.customers.contact"].sort(),
    );
    expect(set.has("own.appointments.cancel")).toBe(false);
    expect(set.has("own.hours.manage")).toBe(false);
    expect(set.has("team.availability.view")).toBe(false);
  });

  it("un rol desconocido, vacío o nulo no tiene ningún permiso", () => {
    for (const role of ["superadmin", "OWNER", "", null, undefined, "root", "professional "]) {
      expect(permissionsFor(role as string).size, String(role)).toBe(role === "professional " ? 0 : 0);
    }
  });

  it("cada permiso configurable se activa y desactiva por separado", () => {
    for (const key of PROFESSIONAL_PERMISSION_KEYS) {
      const on = permissionsFor("professional", { ...DEFAULT_PROFESSIONAL_PERMISSIONS, [key]: true });
      const off = permissionsFor("professional", { ...DEFAULT_PROFESSIONAL_PERMISSIONS, [key]: false });
      expect(on.size - off.size, key).toBe(1);
    }
    const all = permissionsFor("professional", Object.fromEntries(PROFESSIONAL_PERMISSION_KEYS.map((k) => [k, true])) as never);
    for (const permission of BUSINESS) expect(all.has(permission), `ni con todo activado: ${permission}`).toBe(false);
  });

  it("predeterminados ← negocio ← excepción individual; lo inválido se ignora", () => {
    expect(resolveProfessionalPermissions(null, null)).toEqual(DEFAULT_PROFESSIONAL_PERMISSIONS);
    expect(resolveProfessionalPermissions({ cancelAppointments: true }, null).cancelAppointments).toBe(true);
    expect(resolveProfessionalPermissions({ cancelAppointments: true }, { cancelAppointments: false }).cancelAppointments).toBe(false);
    for (const junk of ["x", 5, [], { cancelAppointments: "sí", otra: true, manageHours: 1 }, null, undefined]) {
      expect(parsePermissionOverrides(junk)).toEqual({});
    }
    // Nada de lo guardado puede otorgar un permiso de gestión: solo existen las ocho claves.
    expect(Object.keys(resolveProfessionalPermissions({ "billing.manage": true, team: true }, { admin: true }))).toEqual([...PROFESSIONAL_PERMISSION_KEYS]);
  });
});
