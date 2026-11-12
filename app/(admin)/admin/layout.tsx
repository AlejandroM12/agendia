import { notFound } from "next/navigation";
import { requireContext } from "@/lib/dal";
import { isPlatformAdmin } from "@/lib/deployment";

export const instant = false;

/**
 * Panel de plataforma: solo para los emails listados en PLATFORM_ADMIN_EMAILS
 * y nunca en instalaciones independientes. Para cualquier otro usuario la
 * ruta directamente no existe (404).
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireContext();
  if (!isPlatformAdmin(user.email)) notFound();

  return (
    <div className="min-h-dvh">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">{children}</div>
    </div>
  );
}
