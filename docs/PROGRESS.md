# Progreso

- **Última funcionalidad completada:** motor de agenda en backend — modelo de datos completo (servicios, disponibilidad, clientes, turnos, notificaciones, planes/suscripciones), cálculo de horarios con zona horaria, turnos con exclusion constraint contra superposición, outbox de notificaciones con reintentos e idempotencia, envío por Resend (solo si hay credenciales). 60 tests aprobados.
- **Nueva identidad visual:** tokens "papel y tinta" (verde pino + terracota, Fraunces + Geist) en `app/globals.css`; falta aplicarla pantalla por pantalla.
- **Próxima funcionalidad:** UI — registro de 3 campos + onboarding (`/onboarding`), servicios, disponibilidad, agenda/turnos, página pública `/[slug]` y `/turno/[token]`, clientes, recordatorios; luego DAL con `sessionVersion`/membresía, rate limiting, worker (`/api/internal/tick`), Mercado Pago, admin, Docker Compose + CI, nueva landing.
- **Decisiones tomadas:** hosting VPS + Docker Compose (resuelve D-23, falta registrarlo en DECISIONS); página pública en la raíz `/[slug]` con slugs reservados; RLS diferido.
- **Bloqueos reales:** credenciales de Resend y Mercado Pago (no bloquean el resto).
