# Cuentas, membresías, roles e invitaciones (etapa 4)

**Estado:** implementado y **deshabilitado por defecto** (`TEAM_ACCOUNTS_ENABLED` / `Organization.teamAccountsEnabled`). Un negocio con una sola cuenta funciona exactamente como antes. Nada de esto está en producción.

## 1. Modelo

- **Usuario** (`users`): una persona que inicia sesión. Una sola cuenta para todos sus negocios.
- **Profesional** (`professionals`): quien atiende y tiene agenda en UN negocio. Puede existir sin cuenta (`userId` vacío); no hace falta correo para crearlo.
- **Membresía** (`memberships`): usuario ↔ negocio con un rol (`owner`, `admin`, `professional`). Un usuario puede tener roles distintos en negocios distintos (propietaria de su consultorio y profesional en otro).
- **Vínculo** `professionals.userId`: la cuenta de un profesional. Reglas garantizadas por la base: la persona tiene que ser miembro de ESE negocio (trigger), una persona tiene un solo perfil por negocio (`UNIQUE (organizationId, userId)`), y si pierde la membresía el perfil queda sin cuenta (trigger) sin perder nada más.
- **Invitación** (`invitations`): correo + negocio + rol + (profesional) perfil; token solo como hash; una pendiente por perfil y por correo (índices parciales); rol coherente con el perfil y nunca `owner` (CHECK).
- La suscripción pertenece al negocio. Una cuenta invitada no contrata nada ni crea un negocio.

## 2. Organización activa

`lib/dal.ts` resuelve en cada pedido, en el servidor: la sesión (el token **ya no lleva negocio ni rol**), las membresías vigentes de la persona, el negocio activo, su rol y sus permisos. La cookie `agendia_org` es solo una **pista**: se acepta si hoy hay una membresía en ese negocio; si no, se usa la primera membresía (el comportamiento de siempre). Una persona con un solo negocio no ve ningún paso adicional; con varios ve un selector (nombre, logo, rol, negocio actual). Cambiar de negocio (`switchWorkspaceAction`) verifica la membresía, guarda la pista y recarga todo desde el servidor.

Consecuencias: un cambio de rol, de permisos o una revocación **vale en el siguiente pedido, también con la sesión ya abierta**. Quien se queda sin ningún negocio llega a `/sin-acceso` (explicado, no un error). No hay agendas sincronizadas ni detección de conflictos entre negocios.

Puntos que presuponían una sola membresía y se corrigieron: `auth.ts` (el token), `lib/dal.ts`, el listado del panel de plataforma (toma al propietario) y los avisos internos (`modules/notifications/enqueue.ts`).

## 3. Roles y matriz de permisos (`lib/permissions.ts`)

| Permiso | Propietario | Administrador | Profesional |
|---|:--:|:--:|:--:|
| Ver su propia agenda | sí | sí | sí |
| Gestionar profesionales, horarios y bloqueos de cualquiera | sí | sí | no |
| Crear, reprogramar, reasignar y cancelar turnos de cualquiera | sí | sí | no |
| Servicios, clientes (todos), página pública, configuración, estadísticas | sí | sí | no |
| Invitar y revocar profesionales | sí | sí | no |
| Facturación, plan y suscripción | sí | **no** | no |
| Configurar permisos de profesionales | sí | **no** | no |
| Invitar y quitar administradores | sí | **no** | no |

Un rol desconocido no tiene ningún permiso. No hay editor arbitrario de roles. El propietario no se puede degradar, quitar ni revocar desde ninguna acción; no hay transferencia de titularidad.

### Permisos configurables del profesional

Ver la propia agenda siempre. El propietario decide el resto, para todos o por excepción (`Organization.professionalPermissions`, `Professional.permissionOverrides`; predeterminados ← negocio ← excepción):

