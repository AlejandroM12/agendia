// Renderiza las piezas HTML de la campaña a PNG con el tamaño exacto de cada red.
//
//   node marketing/lanzamiento/fuentes/renderizar.mjs            # las seis
//   node marketing/lanzamiento/fuentes/renderizar.mjs ig-02      # solo las que coinciden
//
// Instagram: 1080 × 1350 (4:5). TikTok: 1080 × 1920 (9:16).
// Las capturas están en fuentes/capturas (ver demo/capturar.mjs).

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
import QRCode from "qrcode";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "..");
const SITE = "https://agendia.atajolab.dev";

const PIECES = [
  { id: "ig-01-problema", file: "instagram/01-problema.png", w: 1080, h: 1350 },
  { id: "ig-02-solucion", file: "instagram/02-solucion.png", w: 1080, h: 1350 },
  { id: "ig-03-conversion", file: "instagram/03-conversion.png", w: 1080, h: 1350 },
  { id: "tt-01-hook", file: "tiktok/01-hook.png", w: 1080, h: 1920 },
  { id: "tt-02-solucion", file: "tiktok/02-solucion.png", w: 1080, h: 1920 },
  { id: "tt-03-conversion", file: "tiktok/03-conversion.png", w: 1080, h: 1920 },
];

// QR real hacia la landing: las piezas se pueden escanear.
mkdirSync(resolve(here, "piezas/assets"), { recursive: true });
writeFileSync(
  resolve(here, "piezas/assets/qr.svg"),
  await QRCode.toString(SITE, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#1f4d3f", light: "#ffffff" } }),
);

const filter = process.argv[2];
const browser = await chromium.launch();
for (const piece of PIECES.filter((p) => !filter || p.id.includes(filter))) {
  const page = await browser.newPage({ viewport: { width: piece.w, height: piece.h }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(resolve(here, `piezas/${piece.id}.html`)).href);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(Array.from(document.images).map((img) => img.decode().catch(() => undefined)));
  });
  const target = resolve(out, piece.file);
  mkdirSync(dirname(target), { recursive: true });
  await page.screenshot({ path: target, type: "png", clip: { x: 0, y: 0, width: piece.w, height: piece.h } });
  await page.close();
  console.log(`ok · ${piece.file} (${piece.w}×${piece.h})`);
}
await browser.close();
