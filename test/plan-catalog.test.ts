import { describe, it, expect, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import { ensurePlan } from "@/modules/billing/catalog";

afterEach(() => vi.restoreAllMocks());

describe("ensurePlan", () => {
  it("pedidos simultáneos devuelven el mismo plan", async () => {
    const plans = await Promise.all(Array.from({ length: 8 }, () => ensurePlan("profesional")));
    expect(new Set(plans.map((plan) => plan.id)).size).toBe(1);
  });

  it("si otro pedido creó el plan primero, devuelve esa fila en vez de fallar (carrera en una base nueva)", async () => {
    const real = await ensurePlan("equipo");
    // El pedido «ve» el plan como inexistente, intenta crearlo y choca con la restricción única.
    vi.spyOn(db.plan, "findUnique").mockResolvedValueOnce(null);
    const create = vi.spyOn(db.plan, "create");
    const again = await ensurePlan("equipo");
    expect(create).toHaveBeenCalledTimes(1); // intentó crear y perdió la carrera
    expect(again.id).toBe(real.id);
  });
});
