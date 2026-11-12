import { Logo } from "@/components/brand/logo";
import { ButtonLink } from "@/components/ui/button-link";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 text-center">
      <Logo />
      <h1 className="mt-10 font-display text-3xl font-semibold">No encontramos esta página</h1>
      <p className="mt-2 max-w-sm text-muted-foreground">
        Puede que el enlace esté mal escrito o que la página ya no exista.
      </p>
      <ButtonLink href="/" className="mt-6">
        Ir al inicio
      </ButtonLink>
    </main>
  );
}
