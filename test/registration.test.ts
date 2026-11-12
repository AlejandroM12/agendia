import { describe, it, expect, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import { getRegistrationStatus } from "@/modules/auth/registration";
import { createAppointment } from "@/modules/appointments/service";
import { addDays, todayInTz, zonedTimeToUtc } from "@/lib/time";
import { createSchedulableOrganization } from "./helpers";

describe("apertura del registro", () => {
  afterEach(() => vi.unstubAllEnvs());

  const production = (env: Record<string, string>) => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEPLOYMENT_MODE", "saas");
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("EMAIL_FROM", "");
    vi.stubEnv("ALLOW_REGISTRATION_WITHOUT_EMAIL", "");
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  };

  it("en producción sin canal de email el registro está cerrado: nadie podría recuperar su acceso", async () => {
    production({});
    expect(await getRegistrationStatus()).toEqual({ open: false, reason: "email_not_configured" });
  });

  it("media configuración de email no alcanza", async () => {
    production({ RESEND_API_KEY: "re_solo_la_clave" });
    expect((await getRegistrationStatus()).open).toBe(false);
  });

  it("con el email configurado, el registro se abre", async () => {
    production({ RESEND_API_KEY: "re_test", EMAIL_FROM: "Agendia <turnos@example.com>" });
    expect(await getRegistrationStatus()).toEqual({ open: true });
  });

  it("solo se puede forzar con la variable explícita de pruebas/staging", async () => {
    production({ ALLOW_REGISTRATION_WITHOUT_EMAIL: "1" });
    expect(await getRegistrationStatus()).toEqual({ open: true });
  });

  it("en desarrollo está abierto (el enlace de recuperación se muestra en pantalla)", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("RESEND_API_KEY", "");
    expect(await getRegistrationStatus()).toEqual({ open: true });
  });

  it("una instalación independiente con su cuenta ya creada no acepta registros nuevos", async () => {
    const existing = await createSchedulableOrganization();
    try {
      production({ DEPLOYMENT_MODE: "standalone", RESEND_API_KEY: "re_test", EMAIL_FROM: "a@example.com" });
      expect(await getRegistrationStatus()).toEqual({ open: false, reason: "standalone_already_set_up" });
    } finally {
      vi.unstubAllEnvs();
      await existing.cleanup();
    }
  });
});

describe("datos de clientes frente a reservas públicas", () => {
  it("una reserva pública con el email de un cliente existente no modifica su ficha", async () => {
    const ctx = await createSchedulableOrganization();
    try {
      const day = addDays(todayInTz(ctx.organization.timezone), 2);
      const at = (minutes: number) => zonedTimeToUtc(day, minutes, ctx.organization.timezone);

      const original = await db.customer.create({
        data: { organizationId: ctx.organization.id, name: "Marta Real", email: "marta@example.com" },
      });

      const booking = await createAppointment({
        organization: ctx.organization,
        serviceId: ctx.service.id,
        startsAt: at(10 * 60),
        customer: { name: "Impostor", email: "marta@example.com", phone: "1100000000" },
        actor: "customer",
      });
      expect(booking.ok).toBe(true);

      const after = await db.customer.findUniqueOrThrow({ where: { id: original.id } });
      expect(after).toMatchObject({ name: "Marta Real", phone: null });

      // El profesional, en cambio, sí puede completar el teléfono que faltaba.
      const manual = await createAppointment({
        organization: ctx.organization,
        serviceId: ctx.service.id,
        startsAt: at(12 * 60),
        customer: { name: "Marta Real", email: "marta@example.com", phone: "11 2222-3333" },
        actor: "professional",
      });
      expect(manual.ok).toBe(true);
      expect((await db.customer.findUniqueOrThrow({ where: { id: original.id } })).phone).toBe("1122223333");
    } finally {
      await ctx.cleanup();
    }
  });
});
