// Entorno LOCAL de pruebas de Mercado Pago (nunca toca producción).
//
//   node scripts/mp-sandbox/up.mjs            # base descartable + migraciones + servidor + worker + túnel HTTPS
//   node scripts/mp-sandbox/up.mjs --no-build # reutiliza .next (si ya compilaste con el código actual)
//   node scripts/mp-sandbox/up.mjs --dry      # sin credenciales reales (solo comprueba que todo arranca)
//   node scripts/mp-sandbox/down.mjs          # lo apaga todo
//
// Credenciales: archivo `.env.mp-test` en la raíz (ignorado por git; ver .env.mp-test.example). Este script las lee
// y se las pasa al servidor por entorno: nunca las imprime ni las escribe en los logs.
//
// Cadena: Internet → túnel (cloudflared, sin cuenta) → proxy local :3121 (puede descartar webhooks para simular
// avisos perdidos) → Next.js :3120. El worker llama al tick de la app como en producción.
import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { parse } from "dotenv";

const DIR = ".mp-sandbox";
const APP_PORT = 3120;
const PROXY_PORT = 3121;
const DB_NAME = "agendia_mp_sandbox";
const args = new Set(process.argv.slice(2));

mkdirSync(DIR, { recursive: true });

function loadSandboxEnv() {
  if (args.has("--dry")) {
    return { MERCADOPAGO_ACCESS_TOKEN: "dry-run", MERCADOPAGO_WEBHOOK_SECRET: "dry-run", MP_TEST_ACCOUNT_EMAILS: "mp-pro@agendia.test" };
  }
  if (!existsSync(".env.mp-test")) {
    console.error("Falta .env.mp-test (ver .env.mp-test.example). Para solo probar el arranque: --dry");
    process.exit(1);
  }
  const values = parse(readFileSync(".env.mp-test"));
  for (const key of ["MERCADOPAGO_ACCESS_TOKEN", "MERCADOPAGO_WEBHOOK_SECRET"]) {
    if (!values[key]) {
      console.error(`.env.mp-test no tiene ${key}.`);
      process.exit(1);
    }
  }
  return values;
}

const APP_ONLY = args.has("--app-only"); // reinicia solo la aplicación y el worker (mismo túnel, misma base)
const sandbox = loadSandboxEnv();
const local = parse(readFileSync(".env.local"));

// Cuentas de Agendia (no de Mercado Pago) autorizadas a pagar en modo prueba.
const TEST_ACCOUNTS = ["mp-pro", "mp-team", "mp-change", "mp-cancel", "mp-reject", "mp-lost"].map((n) => `${n}@agendia.test`);

// 1) Base descartable
const previous = APP_ONLY ? JSON.parse(readFileSync(`${DIR}/state.json`, "utf8")) : null;
const psql = (sql) =>
  execFileSync("docker", ["exec", "agendia-postgres", "sh", "-c", `psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 -c "${sql}"`], { stdio: "pipe" });
if (!APP_ONLY) {
  psql(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
  psql(`CREATE DATABASE ${DB_NAME}`);
}
const dbUrl = new URL(local.DATABASE_URL);
dbUrl.pathname = `/${DB_NAME}`;
console.log(`Base descartable creada: ${DB_NAME}`);

// 2) Migraciones y build (con el código actual)
const baseEnv = { ...process.env, DATABASE_URL: dbUrl.toString() };
execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env: baseEnv, stdio: APP_ONLY ? "ignore" : "inherit" });
if (!args.has("--no-build")) {
  console.log("Compilando…");
  execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"], { env: baseEnv, stdio: "ignore", shell: process.platform === "win32" });
}

