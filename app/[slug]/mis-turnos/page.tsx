import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { LookupForm } from "@/components/booking/lookup-form";
import { PublicShell } from "@/components/booking/public-shell";
import { isEmailConfigured } from "@/modules/notifications/email";
import { findPublicOrganization, loadPublicOrganization } from "@/modules/public-page/load";

export const instant = false;

export async function generateMetadata(props: PageProps<"/[slug]/mis-turnos">): Promise<Metadata> {
  const { slug } = await props.params;
  const found = await findPublicOrganization(slug);
  return {
    title: { absolute: found ? `Consultá tus turnos · ${found.profile.name}` : "Página no encontrada" },
    robots: { index: false, follow: false },
  };
}

export default async function LookupPage(props: PageProps<"/[slug]/mis-turnos">) {
  const { slug } = await props.params;
  await connection();
  const { profile, images } = await loadPublicOrganization(slug, "/mis-turnos");
  const invalidLink = (await props.searchParams).enlace === "vencido";

  // Sin canal de email no se promete un envío que no va a ocurrir. (Fuera
  // de producción el formulario muestra el enlace en pantalla.)
  const available = isEmailConfigured() || process.env.NODE_ENV !== "production";

  return (
    <PublicShell profile={profile} images={images}>
      <h1 className="font-display text-2xl font-semibold">Consultá tus turnos</h1>
      <p className="mt-2 text-muted-foreground">
        Ingresá tu email y te enviamos un enlace para ver tus turnos en {profile.name}. Desde ahí podés reprogramarlos
        o cancelarlos. No hace falta crear una cuenta.
      </p>

      {invalidLink && (
        <p role="alert" className="mt-5 rounded-xl bg-danger-soft px-4 py-3 text-sm text-destructive">
          Ese enlace venció o ya no es válido. Pedí uno nuevo.
        </p>
      )}

      <div className="mt-6">
        {available ? (
          <LookupForm slug={profile.slug} />
        ) : (
          <p className="rounded-2xl border border-dashed border-input bg-card/60 px-5 py-6 text-sm text-muted-foreground">
            La consulta por email no está disponible en este momento. Usá el enlace «Ver mi turno» que recibiste al
            reservar, o comunicate con {profile.name}.
          </p>
        )}
      </div>

      <p className="mt-8 text-center text-sm">
        <Link href={`/${profile.slug}`} className="font-medium text-brand-text underline-offset-4 hover:underline">
          Reservar un turno nuevo
        </Link>
      </p>
    </PublicShell>
  );
}
