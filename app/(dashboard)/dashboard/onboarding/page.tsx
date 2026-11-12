import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/dal";
import { PlaceholderPage } from "@/components/dashboard/placeholder-page";

export const metadata: Metadata = { title: "Onboarding" };

/**
 * En la Fase 1, el registro crea la organización de forma atómica junto
 * con el usuario (ver modules/organizations/register.ts), así que esta
 * pantalla no debería alcanzarse en el flujo normal. Se deja preparada
 * para la Fase 2, cuando el onboarding (rubro, servicios, horarios) se
 * separe del registro inicial.
 *
 * Importante: esta página llama a `requireSession()`, no a
 * `requireOrganization()` — si usara la variante que exige organización,
 * un usuario sin organización quedaría en un bucle de redirects contra
 * esta misma pantalla.
 */
export default async function OnboardingPage() {
  const session = await requireSession();

  if (session.user.organizationId) {
    redirect("/dashboard");
  }

  return (
    <PlaceholderPage
      title="Completar configuración"
      phase="Fase 2"
      description="El asistente de onboarding (rubro, servicios, horarios) se incorpora en la Fase 2. Tu cuenta ya tiene los datos mínimos creados durante el registro."
    />
  );
}
