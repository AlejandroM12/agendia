import { Archivo, Nunito, Playfair_Display } from "next/font/google";
import type { ThemeFontId } from "@/lib/theme";

/**
 * Tipografías opcionales de la página pública de cada negocio. Fraunces y
 * Geist (las de Agendia) ya se cargan en app/layout.tsx; estas tres se
 * declaran sin precarga: el navegador solo descarga la que la página usa.
 */
const playfair = Playfair_Display({ variable: "--font-playfair", subsets: ["latin"], preload: false, display: "swap" });
const nunito = Nunito({ variable: "--font-nunito", subsets: ["latin"], preload: false, display: "swap" });
const archivo = Archivo({ variable: "--font-archivo", subsets: ["latin"], preload: false, display: "swap" });

/** Clases que definen las variables de las fuentes opcionales. */
export const publicFontClasses = `${playfair.variable} ${nunito.variable} ${archivo.variable}`;

/** Variables que cambian títulos (`--font-display`) y texto (`--font-sans`) según la opción elegida. */
export function fontCssVariables(font: ThemeFontId): Record<string, string> {
  switch (font) {
    case "moderna":
      return { "--font-display": "var(--font-sans)" };
    case "elegante":
      return { "--font-display": "var(--font-playfair)" };
    case "amigable":
      return { "--font-display": "var(--font-nunito)", "--font-sans": "var(--font-nunito)" };
    case "fuerte":
      return { "--font-display": "var(--font-archivo)" };
    case "clasica":
      return {};
  }
}
