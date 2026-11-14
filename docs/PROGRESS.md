# Progreso

- **Producción:** https://agendia.atajolab.dev (Hetzner, Docker Compose, Caddy, PostgreSQL, Resend).
- **Última funcionalidad completada:** mejora de formularios y pantallas de cuenta — ningún formulario pierde lo escrito ante un error (D-40), validación en el navegador con los mismos esquemas del servidor, requisitos de contraseña visibles y en tiempo real, mostrar/ocultar contraseña, registro e ingreso rediseñados, reserva pública que conserva servicio, horario y datos, y textos sin «sin tarjeta» (D-41).
- **Validación:** lint, typecheck, build, tests (Vitest) y E2E Playwright mobile + desktop en verde.
- **Pendiente de desplegar:** esta versión (la anterior, páginas públicas personalizables, ya está en producción). Procedimiento en `docs/DEPLOYMENT.md` §5.
- **Limitaciones conocidas:** sin dominios propios ni subdominios por negocio; una sola portada (sin galería); el logo no se incluye en los emails; «Consultá tus turnos» requiere que el cliente haya reservado con email.
