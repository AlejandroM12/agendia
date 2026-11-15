import { describe, expect, it } from "vitest";
import { invitationLinksVisible, isLocalRuntime } from "@/lib/test-flags";

const env = (values: Record<string, string>) => values as unknown as NodeJS.ProcessEnv;

describe("interruptores de prueba: no se activan por error en una instalación real", () => {
  it("fuera de producción el enlace se muestra (desarrollo y pruebas)", () => {
    expect(invitationLinksVisible(env({ NODE_ENV: "development" }))).toBe(true);
    expect(invitationLinksVisible(env({ NODE_ENV: "test" }))).toBe(true);
  });

  it("en producción, sin la variable, nunca", () => {
    expect(invitationLinksVisible(env({ NODE_ENV: "production", AUTH_URL: "http://localhost:3100" }))).toBe(false);
    expect(invitationLinksVisible(env({ NODE_ENV: "production", AUTH_URL: "https://agendia.atajolab.dev" }))).toBe(false);
  });

  it("la variable por sí sola no alcanza: en un dominio real se ignora (SaaS o licencia)", () => {
    for (const url of ["https://agendia.atajolab.dev", "https://turnos.cliente.com.ar", "http://192.168.1.10:3000", "no-es-una-url"]) {
      expect(invitationLinksVisible(env({ NODE_ENV: "production", ALLOW_INVITATIONS_WITHOUT_EMAIL: "1", AUTH_URL: url }))).toBe(false);
    }
    expect(invitationLinksVisible(env({ NODE_ENV: "production", ALLOW_INVITATIONS_WITHOUT_EMAIL: "1" }))).toBe(false);
  });

  it("una instalación independiente nunca muestra el enlace, ni siquiera en localhost", () => {
    expect(
      invitationLinksVisible(env({ NODE_ENV: "production", DEPLOYMENT_MODE: "standalone", ALLOW_INVITATIONS_WITHOUT_EMAIL: "1", AUTH_URL: "http://localhost:3100" })),
    ).toBe(false);
  });

  it("solo con la variable y el servidor local (las pruebas E2E) se muestra", () => {
    expect(invitationLinksVisible(env({ NODE_ENV: "production", ALLOW_INVITATIONS_WITHOUT_EMAIL: "1", AUTH_URL: "http://localhost:3100" }))).toBe(true);
    expect(isLocalRuntime(env({ APP_URL: "http://127.0.0.1:3100" }))).toBe(true);
  });
});
