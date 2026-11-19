import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Globe, MessageCircle } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { Section } from "@/components/dashboard/section";
import { BusinessForm, PasswordForm } from "@/components/settings/settings-forms";
import { requirePagePermission } from "@/lib/dal";

export const metadata: Metadata = { title: "Configuración" };

export default async function SettingsPage() {
  const { organization, user, canWrite } = await requirePagePermission("settings.manage");

  return (
    <>
      <PageHeader title="Configuración" />
      <div className="space-y-10">
        <Link
          href="/dashboard/pagina"
          className="flex items-center gap-4 rounded-2xl border border-border bg-card p-4 transition-colors hover:border-primary"
        >
          <Globe className="size-5 shrink-0 text-primary" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block font-medium">Mi página pública</span>
            <span className="block text-sm text-muted-foreground">
              Nombre, logo, colores, datos de contacto y el enlace que compartís con tus clientes.
            </span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </Link>

        <Link
          href="/dashboard/configuracion/integraciones"
          className="flex items-center gap-4 rounded-2xl border border-border bg-card p-4 transition-colors hover:border-primary"
        >
          <MessageCircle className="size-5 shrink-0 text-primary" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block font-medium">Integraciones</span>
            <span className="block text-sm text-muted-foreground">WhatsApp automático: confirmaciones, recordatorios y avisos de tus turnos.</span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </Link>

        <Section title="Tu negocio" description="Datos que usa la agenda para funcionar.">
          <BusinessForm organization={organization} disabled={!canWrite} />
        </Section>

        <Section title="Tu cuenta" description={`Ingresás con ${user.email}.`}>
          <PasswordForm />
        </Section>
      </div>
    </>
  );
}
