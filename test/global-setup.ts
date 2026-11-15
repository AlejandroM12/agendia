import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import pg from "pg";

/**
 * Base de datos propia para cada ejecución de las pruebas.
 *
 * Antes, todas las ejecuciones (y las pruebas E2E, y las pruebas de carga) compartían la base de
 * desarrollo: dos procesos a la vez podían pisarse (conteos globales, límite de conexiones, limpiezas) y
 * una falla intermitente era imposible de atribuir. Ahora cada `vitest run` crea su base a partir de una
 * plantilla ya migrada, corre contra ella y la borra al terminar:
 *
 *  - `<base>_tpl`: plantilla con todas las migraciones al día. Se (re)migra bajo un lock de PostgreSQL, así
 *    que dos ejecuciones simultáneas no se estorban. Es la única base con nombre fijo.
 *  - `<base>_t_<id>`: la de esta ejecución (`CREATE DATABASE … TEMPLATE`), borrada al final.
 *
 * No toca la base de desarrollo. `TEST_DATABASE_KEEP=1` conserva la base de la ejecución para inspeccionarla;
 * `TEST_DATABASE_SHARED=1` vuelve a usar DATABASE_URL tal cual (por ejemplo, un servicio de CI ya migrado).
 */

const LOCK_KEY = 7_315_552_001;

function withDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

export default async function setup() {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL no está definida: las pruebas de integración necesitan una base PostgreSQL local.");
  if (process.env.TEST_DATABASE_SHARED === "1") return;

  const host = new URL(base).hostname;
  if (!["localhost", "127.0.0.1"].includes(host)) {
    throw new Error(`Las pruebas solo corren contra una base local (DATABASE_URL apunta a "${host}").`);
  }

  const baseName = decodeURIComponent(new URL(base).pathname.slice(1));
  const templateName = `${baseName}_tpl`;
  const runName = `${baseName}_t_${randomBytes(4).toString("hex")}`;

  const admin = new pg.Client({ connectionString: withDatabase(base, "postgres") });
  await admin.connect();
  try {
    await admin.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);

    const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [templateName]);
    if (exists.rowCount === 0) await admin.query(`CREATE DATABASE "${templateName}"`);
    // Migrar la plantilla es incremental: si ya está al día, no hace nada.
    execFileSync(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"], {
      env: { ...process.env, DATABASE_URL: withDatabase(base, templateName) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    // Nadie puede estar conectado a la plantilla mientras se copia.
    await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()", [templateName]);
    await admin.query(`CREATE DATABASE "${runName}" TEMPLATE "${templateName}"`);
  } finally {
    await admin.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => undefined);
    await admin.end();
  }

  process.env.DATABASE_URL = withDatabase(base, runName);
  process.env.TEST_DATABASE_NAME = runName;

  return async () => {
    if (process.env.TEST_DATABASE_KEEP === "1") {
      console.log(`[tests] base conservada: ${runName}`);
      return;
    }
    const cleanup = new pg.Client({ connectionString: withDatabase(base, "postgres") });
    await cleanup.connect();
    try {
      await cleanup.query(`DROP DATABASE IF EXISTS "${runName}" WITH (FORCE)`);
    } finally {
      await cleanup.end();
    }
  };
}