| Permiso | Predeterminado |
|---|:--:|
| Crear turnos propios | sí |
| Reprogramar turnos propios | sí |
| Cancelar turnos propios | **no** |
| Marcar atendido o ausente | sí |
| Escribir por WhatsApp a sus clientes | sí |
| Crear bloqueos y ausencias propias (nunca cancelan turnos) | sí |
| Modificar sus horarios de trabajo | **no** |
| Ver cuándo están ocupados sus compañeros (sin datos de clientes) | **no** |

Ningún valor guardado puede otorgar permisos de gestión: solo existen esas ocho claves y lo inválido se ignora.

## 4. Alcance de datos (`modules/access/scope.ts`)

- Propietario y administrador: todo lo de su negocio.
- Profesional: **sus turnos** y **los clientes que tienen turnos con él** (de ellos, solo esos turnos). Un identificador (de turno o de cliente) nunca alcanza: se busca siempre con el filtro del alcance, y un recurso fuera de él da «no encontrado».
- Del cliente ve nombre y teléfono (este último solo con el permiso de contacto); no ve el correo, las notas del cliente ni las notas internas del turno. No ve el historial con otros profesionales ni el listado completo de clientes.
- Compañeros (con el permiso): solo horarios ocupados («Ocupado 10:00 – 10:30»), sin nombres ni servicios ni teléfonos.
- Aplicado en: página «Hoy», agenda, turnos (listado, detalle, alta, reprogramación, cancelación, resultado), buscador y autocompletado de clientes, ficha de cliente, horarios, bloqueos, WhatsApp, y las acciones del servidor correspondientes. Las acciones de profesional ignoran el profesional que diga el formulario.
- Agendia no es una historia clínica: no se agregaron campos ni historiales.

## 5. Invitaciones (`modules/team/invitations.ts`)

Flujo: el propietario crea el perfil sin cuenta → «Acceso individual» → correo → enviar. La persona recibe un correo (Resend) con negocio, quién invita, plazo y un enlace; si no la esperaba, lo ignora.

- **Token:** 32 bytes aleatorios; solo se guarda su hash SHA-256; nunca se muestra en el panel ni se registra en logs o auditoría; de un solo uso; vence a los **7 días**; revocable; reenviar emite un token nuevo (el anterior deja de servir). Las páginas del enlace llevan `Referrer-Policy: no-referrer` y `noindex`.
- **Límites:** 20 invitaciones nuevas por negocio por hora; 3 por correo por día en toda la plataforma (nadie puede llenarle la casilla a otra persona); un reenvío por minuto y hasta 5 envíos por invitación; 60 aperturas del enlace por IP por hora y 20 aceptaciones por IP por hora.
- **Anti-enumeración:** un enlace inexistente, vencido, revocado o usado muestra el mismo mensaje. Quien invita solo se entera de si el correo ya es miembro de SU negocio.
- **Aceptar sin cuenta:** nombre y contraseña; el correo queda verificado (abrió el enlace); se entra directo a la agenda, sin registro comercial ni suscripción.
- **Aceptar con cuenta:** se inicia sesión (el login vuelve al enlace) y debe coincidir el correo; sus otros negocios no cambian. Con otra cuenta iniciada se avisa que es para otro correo.
- **Transaccional:** un bloqueo por invitación; se revalida todo al aceptar (invitación vigente, negocio con cuentas habilitadas y no suspendido, profesional existente, activo y sin cuenta, correo, sin membresía previa). Aceptaciones simultáneas: gana una; no queda nada a medias.
- **No consume cupo:** el perfil ya existía y ya contaba; un administrador no atiende. Las membresías administrativas no sirven para evadir los límites: atender requiere un perfil de profesional, que cuenta como siempre.
- **Estados** en Equipo: sin acceso individual · invitación pendiente · invitación vencida · cuenta vinculada · acceso revocado.
- **Administradores:** solo el propietario los invita y quita; empiezan sin los avisos de reservas del negocio.

## 6. Revocar acceso, desactivar y cancelar

