import { config as loadEnv } from "dotenv";
import { defineConfig, env } from "prisma/config";

// La CLI de Prisma no carga .env.local automáticamente (solo Next.js lo
// hace). Lo cargamos explícitamente para que `prisma migrate`/`studio`
// encuentren DATABASE_URL en desarrollo.
loadEnv({ path: ".env.local" });

// Prisma 7: la URL de conexión para Migrate/Studio se define acá, separada
// del `datasource` del schema (ver prisma/schema.prisma). El runtime de la
// aplicación usa, en cambio, el driver adapter configurado en lib/db.ts.
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: env("DATABASE_URL"),
  },
});
