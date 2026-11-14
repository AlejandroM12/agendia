import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatMoney, futurePricing, licenseRenewalText, offers, pricing, trialPolicy } from "@/lib/brand";
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

describe("oferta multiprofesional futura", () => {
  it("está definida en un solo lugar, con los importes acordados", () => {
    expect(futurePricing).toEqual({ teamMonthly: 19900, licenseProfessional: 149000, licenseTeam: 249000 });
    expect(PLAN_CAPABILITIES.profesional.maxActiveProfessionals).toBe(2);
    expect(PLAN_CAPABILITIES.equipo.maxActiveProfessionals).toBe(5);
  });

  it("no se publica: ninguna página, componente ni módulo la usa todavía", () => {
    const users = runtimeSources.filter((file) => file !== join("lib", "brand.ts") && /futurePricing/.test(readFileSync(file, "utf8")));
    expect(users).toEqual([]);
    for (const value of [futurePricing.teamMonthly, futurePricing.licenseTeam]) {
      const formatted = formatMoney(value).replace(/ /g, " ");
      for (const file of runtimeSources) {
        expect(readFileSync(file, "utf8"), file).not.toContain(formatted);
      }
    }
  });
});

describe("integraciones que todavía no existen", () => {
  it("no hay dependencias ni código de Google Calendar ni de proveedores de WhatsApp", () => {
    const pkg = readFileSync("package.json", "utf8").toLowerCase();
    expect(pkg).not.toMatch(/googleapis|google-auth|twilio|whatsapp/);
    for (const file of runtimeSources) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/googleapis|calendar\.google|graph\.facebook\.com|api\.twilio/i);
    }
  });
});