Son tres cosas distintas. **Cancelar una invitación** invalida el enlace. **Revocar el acceso** borra la membresía de ESA persona en ESE negocio y nada más: el perfil, los horarios, los turnos, los clientes, el historial, las estadísticas y los servicios se conservan y la agenda sigue a cargo del negocio; corta el acceso en el siguiente pedido; cancela los avisos internos pendientes hacia esa cuenta; no toca sus otros negocios; no revoca a un propietario ni a un administrador desde ahí; y una reactivación posterior **no** devuelve el acceso (hay que invitar de nuevo). **Desactivar al profesional** (etapa 2) deja la membresía: la persona sigue entrando, ve un aviso («tu perfil está desactivado») y no recibe turnos nuevos.

## 7. Notificaciones internas (`resolveInternalRecipients`)

Cliente: igual que antes. Internos: propietario y administradores con avisos activados (si el negocio los tiene activos), cuando el cliente reserva, cambia o cancela; el profesional asignado con cuenta y avisos activos, de lo que le pasa a SUS turnos (también si lo cambia el negocio) y cuando le asignan uno, salvo lo que hizo él mismo; ningún otro profesional. Sin duplicados (un propietario que atiende recibe uno solo). Un profesional sin cuenta no cambia nada. Al reasignar se avisa al nuevo, no al anterior. **Se revalidan al enviar** (membresía vigente, avisos activos, turno todavía suyo). Cada persona configura sus avisos en «Mi cuenta/Mi perfil». Sin WhatsApp automático ni más correos por turno.

## 8. Auditoría

`audit_logs` (por negocio, actor, acción, momento; sin tokens ni contraseñas ni datos de clientes): `team.invitation.create|resend|revoke|accept`, `team.access.revoke`, `team.admin.remove`, `team.admin.notifications`, `team.permissions.update|override`, `team.appointment.reassign`, y las de etapas anteriores. Los horarios y bloqueos propios no se auditan individualmente (decisión de costo/ruido; ver riesgos).

## 9. Dashboard del profesional

Navegación propia: Hoy, Mi agenda, Mis turnos, Mis clientes (con el permiso de contactar), Mis horarios, Mi perfil. «Hoy» muestra turnos del día, atendidos, pendientes y el próximo. Las secciones de gestión redirigen a «Hoy». Mismos componentes responsivos que el resto. «Mi perfil»: cuenta, contraseña, avisos, cómo figura en el negocio (lo administra el negocio) y qué puede hacer.

## 10. Activación controlada

Dos interruptores independientes, ambos apagados por defecto: **modo equipo** (`TEAM_MODE_ENABLED` / `teamModeEnabled`) y **cuentas individuales** (`TEAM_ACCOUNTS_ENABLED` / `teamAccountsEnabled`). Se separan porque las cuentas abren la aplicación a personas que no son el propietario y conviene un piloto aparte. Habilitar un negocio de prueba: `node scripts/team-mode.mjs <enlace> on` y `... accounts-on` (queda en auditoría). El servidor exige el interruptor al invitar y al aceptar; apagarlo no borra cuentas. `ALLOW_INVITATIONS_WITHOUT_EMAIL=1` existe **solo** en `playwright.config.ts` (deja ver el enlace sin correo en la build de producción de las pruebas): nunca en una instalación real.

## 11. Migración y rollback

Migración `20261118000000_accounts_and_invitations` (aditiva, atómica, con una guarda previa): valor `professional` del rol, columnas nuevas, tabla `invitations`, unicidad de la cuenta por negocio (antes global), triggers e índices parciales. Los propietarios conservan su membresía y sus avisos; los datos no se tocan. Probada sobre una base con el esquema anterior (`test/accounts-migration.test.ts`).

**Volver a una versión anterior** (que admite una sola membresía por usuario y no tiene roles): esa versión malinterpretaría los accesos nuevos (no conoce `professional` y trataría a cualquier administrador como propietario). `scripts/prepare-rollback.mjs` ahora también aparta, **sin borrar datos**, las membresías que no son del propietario a `rollback_backup_memberships` (con el perfil al que estaban vinculadas); los profesionales conservan perfil, agenda y turnos y solo pierden la cuenta; `--restore` la devuelve. Los usuarios, las contraseñas y los negocios no se tocan; una persona con dos negocios como propietaria entraría al primero. Alternativa: corregir hacia adelante. No se ejecutó en producción.

