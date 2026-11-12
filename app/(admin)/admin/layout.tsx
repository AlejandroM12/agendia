import { notFound } from "next/navigation";
import { requireContext } from "@/lib/dal";
import { canAccessPlatformAdmin } from "@/lib/deployment";

export const instant = false;

/**
 * Panel de plataforma: solo para usuarios con la marca `isPlatformAdmin`
 * (ver lib/deployment.ts) y nunca en instalaciones independientes. Para cualquier otro usuario la
 * ruta directamente no existe (404).
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireContext();
  if (!canAccessPlatformAdmin(user)) notFound();

  return (
    <div className="min-h-dvh">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">{children}</div>
    </div>
  );
}
