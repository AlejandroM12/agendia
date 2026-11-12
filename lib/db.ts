import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

// Prisma 7 requiere un driver adapter explícito en el runtime (la URL ya no
// se lee del datasource del schema). Ver prisma.config.ts para el uso
// equivalente en Migrate/Studio.
const adapter = new PrismaPg(process.env.DATABASE_URL ?? "");

// Evita crear múltiples instancias de PrismaClient durante hot-reload en
// desarrollo (cada recarga de módulo re-ejecutaría este archivo).
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
