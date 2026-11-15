import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
// Segundo servidor (misma build) con los planes con equipo publicados: solo para e2e/team-commercial.spec.ts.
const PUBLISHED_PORT = Number(process.env.E2E_PUBLISHED_PORT ?? 3110);

/**
 * Pruebas de punta a punta contra la app real: build de producción +
 * base de datos local (la de .env.local). Cubren el recorrido comercial completo: registro,
 * onboarding, agenda, reserva pública y gestión del turno por el cliente.
 */
export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  outputDir: "test-results",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: "es-AR",
    timezoneId: "America/Argentina/Buenos_Aires",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "mobile", testIgnore: /team-commercial/, use: { ...devices["Pixel 7"] } },
    { name: "desktop", testIgnore: /team-commercial/, use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 850 } } },
    {
      name: "published-mobile",
      testMatch: /team-commercial/,
      use: { ...devices["Pixel 7"], baseURL: `http://localhost:${PUBLISHED_PORT}` },
    },
    {
      name: "published-desktop",
      testMatch: /team-commercial/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 850 }, baseURL: `http://localhost:${PUBLISHED_PORT}` },
    },
  ],
  webServer: [
    {
    command: `npm run build && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: true,
    timeout: 300_000,
    env: {
      // Las pruebas corren sin canal de email: se habilita el registro igual
      // (en producción real queda cerrado hasta configurar Resend).
      ALLOW_REGISTRATION_WITHOUT_EMAIL: "1",
      // Sin canal de correo, deja ver el enlace de una invitación (solo en estas pruebas).
      ALLOW_INVITATIONS_WITHOUT_EMAIL: "1",
      AUTH_URL: `http://localhost:${PORT}`,
      APP_URL: `http://localhost:${PORT}`,
    },
    },
    {
      command: "node e2e/start-published.mjs",
      url: `http://localhost:${PUBLISHED_PORT}/api/health`,
      reuseExistingServer: true,
      timeout: 300_000,
    },
  ],
});
