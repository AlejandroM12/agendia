import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/dashboard/placeholder-page";

export const metadata: Metadata = { title: "Clientes" };

export default function ClientesPage() {
  return (
    <PlaceholderPage
      title="Clientes"
      phase="Fase 3"
      description="La base de clientes se completa a medida que se reciben turnos manuales y reservas públicas."
    />
  );
}
