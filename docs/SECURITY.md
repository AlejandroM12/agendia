# Seguridad y multi-tenancy en producción — Agendia

> Este documento profundiza, para el contexto de producción, los puntos que `ARCHITECTURE.md` §10 ya enumera como requisitos transversales. No repite lo que ya está resuelto en la Fase 1 (hashing de contraseñas, cookies de sesión, validación con Zod, tokens opacos) — se enfoca en lo que falta reforzar antes de aceptar clientes reales: aislamiento multi-tenant en profundidad, protección a escala de endpoints públicos, y manejo de secretos en un entorno de CI/CD real.

## 1. Aislamiento multi-tenant: dos capas, no una sola

**Hoy (Fase 1):** el aislamiento es enteramente de aplicación — todo acceso a datos pasa por `lib/dal.ts`, que resuelve el `organizationId` siempre desde la sesión del servidor, nunca desde un parámetro del cliente (ver `lib/dal.ts` y los tests de `test/organization-isolation.test.ts`). Es un diseño correcto, pero es una sola capa: un error humano futuro (un query que se olvida de filtrar por `organizationId`) no tiene una segunda red de seguridad.

**Propuesta para cuando existan entidades operativas (Fase 3 — `Appointment`, `Customer`, `Service`, etc.):** agregar **Row-Level Security (RLS) de PostgreSQL** como segunda capa, independiente del código de la aplicación:

1. Cada tabla con datos de organización (`appointments`, `customers`, `services`, etc.) tiene una policy RLS que exige `organization_id = current_setting('app.current_organization_id')::uuid`.
2. Al abrir cada transacción de Prisma, la aplicación ejecuta `SET LOCAL app.current_organization_id = '<id>'` con el id resuelto por `lib/dal.ts` — nunca con un valor que venga del cliente.
3. Aunque una consulta de aplicación se olvide del filtro por `organizationId`, PostgreSQL de todas formas no devuelve filas de otra organización.

Esto no reemplaza el filtrado explícito en el código (sigue siendo la primera línea de defensa, y la más fácil de razonar al leer el código) — es una capa adicional que no depende de que cada desarrollador la recuerde en cada query nueva. Se implementa junto con el esquema de la Fase 3, no antes, porque hoy no hay ninguna tabla operativa a la que aplicarle una policy.

## 2. Prevención de reservas simultáneas (reconfirmación para producción)

El diseño ya documentado en `ARCHITECTURE.md` §5 —constraint de exclusión de PostgreSQL sobre `(professionalId, tsrange(startsAt, endsAt))`— es una garantía de la base de datos, no de la aplicación. Esto importa especialmente en producción porque:

- **Es agnóstica a cuántas instancias de la app estén corriendo.** Si en el futuro la app web escala horizontalmente (varias instancias de Next.js detrás de un balanceador), la constraint sigue siendo válida sin ningún cambio ni coordinación entre instancias — PostgreSQL es el único árbitro.
- **No depende de locks distribuidos ni de Redis.** No hay que introducir infraestructura adicional para mantener esta garantía a medida que el sistema crece.

No se propone ningún cambio a este diseño — se reconfirma que sigue siendo válido en cualquiera de las opciones de hosting evaluadas en `INFRASTRUCTURE.md`.

## 3. Rate limiting en producción

Diseño actual (`ARCHITECTURE.md` §6, decisión pendiente D-10): contador en base de datos o en memoria, sin Redis obligatorio. Para producción:

- **Mientras la app corra en una sola instancia** (el caso inicial en cualquiera de las tres opciones de hosting), el diseño actual alcanza sin cambios.
- **Si la app escala a múltiples instancias** (Railway y Vercel lo permiten con un clic; en VPS requeriría agregar un balanceador), un contador en memoria por instancia deja de ser confiable — cada instancia vería solo una fracción de los intentos. En ese momento, migrar a un store compartido (Redis administrado) es la corrección correcta, sin cambiar la interfaz del rate limiter en el código.
- Los endpoints a proteger en producción, como mínimo: `/login` (fuerza bruta de contraseñas), `/registro` (spam de cuentas), `/reservar/[slug]` y sus acciones (abuso de reservas públicas), `/olvide-contrasena` (enumeración de emails y spam de envíos), y el webhook de Mercado Pago (validar primero la firma, `SECTION 5` de `INFRASTRUCTURE.md`, antes de cualquier otro procesamiento, para que una request sin firma válida ni siquiera consuma trabajo de negocio).

