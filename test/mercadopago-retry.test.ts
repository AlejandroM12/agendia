import { afterEach, describe, expect, it, vi } from "vitest";
import { createPreapproval, getPreapproval, resetDetectedCredentialsKind } from "@/modules/billing/mercadopago";

afterEach(() => {
  resetDetectedCredentialsKind();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const limited = () => new Response(JSON.stringify({ status: 429, message: "local_rate_limited" }), { status: 429 });

describe("cliente de Mercado Pago: reintentos", () => {
  it("una consulta que recibe 429 se reintenta y devuelve el resultado", async () => {
    vi.stubEnv("MERCADOPAGO_ACCESS_TOKEN", "token");
    const fetchMock = vi.fn().mockResolvedValueOnce(limited()).mockResolvedValueOnce(ok({ id: "abc", status: "authorized" }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await getPreapproval("abc")).toMatchObject({ id: "abc", status: "authorized" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("si el límite persiste, falla con un mensaje claro tras los reintentos (y el webhook responde 500 para que Mercado Pago reintente)", async () => {
    vi.stubEnv("MERCADOPAGO_ACCESS_TOKEN", "token");
    const fetchMock = vi.fn(async () => limited());
    vi.stubGlobal("fetch", fetchMock);
    await expect(getPreapproval("abc")).rejects.toThrow(/429/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("un POST nunca se reintenta (podría duplicar la suscripción)", async () => {
    vi.stubEnv("MERCADOPAGO_ACCESS_TOKEN", "token");
    vi.stubEnv("MERCADOPAGO_MODE", "live");
    const fetchMock = vi.fn(async (url: unknown) =>
      String(url).endsWith("/users/me") ? new Response(JSON.stringify({ tags: [] }), { status: 200 }) : limited(),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      createPreapproval({ organizationId: "o", payerEmail: "a@b.co", reason: "r", amount: 1, currency: "ARS", backUrl: "https://x.test" }),
    ).rejects.toThrow(/429/);
    // una consulta de la cuenta (tipo de credenciales) y un único intento de crear la suscripción
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/preapproval"))).toHaveLength(1);
  });
});
