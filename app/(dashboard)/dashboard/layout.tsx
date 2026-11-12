import Link from "next/link";
import { getOptionalOrganization } from "@/lib/dal";
import { brand } from "@/lib/brand";
import { DashboardNav } from "@/components/dashboard/dashboard-nav";
import { LogoutButton } from "@/components/dashboard/logout-button";
import { TrialStatusBadge } from "@/components/dashboard/trial-status-badge";

// Todo el dashboard es contenido por-sesión (requiere leer la cookie de
// autenticación): no hay nada que ganar prerrenderizándolo de forma
// estática. Se opta explícitamente por el modo dinámico/bloqueante en vez
// de introducir límites de Suspense solo para satisfacer el prerenderizado
// de Cache Components — ver la guía de autenticación con Cache Components
// de Next.js (node_modules/next/dist/docs/.../authentication-with-cache-components.md,
// sección "Migrating an existing app") y docs/DECISIONS.md.
export const instant = false;

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Solo dibuja la cáscara visual (sidebar, badge de prueba). La
  // autorización real de cada pantalla se hace en la propia página — ver el
  // comentario en lib/dal.ts sobre por qué no se exige la organización aquí.
  const { session, organization } = await getOptionalOrganization();

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <aside className="border-b border-border bg-secondary/30 p-4 lg:w-64 lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between lg:flex-col lg:items-start lg:gap-4">
          <Link href="/" className="flex items-center gap-2 font-semibold text-foreground">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
              A
            </span>
            <span>{brand.name}</span>
          </Link>
          {organization && <TrialStatusBadge organization={organization} />}
        </div>
        <div className="mt-6 hidden lg:block">
          <DashboardNav />
        </div>
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-border px-4 py-3 lg:px-8">
          <div className="text-sm text-muted-foreground">
            {organization ? `${organization.name} · ` : ""}
            {session.user.email}
          </div>
          <LogoutButton />
        </header>

        <div className="border-b border-border px-4 py-2 lg:hidden">
          <DashboardNav />
        </div>

        <main className="flex-1 p-4 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
