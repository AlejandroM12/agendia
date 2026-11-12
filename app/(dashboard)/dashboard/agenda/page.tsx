import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/dashboard/placeholder-page";

export const metadata: Metadata = { title: "Agenda" };

export default function AgendaPage() {
  return (
    <PlaceholderPage
      title="Agenda"
      phase="Fase 3"
      description="La vista de calendario y la creación de turnos manuales se implementan junto con servicios y disponibilidad."
    />
  );
}