// 3) Túnel HTTPS gratuito (cloudflared «quick tunnel»: sin cuenta, URL nueva en cada ejecución)
if (APP_ONLY) {
  for (const name of ["app", "worker"]) {
    try { execFileSync("taskkill", ["/PID", String(previous.pids[name]), "/T", "/F"], { stdio: "ignore" }); } catch {}
  }
}
const tunnelLog = `${DIR}/tunnel.log`;
const tunnelFd = APP_ONLY ? null : openSync(tunnelLog, "w");
const tunnel = APP_ONLY ? { pid: previous.pids.tunnel } : spawn("cloudflared", ["tunnel", "--url", `http://localhost:${PROXY_PORT}`, "--no-autoupdate"], {
  detached: true,
  stdio: ["ignore", tunnelFd, tunnelFd],
});
tunnel.unref?.();
let tunnelUrl = APP_ONLY ? previous.tunnelUrl : null;
for (let i = 0; i < 60 && !tunnelUrl; i++) {
  await sleep(1000);
  tunnelUrl = readFileSync(tunnelLog, "utf8").match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)?.[0] ?? null;
}
if (!tunnelUrl) {
  console.error(`No se obtuvo la URL del túnel. Mirá ${tunnelLog}`);
  process.exit(1);
}

// 4) Proxy local (registra los webhooks recibidos y descarta los que lleguen mientras exista .mp-sandbox/drop-webhooks)
const proxyScript = "scripts/mp-sandbox/proxy.mjs";
const proxyFd = APP_ONLY ? null : openSync(`${DIR}/proxy.log`, "w");
const proxy = APP_ONLY ? { pid: previous.pids.proxy } : spawn(process.execPath, [proxyScript], { detached: true, stdio: ["ignore", proxyFd, proxyFd] });
proxy.unref?.();

// 5) Servidor y worker
const appEnv = {
  ...baseEnv,
  NODE_ENV: "production",
  PORT: String(APP_PORT),
  APP_URL: tunnelUrl,
  AUTH_URL: tunnelUrl,
  AUTH_SECRET: previous?.authSecret ?? randomBytes(24).toString("base64"),
  CRON_SECRET: previous?.cronSecret ?? randomBytes(24).toString("base64"),
  DEPLOYMENT_MODE: "saas",
  PUBLISH_TEAM_PLANS: "1",
  ALLOW_REGISTRATION_WITHOUT_EMAIL: "1",
  MERCADOPAGO_ACCESS_TOKEN: sandbox.MERCADOPAGO_ACCESS_TOKEN,
  MERCADOPAGO_WEBHOOK_SECRET: sandbox.MERCADOPAGO_WEBHOOK_SECRET,
  MERCADOPAGO_MODE: "test",
  MERCADOPAGO_TEST_EMAILS: TEST_ACCOUNTS.join(","),
};
const appFd = openSync(`${DIR}/app.log`, "w");
const app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(APP_PORT)], {
  env: appEnv,
  detached: true,
  stdio: ["ignore", appFd, appFd],
});
app.unref();
for (let i = 0; i < 90; i++) {
  await sleep(1000);
  try {
    if ((await fetch(`http://127.0.0.1:${APP_PORT}/api/health`)).ok) break;
  } catch {}
  if (i === 89) {
    console.error(`La aplicación no respondió. Mirá ${DIR}/app.log`);
    process.exit(1);
  }
}
const workerFd = openSync(`${DIR}/worker.log`, "w");
const worker = spawn(process.execPath, ["scripts/worker.mjs"], {
  env: { ...process.env, CRON_SECRET: appEnv.CRON_SECRET, WORKER_TARGET_URL: `http://127.0.0.1:${APP_PORT}`, WORKER_INTERVAL_SECONDS: "15" },
  detached: true,
  stdio: ["ignore", workerFd, workerFd],
});
worker.unref();

writeFileSync(
  `${DIR}/state.json`,
  JSON.stringify({ tunnelUrl, appPort: APP_PORT, proxyPort: PROXY_PORT, dbName: DB_NAME, databaseUrl: dbUrl.toString(), testAccounts: TEST_ACCOUNTS, cronSecret: appEnv.CRON_SECRET, authSecret: appEnv.AUTH_SECRET, pids: { tunnel: tunnel.pid, proxy: proxy.pid, app: app.pid, worker: worker.pid }, startedAt: new Date().toISOString() }, null, 1),
);

console.log("\nListo.");
console.log(`URL pública del túnel : ${tunnelUrl}`);
console.log(`Webhook de prueba     : ${tunnelUrl}/api/webhooks/mercadopago`);
console.log(`Cuentas de Agendia autorizadas a pagar en modo prueba: ${TEST_ACCOUNTS.join(", ")}`);
