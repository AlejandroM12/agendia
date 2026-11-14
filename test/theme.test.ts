import { describe, it, expect } from "vitest";
import { industries } from "@/lib/brand";
import {
  contrastRatio,
  darkenToContrast,
  DEFAULT_THEME,
  isHexColor,
  normalizeHexColor,
  presetForIndustry,
  readableOn,
  resolveTheme,
  THEME_FONTS,
  THEME_PRESETS,
  themeCssVariables,
} from "@/lib/theme";

/** Una muestra amplia de colores: los 216 "web safe" más grises y tonos difíciles. */
const SAMPLE: string[] = (() => {
  const steps = ["00", "33", "66", "99", "cc", "ff"];
  const colors: string[] = [];
  for (const r of steps) for (const g of steps) for (const b of steps) colors.push(`#${r}${g}${b}`);
  return [...colors, "#777777", "#808080", "#767676", "#f2d21b", "#ffe600", "#00ff7f", "#ff69b4", "#fafafa"];
})();

describe("colores: validación y contraste", () => {
  it("normaliza colores escritos de distintas formas y rechaza lo que no es un color", () => {
    expect(normalizeHexColor("#ABC")).toBe("#aabbcc");
    expect(normalizeHexColor(" 1F4D3F ")).toBe("#1f4d3f");
    for (const invalid of ["", "rojo", "#12", "#12345g", "rgb(0,0,0)", "#fff; background:url(x)", "expression(1)", null, 42]) {
      expect(normalizeHexColor(invalid)).toBeNull();
    }
    expect(isHexColor("#1f4d3f")).toBe(true);
    expect(isHexColor("#1f4d3f;")).toBe(false);
  });

  it("calcula el contraste WCAG", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    expect(contrastRatio("#767676", "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });

  it("para cualquier color de fondo elige un texto que cumple AA (4,5:1)", () => {
    for (const color of SAMPLE) {
      expect(contrastRatio(readableOn(color), color), color).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("oscurece un color solo lo necesario para usarlo como texto", () => {
    expect(darkenToContrast("#1f4d3f", ["#ffffff"], 4.5)).toBe("#1f4d3f");
    const yellow = darkenToContrast("#f2d21b", ["#ffffff"], 4.5);
    expect(yellow).not.toBe("#f2d21b");
    expect(contrastRatio(yellow, "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });
});

describe("tema de la página pública", () => {
  it("cualquier color elegido produce una página legible", () => {
    for (const color of SAMPLE) {
      const theme = resolveTheme({ primary: color, secondary: color, font: "clasica" });
      // Botones: texto sobre el color principal.
      expect(contrastRatio(theme.primaryForeground, theme.primary), `botón ${color}`).toBeGreaterThanOrEqual(4.5);
      // Enlaces y textos de marca: sobre blanco y sobre el fondo suave.
      expect(contrastRatio(theme.primaryText, "#ffffff"), `texto ${color}`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(theme.primaryText, theme.soft), `texto suave ${color}`).toBeGreaterThanOrEqual(4.5);
      // Bordes y foco.
      expect(contrastRatio(theme.primaryBorder, "#ffffff"), `borde ${color}`).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(theme.secondaryForeground, theme.secondary), `secundario ${color}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("avisa cuando tuvo que ajustar un color claro, y deja intactos los que ya se leen bien", () => {
    expect(resolveTheme({ primary: "#f2d21b" })).toMatchObject({ primary: "#f2d21b", adjusted: true });
    expect(resolveTheme({ primary: "#1f4d3f" })).toMatchObject({ primaryText: "#1f4d3f", adjusted: false });
  });

  it("valores inválidos caen al tema por defecto en vez de romper la página", () => {
    const theme = resolveTheme({ primary: "javascript:alert(1)", secondary: "", font: "comic-sans" });
    expect(theme.primary).toBe(DEFAULT_THEME.primary);
    expect(theme.secondary).toBe(DEFAULT_THEME.secondary);
    expect(theme.font).toBe(DEFAULT_THEME.font);
  });

  it("las variables CSS que genera son siempre colores hexadecimales", () => {
    for (const primary of ["#f2d21b", "url(x)", "#000", "red;}</style><script>"]) {
      for (const value of Object.values(themeCssVariables(resolveTheme({ primary, secondary: primary })))) {
        expect(value).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it("los estilos sugeridos son válidos y hay uno para cada rubro", () => {
    const fonts = THEME_FONTS.map((font) => font.id);
    for (const preset of THEME_PRESETS) {
      expect(isHexColor(preset.primary) && isHexColor(preset.secondary), preset.id).toBe(true);
      expect(fonts).toContain(preset.font);
    }
    for (const industry of industries) {
      expect(presetForIndustry(industry.id).industries, industry.id).toContain(industry.id);
    }
    expect(presetForIndustry(null).id).toBe("pino");
    // No todos los rubros reciben la misma estética.
    expect(new Set(industries.map((industry) => presetForIndustry(industry.id).id)).size).toBeGreaterThanOrEqual(6);
  });
});