## 12. Riesgos que quedan

- Un solo propietario por negocio y sin transferencia de titularidad.
- Las sesiones duran 30 días y no se pueden revocar una por una (sí al cambiar la contraseña); la autorización se resuelve en cada pedido, así que el acceso se corta igual.
- «Mis clientes»: un profesional conserva el acceso a los clientes con los que tuvo turnos aunque hayan sido hace tiempo (política: acceso mínimo a quienes atendió).
- El correo de invitación depende de Resend; sin él no se puede invitar en producción.
- Los cambios de horarios y bloqueos de un profesional no se auditan uno por uno.
- Sin autenticación de dos pasos ni inicio de sesión social.
- PWA y notificaciones push: no existen (ver abajo).

## 13. Mejora futura: instalación como aplicación (PWA)

No existe un manifiesto ni un service worker y no se implementó. Sería una mejora acotada para quienes consultan su agenda en el celular durante el día: manifiesto + icono (ya hay `public/icon.svg`), `display: standalone` y caché solo de recursos estáticos (nunca de datos de agenda). Las notificaciones push son otra decisión (proveedor, permisos y costo). La experiencia móvil de esta etapa ya es la base: barra inferior, botones táctiles, sesión persistente de 30 días.


## 14. Etapa 5: sesiones, auditoría, interruptores y avisos

**Sesiones revocables** (`lib/sessions.ts`, tabla `user_sessions`, migración `20261119000200_user_sessions`): cada inicio de sesión crea una fila y el JWT lleva su id (`sid`). `lib/dal.ts` la comprueba en la misma consulta que ya lee al usuario; una revocada deja de valer **en el siguiente pedido**. Desde «Mi cuenta» → «Sesiones abiertas» se puede cerrar una sesión o todas las demás; «Cerrar sesión» revoca solo la actual; cambiar o restablecer la contraseña cierra todas (`sessionVersion`). Los tokens anteriores (sin `sid`) siguen regidos por `sessionVersion`, así que desplegar no cierra sesiones ajenas. Se guarda solo «Chrome en Windows», nunca la IP. Un propietario **no** cierra sesiones de otra persona (puede tener otros negocios): le **revoca el acceso** al suyo, que corta de inmediato. Se purgan las sesiones inactivas o revocadas hace más de 40 días (solo de esta tabla).

**Auditoría:** ver `docs/SECURITY.md` (lista completa). `lib/audit.ts` (`recordAudit`) no guarda datos personales ni motivos escritos.

**Interruptores** (`lib/features.ts`): `TEAM_MODE_ENABLED`, `TEAM_ACCOUNTS_ENABLED` (globales) y sus equivalentes por negocio; `PUBLISH_TEAM_PLANS` activa ambos para todos según el plan; `TEAM_FEATURES_PAUSED` es el interruptor de emergencia. Una **instalación independiente** tiene siempre disponibles las funciones de equipo y cuentas, limitadas por el nivel de la licencia. Relación con plan y suscripción: `docs/COMMERCIAL.md` §3.

**Avisos internos:** las membresías nuevas (profesional o administrador) arrancan con `notifyBookings = false` (opt-in desde «Mi cuenta»); lo ya configurado no cambia.

**Solo lectura y turnos confirmados:** `requireScopedManage` / `canManageExisting` permiten cancelar y cerrar turnos ya confirmados con la prueba terminada o la suscripción cancelada; crear y mover siguen bloqueados; una cuenta suspendida no puede nada.

**Exceso de cupo:** un profesional restringido (`modules/team/capacity.ts`) conserva su cuenta, sus permisos y sus turnos confirmados; solo deja de recibir reservas nuevas. Ver `docs/COMMERCIAL.md` §6.

**Plataforma:** `/admin` y `/admin/negocios/<id>` verifican `isPlatformAdmin` en cada página y acción; son independientes de los administradores de un negocio.

**Acceso histórico a clientes y 2FA:** evaluación en `docs/SECURITY.md`.
