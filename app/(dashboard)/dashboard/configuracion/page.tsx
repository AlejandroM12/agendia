import type { Metadata } from "next";
import { PageHeader } from "@/components/dashboard/page-header";
import { Section } from "@/components/dashboard/section";
import { ShareLink } from "@/components/dashboard/share-link";
import { BusinessForm, PasswordForm } from "@/components/settings/settings-forms";
import { requireOrganization } from "@/lib/dal";
import { brand } from "@/lib/brand";

export const metadata: Metadata = { title: "Configuración" };

export default async function SettingsPage() {
  const { organization, user, canWrite } = await requireOrganization();

  return (
    <>
      <PageHeader title="Configuración" />
      <div className="space-y-10">
        <ShareLink url={`${brand.url}/${organization.slug}`} businessName={organization.name} />

        <Section title="Tu negocio" description="Lo que ven tus clientes en tu página de reservas.">
          <BusinessForm organization={organization} baseUrl={brand.url} disabled={!canWrite} />
        </Section>

        <Section title="Tu cuenta" description={`Ingresás con ${user.email}.`}>
          <PasswordForm />
        </Section>
      </div>
    </>
  );
}
