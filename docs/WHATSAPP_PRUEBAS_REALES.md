# Pruebas reales de WhatsApp con el número de prueba de Meta

Procedimiento para ver llegar a tu celular los cinco avisos (confirmación, recordatorio, cancelación, reprogramación y confirmación de asistencia). Es local: web en `http://localhost:3000`, worker corriendo y túnel hacia Meta. No se despliega nada y no se tocan producción ni Mercado Pago.

## 0. Requisitos (todos deben estar en verde)
- [ ] Las cuatro plantillas figuran **Aprobadas** en `/admin/negocios/<id de la demo>` → «WhatsApp automático» (botón de sincronizar para refrescar).
- [ ] **Token de acceso vigente** (el temporal de Meta dura 24 h; si venció: Meta → WhatsApp → Configuración de la API → generar token → en Agendia «Guardar conexión» con el token nuevo → «Validar»).
- [ ] Web y worker levantados; túnel de WhatsApp activo y su URL pegada en Meta como URL de devolución de llamada (si cambió, volver a pegarla y a verificar).
- [ ] Tu celular **verificado como destinatario** en Meta y cargado como destinatario autorizado de la demo supervisada (y como número de prueba en el panel).
- [ ] Conexión **validada** y luego **activada** (solo cuando las plantillas estén aprobadas).
- [ ] La demo vive 24 h desde su creación; si venció, crear otra y volver a cargar las credenciales.

## 1. Confirmación de reserva
1. Abrí la página pública de la demo: `http://localhost:3000/<slug de la demo>`.
2. Elegí servicio, profesional y horario; completá nombre, **tu celular** (el autorizado) y tildá la casilla de WhatsApp.
3. Reservá. En hasta 1 minuto (ciclo del worker) llega `agendia_confirmacion_v1` con los botones **Confirmo**, **Cancelar turno** y **Reprogramar**.
4. En `/admin/negocios/<id>` el mensaje figura *Enviado → Entregado → Leído* (los estados llegan por el webhook).

## 2. Confirmación de asistencia
- En el mensaje, tocá **Confirmo**. Debería llegar «¡Gracias! Dejamos confirmada tu asistencia…» y en el turno (panel del negocio) aparecer la asistencia confirmada.

## 3. Recordatorio
El recordatorio se programa `reminderHoursBefore` horas antes del turno (por defecto 24 h) y solo si falta más de ese tiempo + 15 min. Para verlo sin esperar un día:
- **Opción A (rápida, solo para pruebas):** reservá un turno a varios días y pedime que adelante la hora de ese recordatorio a «ahora»: el worker lo envía en su próximo ciclo con la plantilla real `agendia_recordatorio_v1`.
- **Opción B (sin atajos):** en `/admin` poné «horas antes del recordatorio» = 1 y reservá un turno que empiece en ~1 h 20 min; el recordatorio sale unos 20 min después.

## 4. Cancelación
- **Desde el negocio:** entrá al panel de la demo (`/login` con el correo y la contraseña que se mostraron al crearla), abrí el turno y cancelalo → llega `agendia_cancelacion_v1` con «Reservar de nuevo».
- **Desde WhatsApp:** en el mensaje de confirmación tocá **Cancelar turno**; Agendia pregunta «¿Seguro que querés cancelar?» con **Sí, cancelar / No, mantenerlo** (segundo paso a propósito).

## 5. Reprogramación
- En el panel de la demo, abrí un turno y cambiale el horario → llega `agendia_reprogramacion_v1` con **Confirmo** y **Ver mi turno**.

## 6. Baja (opcional)
- Respondé el texto **BAJA** al número de prueba: Agendia revoca el consentimiento, anula lo pendiente y contesta una confirmación. Para volver a recibir hay que reservar de nuevo con la casilla tildada.

## 7. Qué mirar y qué esperar
- Historial de mensajes y estados: `/admin/negocios/<id>` (y, para el negocio, *Configuración → Integraciones*).
- Si algo no llega: el historial muestra el error de Meta con su código; el log del worker y del servidor muestran el resto. Códigos frecuentes: `190` (token vencido), `131030` (destinatario no autorizado en el número de prueba), `132001` (plantilla inexistente o no aprobada), `131026` (no se pudo entregar).
- Los botones de enlace («Reprogramar», «Ver mi turno», «Reservar de nuevo») apuntan al dominio de producción (`WHATSAPP_TEMPLATE_BASE_URL`): en estas pruebas **no** abren el turno local. Los botones de respuesta sí funcionan por el webhook.
- Si el túnel se reinicia cambia de dirección: hay que pegar la nueva en Meta y verificar de nuevo.
- Las pruebas locales no cobran nada: el número de prueba es gratuito y no hay método de pago cargado.

## 8. Al terminar
- «Desactivar» la conexión y, si ya no se usa, «Revocar credenciales» en el panel.
- Revocar el token en Meta si fue expuesto en algún lado.
- Volcar los resultados (qué llegó, tiempos y errores) en `docs/WHATSAPP_ONBOARDING.md` §6 antes de tocar producción.
