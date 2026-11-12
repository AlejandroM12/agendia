import { NextResponse } from "next/server";
import { db } from "@/lib/db";

/** Health check para el orquestador y el monitoreo externo: app + base de datos. */
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok" });
  } catch {
    return NextResponse.json({ status: "error", database: "unreachable" }, { status: 503 });
  }
}
