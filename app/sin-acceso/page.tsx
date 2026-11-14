import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Logo } from "@/components/brand/logo";
import { ButtonLink } from "@/components/ui/button-link";
import { brand } from "@/lib/brand";
import { getCurrentSession } from "@/lib/dal";
import { db } from "@/lib/db";

export const metadata: Metadata = { title: "Sin acceso", robots: { index: false, follow: false } };
export const instant = false;

/**
 * Una cuenta válida que ya no pertenece a ningún negocio (por ejemplo, se le
 * revocó el acceso al único que tenía). No es un error: se explica qué pasó.
 */
export default async function NoWorkspacePage() {
  const session = await getCurrentSession();
  if (!session?.user?.id) redirect("/login");
  const memberships = await db.membership.count({ where: { userId: session.user.id } });
  if (memberships > 0) redirect("/dashboard");

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 py-12">
      <Logo href="/" />
      <div>
        <h1 className="font-display text-3xl font-semibold">Tu cuenta no tiene acceso a ningún negocio</h1>
        <p className="mt-3 text-muted-foreground">
          Es probable que el negocio al que pertenecías haya revocado tu acceso. Tus datos personales siguen intactos. Si
          creés que es un error, comunicate con la persona que te invitó, o escribinos a{" "}
          <a className="font-medium text-primary underline underline-offset-4" href={`mailto:${brand.contactEmail}`}>
            {brand.contactEmail}
          </a>
          .
        </p>
      </div>
      {/* /logout es un route handler: tiene que ser una navegación completa. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href="/logout" className="inline-flex h-10 items-center justify-center rounded-lg border border-input bg-card px-4 text-sm font-medium hover:bg-muted">
        Cerrar sesión
      </a>
      <ButtonLink variant="ghost" href="/">Ir al inicio</ButtonLink>
    </main>
  );
}
