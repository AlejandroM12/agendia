/**
 * Identidad visual de la página pública de cada negocio.
 *
 * El negocio elige dos colores y una tipografía entre opciones predefinidas.
 * A partir de eso se calculan acá las variables de color que usa la página,
 * garantizando contraste legible sea cual sea el color elegido: nunca se
 * aplica CSS escrito por el usuario.
 *
 * Sin dependencias del servidor: lo usan la página pública, la vista previa
 * del panel y los emails.
 */

export const DEFAULT_THEME = { primary: "#1f4d3f", secondary: "#c8643c", font: "clasica" } as const;

const INK = "#1d1b18";
const WHITE = "#ffffff";

export type Rgb = { r: number; g: number; b: number };

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

/** Acepta "#abc", "abc", "#aabbcc" o "AABBCC" y devuelve "#aabbcc"; `null` si no es un color. */
export function normalizeHexColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{3}$/.test(raw)) return `#${raw.replace(/./g, (c) => c + c)}`;
  return /^[0-9a-f]{6}$/.test(raw) ? `#${raw}` : null;
}

export function hexToRgb(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const channel = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/** Mezcla `hex` con `other`; `weight` es la proporción de `other` (0 a 1). */
export function mix(hex: string, other: string, weight: number): string {
  const a = hexToRgb(hex);
  const b = hexToRgb(other);
  return rgbToHex({
    r: a.r + (b.r - a.r) * weight,
    g: a.g + (b.g - a.g) * weight,
    b: a.b + (b.b - a.b) * weight,
  });
}

/** Luminancia relativa según WCAG 2.x. */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const linear = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** Relación de contraste WCAG entre dos colores (de 1 a 21). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Texto (blanco o tinta) que mejor se lee sobre un fondo. Siempre supera
 * 4,5:1: en los tonos medios, donde la tinta no alcanza, usa negro puro.
 */
export function readableOn(background: string): string {
  const best = contrastRatio(WHITE, background) >= contrastRatio(INK, background) ? WHITE : INK;
  return contrastRatio(best, background) >= 4.5 ? best : "#000000";
}

/**
 * Devuelve `color`, oscurecido lo mínimo necesario para alcanzar `ratio` de
 * contraste contra todos los `backgrounds` (fondos claros).
 */
export function darkenToContrast(color: string, backgrounds: string[], ratio: number): string {
  const passes = (candidate: string) => backgrounds.every((bg) => contrastRatio(candidate, bg) >= ratio);
  if (passes(color)) return color;
  for (let step = 1; step <= 20; step++) {
    const candidate = mix(color, "#000000", step * 0.05);
    if (passes(candidate)) return candidate;
  }
  return INK;
}

export type ThemeFontId = "clasica" | "moderna" | "elegante" | "amigable" | "fuerte";

/** Tipografías disponibles. Las fuentes en sí se cargan en lib/public-fonts.ts. */
export const THEME_FONTS: ReadonlyArray<{ id: ThemeFontId; label: string; hint: string }> = [
  { id: "clasica", label: "Clásica", hint: "Títulos con serif cálida" },
  { id: "moderna", label: "Moderna", hint: "Limpia y neutra" },
  { id: "elegante", label: "Elegante", hint: "Serif fina, de alto contraste" },
  { id: "amigable", label: "Amigable", hint: "Redondeada y cercana" },
  { id: "fuerte", label: "Fuerte", hint: "Títulos anchos y con peso" },
];

export function isThemeFont(value: unknown): value is ThemeFontId {
  return THEME_FONTS.some((font) => font.id === value);
}

export type ThemePreset = {
  id: string;
  label: string;
  primary: string;
  secondary: string;
  font: ThemeFontId;
  /** Rubros (lib/brand.ts → industries) para los que se sugiere. */
  industries: string[];
};

/** Puntos de partida por estilo de negocio. Después se puede cambiar todo. */
export const THEME_PRESETS: ReadonlyArray<ThemePreset> = [
  { id: "pino", label: "Pino", primary: "#1f4d3f", secondary: "#c8643c", font: "clasica", industries: ["otro"] },
  { id: "barberia", label: "Barbería", primary: "#1c1917", secondary: "#b8893b", font: "fuerte", industries: ["belleza"] },
  { id: "estetica", label: "Estética", primary: "#a8456a", secondary: "#e3b9a4", font: "elegante", industries: ["unas", "belleza"] },
  { id: "consultorio", label: "Consultorio", primary: "#1f5fa8", secondary: "#2a9d8f", font: "moderna", industries: ["salud"] },
  { id: "calma", label: "Calma", primary: "#5d6f52", secondary: "#c9a66b", font: "clasica", industries: ["psicologia", "bienestar"] },
  { id: "energia", label: "Energía", primary: "#d9480f", secondary: "#1c1917", font: "fuerte", industries: ["fitness"] },
  { id: "aula", label: "Aula", primary: "#5b3fa8", secondary: "#f2b134", font: "amigable", industries: ["educacion"] },
  { id: "taller", label: "Taller", primary: "#0f4c5c", secondary: "#e36414", font: "moderna", industries: ["tecnico"] },
];

/** Estilo sugerido para un rubro (el primero que lo incluye). */
export function presetForIndustry(industry: string | null | undefined): ThemePreset {
  return THEME_PRESETS.find((preset) => industry && preset.industries[0] === industry)
    ?? THEME_PRESETS.find((preset) => industry && preset.industries.includes(industry))
    ?? THEME_PRESETS[0];
}

export type ThemeInput = { primary: string; secondary: string; font: string };

export type ResolvedTheme = {
  primary: string;
  primaryForeground: string;
  /** El color principal, oscurecido si hace falta, para textos y enlaces sobre fondo claro. */
  primaryText: string;
  /** Ídem para bordes y foco (contraste 3:1). */
  primaryBorder: string;
  soft: string;
  secondary: string;
  secondaryForeground: string;
  font: ThemeFontId;
  /** `true` si el color principal tuvo que ajustarse para usarse como texto. */
  adjusted: boolean;
};

/**
 * Convierte la elección del negocio en colores seguros de usar. Valores
 * inválidos (no deberían llegar: se validan al guardar) caen al tema por
 * defecto en lugar de romper la página.
 */
export function resolveTheme(input: Partial<ThemeInput>): ResolvedTheme {
  const primary = normalizeHexColor(input.primary) ?? DEFAULT_THEME.primary;
  const secondary = normalizeHexColor(input.secondary) ?? DEFAULT_THEME.secondary;
  const soft = mix(primary, WHITE, 0.9);
  const primaryText = darkenToContrast(primary, [WHITE, soft], 4.5);
  return {
    primary,
    primaryForeground: readableOn(primary),
    primaryText,
    primaryBorder: darkenToContrast(primary, [WHITE], 3),
    soft,
    secondary,
    secondaryForeground: readableOn(secondary),
    font: isThemeFont(input.font) ? input.font : DEFAULT_THEME.font,
    adjusted: primaryText !== primary,
  };
}

/**
 * Variables CSS que sobrescriben los tokens de app/globals.css dentro de la
 * página pública. Todos los valores salen de `resolveTheme`: son colores
 * hexadecimales calculados, nunca texto libre.
 */
export function themeCssVariables(theme: ResolvedTheme): Record<string, string> {
  return {
    "--primary": theme.primary,
    "--primary-foreground": theme.primaryForeground,
    "--accent": theme.soft,
    "--accent-foreground": theme.primaryText,
    "--ring": theme.primaryBorder,
    "--highlight": theme.secondary,
    "--highlight-foreground": theme.secondaryForeground,
    "--brand-text": theme.primaryText,
    "--brand-border": theme.primaryBorder,
  };
}
