import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/dashboard/placeholder-page";

export const metadata: Metadata = { title: "Disponibilidad" };

export default function DisponibilidadPage() {
  return (
    <PlaceholderPage
      title="Disponibilidad"
      phase="Fase 3"
      description="Reglas semanales recurrentes y excepciones puntuales (bloqueos, días no laborables)."
    />
  );
}
