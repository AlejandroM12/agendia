# Progreso

- **Producción:** https://agendia.atajolab.dev (Hetzner, Docker Compose, Caddy, PostgreSQL, Resend). La versión desplegada es la de las páginas públicas personalizables y los formularios mejorados.
- **Última funcionalidad completada (sin desplegar):** **equipos, etapa 1** — modelo de datos y motor de disponibilidad por profesional, asignación automática, cupos por plan, métricas de consumo y activación controlada (apagada por defecto). Detalle, riesgos y procedimiento en `docs/MULTI_PROFESSIONAL.md`. Decisiones D-42 a D-46.
- **Validación:** lint, typecheck, build, 249 tests (Vitest, contra PostgreSQL real, incluida la migración sobre una base anterior) y E2E Playwright mobile + desktop en verde.
- **Pendiente de desplegar:** esta versión incluye una **migración de base de datos** (`20261115010000_team_foundation`). Procedimiento y rollback en `docs/MULTI_PROFESSIONAL.md` §8 y §13.
- **Siguiente:** etapa 2 (equipo y agenda administrativa). Las cuentas de profesionales (etapa 4) no se habilitan hasta resolver los riesgos de roles de la sección 10 del documento.
- **Limitaciones conocidas:** sin dominios propios ni subdominios por negocio; una sola portada; el logo no va en los emails; «Consultá tus turnos» requiere que el cliente haya reservado con email; sin recursos compartidos (salas, sillones).
