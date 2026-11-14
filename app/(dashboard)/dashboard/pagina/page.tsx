import type { Metadata } from "next";
import { PageHeader } from "@/components/dashboard/page-header";
import { PublicPageEditor } from "@/components/public-page/editor";
import { SharePanel } from "@/components/public-page/share-panel";
import { brand } from "@/lib/brand";
import { requirePagePermission } from "@/lib/dal";
import { presetForIndustry } from "@/lib/theme";
import { getOrganizationImages } from "@/modules/public-page/images";
import { toPublicProfile } from "@/modules/public-page/settings";

export const metadata: Metadata = { title: "Mi página pública" };

export default async function PublicPageSettings() {
  const { organization, canWrite } = await requirePagePermission("publicpage.manage");
  const images = await getOrganizationImages(organization.id);

  return (
    // data-wide-page: el panel le da más ancho a esta pantalla (formulario + vista previa).
    <div data-wide-page>
      <PageHeader
        title="Mi página pública"
        description="La página donde tus clientes reservan: con tu nombre, tu logo y tus colores."
      />
      <div className="space-y-10">
        <SharePanel url={`${brand.url}/${organization.slug}`} businessName={organization.name} />
        <PublicPageEditor
          profile={toPublicProfile(organization)}
          images={{ logoUrl: images.logoUrl, coverUrl: images.coverUrl }}
          baseUrl={brand.url}
          suggestedPresetId={presetForIndustry(organization.industry).id}
          disabled={!canWrite}
        />
      </div>
    </div>
  );
}
