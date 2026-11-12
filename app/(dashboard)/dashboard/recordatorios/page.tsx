import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/dashboard/placeholder-page";

export const metadata: Metadata = { title: "Recordatorios" };

export default function RecordatoriosPage() {
  return (
    <PlaceholderPage
      title="Recordatorios"
      phase="Fase 4"
      description="Historial de notificaciones (confirmación, cancelación, reprogramación, recordatorio 24h) una vez implementado el worker."
    />
  );
}
