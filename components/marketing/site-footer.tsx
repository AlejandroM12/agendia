import Link from "next/link";
import { brand } from "@/lib/brand";

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-secondary/40">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="grid gap-8 sm:grid-cols-3">
          <div>
            <p className="font-semibold text-foreground">{brand.name}</p>
            <p className="mt-2 text-sm text-muted-foreground">{brand.tagline}.</p>
          </div>

          <div>
            <p className="text-sm font-medium text-foreground">Navegación</p>
            <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
              <li>
                <Link href="/#funcionalidades" className="hover:text-foreground">
                  Funcionalidades
                </Link>
              </li>
              <li>
                <Link href="/precios" className="hover:text-foreground">
                  Precios
                </Link>
              </li>
              <li>
                <Link href="/registro" className="hover:text-foreground">
                  Probar gratis
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <p className="text-sm font-medium text-foreground">Contacto</p>
            <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
              <li>
                <a href="mailto:hola@agendia.app" className="hover:text-foreground">
                  hola@agendia.app
                </a>
              </li>
              <li className="text-xs text-muted-foreground/80">
                Enlaces legales (términos, privacidad) — próximamente.
              </li>
            </ul>
          </div>
        </div>

        <p className="mt-10 text-xs text-muted-foreground/80">
          © <CopyrightYear /> {brand.name}. Todos los derechos reservados.
        </p>
      </div>
    </footer>
  );
}

// `new Date()` es un valor "inestable" para el prerenderizado estático de
// Cache Components (podría cambiar entre renders). Lo aislamos en su propio
// componente cacheado: se resuelve una vez y entra en la cáscara estática
// en vez de forzar toda la página a renderizado dinámico.
async function CopyrightYear() {
  "use cache";
  return new Date().getFullYear();
}
