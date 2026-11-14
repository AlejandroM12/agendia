import { AuthBenefits } from "@/components/auth/benefits";
import { Logo } from "@/components/brand/logo";
import { brand } from "@/lib/brand";

/**
 * Pantallas de cuenta. En escritorio, un panel de marca acompaña al
 * formulario; en el celular el formulario va primero y solo.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh flex-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="relative hidden overflow-hidden bg-primary p-12 text-primary-foreground lg:flex lg:flex-col lg:justify-between xl:p-16">
        {/* Formas decorativas, con los colores de la marca. */}
        <div aria-hidden="true" className="absolute -top-24 -right-24 size-80 rounded-full bg-primary-foreground/6" />
        <div aria-hidden="true" className="absolute -bottom-32 -left-20 size-96 rounded-full bg-highlight/25" />

        <Logo inverted className="relative" />

        <div className="relative max-w-md">
          <p className="font-display text-4xl leading-[1.1] font-semibold xl:text-5xl">
            Menos coordinar,
            <br />
            <span className="italic">más atender.</span>
          </p>
          <p className="mt-4 text-lg text-primary-foreground/80">
            Turnos, reservas online y recordatorios para profesionales independientes.
          </p>
          <AuthBenefits tone="onPrimary" className="mt-10" />
        </div>

        <p className="relative text-sm text-primary-foreground/65">
          Un producto de{" "}
          <a href={brand.maker.url} className="font-medium text-primary-foreground underline-offset-4 hover:underline">
            {brand.maker.name}
          </a>
        </p>
      </aside>

      <main className="flex flex-col items-center px-4 py-8 sm:justify-center sm:py-12">
        <Logo className="mb-8 lg:hidden" />
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
