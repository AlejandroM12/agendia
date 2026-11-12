import { config as loadEnv } from "dotenv";
import { defineConfig } from "vitest/config";
import path from "node:path";

// Los tests de integración usan la base de datos de .env.local.
loadEnv({ path: ".env.local", quiet: true });

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Las pruebas de integración (organización/registro/reset de
    // contraseña) pegan contra la base de datos real de desarrollo, así
    // que corren de a una para no pisarse entre sí sin necesitar una
    // infraestructura de base de datos de test separada todavía.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": import.meta.dirname,
      // Ver test/server-only-stub.ts: fuera del build de Next.js, el
      // paquete real `server-only` lanza incondicionalmente.
      "server-only": path.resolve(import.meta.dirname, "test/server-only-stub.ts"),
    },
  },
});
