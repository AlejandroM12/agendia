// Worker de Agendia: dispara el trabajo periódico de la aplicación.
//
// Es un proceso mínimo y sin dependencias: cada INTERVAL segundos llama a
// POST /api/internal/tick. Toda la lógica (enviar recordatorios, vencer
// pruebas, reconciliar pagos) y todo el estado viven en la app y en la base
// de datos, así que si este proceso se reinicia no se pierde nada: en la
// siguiente vuelta se procesa lo que haya quedado pendiente.

const APP_URL = (process.env.WORKER_TARGET_URL ?? "http://localhost:3000").replace(/\/$/, "");
const SECRET = process.env.CRON_SECRET;
const INTERVAL_MS = Math.max(15, Number(process.env.WORKER_INTERVAL_SECONDS ?? 60)) * 1000;

if (!SECRET) {
  console.error("[worker] falta CRON_SECRET: no se puede autenticar contra la app.");
  process.exit(1);
}

let stopping = false;
let timer;

async function tick() {
  const startedAt = Date.now();
  try {
    const response = await fetch(`${APP_URL}/api/internal/tick`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SECRET}` },
      signal: AbortSignal.timeout(120_000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error(`[worker] tick respondió ${response.status}`, body);
    } else {
      const n = body.notifications ?? {};
      // Solo se registra cuando hubo trabajo, para no llenar los logs.
      if (n.claimed || body.expiredTrials || body.lockedAccounts || body.subscriptions?.checked) {
        console.log(
          `[worker] tick ok en ${Date.now() - startedAt} ms — avisos: ${n.sent ?? 0} enviados, ${n.retried ?? 0} a reintentar, ${n.failed ?? 0} fallidos, ${n.skipped ?? 0} sin canal; pruebas vencidas: ${body.expiredTrials ?? 0}`,
        );
      }
    }
  } catch (error) {
    console.error("[worker] no se pudo contactar a la app:", error instanceof Error ? error.message : error);
  }
  if (!stopping) timer = setTimeout(tick, INTERVAL_MS);
}

function shutdown() {
  stopping = true;
  clearTimeout(timer);
  console.log("[worker] detenido.");
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

console.log(`[worker] iniciado: ${APP_URL} cada ${INTERVAL_MS / 1000} s`);
tick();
