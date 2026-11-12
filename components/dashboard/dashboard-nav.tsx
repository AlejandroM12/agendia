"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Resumen" },
  { href: "/dashboard/agenda", label: "Agenda" },
  { href: "/dashboard/turnos", label: "Turnos" },
  { href: "/dashboard/clientes", label: "Clientes" },
  { href: "/dashboard/servicios", label: "Servicios" },
  { href: "/dashboard/disponibilidad", label: "Disponibilidad" },
  { href: "/dashboard/recordatorios", label: "Recordatorios" },
  { href: "/dashboard/configuracion", label: "Configuración" },
  { href: "/dashboard/facturacion", label: "Facturación" },
];

export function DashboardNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1">
      {NAV_ITEMS.map((item) => {
        const isActive = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "rounded-md px-3 py-2 text-sm font-medium transition-colors",
              isActive
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
