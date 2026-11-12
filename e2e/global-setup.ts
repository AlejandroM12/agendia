import { config } from "dotenv";
import pg from "pg";

/**
 * Antes de correr las pruebas se vacían los contadores de rate limiting de
 * la base local: varias corridas seguidas registran cuentas desde la misma
 * IP y chocarían con los límites reales (que quedan activos durante el test).
 */
export default async function globalSetup() {
  config({ path: ".env.local" });
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('DELETE FROM "rate_limits"');
  } finally {
    await client.end();
  }
}
