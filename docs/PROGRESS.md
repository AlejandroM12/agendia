# Progreso

- **Última funcionalidad completada:** preparación para el lanzamiento: precios definitivos (Plan Profesional ARS 14.000/mes, Licencia independiente ARS 199.000), verificación de email obligatoria, compra de la licencia por Mercado Pago, instalaciones independientes alojadas en el mismo servidor (`deploy/instance.sh`), copia externa de backups y guía de despliegue actualizada.
- **Validación:** lint, typecheck, build, tests (Vitest) y E2E Playwright mobile + desktop en verde. Stack de producción completo probado en Docker local (HTTPS de prueba, backup y restauración, instalación independiente de punta a punta).
- **Estado:** **no desplegada.** No hay servidor, dominio ni cuentas externas contratadas; no hay cobros habilitados.
- **Bloqueos reales (requieren al dueño):** VPS + dominio; cuenta de Resend con dominio verificado; credenciales de prueba de Mercado Pago (checklist de 20 casos en `docs/PRODUCTION_READINESS.md` §6) y, después, autorización para las productivas; destino de la copia externa; valor de la renovación anual de la licencia; términos, privacidad y texto de la licencia.
- **Siguiente paso:** primer despliegue siguiendo `docs/DEPLOYMENT.md` §3.
