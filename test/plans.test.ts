import { describe, it, expect } from "vitest";
import {
  describePlanReduction,
  evaluateProfessionalQuota,
  PLAN_CAPABILITIES,
  planTierFromCode,
  resolveProfessionalLimit,
  TRIAL_MAX_PROFESSIONALS,
} from "@/lib/plans";

const base = { standalone: false, status: "active" as const, planCode: "mensual", extraProfessionals: 0 };

describe("capacidades de los planes (definición única)", () => {
  it("Plan Profesional: hasta 2 profesionales activos; Plan Equipo: hasta 5", () => {
    expect(PLAN_CAPABILITIES.profesional.maxActiveProfessionals).toBe(2);
    expect(PLAN_CAPABILITIES.equipo.maxActiveProfessionals).toBe(5);
    expect(resolveProfessionalLimit(base)).toMatchObject({ limit: 2, source: "plan", tier: "profesional" });
    expect(resolveProfessionalLimit({ ...base, planCode: "equipo", paymentVerified: true })).toMatchObject({ limit: 5, tier: "equipo" });
  });

  it("el plan actual «mensual» es el Plan Profesional; un código desconocido nunca da más cupos", () => {
    expect(planTierFromCode("mensual")).toBe("profesional");
    expect(planTierFromCode(null)).toBe("profesional");
    expect(planTierFromCode("algo-raro")).toBe("profesional");
    expect(planTierFromCode("equipo")).toBe("equipo");
  });

  it("la prueba gratuita permite hasta 2 profesionales, también vencida o en pausa", () => {
    expect(TRIAL_MAX_PROFESSIONALS).toBe(2);
    for (const status of ["trial", "trial_readonly", "locked"] as const) {
      expect(resolveProfessionalLimit({ ...base, status, planCode: null })).toMatchObject({ limit: 2, source: "trial" });
    }
  });

  it("una cuenta activada a mano, sin suscripción, cuenta como Plan Profesional", () => {
    expect(resolveProfessionalLimit({ ...base, planCode: null })).toMatchObject({ limit: 2, source: "plan" });
  });

  it("el cupo del Plan Equipo solo rige con un pago verificado", () => {
    expect(resolveProfessionalLimit({ ...base, planCode: "equipo" }).limit).toBe(2);
    expect(resolveProfessionalLimit({ ...base, planCode: "equipo", paymentVerified: false })).toMatchObject({ limit: 2, tier: "profesional" });
    expect(resolveProfessionalLimit({ ...base, planCode: "equipo", paymentVerified: true })).toMatchObject({ limit: 5, tier: "equipo" });
  });

  it("estar en mora no quita el cupo pagado, pero cancelar o suspender vuelve al cupo de la prueba", () => {
    expect(resolveProfessionalLimit({ ...base, status: "past_due", planCode: "equipo", paymentVerified: true }).limit).toBe(5);
    for (const status of ["canceled", "suspended"] as const) {
      expect(resolveProfessionalLimit({ ...base, status, planCode: "equipo", paymentVerified: true })).toMatchObject({ limit: 2, source: "trial" });
    }
  });

  it("la licencia Equipo independiente admite 5 y la Profesional 2", () => {
    expect(resolveProfessionalLimit({ ...base, standalone: true, licenseTier: "equipo" }).limit).toBe(5);
    expect(resolveProfessionalLimit({ ...base, standalone: true, licenseTier: "profesional" }).limit).toBe(2);
  });

  it("la instalación independiente tiene su propio cupo", () => {
    expect(resolveProfessionalLimit({ ...base, standalone: true })).toMatchObject({
      limit: PLAN_CAPABILITIES.profesional.maxActiveProfessionals,
      source: "standalone",
    });
  });

  it("los profesionales adicionales suman a cualquier base y valores inválidos no restan", () => {
    expect(resolveProfessionalLimit({ ...base, extraProfessionals: 3 })).toMatchObject({ limit: 5, base: 2, extra: 3 });
    expect(resolveProfessionalLimit({ ...base, status: "trial", extraProfessionals: 1 }).limit).toBe(3);
    expect(resolveProfessionalLimit({ ...base, extraProfessionals: -4 }).limit).toBe(2);
    expect(resolveProfessionalLimit({ ...base, extraProfessionals: Number.NaN }).limit).toBe(2);
  });
});

describe("cupos usados y disponibles", () => {
  const limit = resolveProfessionalLimit(base);

  it("calcula usados, disponibles y si se puede sumar uno más", () => {
    expect(evaluateProfessionalQuota(limit, 0)).toMatchObject({ active: 0, available: 2, canAdd: true, overLimit: false });
    expect(evaluateProfessionalQuota(limit, 1)).toMatchObject({ available: 1, canAdd: true });
    expect(evaluateProfessionalQuota(limit, 2)).toMatchObject({ available: 0, canAdd: false, overLimit: false });
  });

  it("detecta el exceso (por ejemplo, tras una reducción de plan)", () => {
    expect(evaluateProfessionalQuota(limit, 4)).toMatchObject({ available: 0, canAdd: false, overLimit: true });
  });
});

describe("política de reducción de plan (diseño)", () => {
  it("no borra ni desactiva nada: bloquea altas y reactivaciones y deja la elección al administrador", () => {
    const reduction = describePlanReduction(5, 2);
    expect(reduction).toEqual({ excess: 3, deletesAnything: false, blocksNewAndReactivation: true, adminMustDeactivate: 3 });
    expect(describePlanReduction(1, 2)).toMatchObject({ excess: 0, blocksNewAndReactivation: false });
    expect(describePlanReduction(2, 2)).toMatchObject({ excess: 0, blocksNewAndReactivation: true });
  });
});
