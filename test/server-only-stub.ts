// Stub para el paquete `server-only` en tests.
//
// En la app real, Next.js alias-ea `server-only` a un módulo vacío cuando
// construye el bundle del servidor, y solo deja su implementación (que
// lanza un error) cuando algo intenta llevarlo al bundle del cliente. Fuera
// de ese build, como en Vitest, `server-only` lanza incondicionalmente —
// así que replicamos el alias server-side acá (ver vitest.config.ts).
export {};
