import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/dashboard/placeholder-page";

export const metadata: Metadata = { title: "Administración" };

export default function AdminPage() {
  return (
    <PlaceholderPage
      title="Administración SaaS"
      phase="Fase 5"
      description="Cuentas registradas, estado de pruebas y suscripciones, y gestión de licencias. Deshabilitado en modo standalone."
    />
  );
}
