import { describe, it, expect, afterAll, beforeAll, vi } from "vitest";
import { firstFieldErrors } from "@/lib/action-state";
import { checkPassword, PASSWORD_RULES, passwordSchema } from "@/lib/password-rules";
import { changePasswordSchema, newPasswordSchema, registerSchema } from "@/modules/auth/schemas";
import { bookingContactSchema, customerInputSchema } from "@/modules/customers/schema";
import { db } from "@/lib/db";
import { addDays, todayInTz, zonedTimeToUtc } from "@/lib/time";
import { createSchedulableOrganization, uniqueSuffix } from "./helpers";

/**
 * Validación compartida entre el navegador y el servidor: los formularios
 * muestran estos mismos mensajes antes de enviar, y el servidor vuelve a
 * aplicar las mismas reglas.
 */

vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": `192.0.2.${Math.floor(Math.random() * 250) + 1}` }) }));

import { bookAppointmentAction } from "@/modules/booking/actions";
import { registerOrganizationSchema } from "@/modules/organizations/register";
import { resetPasswordSchema } from "@/modules/auth/password-reset";

describe("requisitos de contraseña: una sola definición", () => {
  it("los indicadores y el esquema del servidor salen de la misma lista", () => {
    const cases: Array<[string, boolean[]]> = [
      ["", [false, false, false]],
      ["abc", [false, true, false]],
      ["12345678", [true, false, true]],
      ["abcdefgh", [true, true, false]],
      ["abc12", [false, true, true]],
      ["abcdefg1", [true, true, true]],
    ];
    for (const [password, expected] of cases) {
      const status = checkPassword(password);
      expect(status.map((rule) => rule.met), password).toEqual(expected);
      // El servidor acepta la contraseña exactamente cuando todos los indicadores están cumplidos.
      expect(passwordSchema.safeParse(password).success, password).toBe(expected.every(Boolean));
    }
    expect(checkPassword("").map((rule) => rule.label)).toEqual(PASSWORD_RULES.map((rule) => rule.label));
  });

  it("registro, restablecimiento y cambio de contraseña aplican los mismos requisitos, con mensajes específicos", () => {
    const weak = "abcdefgh";
    const message = "Debe contener al menos un número.";
    const register = registerSchema.safeParse({ name: "Ana", email: "ana@example.com", password: weak });
    const organization = registerOrganizationSchema.safeParse({ name: "Ana", email: "ana@example.com", password: weak });
    const reset = resetPasswordSchema.safeParse({ token: "t", password: weak });
    const fresh = newPasswordSchema.safeParse({ password: weak });
    const change = changePasswordSchema.safeParse({ current: "x", next: weak });
    for (const result of [register, organization, reset, fresh]) {
      expect(result.success).toBe(false);
      if (!result.success) expect(firstFieldErrors(result.error).password).toBe(message);
    }
    expect(!change.success && firstFieldErrors(change.error).next).toBe(message);
    expect(registerSchema.safeParse({ name: "Ana", email: "ana@example.com", password: "abcdefg1" }).success).toBe(true);
  });

  it("el registro informa cada campo inválido por separado", () => {
    const result = registerSchema.safeParse({ name: "", email: "ana@", password: "x" });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(firstFieldErrors(result.error)).toEqual({
      name: "Ingresá tu nombre.",
      email: "Ingresá un email válido, como nombre@ejemplo.com.",
      password: "Debe tener al menos 8 caracteres.",
    });
  });
});

