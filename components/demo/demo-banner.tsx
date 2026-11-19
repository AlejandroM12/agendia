import Link from "next/link";
import { FlaskConical } from "lucide-react";
import type { Organization } from "@prisma/client";
import { demoRemainingMinutes } from "@/modules/demo/policy";

/** Franja fija de toda demo: deja claro que es ficticia y qué no hace. */
export function DemoBanner({ organization }: { organization: Pick<Organization, "slug" | "demoKind" | "demoExpiresAt" | "demoAllowedRecipients"> }) {
  const supervised = organization.demoKind === "supervised";
  const minutes = demoRemainingMinutes(organization);
  const left = minutes >= 90 ? `${Math.round(minutes / 60)} horas` : `${minutes} minutos`;

  return (
    <div role="status" className="border-b border-amber-300/60 bg-amber-100 px-4 py-2 text-sm text-amber-950">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-1">
        <span className="flex items-center gap-2 font-semibold">
          <FlaskConical className="size-4" aria-hidden="true" /> {supervised ? "DEMO SUPERVISADA" : "DEMO"}
        </span>
        <span>
          {supervised
            ? `Los avisos reales salen solo a: ${organization.demoAllowedRecipients.join(", ") || "nadie"}.`
            : "Datos ficticios. No se envía ningún mensaje real ni hay pagos."}{" "}
          Se borra en {left}.
        </span>
        <span className="ml-auto flex flex-wrap gap-x-4">
          <Link href="/dashboard/demo" className="font-medium underline underline-offset-4">
            Qué probar
          </Link>
          <a href={`/${organization.slug}`} target="_blank" rel="noopener noreferrer" className="font-medium underline underline-offset-4">
            Página de reservas
          </a>
          {!supervised && (
            <Link href="/registro" className="font-medium underline underline-offset-4">
              Crear mi cuenta
            </Link>
          )}
        </span>
      </div>
    </div>
  );
}
