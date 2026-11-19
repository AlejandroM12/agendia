# Licencias independientes (Profesional y Equipo)

> Estado: la **parte técnica está implementada y probada localmente**. Las **condiciones de renovación y lo que pasa si no se renueva el alojamiento no están definidas**: este documento lista opciones, **no promesas**. Los textos son comerciales, **no legales** (`docs/LEGAL_REVIEW.md`).
> Etiquetas: **Implementado** · **Probado localmente** · **Pendiente de decisión comercial** · **Pendiente de revisión legal**.

## 1. Qué se vende

- **Licencia Profesional: ARS 149.000**, pago único, hasta **2** profesionales activos.
- **Licencia Equipo: ARS 249.000**, pago único, hasta **5** profesionales activos.
- Las dos son **licencias de uso permanente** de una **instalación independiente con base de datos propia**. Incluyen la **instalación y la configuración**, y el **primer año de alojamiento, dominio y soporte**. **No incluyen el código fuente.**
- Incluyen todas las funciones del producto: agenda, turnos y clientes sin límite, agendas individuales, reserva online con elección de profesional, página personalizada, recordatorios por email, WhatsApp manual, cuentas individuales, invitaciones y permisos configurables. Sin suscripción mensual de Agendia.
- **Desde el segundo año** el alojamiento, el dominio y el soporte se **renuevan por separado**. **No hay precio de renovación definido** (`PRICE_LICENSE_RENEWAL` vacío; la página dice «te informamos el valor por escrito antes de que compres») y **no se promete** ninguna actualización gratuita de por vida.

## 2. Cómo está implementado

- `DEPLOYMENT_MODE=standalone` → sin prueba gratuita, sin suscripción, sin `/precios`, `/licencia` ni `/admin`, sin «Mi plan»; el estado comercial nunca restringe la escritura (`canPerformWriteActions` devuelve siempre `true`). Registro abierto **solo para la primera cuenta**.
- **Nivel de la licencia:** `LICENSE_TIER=profesional|equipo` (sin valor o desconocido → `profesional`, el más restrictivo) define el cupo (2 o 5) en el servidor (`resolveProfessionalLimit`). `extraProfessionals` permite una ampliación pactada.
- **Equipos incluidos:** en una instalación independiente el modo equipo y las cuentas individuales están **siempre disponibles** (`lib/features.ts`); los limita el nivel de la licencia, no un interruptor.
- **Crear la instalación:** `./deploy/instance.sh create <nombre> <dominio> [profesional|equipo]` escribe `LICENSE_TIER` en el `.env` de la instancia. Una instancia ya creada se cambia de nivel editando ese archivo y ejecutando `instance.sh update <nombre>` (copia de seguridad previa incluida).
- **Venta de la licencia (SaaS):** `/licencia` (Checkout Pro) guarda el nivel en la orden (`license_orders.tier`) y el importe sale del servidor; la Licencia Equipo solo se vende con los planes con equipo publicados (`PUBLISH_TEAM_PLANS=1`). Hasta entonces existe una sola licencia pública («Licencia independiente», ARS 149.000).
- **Sin control invasivo:** no hay clave de licencia, ni llamadas a un servidor central, ni vencimientos, ni bloqueos. Nada borra ni restringe datos del cliente.
- **Invitaciones:** una instalación independiente **nunca** muestra en pantalla un enlace de invitación; solo viaja por el correo del invitado (`lib/test-flags.ts`, probado).

## 3. Prueba de una instalación independiente completa (local y aislada)

`node scripts/check-standalone-install.mjs [profesional|equipo]` (requiere `npm run build`): crea una base descartable en el PostgreSQL local, la migra, arranca la aplicación con `DEPLOYMENT_MODE=standalone` en otro puerto, la recorre con un navegador y la borra. **Resultado medido: 36 de 36 comprobaciones** (18 por nivel):

- arranca y responde `/api/health`; `/precios` y `/licencia` redirigen al ingreso; `/admin` no responde 200;
- se crea la primera cuenta, el onboarding pregunta «¿Cómo trabajás?» y termina; no se habla de prueba gratuita;
- no existe «Mi plan»; se pueden dar de alta **exactamente 2 (Profesional) o 5 (Equipo)** profesionales activos y el siguiente se rechaza;
- no se muestra ningún enlace de invitación sin el flujo de correo; el registro queda cerrado tras la primera cuenta;
- la base no tiene suscripciones ni órdenes de licencia: **no depende de Agendia SaaS**.

No se crearon servidores, dominios ni servicios. **No cubre:** instalación con Docker y proxy HTTPS reales (`instance.sh`, que sí se revisó pero **no se ejecutó**), correo real ni un navegador físico. *Pendiente de prueba real en la primera instalación de un cliente (sobre un dominio de prueba).*

## 4. Qué hace falta si el cliente NO renueva (opciones, sin promesas)

El derecho de uso es **permanente**: no vence ni se bloquea. Lo que se renueva es el **servicio** (alojamiento, dominio, soporte). Opciones a decidir:

1. **Renovación completa** de alojamiento + dominio + soporte con AtajoLab (precio por definir). *Pendiente de decisión comercial.*
2. **Renovación parcial, por ítems:** solo alojamiento y dominio, sin soporte (más barata), o soporte por horas. *Pendiente de decisión comercial.*
3. **Traspaso a infraestructura propia del cliente:** técnicamente viable —el compose independiente admite «un servidor aparte» (`deploy/docker-compose.standalone.yml`, modo 2), la base es PostgreSQL estándar y las copias son `pg_dump`—, pero implica **entregar las imágenes ya construidas** (sin código fuente) y los datos. Hoy **no está ofrecido ni documentado como derecho**: hay que decidir si se ofrece, con qué condiciones (instalación a cargo del cliente, sin soporte) y cómo se redacta. *Pendiente de decisión comercial y revisión legal.*
4. **Entrega de los datos del cliente** (volcado SQL de su base y de sus imágenes). Es el mínimo razonable ante cualquier baja. **Hoy no hay exportación en CSV dentro de la aplicación** (solo el volcado de base de datos, que exige un operador): si se quiere ofrecer autoservicio, es trabajo nuevo. *Pendiente de decisión comercial.*
5. **Mientras se decide, el servicio sigue funcionando:** no se apaga una instalación por falta de renovación sin aviso escrito previo y un plazo que habrá que definir; **nunca se borran datos del cliente** como consecuencia automática. *El plazo y el procedimiento de baja están pendientes de decisión comercial y legal.*

Lo que **no** se debe prometer hasta decidirlo: precio de renovación, actualizaciones gratuitas, traspaso a servidor propio, exportación en CSV y plazos de baja.

## 5. Operación

- Costo y margen del primer año, y por qué el ingreso único exige definir la renovación: `docs/PRODUCTION_READINESS.md` §5.
- Capacidad: cada instalación usa ≈ 350–450 MB de RAM (estimación previa, **no medida** con instalaciones reales); al pasar de ~6 instalaciones en el mismo VPS hay que subir el servidor o sumar otro.
- Copias de seguridad por instancia: `instances/<nombre>/backups` (diaria con rotación) y `instance.sh backup`; las copias externas incluyen las instalaciones (`deploy/offsite.sh`). Estado real de lo configurado: `docs/PRODUCTION_READINESS.md` §14.
- Actualizaciones: `instance.sh update` con copia previa y migraciones; **no hay promesa contractual de actualizaciones**.
