import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Logo } from "@/components/brand/logo";
import { AcceptWithAccountButton, NewAccountForm } from "@/components/team/invitation-forms";
import { ButtonLink } from "@/components/ui/button-link";
import { getCurrentSession } from "@/lib/dal";
import { db } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { findInvitationByToken } from "@/modules/team/invitations";

export const metadata: Metadata = {
  title: "Invitación",
  robots: { index: false, follow: false },
  // El enlace es la credencial de la invitación: no debe viajar como referente.
  referrer: "no-referrer",
};
export const instant = false;

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 py-12">
      <Logo href="/" />
      {children}
    </main>
  );
}

/**
 * Abrir el enlace de una invitación. Un enlace inexistente, vencido, revocado o
 * ya usado muestra siempre el mismo mensaje: no se puede averiguar nada con él.
 */
export default async function InvitationPage(props: PageProps<"/invitacion/[token]">) {
  const { token } = await props.params;
  await connection();

  const limited = !(await rateLimit(`invitation:open:${await clientIp()}`, 60, 3600)).allowed;
  const found = limited ? null : await findInvitationByToken(token);
  if (!found) {
    return (
      <Shell>
        <h1 className="font-display text-3xl font-semibold">Esta invitación no es válida</h1>
        <p className="text-muted-foreground">
          El enlace venció, ya se usó o fue cancelado. Pedile a quien te invitó que te envíe una nueva.
        </p>
        <ButtonLink variant="outline" href="/login">Ir a iniciar sesión</ButtonLink>
      </Shell>
    );
  }
  const { view } = found;

  const session = await getCurrentSession();
  const user = session?.user?.id ? await db.user.findUnique({ where: { id: session.user.id }, select: { email: true } }) : null;
  const signedInWithInvitedEmail = user?.email.toLowerCase() === view.email;

  return (
    <Shell>
      <div>
        <h1 className="font-display text-3xl font-semibold">Te invitaron a {view.organizationName}</h1>
        <p className="mt-3 text-muted-foreground">
          {view.inviterName ? `${view.inviterName} te invitó` : "Te invitaron"}
          {view.professionalName
            ? ` para que accedas a tu propia agenda como ${view.professionalName}.`
            : ` a ${view.organizationName} como ${view.roleLabel.toLowerCase()}.`}{" "}
          No hace falta que contrates nada.
        </p>
      </div>

      {user && !signedInWithInvitedEmail ? (
        <div className="space-y-3 rounded-2xl border border-border bg-card p-5">
          <p className="font-medium">Ingresaste con otra cuenta</p>
          <p className="text-sm text-muted-foreground">
            Esta invitación es para <strong className="break-all">{view.email}</strong>. Cerrá sesión e ingresá con esa cuenta
            (o creá una con ese correo) para aceptarla.
          </p>
          {/* /logout es un route handler: tiene que ser una navegación completa. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/logout" className="inline-flex h-10 items-center rounded-lg border border-input bg-card px-4 text-sm font-medium hover:bg-muted">
            Cerrar sesión
          </a>
        </div>
      ) : signedInWithInvitedEmail ? (
        <AcceptWithAccountButton token={token} />
      ) : view.accountExists ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Ya tenés una cuenta con <strong className="break-all">{view.email}</strong>. Ingresá para aceptar la invitación:
            tus otros negocios no cambian.
          </p>
          <ButtonLink size="lg" className="w-full" href={`/login?callbackUrl=${encodeURIComponent(`/invitacion/${token}`)}`}>
            Iniciar sesión y aceptar
          </ButtonLink>
        </div>
      ) : (
        <NewAccountForm token={token} email={view.email} />
      )}

      <p className="text-center text-xs text-muted-foreground">
        La invitación vence el {new Intl.DateTimeFormat("es-AR", { dateStyle: "long", timeZone: "America/Argentina/Buenos_Aires" }).format(view.expiresAt)}.{" "}
        Si no la esperabas, ignorala.{" "}
        <Link href="/" className="underline underline-offset-4">Ir al inicio</Link>
      </p>
    </Shell>
  );
}
