# Progreso

- **Última funcionalidad completada:** evaluación de producción (`docs/PRODUCTION_READINESS.md`): comparación de infraestructura y costos, auditoría multi-tenant con correcciones y tests de aislamiento, registro condicionado al email, scripts de soporte (admin, enlace de recuperación, email de prueba), checklist de sandbox de Mercado Pago y empaquetado de la instalación independiente sin código fuente.
- **Validación:** lint, typecheck, build, 95 tests (Vitest) y E2E Playwright mobile + desktop en verde.
- **Próxima funcionalidad:** verificación de email al registrarse; envío por SMTP para instalaciones independientes; páginas legales cuando esté el texto.
- **Bloqueos reales (requieren al dueño):** contratar VPS + dominio; cuenta de Resend con dominio verificado (hasta entonces el registro queda cerrado en producción); credenciales de Mercado Pago y checklist de sandbox; términos y privacidad; destino de la copia externa de backups.
