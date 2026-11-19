# Revisión legal pendiente para el lanzamiento comercial (Argentina)

> **Esto NO es asesoramiento legal ni un documento validado.** Es un inventario técnico-comercial de lo que hay que resolver con un abogado antes de cobrar, más **borradores** (`docs/legal/`) marcados como **BORRADOR — PENDIENTE DE REVISIÓN Y APROBACIÓN**. Las referencias normativas son orientativas y **hay que verificar su vigencia y alcance** con un profesional. **No se inventó ningún dato del titular** (CUIT, domicilio, razón social, etc.): todo lo que falta está marcado `[COMPLETAR]` y listado en §5.
> **La aplicación no debe considerarse legalmente validada.**

## 1. Qué hay hoy

- **No hay páginas de Términos y Condiciones ni de Política de Privacidad** publicadas. Es un **bloqueo para cobrar** (los términos se aceptan al contratar y la privacidad se exige al recolectar datos personales).
- Textos comerciales existentes (no legales): `/licencia` (condiciones antes de comprar, con casilla de aceptación en la orden), preguntas frecuentes (`lib/faq.ts`), `/precios`, avisos de «Mi plan» y correos de fin de prueba. **Hay que revisarlos** para que no contradigan los términos definitivos.
- **No figura en ninguna pantalla quién es el proveedor** (razón social, CUIT, domicilio, contacto formal). Solo está `CONTACT_EMAIL`.
- Los datos de clientes finales (nombre, teléfono, email, notas, turnos) los carga cada negocio: **el negocio es el responsable del tratamiento de sus clientes y Agendia es su encargado/proveedor de servicio**; esa relación hay que escribirla.

## 2. Requisitos a evaluar (verificar con un abogado)

### Términos y condiciones (SaaS)
- Identificación del proveedor, objeto del servicio, planes y precios en ARS (impuestos incluidos o no), **prueba gratuita de 14 días sin cobro automático**, renovación mensual, **sin permanencia**.
- **Cancelación de la suscripción:** cómo, cuándo rige (acceso hasta el fin del período pago), sin reembolso proporcional salvo decisión comercial; **cambios de plan** (al renovar o inmediato) y **reducción de lugares** con el período de adaptación y la restricción de reservas nuevas (nunca se borran datos ni se cancelan turnos).
- **Defensa del consumidor:** si el cliente puede ser consumidor (profesional independiente que contrata para su actividad quizá no lo sea; verificar), Ley 24.240 y sus resoluciones sobre contratos a distancia: **derecho de revocación / «botón de arrepentimiento»** y **«botón de baja»** (Resoluciones de la Secretaría de Comercio; verificar vigencia), información clara, y trato digno. Decidir si se aplican a todos los clientes por defecto.
- Obligaciones y prohibiciones de uso, suspensión por incumplimiento o abuso, limitación de responsabilidad, disponibilidad del servicio (sin SLA salvo que se defina), soporte, modificación de los términos con aviso, ley aplicable y jurisdicción.
- **Mercado Pago:** quién cobra, que Agendia no almacena datos de tarjeta, qué pasa ante contracargos y reembolsos.
- Facturación: tipo de comprobante y condición frente a ARCA (ex AFIP). *Pendiente de definir con el contador.*

### Política de privacidad y tratamiento de datos personales
- **Ley 25.326 de Protección de Datos Personales** y su reglamentación: finalidad, consentimiento donde corresponda, derechos de acceso, rectificación y supresión, seguridad y confidencialidad, deber de información, **inscripción de bases de datos ante la autoridad de aplicación** (AAIP; verificar si corresponde a Agendia como proveedor y a cada negocio), y la **posible reforma o nuevo marco** en trámite (verificar).
- **Transferencias internacionales:** el servidor está en Hetzner (verificar ubicación del centro de datos), el correo sale por Resend (Estados Unidos) y los pagos por Mercado Pago. La ley restringe transferir datos a países sin protección adecuada salvo garantías: **verificar qué cláusulas hacen falta** (por ejemplo con Resend).
- **Datos sensibles de salud:** negocios de psicología, nutrición, kinesiología, consultorios. Un turno, un motivo o una nota pueden revelar salud (**datos sensibles**, Ley 25.326 art. 2 y 7). Qué guarda Agendia: nombre, contacto, servicio, fecha y notas internas opcionales. Qué hace para minimizar: los mensajes de WhatsApp nunca llevan motivo ni notas, existe un modo discreto, y los correos no incluyen notas. **Hay que decidir y escribir** si se recomienda no cargar datos clínicos en las notas, cómo se informa al negocio y quién responde ante un pedido de acceso. (Las historias clínicas y su conservación tienen su propia normativa —por ejemplo la Ley 26.529 de derechos del paciente— que obliga al profesional, **no a Agendia**; verificar con el abogado si esto afecta lo que Agendia ofrece o promete.)
- **Cookies:** la aplicación usa cookies de sesión y de organización activa (necesarias); no hay analítica ni publicidad. Confirmar si hace falta aviso.
- **Menores y terceros:** un negocio puede cargar datos de menores o de terceros. Definir la responsabilidad del negocio.

