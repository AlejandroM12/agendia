import type { Metadata } from "next";
import { PublicPage } from "@/components/booking/public-page";
import { db } from "@/lib/db";
import { requireOrganization } from "@/lib/dal";
import { getOrganizationImages } from "@/modules/public-page/images";
import { publicPageSchema, readPublicPageInput, toPublicProfile } from "@/modules/public-page/settings";

export const metadata: Metadata = { title: "Vista previa", robots: { index: false, follow: false } };
export const instant = false;

/**
 * Vista previa de la página pública para «Mi página pública»: la misma
 * página real, con los cambios todavía sin guardar que llegan por la URL.
 *
 * Solo la ve el dueño del negocio (exige sesión) y siempre muestra **su**
 * negocio: los parámetros cambian cómo se ve, nunca de quién son los datos.
 * Pasan por la misma validación que al guardar; si algo no es válido se
 * muestra lo guardado.
 */
export default async function PublicPagePreview(props: PageProps<"/vista-previa">) {
  const { organization, canWrite } = await requireOrganization();
  const params = await props.searchParams;

  const saved = toPublicProfile(organization);
  const draft = publicPageSchema.safeParse(
    readPublicPageInput((name) => (typeof params[name] === "string" ? params[name] : undefined)),
  );
  // El identificador de URL no se previsualiza: las reservas de prueba usan el real.
  const profile = draft.success ? { ...saved, ...draft.data, slug: saved.slug } : saved;

  const [images, services] = await Promise.all([
    getOrganizationImages(organization.id),
    db.service.findMany({
      where: { organizationId: organization.id, active: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, name: true, description: true, durationMinutes: true, price: true },
    }),
  ]);

  return <PublicPage profile={profile} images={images} services={services} bookable={canWrite} preview />;
}
