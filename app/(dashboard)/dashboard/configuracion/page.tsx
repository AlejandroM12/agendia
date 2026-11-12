import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/dashboard/placeholder-page";

export const metadata: Metadata = { title: "Configuración" };

export default function ConfiguracionPage() {
  return (
    <PlaceholderPage
      title="Configuración"
      phase="Fase 2"
      description="Edición de datos del negocio, rubro y zona horaria. Por ahora estos valores se definen en el registro."
    />
  );
}
