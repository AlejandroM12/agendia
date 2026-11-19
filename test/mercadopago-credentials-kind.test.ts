import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertCredentialsMatchMode, createPreapproval, createPreference, resetDetectedCredentialsKind } from "@/modules/billing/mercadopago";

const preapprovalParams = { organizationId: "o", payerEmail: "a@b.co", reason: "r", amount: 9900, currency: "ARS", backUrl: "https://x.test" };

function account(tags: string[]) {
  const fetchMock = vi.fn(async (url: unknown) =>
    String(url).endsWith("/users/me")
      ? new Response(JSON.stringify({ id: 1, tags }), { status: 200 })
      : new Response(JSON.stringify({ id: "pre1", init_point: "https://mp.test/x" }), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  resetDetectedCredentialsKind();
  vi.stubEnv("MERCADOPAGO_ACCESS_TOKEN", "APP_USR-token");
  vi.stubEnv("MERCADOPAGO_WEBHOOK_SECRET", "secret");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetDetectedCredentialsKind();
});

describe("credenciales de prueba vs. de producción", () => {
  it("credenciales de PRUEBA declaradas como live: no se crea ninguna suscripción ni preferencia", async () => {
    vi.stubEnv("MERCADOPAGO_MODE", "live");
    const fetchMock = account(["user_product_seller", "test_user", "normal"]);
    await expect(createPreapproval(preapprovalParams)).rejects.toThrow(/credenciales cargadas son de PRUEBA/);
    await expect(createPreference({ externalReference: "license:1", title: "t", amount: 1, currency: "ARS", payer: { email: "a@b.co", name: "A" }, returnUrl: "https://x.test" })).rejects.toThrow(/PRUEBA/);
    expect(fetchMock.mock.calls.every(([url]) => String(url).endsWith("/users/me"))).toBe(true); // nunca llegó al POST
  });

  it("credenciales de PRODUCCIÓN declaradas como test: se bloquea (un cobro real sería posible)", async () => {
    vi.stubEnv("MERCADOPAGO_MODE", "test");
    account(["user_product_seller", "normal"]);
    await expect(createPreapproval(preapprovalParams)).rejects.toThrow(/PRODUCCIÓN/);
  });

  it("modo y credenciales coherentes: opera, y el tipo de cuenta se consulta una sola vez", async () => {
    vi.stubEnv("MERCADOPAGO_MODE", "test");
    const fetchMock = account(["test_user"]);
    await createPreapproval(preapprovalParams);
    await createPreapproval(preapprovalParams);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/users/me"))).toHaveLength(1);
  });

  it("sin modo declarado no se opera", async () => {
    vi.stubEnv("MERCADOPAGO_MODE", "");
    account(["test_user"]);
    await expect(assertCredentialsMatchMode()).rejects.toThrow(/falta MERCADOPAGO_MODE/);
  });

  it("si Mercado Pago no responde a la consulta de la cuenta no se asume nada: se deja operar y se reintenta después", async () => {
    vi.stubEnv("MERCADOPAGO_MODE", "live");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    await expect(assertCredentialsMatchMode()).resolves.toBeUndefined();
  });
});
