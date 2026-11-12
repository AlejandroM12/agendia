# Progreso

- **Última funcionalidad completada:** infraestructura de producción en el repo (Dockerfile, `docker-compose.yml` con caddy/web/worker/migrate/postgres/backup, scripts de deploy/backup/restore, CI de GitHub Actions), probada localmente con un stack descartable. Antes: MVP completo (onboarding, agenda, reservas públicas, clientes, recordatorios, plan, admin, Mercado Pago, landing).
- **Validación:** lint, typecheck, build, 76 tests (Vitest) y E2E Playwright mobile + desktop en verde.
- **Próxima funcionalidad:** páginas legales (términos y privacidad, requieren texto aprobado); copia externa de backups; envío por SMTP para instalaciones independientes; WhatsApp; pulido de UX según uso real.
- **Bloqueos reales (requieren al dueño):** credenciales de Resend (emails) y de Mercado Pago (pago online; validar en sandbox); contratar VPS + dominio y desplegar; textos legales.
