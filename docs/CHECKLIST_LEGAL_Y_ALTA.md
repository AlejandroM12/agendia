# Checklist legal y de incorporación asistida

> Esto es un **checklist operativo**, no asesoramiento legal. Los textos de `docs/legal/` son borradores **no validados**. Ningún dato del titular está inventado: lo que falta figura como **PENDIENTE**. Conviene que un profesional matriculado revise Términos, Privacidad y el tratamiento de datos antes de vender.

## A. Antes de vender (una sola vez, AtajoLab)

### A.1 Datos del titular (PENDIENTES — los tenés que aportar vos)
- [ ] Razón social o nombre completo del responsable comercial.
- [ ] CUIT y condición frente a ARCA (monotributo / responsable inscripto) y tipo de factura que se emite.
- [ ] Domicilio legal y domicilio para notificaciones.
- [ ] Email y teléfono oficiales para términos, privacidad y bajas (¿es `CONTACT_EMAIL`?).
- [ ] ¿Se factura cada cobro? ¿Los precios incluyen impuestos?
- [ ] Inscripción de la base de datos ante la autoridad de aplicación de datos personales (si corresponde) y quién la gestiona.
- [ ] Jurisdicción y ley aplicable (tribunales).
- [ ] Persona que responde pedidos de acceso, rectificación y supresión, y plazo que te comprometés a cumplir.

### A.2 Decisiones pendientes (ver `docs/LEGAL_REVIEW.md` §5)
- [ ] Reintegro al pasar de Profesional a Equipo «hoy».
- [ ] Retención de datos de cuentas inactivas, baja y supresión (sin plazos inventados).
- [ ] Exportación de datos (si se ofrece y en qué formato).
- [ ] Licencias: condiciones de renovación, qué pasa si no se renueva, titularidad del dominio y traspaso.
- [ ] Aviso a negocios de salud: no cargar datos clínicos en las notas.
- [ ] Proveedores a mencionar y su ubicación: Hetzner, Resend, Mercado Pago, **Meta (WhatsApp)**.

### A.3 Publicación
- [ ] Términos y Privacidad revisados y **publicados** (Meta pide la política de privacidad pública para App Review y verificación del negocio).
- [ ] La política de privacidad menciona el tratamiento de datos de los clientes finales de cada negocio (nombre, teléfono, correo, turnos) y que Agendia actúa como **encargado** del negocio, que es el **responsable** de esos datos.
- [ ] La política menciona el uso de WhatsApp (Meta) como proveedor cuando el negocio lo activa.

### A.4 WhatsApp / Meta
- [ ] Decidir el camino con Meta (`docs/WHATSAPP_ONBOARDING.md` §1): una aplicación por negocio, o aplicación de AtajoLab como Tech Provider (exige verificación del negocio y App Review).
- [ ] Portfolio comercial de Meta de AtajoLab creado (para las pruebas con el número gratuito alcanza con una cuenta de desarrollador).
- [ ] Si se elige Tech Provider: datos legales de A.1 cargados y verificación del negocio iniciada. **Demora de días a semanas.**
- [ ] `WHATSAPP_ENCRYPTION_KEY` generada y guardada en un gestor de contraseñas **separado del servidor**.

## B. Por cada negocio real (alta asistida)

### B.1 Acuerdo (fuera de Agendia, por escrito)
- [ ] Condiciones y costo del servicio de WhatsApp acordados (no se publican precios).
- [ ] El negocio entiende que **los mensajes los factura Meta a su cuenta** y que necesita medio de pago cargado en Meta.
- [ ] El negocio acepta los **términos de WhatsApp Business** y la política de mensajería de Meta (la cuenta es suya).
- [ ] El negocio sabe que sus clientes deben **aceptar recibir WhatsApp** (casilla al reservar) y que pueden darse de baja con BAJA.
- [ ] Quedó claro qué datos se tratan, que el negocio es el responsable y que puede pedir la **revocación de credenciales** cuando quiera.

### B.2 Requisitos del cliente
- [ ] Número propio disponible para WhatsApp Business (que no esté en uso en WhatsApp común o que se pueda liberar), con SMS o llamada para verificarlo.
- [ ] Acceso a su portfolio comercial de Meta (o creación conjunta) y nombre comercial para el nombre visible.
- [ ] Medio de pago cargado en Meta.
- [ ] Persona de contacto autorizada para aprobar el alta.

### B.3 Pasos técnicos (sin código; ver `docs/WHATSAPP_ONBOARDING.md` §3)
- [ ] Crear/elegir aplicación, WABA y número; verificar número y nombre.
- [ ] Usuario del sistema + token permanente + App Secret + IDs.
- [ ] En `/admin/negocios/<id>`: guardar conexión → token del webhook → configurar webhook en Meta (`messages`) → validar → crear/sincronizar plantillas → esperar aprobación.
- [ ] Límite mensual, avisos habilitados y números de prueba.
- [ ] Mensaje de prueba recibido → activar.
- [ ] Reserva de prueba de punta a punta con un celular del negocio (confirmación, recordatorio, cancelación, respuesta).

### B.4 Cierre
- [ ] El cliente confirmó que ve *Configuración → Integraciones* con estado «Activo».
- [ ] Registro interno: fecha de alta, quién la hizo, número, límite y condiciones acordadas.
- [ ] Fecha de revisión del consumo y de la calidad del número.

### B.5 Baja
- [ ] «Revocar credenciales» en `/admin`, revocar el token en Meta y avisar al cliente. Los avisos por correo siguen funcionando.
