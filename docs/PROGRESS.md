# Progreso

- **Producción:** https://agendia.atajolab.dev (Hetzner, Docker Compose, Caddy, PostgreSQL, Resend).
- **Última funcionalidad completada:** páginas públicas personalizables por negocio — «Mi página pública» en el panel (identidad, logo y portada, colores, tipografía, contacto, visibilidad, identificador de URL, vista previa celular/escritorio, compartir por WhatsApp y QR), página de reservas rediseñada, «Consultá tus turnos» por email, enlaces anteriores que redirigen, metadata e imagen de vista previa por negocio, emails con el nombre y el color del negocio. Decisiones D-36 a D-39.
- **Validación:** lint, typecheck, build, tests (Vitest) y E2E Playwright mobile + desktop en verde; imagen de producción probada en un contenedor (subida de imágenes, imagen de vista previa, QR).
- **Pendiente de desplegar:** esta versión todavía no está en producción. Procedimiento y rollback en `docs/DEPLOYMENT.md` §5.
- **Limitaciones conocidas:** sin dominios propios ni subdominios por negocio; una sola portada (sin galería); el logo no se incluye en los emails; «Consultá tus turnos» requiere que el cliente haya reservado con email.
