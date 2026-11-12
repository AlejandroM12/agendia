import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { brand } from "@/lib/brand";

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <Logo />
            <p className="mt-3 max-w-xs text-sm text-muted-foreground">{brand.tagline}.</p>
          </div>
          <nav className="flex flex-wrap gap-x-8 gap-y-2 text-sm font-medium text-muted-foreground" aria-label="Pie de página">
            <Link href="/#funciones" className="hover:text-foreground">Funciones</Link>
            <Link href="/precios" className="hover:text-foreground">Precios</Link>
            <Link href="/login" className="hover:text-foreground">Ingresar</Link>
            <Link href="/registro" className="hover:text-foreground">Probar gratis</Link>
            <a href={`mailto:${brand.contactEmail}`} className="hover:text-foreground">Contacto</a>
          </nav>
        </div>

        <div className="mt-10 flex flex-col gap-1 border-t border-border pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>
            © <CopyrightYear /> {brand.name}. Todos los derechos reservados.
          </p>
          <p>
            Un producto de{" "}
            <a
              href={brand.maker.url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-foreground/80 underline-offset-4 hover:underline"
            >
              {brand.maker.name}
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
}

// `new Date()` es un valor inestable para el prerenderizado estático: se
// aísla en un componente cacheado para no volver dinámica toda la página.
async function CopyrightYear() {
  "use cache";
  return new Date().getFullYear();
}
