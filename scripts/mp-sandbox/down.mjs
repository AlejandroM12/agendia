// Apaga el entorno local de pruebas de Mercado Pago y borra su base descartable.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";

const state = ".mp-sandbox/state.json";
if (!existsSync(state)) {
  console.log("No hay entorno levantado.");
  process.exit(0);
}
const { pids, dbName } = JSON.parse(readFileSync(state, "utf8"));
for (const [name, pid] of Object.entries(pids)) {
  try {
    execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    console.log(`detenido ${name} (${pid})`);
  } catch {
    console.log(`${name} (${pid}) ya no estaba en marcha`);
  }
}
if (!process.argv.includes("--keep-db")) {
  try {
    execFileSync("docker", ["exec", "agendia-postgres", "sh", "-c", `psql -U "$POSTGRES_USER" -d postgres -c "DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)"`], { stdio: "ignore" });
    console.log(`base ${dbName} eliminada`);
  } catch {
    console.log("no se pudo eliminar la base (¿Docker apagado?)");
  }
}
rmSync(state, { force: true });
rmSync(".mp-sandbox/drop-webhooks", { force: true });
