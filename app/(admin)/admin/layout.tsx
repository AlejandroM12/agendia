import { requireSession } from "@/lib/dal";

// Mismo motivo que app/(dashboard)/dashboard/layout.tsx: contenido
// por-sesión, sin beneficio de prerenderizado estático.
export const instant = false;

/**
 * TODO (Fase 5): este layout solo exige una sesión válida todavía. La
 * autorización real de "administrador SaaS" requiere un concepto que no
 * existe en el modelo de datos de la Fase 1 (no es el mismo rol que
 * Membership.role, que es por organización) — ver docs/DATABASE_DESIGN.md
 * y docs/ROADMAP.md, Fase 5. No se implementa un chequeo de rol simulado
 * mientras ese modelo no exista.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireSession();

  return (
    <div className="min-h-screen bg-secondary/30 p-8">
      <div className="mx-auto max-w-4xl">{children}</div>
    </div>
  );
}
