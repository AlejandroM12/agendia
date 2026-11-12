import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runTick } from "@/modules/system/tick";

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  return expected.length === received.length && timingSafeEqual(expected, received);
}

/** Punto de entrada del trabajo periódico. Solo lo invoca el worker, con CRON_SECRET. */
export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    return NextResponse.json({ ok: true, ...(await runTick()) });
  } catch (error) {
    console.error("[tick] falló la ejecución", error);
    return NextResponse.json({ error: "tick_failed" }, { status: 500 });
  }
}