### Conservación y eliminación de datos
- **Hoy no se borra nada automáticamente.** Una cuenta que no contrata queda en solo lectura 30 días y luego pausada, **con todos sus datos**.
- **No se fijó ningún plazo de eliminación ni de anonimización** y no se debe inventar uno. Decisiones pendientes: cuánto tiempo conservar los datos de una cuenta que no contrata, **cuándo y cómo** se ofrece la exportación, qué pasa cuando un negocio pide la baja, cómo se atiende el **derecho de supresión** de un cliente final (hoy requiere un operador; no hay botón), y qué se conserva por obligaciones contables y fiscales (por ejemplo, comprobantes) o ante un conflicto.
- **Copias de seguridad:** rotación diaria de 7 y semanal de 4 copias, y copia externa hasta 90 días (`docs/PRODUCTION_READINESS.md` §14): un dato eliminado persiste en las copias hasta que rotan. Hay que decirlo en la política.
- **Acceso histórico de profesionales a clientes:** `docs/SECURITY.md` (opciones B y C pendientes de decisión).

### Licencias independientes
- Redactar el **contrato de licencia de uso** (permanente, no exclusiva, intransferible salvo acuerdo, **sin entrega de código fuente**, propiedad intelectual de AtajoLab), la **prestación de servicios** del primer año (instalación, configuración, alojamiento, dominio, soporte) y las **condiciones desde el segundo año**, **que hoy no existen** (no hay precio ni plazo de baja definidos: `docs/LICENSES.md` §4).
- Titularidad del **dominio** de la instalación (¿a nombre del cliente o de AtajoLab?), responsabilidad sobre los datos (el cliente es el responsable; Agendia, el encargado), qué se entrega ante una baja o un traspaso, y confidencialidad.
- Qué pasa con las **actualizaciones**: **no se promete** que sean gratuitas ni de por vida.
- La casilla actual de `/licencia` (aceptar «licencia de uso, sin código fuente») **no reemplaza** un contrato.

### Identificación del responsable comercial
Datos que deben figurar en términos, privacidad, facturas y pie del sitio: razón social o nombre completo, CUIT, condición ante ARCA, domicilio legal, email y teléfono de contacto, y el **domicilio para notificaciones**. Ver §5.

## 3. Borradores preparados (no publicados)
- `docs/legal/TERMINOS_BORRADOR.md` y `docs/legal/PRIVACIDAD_BORRADOR.md`: estructura y cláusulas coherentes con **lo que el producto realmente hace**, con `[COMPLETAR]` donde falta un dato y notas `[REVISAR]` donde hay una decisión legal. **No se publican como páginas de la aplicación** hasta que un abogado los revise y vos los apruebes; publicar un borrador sin revisar sería presentarlo como válido.
- Una vez aprobados, el trabajo técnico es chico: dos páginas estáticas (`/terminos`, `/privacidad`), enlaces en el pie y en el registro, y una casilla de aceptación en el alta (con registro de fecha y versión).

## 4. Lo que el producto ya garantiza y se puede afirmar con respaldo técnico
No se borran datos automáticamente; los turnos confirmados siguen siendo gestionables en solo lectura; ninguna reducción de plan cancela turnos ni borra profesionales; no se guardan datos de tarjeta; contraseñas con hash; sesiones revocables; auditoría de cambios de gestión; aislamiento entre negocios probado; WhatsApp manual sin datos clínicos. **No se debe afirmar** cumplimiento legal, certificaciones, ni plazos de retención.

## 5. Datos y decisiones que necesito que me proporciones
**Datos del titular (no los invento):**
1. Razón social o nombre completo del responsable comercial.
2. CUIT y condición frente a ARCA (monotributo / responsable inscripto) y tipo de factura.
3. Domicilio legal y domicilio para notificaciones.
4. Email y teléfono de contacto oficial para términos, privacidad y bajas (¿es `CONTACT_EMAIL`?).
5. ¿Se factura cada cobro? ¿Los precios incluyen impuestos?
6. ¿Hay registro de bases de datos en la autoridad de aplicación? ¿Quién lo gestiona?

**Decisiones comerciales y legales:**
7. Si los clientes se consideran consumidores a efectos de revocación y baja (botones).
8. Reintegro proporcional al pasar de Profesional a Equipo «hoy» (`docs/MERCADOPAGO.md` §4).
9. Retención de datos de cuentas inactivas y procedimiento de baja y supresión (**sin plazos inventados**).
10. Si se ofrece exportación de datos y en qué formato.
11. Licencias: precio y condiciones de renovación, qué pasa si no se renueva, titularidad del dominio y si se ofrece traspaso a infraestructura propia (`docs/LICENSES.md` §4).
12. Si se recomienda a los negocios de salud no cargar datos clínicos en las notas y cómo se informa.
13. Jurisdicción y ley aplicable (¿tribunales de qué ciudad?).
14. Proveedores a mencionar y sus ubicaciones (Hetzner, Resend, Mercado Pago) y si hace falta algún acuerdo con ellos.
15. Persona o equipo que responderá pedidos de acceso y supresión y en qué plazo se compromete a responder.
