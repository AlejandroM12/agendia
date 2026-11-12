import { LogOut, Plus } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { ButtonLink } from "@/components/ui/button-link";
import { AccountBanner } from "@/components/dashboard/account-banner";
import { MobileTabBar, SidebarNav } from "@/components/dashboard/navigation";
import { requireOrganization } from "@/lib/dal";
import { isStandalone } from "@/lib/deployment";

// Todo el panel depende de la sesión: se renderiza por request.
export const instant = false;

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // La cáscara usa el contexto para dibujarse; cada página y cada server
  // action vuelve a exigirlo por su cuenta (lib/dal.ts).
  const { organization, user, canWrite } = await requireOrganization();

  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar p-4 lg:flex">
        <Logo href="/dashboard" className="px-2 py-1" />
        {canWrite && (
          <ButtonLink
            className="mt-6 w-full" href="/dashboard/turnos/nuevo">
                <Plus aria-hidden="true" /> Nuevo turno
              </ButtonLink>
        )}
        <div className="mt-6 flex-1 overflow-y-auto">
          <SidebarNav showBilling={!isStandalone()} />
        </div>
        <div className="border-t border-sidebar-border pt-3">
          <p className="truncate px-3 text-sm font-medium text-foreground">{organization.name}</p>
          <p className="truncate px-3 text-xs text-muted-foreground">{user.email}</p>
          {/* Enlace común (no <Link>): cerrar sesión recarga la página y no deja datos en memoria. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/logout"
            className="mt-2 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <LogOut className="size-4.5" aria-hidden="true" /> Cerrar sesión
          </a>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-border bg-background px-4 py-3 lg:hidden">
          <Logo href="/dashboard" />
          <p className="max-w-[45%] truncate text-sm text-muted-foreground">{organization.name}</p>
        </header>
        <AccountBanner organization={organization} />
        <main className="mx-auto w-full max-w-4xl flex-1 px-4 pt-6 pb-28 sm:px-6 lg:px-10 lg:pt-10 lg:pb-12">
          {children}
        </main>
      </div>

      <MobileTabBar canWrite={canWrite} />
    </div>
  );
}
