# Plan de salida a producción (agendia.atajolab.dev)

Decisión del titular (2026-11-20): llevar Agendia **directamente a producción**, con todo habilitado y cobros reales de Mercado Pago, sin entornos de prueba, túneles ni pilotos por organización. No hay clientes activos. Sin funcionalidades nuevas.

Reglas: los comandos del servidor los ejecuta el titular (uno por vez, con su confirmación); ningún secreto se pega en el chat ni en el repositorio; ningún cobro real sin su autorización expresa; nada afecta a Presupuestos ni a otros servicios del VPS; los commits no llevan atribuciones de IA.

## Estado del repositorio al iniciar
- `main` = `edf7fed`, CI **verde**. Suite local: 595/595 pruebas, 74/74 E2E, lint, typecheck y build limpios.
- Migraciones del repositorio (las nuevas respecto de lo que ya pudo haberse desplegado se confirman con la auditoría del servidor): `…team_foundation`, `…professional_photos`, `…professional_change_notification`, `…notification_payload`, `…accounts_and_invitations`, `…commercial_plans`, `…subscription_contract`, `…user_sessions`, `…demo_workspaces`, `…whatsapp_integration`. Todas **aditivas**.
- `README.md` tiene una reescritura local del titular sin commitear: **no entra** en el despliegue.

## Fases
0. **Auditoría de solo lectura del servidor** (commit desplegado, migraciones aplicadas, contenedores, variables definidas —sin valores—, recursos, backups, qué más corre).
1. **Decisiones y datos que bloquean** (sección siguiente).
2. **Preparar `.env.production`**: `WHATSAPP_ENCRYPTION_KEY` nueva, `PUBLISH_TEAM_PLANS=1`, demo encendida (sin `DEMO_DISABLED`), Mercado Pago **sin tocar** hasta la fase 5.
3. **Despliegue de código** con `./deploy/deploy.sh` (copia previa, build, migraciones, reemplazo, health). Aplicar la configuración de Caddy (token del webhook redactado).
4. **Verificación post-despliegue**: salud, páginas públicas, registro y verificación de correo, prueba de 14 días, demo pública, `/admin`.
5. **Mercado Pago real**: credenciales de producción, `MERCADOPAGO_MODE=live`, webhook definitivo, **una compra real controlada por el titular** (importe y comisiones informados antes), luego cancelación/devolución, y revisión de reconciliación.
6. **WhatsApp**: webhook de Meta al dominio definitivo, token vigente, demo supervisada en producción, misma cuenta de WhatsApp (las cuatro plantillas ya existen: la sincronización no las duplica), activación y las cinco pruebas reales.
7. **Preparación comercial**: landing, precios, registro, onboarding, contratación; pendientes legales y fiscales.
8. **Operación**: backups, seguridad, logs y recursos del VPS.

## Decisiones y datos que bloquean la venta (no se inventan)
- **Legal/fiscal**: titular, CUIT y condición ante ARCA, tipo de factura, domicilio, correo oficial; **Términos y Privacidad revisados y publicados** (hoy son borradores no validados). Detalle en `docs/CHECKLIST_LEGAL_Y_ALTA.md`.
- **Mercado Pago**: aplicación en modo producción con credenciales propias y webhook definitivo; el titular decide cuándo se autoriza cada cobro real.
- **Meta**: el camino para conectar negocios reales (`docs/WHATSAPP_ONBOARDING.md` §1) sigue **sin confirmar** con Meta. Con el número de prueba solo se envía a destinatarios verificados.
- **Correo (Resend)**: dominio verificado y `RESEND_API_KEY`/`EMAIL_FROM` en el servidor; sin esto el registro no confirma correos.
- Licencias: condiciones de renovación y retención de datos sin decidir.

## Riesgos conocidos
- La validación de Mercado Pago en sandbox **quedó incompleta** (ronda 2 sin ejecutar; los webhooks de pagos reales del sandbox no llegaron; el rechazo de suscripciones no se pudo reproducir; renovaciones mensuales no se pueden probar en sandbox). Se acepta pasar a real con **una compra controlada** y la reconciliación como red de seguridad; **las renovaciones solo se verán el mes siguiente**.
- Con una sola compra real no se pueden verificar cambios de plan, rechazos ni renovaciones: se observan cuando ocurran, con `/admin` y la reconciliación.
- Backups: los automáticos viven en el mismo servidor; la copia externa y los simulacros de restauración están postergados (riesgo aceptado, `docs/PRODUCTION_READINESS.md` §14.6).
- El token temporal de Meta dura 24 h: en producción conviene un token de usuario del sistema.

## Rollback (todas las fases)
- **Código**: `./deploy/deploy.sh <commit anterior>`. Las migraciones son aditivas: el código anterior corre sobre la base ya migrada.
- **Base**: solo si hiciera falta volver el esquema, restaurar `backups/pre-deploy-*.sql.gz` con `./deploy/restore.sh <copia> --replace` (descarta lo cargado después de esa copia).
- **Variables**: antes de editar `.env.production` se guarda `.env.production.bak-<fecha>`; volver atrás = restaurar la copia y `docker compose --env-file .env.production up -d web worker`.
- **Mercado Pago**: comentar las dos líneas `MERCADOPAGO_*` con el prefijo `#PAUSADO-` y recrear `web` y `worker`: la app queda sin cobro y los planes se activan a mano desde `/admin`.
- **WhatsApp**: «Desactivar» o «Revocar credenciales» en `/admin`; no afecta correo ni WhatsApp manual.
- **Caddy**: restaurar el `Caddyfile` anterior (`git checkout <commit> -- deploy/Caddyfile`) y reiniciar el contenedor del proxy.
