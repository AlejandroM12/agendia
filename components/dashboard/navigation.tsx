"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  CalendarDays,
  Clock,
  CreditCard,
  Ellipsis,
  Globe,
  Plus,
  Scissors,
  Settings,
  Sun,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Item = { href: string; label: string; icon: LucideIcon; exact?: boolean };

const PRIMARY: Item[] = [
  { href: "/dashboard", label: "Hoy", icon: Sun, exact: true },
  { href: "/dashboard/agenda", label: "Agenda", icon: CalendarDays },
  { href: "/dashboard/clientes", label: "Clientes", icon: Users },
];

const SETUP: Item[] = [
  { href: "/dashboard/pagina", label: "Mi página pública", icon: Globe },
  { href: "/dashboard/servicios", label: "Servicios", icon: Scissors },
  { href: "/dashboard/disponibilidad", label: "Horarios", icon: Clock },
  { href: "/dashboard/recordatorios", label: "Recordatorios", icon: Bell },
  { href: "/dashboard/configuracion", label: "Configuración", icon: Settings },
];

const TEAM: Item = { href: "/dashboard/equipo", label: "Equipo", icon: UsersRound };

const BILLING: Item = { href: "/dashboard/facturacion", label: "Mi plan", icon: CreditCard };

function useIsActive() {
  const pathname = usePathname();
  return (item: Item) => (item.exact ? pathname === item.href : pathname.startsWith(item.href));
}

export function SidebarNav({ showBilling, showTeam = false }: { showBilling: boolean; showTeam?: boolean }) {
  const isActive = useIsActive();
  const pathname = usePathname();
  const agendaActive = pathname.startsWith("/dashboard/turnos");

  const link = (item: Item) => {
    const active = isActive(item) || (item.href === "/dashboard/agenda" && agendaActive);
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
          active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        <item.icon className="size-4.5" aria-hidden="true" />
        {item.label}
      </Link>
    );
  };

  return (
    <nav className="flex flex-col gap-1" aria-label="Principal">
      {PRIMARY.map(link)}
      <p className="mt-5 mb-1 px-3 text-xs font-semibold tracking-wide text-muted-foreground/80 uppercase">
        Mi negocio
      </p>
      {SETUP.slice(0, 2).map(link)}
      {showTeam && link(TEAM)}
      {SETUP.slice(2).map(link)}
      {showBilling && link(BILLING)}
    </nav>
  );
}

/** Barra inferior del celular: lo de todos los días, a un pulgar de distancia. */
export function MobileTabBar({ canWrite }: { canWrite: boolean }) {
  const pathname = usePathname();
  const tabs: Array<Item & { match: (p: string) => boolean }> = [
    { href: "/dashboard", label: "Hoy", icon: Sun, match: (p) => p === "/dashboard" },
    {
      href: "/dashboard/agenda",
      label: "Agenda",
      icon: CalendarDays,
      match: (p) => p.startsWith("/dashboard/agenda") || (p.startsWith("/dashboard/turnos") && p !== "/dashboard/turnos/nuevo"),
    },
    { href: "/dashboard/clientes", label: "Clientes", icon: Users, match: (p) => p.startsWith("/dashboard/clientes") },
    {
      href: "/dashboard/mas",
      label: "Más",
      icon: Ellipsis,
      match: (p) =>
        ["/dashboard/mas", "/dashboard/pagina", "/dashboard/servicios", "/dashboard/equipo", "/dashboard/disponibilidad", "/dashboard/recordatorios", "/dashboard/configuracion", "/dashboard/facturacion"].some(
          (prefix) => p.startsWith(prefix),
        ),
    },
  ];

  const tab = (item: (typeof tabs)[number]) => {
    const active = item.match(pathname);
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium",
          active ? "text-primary" : "text-muted-foreground",
        )}
      >
        <item.icon className="size-5.5" aria-hidden="true" strokeWidth={active ? 2.4 : 2} />
        {item.label}
      </Link>
    );
  };

  return (
    <nav
      aria-label="Principal"
      className="fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      {tabs.slice(0, 2).map(tab)}
      <div className="flex flex-1 items-start justify-center">
        {canWrite && (
          <Link
            href="/dashboard/turnos/nuevo"
            aria-label="Nuevo turno"
            className="-mt-5 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg ring-4 ring-background transition-transform active:scale-95"
          >
            <Plus className="size-6" aria-hidden="true" />
          </Link>
        )}
      </div>
      {tabs.slice(2).map(tab)}
    </nav>
  );
}
