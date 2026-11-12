import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/dashboard/placeholder-page";

export const metadata: Metadata = { title: "Turnos" };

export default function TurnosPage() {
  return (
    <PlaceholderPage
      title="Turnos"
      phase="Fase 3"
      description="El listado y la gestión de turnos (reprogramar, cancelar, completar, marcar ausente) llegan junto con la agenda."
    />
  );
}
