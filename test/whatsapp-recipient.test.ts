import { afterEach, describe, expect, it, vi } from "vitest";
import { sendTemplate, sendText, toCloudRecipient } from "@/modules/whatsapp/meta";

/**
 * Destinatario que se le entrega a Meta. Confirmado con envíos reales contra el número de prueba: `543705204454` sale
 * bien y `5493705204454` da el error 131030. La normalización interna (lib/phone.ts) no cambia: es solo el último paso.
 */

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("toCloudRecipient", () => {
  it("el caso confirmado: 5493705204454 → 543705204454 solo con el formato de prueba", () => {
    expect(toCloudRecipient("5493705204454", "ar-without-9")).toBe("543705204454");
    expect(toCloudRecipient("5493705204454", "e164")).toBe("5493705204454");
  });

  it("otros móviles argentinos (AMBA, interior) pierden solo el 9", () => {
    expect(toCloudRecipient("5491155550000", "ar-without-9")).toBe("541155550000");
    expect(toCloudRecipient("5492614001234", "ar-without-9")).toBe("542614001234");
  });

  it("no toca números internacionales ni argentinos sin 9 o de otro largo", () => {
    for (const number of ["59899123456", "5511987654321", "34612345678", "14155550100", "543705204454", "54911555500", "54911555500001"]) {
      expect(toCloudRecipient(number, "ar-without-9"), number).toBe(number);
    }
  });
});

describe("el cuerpo enviado a Meta", () => {
  function capture() {
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ messages: [{ id: "wamid.X" }] }), { status: 200 });
    });
    return bodies;
  }

  it("por defecto (producción) el destinatario se envía tal cual", async () => {
    const bodies = capture();
    await sendTemplate("t", "123", "5493705204454", "hello_world", "en_US", []);
    await sendText("t", "123", "5493705204454", "hola");
    expect(bodies.map((body) => body.to)).toEqual(["5493705204454", "5493705204454"]);
  });

  it("con el formato de prueba explícito se envía sin el 9, con el resto del cuerpo igual", async () => {
    const bodies = capture();
    await sendTemplate("t", "123", "5493705204454", "hello_world", "en_US", [], "ar-without-9");
    expect(bodies[0]).toMatchObject({ messaging_product: "whatsapp", to: "543705204454", type: "template", template: { name: "hello_world" } });
  });

  it("WHATSAPP_AR_RECIPIENT_FORMAT=ar-without-9 lo aplica a todos los envíos; un valor desconocido no cambia nada", async () => {
    const bodies = capture();
    vi.stubEnv("WHATSAPP_AR_RECIPIENT_FORMAT", "ar-without-9");
    await sendText("t", "123", "5491155550000", "hola");
    vi.stubEnv("WHATSAPP_AR_RECIPIENT_FORMAT", "cualquiera");
    await sendText("t", "123", "5491155550000", "hola");
    expect(bodies.map((body) => body.to)).toEqual(["541155550000", "5491155550000"]);
  });
});
