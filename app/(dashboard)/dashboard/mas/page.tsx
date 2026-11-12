import type { Metadata } from "next";
import Link from "next/link";
import { Bell, ChevronRight, Clock, CreditCard, LogOut, Scissors, Search, Settings, type LucideIcon } from "lucide-react";
import { logoutAction } from "@/app/(auth)/actions";
import { PageHeader } from "@/components/dashboard/page-header";
import { requireOrganization } from "@/lib/dal";
import { isStandalone } from "@/lib/deployment";

export const metadata: Metadata = { title: "Más" };

export default async function MorePage() {
  const { organization, user } = await requireOrganization();

  const items: Array<{ href: string; label: string; description: string; icon: LucideIcon }> = [
    { href: "/dashboard/servicios", label: "Servicios", description: "Qué ofrecés, duración y precios", icon: Scissors },
    { href: "/dashboard/disponibilidad", label: "Horarios", description: "Días de atención y bloqueos", icon: Clock },
    { href: "/dashboard/recordatorios", label: "Recordatorios", description: "Avisos automáticos a tus clientes", icon: Bell },
    { href: "/dashboard/turnos", label: "Buscar turnos", description: "Por cliente, fecha o estado", icon: Search },
    { href: "/dashboard/configuracion", label: "Configuración", description: "Tu negocio, tu enlace y tu cuenta", icon: Settings },
    ...(isStandalone()
      ? []
      : [{ href: "/dashboard/facturacion", label: "Mi plan", description: "Prueba gratuita y suscripción", icon: CreditCard }]),
  ];

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
      <form action={logoutAction} className="mt-6">
        <button
          type="submit"
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <LogOut className="size-4" aria-hidden="true" /> Cerrar sesión
        </button>
      </form>
    </>
  );
}