No se activa Redis hoy — se documenta el punto de activación (D-10) para no tener que rediseñar cuando llegue el momento.

## 4. Enumeración de cuentas y filtrado de información

Ya implementado y verificado en la Fase 1 (`modules/auth/password-reset.ts`, `test/password-reset.test.ts`): la recuperación de contraseña responde igual exista o no la cuenta, para no revelar qué emails están registrados. El mismo principio debe mantenerse al agregar, en fases futuras:
- Mensajes de error de login (ya cumplido: "Email o contraseña incorrectos", sin distinguir cuál de los dos falló).
- Cualquier endpoint público nuevo que reciba un email o identificador (ej. reserva pública): nunca confirmar o negar la existencia de un dato con mensajes distintos según el caso.

## 5. Secretos y credenciales en CI/CD

Ampliado en `INFRASTRUCTURE.md` §7. Principios de seguridad específicos:
- Secretos de staging y producción **nunca** se comparten — un secreto de staging comprometido no debe dar acceso a datos reales de clientes.
- El workflow de GitHub Actions nunca imprime un secreto en los logs (evitar `echo $SECRET` o similar en cualquier paso).
- `MERCADOPAGO_WEBHOOK_SECRET` se usa exclusivamente para validar la firma de los webhooks — nunca se reutiliza como si fuera el `MERCADOPAGO_ACCESS_TOKEN` (son credenciales con propósitos distintos, y tratarlas como intercambiables sería un error de seguridad real, no solo de estilo).
- Rotación documentada como procedimiento, no solo como posibilidad: `AUTH_SECRET` (invalida sesiones activas), credenciales de Mercado Pago, y la contraseña de la base de datos — cada una con su propio runbook antes del lanzamiento comercial.

## 6. Auditoría

`ARCHITECTURE.md` §10 ya define la tabla `AuditLog` para cambios de estado de turno, cambios comerciales y acciones de administración SaaS. Para producción, se agrega un criterio concreto: toda acción ejecutada desde `/admin` (suspender/reactivar una cuenta, modificar un plan, etc.) **debe** quedar registrada en `AuditLog` con el `userId` del administrador que la ejecutó — no es opcional ni se puede omitir "por ahora", porque es la única forma de reconstruir qué pasó si una cuenta de cliente reporta un problema comercial.

## 7. Qué queda explícitamente fuera de esta revisión

- Un test de penetración formal o una auditoría de seguridad externa — razonable antes de manejar pagos reales en volumen (Fase 5 en adelante), no antes.
- Cifrado de datos en reposo más allá de lo que el proveedor de base de datos ya ofrece por defecto — revisar si algún requisito regulatorio específico lo exige, una vez que haya claridad sobre el mercado objetivo.
- Un WAF (Web Application Firewall) dedicado — las plataformas evaluadas en `INFRASTRUCTURE.md` ya incluyen protecciones básicas de borde; se reevalúa si el volumen de tráfico abusivo lo justifica.

## Equipos y roles (pendiente)

Hoy los roles `owner` y `admin` no se verifican en ningún punto del código y todo miembro puede todo; es inocuo porque solo existe el dueño (no hay invitaciones). **Antes de habilitar cuentas de profesionales** hay que resolver los cinco riesgos descriptos en `docs/MULTI_PROFESSIONAL.md` §10 (roles sin verificación, una membresía por usuario, avisos internos a todas las membresías, consultas sin alcance por profesional, acciones que validan escritura y no rol). Las claves foráneas compuestas `(organizationId, id)` ya impiden, en la base de datos, asociar turnos, horarios, bloqueos y servicios con profesionales de otra organización.

## Cuentas, roles e invitaciones (etapa 4)

Los riesgos de roles que seguían abiertos (`docs/MULTI_PROFESSIONAL.md` §10) quedaron resueltos: el rol se verifica en el servidor en cada acción y página (`lib/permissions.ts`, `lib/dal.ts`); una persona puede tener varios negocios con el activo resuelto en el servidor; los avisos internos van al destinatario correcto; y toda consulta de turnos y clientes pasa por `modules/access/scope.ts`. Las invitaciones usan tokens aleatorios guardados como hash, de un solo uso y con vencimiento. Detalle, límites y riesgos restantes en `docs/AUTH_AND_ACCESS.md`.

