import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isStandalone } from "@/lib/deployment";

// A partir de Next.js 16, "Middleware" se llama "Proxy" (mismo mecanismo).
// Ver node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md

const PROTECTED_PREFIXES = ["/dashboard", "/admin", "/onboarding"];
const AUTH_PAGES = ["/login", "/registro"];

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isAuthenticated = Boolean(req.auth?.user);

  // Coincidencia por segmento: "/dashboard-x" es la página pública de un
  // negocio, no una ruta privada.
  const matches = (prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);
  const isProtected = PROTECTED_PREFIXES.some(matches);
  const isAuthPage = AUTH_PAGES.some(matches);

  // Chequeo optimista basado solo en la cookie de sesión. La autorización
  // real (aislamiento por organización, roles, estado de la prueba) se
  // verifica siempre en el servidor, cerca de los datos — ver lib/dal.ts.
  if (isProtected && !isAuthenticated) {
    const loginUrl = new URL("/login", req.nextUrl.origin);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Una instalación independiente no es un sitio comercial: la raíz lleva
  // directo a ingresar, sin landing ni precios del SaaS.
  if (isStandalone() && (pathname === "/" || pathname === "/precios" || matches("/licencia"))) {
    return NextResponse.redirect(new URL(isAuthenticated ? "/dashboard" : "/login", req.nextUrl.origin));
  }

  if (isAuthPage && isAuthenticated) {
    return NextResponse.redirect(new URL("/dashboard", req.nextUrl.origin));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
