import { afterEach, describe, expect, it, vi } from "vitest";
import { canPayOnline, isMercadoPagoConfigured, mercadoPagoMode, onlinePaymentVisible } from "@/modules/billing/mercadopago";

function credentials(mode?: string, emails?: string) {
  vi.stubEnv("MERCADOPAGO_ACCESS_TOKEN", "token");
  vi.stubEnv("MERCADOPAGO_WEBHOOK_SECRET", "secret");
  vi.stubEnv("MERCADOPAGO_MODE", mode ?? "");
  vi.stubEnv("MERCADOPAGO_TEST_EMAILS", emails ?? "");
}

afterEach(() => vi.unstubAllEnvs());

describe("modo de Mercado Pago: un token de prueba no habilita pagos públicos", () => {
  it("sin modo declarado el pago online está apagado aunque haya credenciales", () => {
    credentials(undefined, "yo@example.com");
    expect(mercadoPagoMode()).toBeNull();
    expect(isMercadoPagoConfigured()).toBe(false);
    expect(canPayOnline("yo@example.com")).toBe(false);
    expect(onlinePaymentVisible()).toBe(false);
  });

  it("un valor desconocido cuenta como sin modo", () => {
    credentials("produccion");
    expect(isMercadoPagoConfigured()).toBe(false);
  });

  it("en modo live, cualquiera puede pagar", () => {
    credentials("live");
    expect(canPayOnline("cualquiera@example.com")).toBe(true);
    expect(canPayOnline(null)).toBe(true);
    expect(onlinePaymentVisible()).toBe(true);
  });

  it("en modo test solo pagan los emails autorizados (sin distinguir mayúsculas)", () => {
    credentials("TEST", " Yo@Example.com , otro@example.com ");
    expect(canPayOnline("yo@example.com")).toBe(true);
    expect(canPayOnline("OTRO@example.com")).toBe(true);
    expect(canPayOnline("visitante@example.com")).toBe(false);
    expect(canPayOnline(null)).toBe(false);
    expect(canPayOnline("")).toBe(false);
  });

  it("en modo test sin emails autorizados no paga nadie y el formulario público no se muestra", () => {
    credentials("test");
    expect(isMercadoPagoConfigured()).toBe(true);
    expect(canPayOnline("yo@example.com")).toBe(false);
    expect(onlinePaymentVisible()).toBe(false);
  });

  it("sin token o sin secreto no hay pago online en ningún modo", () => {
    vi.stubEnv("MERCADOPAGO_MODE", "live");
    vi.stubEnv("MERCADOPAGO_ACCESS_TOKEN", "");
    vi.stubEnv("MERCADOPAGO_WEBHOOK_SECRET", "secret");
    expect(canPayOnline("a@example.com")).toBe(false);
  });
});
