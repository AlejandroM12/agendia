# Demostración pública y supervisada

> **Estado:** implementada y probada localmente (`test/demo.test.ts`, `e2e/demo.spec.ts`). **Sin desplegar.** Requiere la migración aditiva `20261120000000_demo_workspaces`.

## 1. Qué es
- **`/demo`** (pública): un botón abre un **negocio ficticio propio** para cada visitante: una barbería con tres profesionales, cuatro servicios, ocho clientes inventados y turnos de los próximos días. El visitante entra con una sesión de ese negocio y puede usar el panel, la agenda, el equipo, la página pública de reservas y la gestión del turno (confirmar asistencia, reprogramar, cancelar).
- **Avisos de WhatsApp (vista previa):** `/dashboard/demo` muestra, como en un teléfono, cómo le llegan al cliente la confirmación, el recordatorio, la cancelación y la reprogramación, con botones de respuesta rápida que funcionan sobre el turno de la demo. **No es el envío real**: es una vista previa con las mismas plantillas (`modules/whatsapp/templates.ts`) que usará el envío real.
- **Demo supervisada** (solo administradores de la plataforma, en `/admin`): una demo con vencimiento de 24 horas cuyos avisos **reales** salen únicamente a los correos que se autoricen en el momento. Las credenciales se muestran una sola vez.

## 2. Garantías de aislamiento (probadas)
- **Cada visitante, su propio negocio** (`Organization.isDemo`): no comparte filas con otro ni con un negocio real. Los usuarios usan el dominio inexistente `demo.agendia.invalid`.
- **Nada real sale:** el procesador de avisos marca como «simulado» todo aviso de una demo pública, **aunque el visitante escriba su correo o teléfono**. En una demo supervisada solo se envía a `demoAllowedRecipients`; todo lo demás se simula. Ante cualquier duda, se simula (`modules/demo/policy.ts`, `demoDelivery`).
- **Sin facturación ni invitaciones:** `composeContext` quita `billing.manage`, `team.invite` y `members.manage_admins` a cualquier cuenta de demo; no se suben imágenes ni se cambia la contraseña; los avisos de la cuenta (fin de prueba) no se generan.
- **Sin pagos:** una demo no tiene suscripción y no puede llamar a Mercado Pago.
- **Topes:** 60 turnos y 80 clientes por demo; 6 demos por IP y hora; 80 demos públicas vivas a la vez; interruptor **`DEMO_DISABLED=1`**.
- **Vencimiento y borrado:** 3 horas (pública) o 24 horas (supervisada). El proceso periódico (`tick`) borra solo negocios con `isDemo` **y** vencimiento cumplido. Una sesión de demo vencida vuelve a `/demo`.
- **No contaminan las métricas:** `/admin` y el consumo de correo excluyen las demos.
- La página pública de una demo lleva una franja «Demo» y no se indexa.

## 3. Despliegue
1. Migración: `20261120000000_demo_workspaces` (aditiva: columnas de `organizations` y `appointments.attendanceConfirmedAt`, más un índice parcial).
2. Variable nueva opcional `DEMO_DISABLED` (vacía = demo encendida). Se pasa por `docker-compose.yml`.
3. Sin infraestructura nueva: usa el worker existente.

## 4. Cómo hacer una demostración real supervisada
1. Entrá a `/admin` → «Demostración supervisada» → ingresá tu correo y/o tu celular con característica (de 1 a 8, separados por coma).
2. Anotá el correo y la contraseña que se muestran (una sola vez) e ingresá en `/login`.
3. Reservá desde `/<slug>` con uno de esos datos: el aviso llega de verdad a ese correo o celular; cualquier otro destinatario se simula.
4. Para ver **WhatsApp real**, conectá la demo al número de prueba de Meta desde `/admin/negocios/<id>` (procedimiento en `docs/WHATSAPP_ONBOARDING.md` §5) y reservá con el consentimiento de WhatsApp tildado. Nunca sale un mensaje a un número que no esté expresamente autorizado. La demo **pública** no envía WhatsApp real.

## 5. Pendiente
- El envío real por WhatsApp (Etapa 1; depende de la decisión del proveedor, `docs/WHATSAPP_PROVEEDORES.md`).
- Contenido comercial de la demo y guion de 3 a 5 minutos (Etapa 3).
