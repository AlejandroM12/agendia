import { db } from "@/lib/db";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Sirve el logo o la portada de un negocio. Son imágenes públicas (aparecen
 * en su página de reservas). Cada reemplazo genera un id nuevo, así que la
 * respuesta se puede cachear sin vencimiento.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/media/[id]">) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return new Response(null, { status: 404 });

  const image = await db.organizationImage.findUnique({ where: { id }, select: { bytes: true, contentType: true } });
  if (!image) return new Response(null, { status: 404 });

  return new Response(new Uint8Array(image.bytes), {
    headers: {
      "Content-Type": image.contentType,
      "Content-Length": String(image.bytes.length),
      "Cache-Control": "public, max-age=31536000, immutable",
      // Solo se sirve como imagen: nunca como documento ni con scripts.
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Disposition": "inline",
    },
  });
}
