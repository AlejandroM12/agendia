import type { Metadata } from "next";
import Link from "next/link";
import { Bell, ChevronRight, CircleUserRound, Clock, CreditCard, Globe, LogOut, Scissors, Search, Settings, Users, UsersRound, type LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { requireOrganization } from "@/lib/dal";
import { isStandalone } from "@/lib/deployment";
import { isTeamModeEnabled } from "@/lib/features";

export const metadata: Metadata = { title: "Más" };

export default async function MorePage() {
  const { organization, user, permissions, role } = await requireOrganization();

  type Entry = { href: string; label: string; description: string; icon: LucideIcon };
  const businessItems: Entry[] = [
    { href: "/dashboard/pagina", label: "Mi página pública", description: "Tu marca, tu enlace y tu código QR", icon: Globe },
    { href: "/dashboard/servicios", label: "Servicios", description: "Qué ofrecés, duración y precios", icon: Scissors },
    ...(isTeamModeEnabled(organization)
      ? [{ href: "/dashboard/equipo", label: "Equipo", description: "Profesionales, accesos, fotos y servicios", icon: UsersRound }]
      : []),
    { href: "/dashboard/disponibilidad", label: "Horarios", description: "Días de atención y bloqueos", icon: Clock },
    { href: "/dashboard/recordatorios", label: "Recordatorios", description: "Avisos automáticos a tus clientes", icon: Bell },
    { href: "/dashboard/turnos", label: "Buscar turnos", description: "Por cliente, fecha o estado", icon: Search },
    { href: "/dashboard/configuracion", label: "Configuración", description: "Actividad, zona horaria y tu cuenta", icon: Settings },
    ...(isStandalone() ? [] : [{ href: "/dashboard/facturacion", label: "Mi plan", description: "Prueba gratuita y suscripción", icon: CreditCard }]),
    { href: "/dashboard/perfil", label: "Mi cuenta", description: "Tus datos, tu contraseña y tus avisos", icon: CircleUserRound },
  ];
  const professionalItems: Entry[] = [
    { href: "/dashboard/disponibilidad", label: "Mis horarios", description: "Tus días de atención y bloqueos", icon: Clock },
    ...(permissions.has("own.customers.contact")
      ? [{ href: "/dashboard/clientes", label: "Mis clientes", description: "Quienes tienen turnos con vos", icon: Users }]
      : []),
    { href: "/dashboard/perfil", label: "Mi perfil", description: "Tus datos, tu contraseña y tus avisos", icon: CircleUserRound },
  ];
  // Cada persona ve solo las secciones que su rol le permite.
  const items = (role === "professional" ? professionalItems : businessItems).filter((item) => {
    const needs: Record<string, Parameters<typeof permissions.has>[0] | undefined> = {
      "/dashboard/pagina": "publicpage.manage",
      "/dashboard/servicios": "services.manage",
      "/dashboard/equipo": "team.manage",
      "/dashboard/recordatorios": "settings.manage",
      "/dashboard/configuracion": "settings.manage",
      "/dashboard/facturacion": "billing.manage",
    };
    const needed = needs[item.href];
    return !needed || permissions.has(needed);
  });

  return (
    <>
      <PageHeader title={organization.name} description={user.email} />
      <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
        {items.map((item) => (
          <li key={item.href}>
            <Link href={item.href} className="flex items-center gap-4 px-4 py-4 hover:bg-accent/50">
              <item.icon className="size-5 shrink-0 text-primary" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{item.label}</span>
                <span className="block truncate text-sm text-muted-foreground">{item.description}</span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
      {/* /logout es un route handler: tiene que ser una navegación completa. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a
        href="/logout"
        className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <LogOut className="size-4" aria-hidden="true" /> Cerrar sesión
      </a>
    </>
  );
}
