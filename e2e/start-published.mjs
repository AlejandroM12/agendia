// Segundo servidor de las pruebas E2E: la MISMA build, con los planes con equipo publicados
// (PUBLISH_TEAM_PLANS=1) en otro puerto. Espera a que la build termine (la hace el primer servidor).
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const port = process.env.E2E_PUBLISHED_PORT ?? "3110";
for (let i = 0; i < 600 && !existsSync(".next/BUILD_ID"); i++) await sleep(1000);
if (!existsSync(".next/BUILD_ID")) {
  console.error("No hay build: el servidor principal no llegó a construirla.");
  process.exit(1);
}
// Con el servidor principal ya en marcha la build está completa.
await sleep(2000);

const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", port], {
  stdio: "inherit",
  env: {
    ...process.env,
    PUBLISH_TEAM_PLANS: "1",
    ALLOW_REGISTRATION_WITHOUT_EMAIL: "1",
    ALLOW_INVITATIONS_WITHOUT_EMAIL: "1",
    AUTH_URL: `http://localhost:${port}`,
    APP_URL: `http://localhost:${port}`,
  },
});
child.on("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
