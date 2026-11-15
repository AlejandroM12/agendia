import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatMoney, licenseRenewalText, offers, pricing, trialPolicy } from "@/lib/brand";
import { PLAN_CAPABILITIES } from "@/lib/plans";

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}
const runtimeSources = ["app", "components", "modules", "lib"].flatMap((dir) => sourceFiles(dir));

describe("oferta comercial vigente", () => {
  it("el Plan Profesional cuesta ARS 9.900 por mes y la licencia ARS 149.000 de pago único", () => {
    expect(pricing.currency).toBe("ARS");
    expect(pricing.monthly).toBe(9900);
    expect(pricing.oneTime).toBe(149000);
    expect(offers.monthly).toBe("Plan Profesional");
  });

  it("la prueba gratuita dura 14 días", () => {
    expect(trialPolicy.trialDays).toBe(14);
  });

  it("no queda ningún precio anterior escrito a mano", () => {
    for (const file of runtimeSources) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/\b14\.?000\b|\b199\.?000\b/);
    }
  });

  it("la renovación no tiene valor definido y se aclara que es por separado desde el segundo año", () => {
    const text = licenseRenewalText();
    expect(text).toContain("Desde el segundo año, el alojamiento, dominio y soporte se renuevan por separado");
    expect(text).not.toMatch(/\$\s?\d/);
  });
});

describe("oferta comercial con equipos", () => {
  it("los cuatro importes acordados están definidos en un solo lugar", () => {
    expect(pricing.monthly).toBe(9900);
    expect(pricing.teamMonthly).toBe(19900);
    expect(pricing.oneTime).toBe(149000);
    expect(pricing.licenseTeam).toBe(249000);
    expect(PLAN_CAPABILITIES.profesional.maxActiveProfessionals).toBe(2);
    expect(PLAN_CAPABILITIES.equipo.maxActiveProfessionals).toBe(5);
    expect(PLAN_CAPABILITIES.equipo.monthlyPrice).toBe(pricing.teamMonthly);
    expect(PLAN_CAPABILITIES.equipo.licensePrice).toBe(pricing.licenseTeam);
  });

  it("ningún módulo escribe los importes a mano: salen de lib/brand.ts", () => {
    for (const value of [pricing.teamMonthly, pricing.licenseTeam]) {
      const formatted = formatMoney(value).replace(/ /g, " ");
      for (const file of runtimeSources) {
        if (file === join("lib", "brand.ts")) continue;
        expect(readFileSync(file, "utf8"), file).not.toContain(formatted);
      }
    }
  });
});
