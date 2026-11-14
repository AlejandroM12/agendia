import { ImageResponse } from "next/og";
import sharp, { type Sharp } from "sharp";
import { db } from "@/lib/db";
import { brand } from "@/lib/brand";
import { mix, resolveTheme } from "@/lib/theme";
import { findPublicOrganization } from "@/modules/public-page/load";

const WIDTH = 1200;
const HEIGHT = 630;

type Embedded = { src: string; width: number; height: number };

/** Imagen guardada (WebP) convertida a un formato que el generador sabe dibujar. */
async function embed(id: string | null, convert: (image: Sharp) => Sharp, mime: string): Promise<Embedded | null> {
  if (!id) return null;
  try {
    const stored = await db.organizationImage.findUnique({ where: { id }, select: { bytes: true } });
    if (!stored) return null;
    const { data, info } = await convert(sharp(stored.bytes)).toBuffer({ resolveWithObject: true });
    return { src: `data:${mime};base64,${data.toString("base64")}`, width: info.width, height: info.height };
  } catch {
    return null;
  }
}

/**
 * Imagen para la vista previa del enlace (Open Graph) de un negocio: su
 * portada o sus colores, su logo, su nombre y su especialidad. Es lo que se
 * ve al compartir la página por WhatsApp o redes.
 */
export async function GET(_request: Request, ctx: RouteContext<"/[slug]/og">) {
  const { slug } = await ctx.params;
  const found = await findPublicOrganization(slug);
  if (!found) return new Response(null, { status: 404 });

  const { profile, images } = found;
  const theme = resolveTheme({ primary: profile.themePrimary, secondary: profile.themeSecondary });
  const [cover, logo] = await Promise.all([
    embed(images.coverId, (image) => image.resize(WIDTH, HEIGHT, { fit: "cover" }).jpeg({ quality: 78 }), "image/jpeg"),
    embed(images.logoId, (image) => image.resize(148, 148, { fit: "inside" }).png(), "image/png"),
  ]);

  // Sobre una portada se usa siempre texto blanco con un velo oscuro; sin
  // portada, el texto que mejor contrasta con el color del negocio.
  const foreground = cover ? "#ffffff" : theme.primaryForeground;
  const name = profile.name.length > 46 ? `${profile.name.slice(0, 45)}…` : profile.name;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          backgroundColor: theme.primary,
          ...(cover
            ? {}
            : { backgroundImage: `linear-gradient(135deg, ${theme.primary} 55%, ${mix(theme.primary, theme.secondary, 0.65)} 100%)` }),
          color: foreground,
        }}
      >
        {cover && (
          // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
          <img src={cover.src} width={WIDTH} height={HEIGHT} style={{ position: "absolute", top: 0, left: 0 }} />
        )}
        {cover && (
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: WIDTH,
              height: HEIGHT,
              display: "flex",
              backgroundImage: "linear-gradient(180deg, rgba(0,0,0,0.25) 0%, rgba(0,0,0,0.72) 100%)",
            }}
          />
        )}

        <div
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            width: "100%",
            height: "100%",
            padding: 72,
          }}
        >
          <div style={{ display: "flex", alignItems: "center" }}>
            {logo ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 148,
                  height: 148,
                  borderRadius: 36,
                  backgroundColor: "#ffffff",
                  overflow: "hidden",
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
                <img src={logo.src} width={logo.width} height={logo.height} />
              </div>
            ) : (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 148,
                  height: 148,
                  borderRadius: 36,
                  backgroundColor: foreground,
                  color: cover ? "#1d1b18" : theme.primary,
                  fontSize: 84,
                  fontWeight: 700,
                }}
              >
                {profile.name.trim().slice(0, 1).toUpperCase()}
              </div>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: name.length > 28 ? 64 : 82, fontWeight: 700, lineHeight: 1.08, letterSpacing: -1.5 }}>
              {name}
            </div>
            {profile.specialty && (
              <div style={{ display: "flex", marginTop: 14, fontSize: 38, opacity: 0.9 }}>{profile.specialty}</div>
            )}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 40 }}>
              <div
                style={{
                  display: "flex",
                  padding: "14px 30px",
                  borderRadius: 999,
                  backgroundColor: foreground,
                  color: cover ? "#1d1b18" : theme.primary,
                  fontSize: 32,
                  fontWeight: 700,
                }}
              >
                Reservá tu turno online
              </div>
              <div style={{ display: "flex", fontSize: 24, opacity: 0.75 }}>con {brand.name}</div>
            </div>
          </div>
        </div>
      </div>
    ),
    {
      width: WIDTH,
      height: HEIGHT,
      headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" },
    },
  );
}
