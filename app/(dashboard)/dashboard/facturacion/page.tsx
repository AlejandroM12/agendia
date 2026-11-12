import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/dashboard/placeholder-page";

export const metadata: Metadata = { title: "Facturación" };

export default function FacturacionPage() {
  return (
    <PlaceholderPage
      title="Facturación"
      phase="Fase 5"
      description="Gestión de suscripción y pagos, una vez integrado Mercado Pago."
    />
  );
}