describe("datos de contacto al reservar", () => {
  const parse = (input: { name?: string; email?: string; phone?: string }) =>
    bookingContactSchema.safeParse({ name: "Marina Díaz", email: "", phone: "", ...input });

  it("alcanza con un email o con un WhatsApp válidos", () => {
    expect(parse({ email: "Marina@Example.com" })).toMatchObject({ success: true, data: { email: "marina@example.com", phone: null } });
    expect(parse({ phone: "11 5555 0000" })).toMatchObject({ success: true, data: { email: null, phone: "11 5555 0000" } });
    expect(parse({ email: "m@example.com", phone: "+54 9 351 555 0000" }).success).toBe(true);
  });

  it("sin ningún contacto, el error se marca en los dos campos", () => {
    const result = parse({});
    expect(result.success).toBe(false);
    if (result.success) return;
    const message = "Dejanos un email o un WhatsApp para poder avisarte.";
    expect(firstFieldErrors(result.error)).toEqual({ email: message, phone: message });
  });

  it("valida el formato de cada dato, con mensajes específicos", () => {
    const email = parse({ email: "marina@" });
    expect(!email.success && firstFieldErrors(email.error)).toEqual({ email: "Ingresá un email válido, como nombre@ejemplo.com." });
    for (const phone of ["123", "abc", "+-"]) {
      const result = parse({ phone });
      expect(!result.success && firstFieldErrors(result.error).phone, phone).toMatch(/teléfono válido/);
    }
    const name = parse({ name: " ", email: "m@example.com" });
    expect(!name.success && firstFieldErrors(name.error)).toEqual({ name: "Ingresá tu nombre y apellido." });
  });

  it("un teléfono que no se puede usar ya no se acepta en silencio como «sin contacto»", () => {
    expect(customerInputSchema.safeParse({ name: "Cliente", email: "", phone: "12" }).success).toBe(false);
    expect(customerInputSchema.safeParse({ name: "Cliente", email: "", phone: "" }).success).toBe(true);
  });
});

describe("acción de reserva: errores por campo y sin efectos", () => {
  type Tenant = Awaited<ReturnType<typeof createSchedulableOrganization>>;
  let tenant: Tenant;

  const form = (values: Record<string, string>) => {
    const data = new FormData();
    data.set("slug", tenant.organization.slug);
    data.set("serviceId", tenant.service.id);
    data.set("slot", zonedTimeToUtc(addDays(todayInTz(tenant.organization.timezone), 3), 10 * 60, tenant.organization.timezone).toISOString());
    for (const [key, value] of Object.entries(values)) data.set(key, value);
    return data;
  };
  const appointments = () => db.appointment.count({ where: { organizationId: tenant.organization.id } });

  beforeAll(async () => {
    tenant = await createSchedulableOrganization();
    await db.organization.update({ where: { id: tenant.organization.id }, data: { onboardingCompletedAt: new Date() } });
  });

  afterAll(async () => {
    await db.rateLimit.deleteMany({ where: { key: { startsWith: "booking:192.0.2." } } });
    await tenant.cleanup();
  });

  it("sin contacto o con datos inválidos no crea el turno y dice qué campo corregir", async () => {
    const missing = await bookAppointmentAction(undefined, form({ name: "Marina Díaz" }));
    expect(missing).toMatchObject({ ok: false, errors: { email: [expect.stringMatching(/email o un WhatsApp/)], phone: [expect.any(String)] } });
    expect(missing && !missing.ok && missing.refresh).toBeFalsy();

    const badPhone = await bookAppointmentAction(undefined, form({ name: "Marina Díaz", phone: "12" }));
    expect(badPhone).toMatchObject({ ok: false, errors: { phone: [expect.stringMatching(/teléfono válido/)] } });

    const badEmail = await bookAppointmentAction(undefined, form({ name: "Marina Díaz", email: "marina@" }));
    expect(badEmail).toMatchObject({ ok: false, errors: { email: [expect.stringMatching(/email válido/)] } });

    expect(await appointments()).toBe(0);
  });

  it("la respuesta de error no devuelve los datos enviados (los conserva el navegador)", async () => {
    const secret = `dato-${uniqueSuffix()}@`;
    const result = await bookAppointmentAction(undefined, form({ name: "Marina Díaz", email: secret }));
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("con datos válidos reserva, y el mismo horario pedido otra vez se rechaza pidiendo elegir otro", async () => {
    const first = await bookAppointmentAction(undefined, form({ name: "Marina Díaz", phone: "11 5555 0000" }));
    expect(first).toMatchObject({ ok: true });
    const second = await bookAppointmentAction(undefined, form({ name: "Otra Persona", email: "otra@example.com" }));
    expect(second).toMatchObject({ ok: false, refresh: true });
    expect(await appointments()).toBe(1);
  });
});
