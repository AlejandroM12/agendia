import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/dashboard/placeholder-page";

export const metadata: Metadata = { title: "Servicios" };

export default function ServiciosPage() {
  return (
    <PlaceholderPage
      title="Servicios"
      phase="Fase 3"
      description="Alta y edición de servicios (nombre, duración, precio opcional, activo/inactivo)."
    />
  );
}
