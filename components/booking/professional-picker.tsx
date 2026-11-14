"use client";

import { Check, Users } from "lucide-react";
import { cn } from "@/lib/utils";

/** Lo que la página pública muestra de un profesional: nada de contacto ni de configuración interna. */
export type PublicProfessionalView = {
  id: string;
  displayName: string;
  description: string | null;
  photoUrl: string | null;
};

export type PublicTeamView = {
  professionals: PublicProfessionalView[];
  /** Para cada servicio: quiénes lo atienden online, en el orden del negocio. */
  byService: Record<string, string[]>;
};

export const ANY_PROFESSIONAL = "any";

function Avatar({ professional }: { professional: PublicProfessionalView }) {
  return professional.photoUrl ? (
    // Foto ya procesada y servida por la app; sin ella, la inicial sobre el color del negocio.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={professional.photoUrl} alt="" className="size-14 shrink-0 rounded-full bg-muted object-cover" />
  ) : (
    <span
      aria-hidden="true"
      className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary font-display text-xl font-semibold text-primary-foreground uppercase"
    >
      {professional.displayName.trim().slice(0, 1)}
    </span>
  );
}

function Card({
  selected,
  onSelect,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "relative flex h-full w-full items-center gap-3.5 rounded-2xl border px-4 py-3.5 text-left transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
        selected ? "border-primary bg-accent/60" : "border-input bg-card hover:border-brand-border hover:bg-accent/40",
      )}
    >
      {children}
      {selected && (
        <span className="absolute top-2.5 right-2.5 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Check className="size-3.5" aria-hidden="true" />
        </span>
      )}
    </button>
  );
}

/**
 * Elegir con quién reservar: una tarjeta por profesional, en el orden que
 * definió el negocio, y «Cualquier profesional». Solo se muestra cuando hay
 * al menos dos opciones reales; los colores son los de la página del negocio.
 */
export function ProfessionalPicker({
  professionals,
  value,
  onChange,
  performedBy,
}: {
  professionals: PublicProfessionalView[];
  value: string | null;
  onChange: (value: string) => void;
  /** Servicios que hace cada profesional (solo se muestran si no hace todos). */
  performedBy?: Record<string, string[]>;
}) {
  return (
    <div role="radiogroup" aria-label="Profesional" className="grid gap-2.5 sm:grid-cols-2">
      {professionals.map((professional) => {
        const services = performedBy?.[professional.id];
        return (
          <Card key={professional.id} selected={value === professional.id} onSelect={() => onChange(professional.id)}>
            <Avatar professional={professional} />
            <span className="min-w-0 flex-1 pr-5">
              <span className="block font-medium">{professional.displayName}</span>
              {professional.description && (
                <span className="mt-0.5 block text-sm text-muted-foreground">{professional.description}</span>
              )}
              {services && services.length > 0 && (
                <span className="mt-1 block text-xs text-muted-foreground">Hace: {services.join(", ")}</span>
              )}
            </span>
          </Card>
        );
      })}
      <Card selected={value === ANY_PROFESSIONAL} onSelect={() => onChange(ANY_PROFESSIONAL)}>
        <span aria-hidden="true" className="flex size-14 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
          <Users className="size-6" />
        </span>
        <span className="min-w-0 flex-1 pr-5">
          <span className="block font-medium">Cualquier profesional</span>
          <span className="mt-0.5 block text-sm text-muted-foreground">
            Encontrá un horario con cualquiera de los profesionales disponibles
          </span>
        </span>
      </Card>
    </div>
  );
}
