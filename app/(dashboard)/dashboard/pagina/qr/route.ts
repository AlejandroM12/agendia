import QRCode from "qrcode";
import { brand } from "@/lib/brand";
import { requirePagePermission } from "@/lib/dal";

/**
 * Código QR de la página pública del negocio de la sesión, para descargar e
 * imprimir. Apunta a la URL estable del negocio (si después cambia su
 * identificador, el enlace anterior sigue redirigiendo).
 *
 *   ?formato=png (por defecto, 1024 px) | svg     &descargar=1 → como archivo
 */
export async function GET(request: Request) {
  const { organization } = await requirePagePermission("publicpage.manage");
  const params = new URL(request.url).searchParams;
  const url = `${brand.url}/${organization.slug}`;
  const options = { margin: 2, errorCorrectionLevel: "M" as const, color: { dark: "#000000", light: "#ffffff" } };
  const disposition = params.get("descargar") === "1" ? "attachment" : "inline";
  const headers = (type: string, extension: string) => ({
    "Content-Type": type,
    "Content-Disposition": `${disposition}; filename="qr-${organization.slug}.${extension}"`,
    "Cache-Control": "private, no-store",
  });

  if (params.get("formato") === "svg") {
    const svg = await QRCode.toString(url, { ...options, type: "svg" });
    return new Response(svg, { headers: headers("image/svg+xml", "svg") });
  }
  const png = await QRCode.toBuffer(url, { ...options, type: "png", width: 1024 });
  return new Response(new Uint8Array(png), { headers: headers("image/png", "png") });
}
