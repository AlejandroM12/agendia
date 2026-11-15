import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { LicenseOrderStatus } from "@prisma/client";
import { ButtonLink } from "@/components/ui/button-link";
import { db } from "@/lib/db";
import { brand, formatMoney } from "@/lib/brand";
import { licenseDisplayName } from "@/lib/plans";
import { isStandalone } from "@/lib/deployment";
import { syncLicenseOrder } from "@/modules/billing/licenses";

export const metadata: Metadata = { title: "Tu compra", robots: { index: false } };
export const instant = false;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATUS: Record<LicenseOrderStatus, { title: string; body: string }> = {
  paid: {
    title: "Recibimos tu pago",
    body: "Gracias por tu compra. Te vamos a escribir al email que nos dejaste para coordinar la instalación y la configuración.",
  },
  pending: {
    title: "Estamos esperando la confirmación del pago",
    body: "Mercado Pago todavía no nos confirmó el pago. Puede demorar unos minutos (o más, si elegiste un medio de pago en efectivo). Recargá esta página para ver el estado actualizado.",
  },
  rejected: {
    title: "El pago no se pudo completar",
    body: "Mercado Pago rechazó el pago y no se te cobró nada. Podés intentarlo de nuevo con otro medio de pago.",
  },
  refunded: {
    title: "El pago fue devuelto",
    body: "Esta compra figura como devuelta. Si creés que es un error, escribinos.",
  },
};

/**
 * Estado de una compra de licencia. Es a donde vuelve la persona desde
 * Mercado Pago. El estado se consulta a la API de Mercado Pago: los
 * parámetros que agrega el checkout a la URL no se usan.
 */
export default async function LicenseOrderPage(props: PageProps<"/licencia/orden/[id]">) {
  const { id } = await props.params;
  if (isStandalone() || !UUID.test(id)) notFound();

  let order = await db.licenseOrder.findUnique({ where: { id } });
  if (!order) notFound();

  if (order.status === "pending" || order.status === "rejected") {
    try {
      await syncLicenseOrder(order.id);
      order = (await db.licenseOrder.findUnique({ where: { id } })) ?? order;
    } catch (error) {
      console.error("[billing] no se pudo consultar el pago de la licencia", order.id, error);
    }
  }

  const status = STATUS[order.status];

  return (
    <section className="mx-auto max-w-xl px-4 py-16 sm:px-6 sm:py-20">
      <div className="rounded-3xl border border-border bg-card p-7">
        <p className="text-sm font-medium text-muted-foreground">
          {licenseDisplayName(order.tier === "equipo" ? "equipo" : "profesional")} · {formatMoney(order.amount, order.currency)}
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold">{status.title}</h1>
        <p className="mt-3 text-muted-foreground">{status.body}</p>
        <p className="mt-5 text-sm text-muted-foreground">
          Número de orden: <span className="font-mono text-foreground">{order.id}</span>
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          {order.status === "rejected" && <ButtonLink href="/licencia">Intentar de nuevo</ButtonLink>}
          <ButtonLink
            variant="outline"
            href={`mailto:${brand.contactEmail}?subject=${encodeURIComponent(`Orden ${order.id}`)}`}
          >
            Escribirnos
          </ButtonLink>
        </div>
      </div>
    </section>
  );
}
