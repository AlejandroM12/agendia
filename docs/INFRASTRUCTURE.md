# Infraestructura de producción — Agendia

> Este documento define **cómo se opera Agendia en producción**: proveedor de hosting, topología app/DB/worker, CI/CD, backups, monitoreo, costos y la checklist de lanzamiento. La arquitectura de aplicación (patrones de código) sigue en `ARCHITECTURE.md`; la seguridad y el aislamiento multi-tenant en detalle están en `SECURITY.md`. Las decisiones puntuales (confirmadas y pendientes de aprobación) se registran, como siempre, en `DECISIONS.md`.
>
> **Nada de este documento está desplegado todavía.** Es una propuesta para revisión. Los números de costo son estimaciones de mercado a la fecha de redacción (noviembre de 2026), no cotizaciones confirmadas — antes de contratar cualquier servicio, hay que verificar el precio vigente en la página oficial del proveedor.

## 1. Diagnóstico de la arquitectura actual (Fase 1)

Lo construido en la Fase 1 es sólido para desarrollo, pero tiene tres puntos de fricción de cara a producción 24/7:

1. **El diseño del worker de notificaciones (D-13) existe para rodear una limitación de Vercel**, no porque sea la forma más simple de resolver el problema. El patrón outbox (tabla `Notification` + idempotencia) es buena práctica igual, pero la necesidad de invocarlo vía Vercel Cron en vez de un proceso persistente es una complejidad que desaparece si se elige una plataforma que sí soporte procesos de larga duración.
2. **Vercel Cron en el plan gratuito ("Hobby") solo permite una ejecución por día.** Para recordatorios y reconciliación de pagos con una cadencia razonable (minutos, no una vez al día) hace falta el plan Pro (de pago). Esto no estaba explicitado en `DECISIONS.md` D-04 cuando se eligió Vercel como "opción inicial".
3. **Neon (PostgreSQL serverless) escala a cero por diseño** cuando no hay actividad, salvo que se configure explícitamente un cómputo mínimo mayor a cero (lo cual tiene costo). Es decir: el mismo patrón de "suspensión por inactividad" que se quiere evitar en el hosting de la app puede reaparecer en la base de datos si no se configura con cuidado.

Ninguno de estos tres puntos es un defecto de diseño del producto — son consecuencias de haber elegido, en la Fase 1, una combinación optimizada para "arrancar gratis", no para "operar un servicio comercial 24/7". Ahora que Agendia es un producto real de AtajoLab, vale la pena revisar esa elección con los requisitos reales sobre la mesa.

No hay deuda técnica grave en el código: el monolito modular, el aislamiento por organización a nivel de aplicación, la prevención de solapamientos a nivel de base de datos y el patrón de autenticación son independientes de qué proveedor de hosting se use — se trasladan sin cambios a cualquiera de las opciones evaluadas abajo.

## 2. Comparación de opciones de hosting

| Opción | Costo inicial estimado* | Siempre activo | Complejidad operativa | Encaje con el diseño actual |
|---|---|---|---|---|
| **A. Vercel Pro + Neon (plan pago, sin autosuspend)** | ~US$40–55/mes | Sí, pero requiere configurar explícitamente Neon sin autosuspend (costo adicional) y pasar a Vercel Pro para cron frecuente | Muy baja (sin servidores que mantener) | Requiere mantener la complejidad del worker vía Cron (D-13) |
| **B. Railway (app + worker + PostgreSQL en una sola plataforma)** | ~US$20–30/mes | Sí — los servicios no se suspenden por inactividad, se cobra por uso real | Baja (una sola plataforma, deploy automático desde GitHub, backups de PostgreSQL incluidos) | Simplifica el worker: puede ser un proceso Node persistente real, sin Cron externo |
| **C. VPS (Hetzner) + Docker Compose propio** | ~US$8–12/mes | Sí, control total | Media-alta (parcheo de OS, TLS, backups y monitoreo a cargo nuestro) | Reutiliza exactamente el empaquetado ya planeado para la instalación standalone (Fase 6) |

\* Estimaciones de mercado a noviembre de 2026, con fuentes de terceros que entre sí no siempre coinciden (ver sección 12). **Verificar precio vigente antes de contratar.**

**Recomendación: Opción B (Railway) para el lanzamiento inicial**, con la Opción C (VPS + Docker Compose) como camino de evolución natural una vez que el paquete standalone de la Fase 6 exista (en ese momento, reutilizarlo para la propia infraestructura del SaaS no cuesta nada adicional de diseño). La Opción A se mantiene documentada como alternativa válida si se prefiere no migrar de proveedor respecto a lo ya definido en `DECISIONS.md` D-04 — ver la decisión pendiente D-23 para el detalle de la propuesta de cambio y sus razones.

**Por qué no Railway + VPS desde el día uno combinados:** sería introducir dos plataformas a la vez sin necesidad (va contra "priorizar simplicidad operativa"). Empezar en una sola plataforma administrada y migrar a VPS más adelante, cuando el volumen lo justifique económicamente, es más simple que operar ambas en paralelo desde el principio.

## 3. Arquitectura de producción propuesta (sobre Railway)

```
┌─────────────────────────────┐
│        GitHub (main)         │
└──────────────┬───────────────┘
               │ push → deploy automático
               ▼
┌─────────────────────────────────────────────┐
│                   Railway                     │
│  ┌───────────────┐   ┌─────────────────────┐ │
│  │  Servicio web  │   │  Servicio worker     │ │
│  │  (next start)  │   │  (proceso Node       │ │
│  │                │   │   persistente)       │ │
│  └───────┬────────┘   └──────────┬───────────┘ │
│          │                       │             │
│          └───────────┬───────────┘             │
│                       ▼                         │
│            ┌─────────────────────┐             │
│            │   PostgreSQL          │             │
│            │   (managed, backups   │             │
│            │    automáticos)       │             │
│            └─────────────────────┘             │
└─────────────────────────────────────────────┘
          │                              │
          ▼                              ▼
   Resend (email)              Mercado Pago (webhooks)
```

- **Servicio web:** la app Next.js corriendo como servidor Node normal (`next start`), no como funciones serverless. Esto es exactamente lo mismo código que hoy, sin cambios de arquitectura de aplicación.
- **Servicio worker:** un proceso Node separado (mismo repositorio, mismo código de `modules/notifications`, un entry point distinto) que reemplaza la invocación por Vercel Cron de D-13. Sigue usando el patrón outbox (tabla `Notification`, `idempotencyKey`, reintentos con backoff) — eso no cambia; lo que cambia es que ahora puede ser un `setInterval` o `node-cron` dentro de un proceso que vive permanentemente, sin la complejidad de disparar una ruta HTTP externa.
- **Base de datos:** PostgreSQL administrado por Railway, con backups automáticos incluidos en el plan. Mismo esquema, misma estrategia de exclusion constraint para solapamientos (`ARCHITECTURE.md` §5) — eso es una garantía de PostgreSQL, no de la plataforma que lo aloja.

Separar web y worker en dos servicios (en vez de un solo proceso que haga ambas cosas) es la única división que se propone — **no** son microservicios con API propia entre sí: ambos leen/escriben la misma base de datos a través del mismo código Prisma, y no se comunican directamente entre ellos. Es la forma más simple de evitar que un recordatorio de email bloquee una request HTTP, sin introducir una cola externa (Redis/BullMQ) todavía.

## 4. Colas, reintentos e idempotencia (confirmación del diseño, independiente del hosting)

El patrón ya documentado en `ARCHITECTURE.md` §4 se mantiene sin cambios conceptuales:

- Toda notificación o evento de pago se persiste **antes** de intentar procesarse (outbox), con una `idempotencyKey` única.
- Reintentos con backoff y tope máximo de intentos; tras agotarlos, el registro queda en `failed` con el error, nunca en un reintento infinito.
- Reprocesar el mismo evento (por una entrega duplicada de Mercado Pago, o por un reinicio del worker a mitad de un lote) nunca produce un efecto duplicado, porque la idempotencia se verifica contra la base de datos antes de actuar.

Lo único que cambia con la Opción B es el *disparador*: un proceso persistente que recorre la tabla cada N segundos, en vez de una invocación HTTP externa programada. La interfaz de `modules/notifications` no cambia.

## 5. Mercado Pago: webhooks y reconciliación (diseño, implementación en Fase 5)

**Validación de firma:** cada notificación llega con un header `x-signature` (timestamp + hash HMAC) y un header `x-request-id`. Antes de procesar cualquier notificación:
1. Reconstruir el manifiesto esperado a partir de `data.id` (query param), `x-request-id` y el timestamp.
2. Calcular el HMAC con el secreto del webhook (`MERCADOPAGO_WEBHOOK_SECRET`, nunca el access token) y compararlo con el hash recibido.
3. Si no coincide, responder `401` sin procesar nada. Si coincide, responder `200` cuanto antes (Mercado Pago reintenta notificaciones no confirmadas durante un tiempo acotado tras errores 5xx o timeouts) y procesar el evento de forma asíncrona si hace falta.

**Idempotencia:** cada notificación trae un `id` único de Mercado Pago. Se persiste en una tabla de eventos de webhook (`id`, `type`, `payload`, `processedAt`) antes de actuar; si el mismo `id` ya fue procesado, se responde `200` sin repetir el efecto.

**No confiar en el payload del webhook para el estado final:** el webhook solo avisa que algo cambió (`topic` + `id`). El estado real de la suscripción o el pago se confirma siempre con una consulta a la API de Mercado Pago usando ese `id`, nunca con los datos que vinieron en la notificación. Esto evita problemas si alguien falsifica un payload que de todas formas no pasó la validación de firma, y evita procesar datos obsoletos si llegan notificaciones fuera de orden.

**Reconciliación:** además de los webhooks, un job periódico (diario) recorre las `Subscription` con `mercadoPagoSubscriptionId` y compara su estado contra la API de Mercado Pago, corrigiendo cualquier discrepancia (webhook perdido, entrega fallida, etc.). Esto es la red de seguridad frente a webhooks que nunca llegaron.

Nada de esto se activa con cobros reales hasta la Fase 5, con tu aprobación explícita (ver `DECISIONS.md` D-09) — este diseño se documenta ahora para no tener que rediseñar el modelo de datos de `Subscription` más adelante.

## 6. CI/CD desde GitHub

```
PR abierto ──► GitHub Actions: lint + typecheck + test + build  (siempre)
                                        │
                                   ✔ todo pasa
                                        ▼
Merge a main ──► deploy automático a producción (Railway/Vercel, nativo de la plataforma)
                                        │
                                        ▼
                         prisma migrate deploy (paso de release, antes de servir tráfico nuevo)
```

- **CI en cada PR:** un workflow de GitHub Actions corre `npm run lint`, `npm run typecheck`, `npm test` y `npm run build`. Nada se despliega desde aquí — es exactamente lo que ya se ejecuta manualmente en cada fase, ahora automatizado. El plan gratuito de GitHub Actions (minutos mensuales incluidos) alcanza sobradamente para el tamaño actual del proyecto.
- **Staging:** una base de datos separada (nunca la misma que producción) y un entorno de deploy separado (rama `staging` o un entorno dedicado de la plataforma), con las mismas variables de entorno que producción salvo `DATABASE_URL` y las credenciales de Mercado Pago (modo sandbox en staging).
- **Migraciones:** `prisma migrate deploy` corre como paso de release contra staging automáticamente en cada deploy a esa rama. Contra producción, requiere una aprobación manual (un "environment" protegido en GitHub Actions, o el equivalente de la plataforma elegida) — nunca una migración automática sin un humano confirmando.
- **Rollback:** tanto Railway como Vercel permiten volver instantáneamente al deploy anterior (rollback a nivel de aplicación). Para el esquema de base de datos, la regla es **expand/contract**: los cambios que podrían romper compatibilidad (borrar una columna o tabla) se despliegan en un paso posterior, solo después de confirmar que el código que dejó de necesitarlos ya está estable en producción — nunca en el mismo deploy que introduce el cambio.

## 7. Variables de entorno y secretos

| Variable | Dónde vive | Notas |
|---|---|---|
| `DATABASE_URL` | Secret de la plataforma (prod/staging separados) | Nunca en el repositorio. |
| `AUTH_SECRET` | Secret de la plataforma | Rotarlo invalida todas las sesiones activas — documentar como procedimiento de emergencia. |
| `RESEND_API_KEY` | Secret de la plataforma | Se incorpora en la Fase 4. |
| `MERCADOPAGO_ACCESS_TOKEN` | Secret de la plataforma | Se incorpora en la Fase 5, con tu aprobación. |
| `MERCADOPAGO_WEBHOOK_SECRET` | Secret de la plataforma | Nunca el access token — son credenciales distintas. |
| `DEPLOYMENT_MODE` | Variable de entorno normal (no sensible) | `saas` en producción/staging. |

Reglas, ya parcialmente establecidas en `ARCHITECTURE.md` §10 y reconfirmadas para producción:
- Ningún secreto se referencia con el prefijo `NEXT_PUBLIC_` (eso lo expondría al bundle del cliente).
- CI usa secrets cifrados de GitHub Actions (nunca variables en texto plano en el workflow).
- Staging y producción tienen secretos **distintos** — un secreto de staging filtrado no compromete producción.
- Antes del lanzamiento comercial, se hace un simulacro de rotación de `AUTH_SECRET` y de las credenciales de Mercado Pago, para confirmar que el procedimiento funciona antes de necesitarlo de verdad.

## 8. Backups, restauración, monitoreo, logs y alertas

**Backups:**
- Backup lógico diario (`pg_dump`), con retención de 7 copias diarias + 4 semanales, independiente del backup nativo de la plataforma elegida (defensa en profundidad: un backup propio sobrevive aunque haya un problema con el proveedor).
- Simulacro de restauración mensual: restaurar el backup más reciente en una base temporal y verificar que la aplicación levanta contra esa copia. Un backup que nunca se probó restaurar no es un backup confiable.

**Monitoreo:**
- Un endpoint `/api/health` (nuevo, liviano) que verifica conectividad a la base de datos, usado por un monitor externo de uptime (con plan gratuito alcanza para esta escala) y por el panel nativo de la plataforma.
- Métricas nativas de la plataforma (CPU, memoria, latencia) como primera línea — no se introduce una herramienta de observabilidad adicional hasta que el volumen la justifique.

**Logs:**
- Sin datos sensibles (ya establecido en `ARCHITECTURE.md` §10): sin contraseñas, tokens, ni datos de contacto completos.
- Visor de logs nativo de la plataforma al inicio; se reevalúa una herramienta dedicada (ej. Better Stack, Axiom) si el volumen de logs lo justifica.

**Alertas:**
- Fallo de deploy → notificación automática (la plataforma lo hace nativamente).
- Caída del `/api/health` → alerta del monitor de uptime.
- Notificaciones o webhooks de pago en estado `failed` por encima de un umbral → se revisa en el panel de administración SaaS (Fase 5); no se introduce una herramienta de alertas separada en esta etapa.

## 9. Preparación para la instalación independiente (Fase 6)

La Opción B (Railway) no compite con la Fase 6: el código de la aplicación es el mismo en ambos modos (`DEPLOYMENT_MODE=saas|standalone`, ya definido en `ARCHITECTURE.md` §1). Lo único que agrega valor cruzado es escribir el `Dockerfile` y el `docker-compose.yml` de la instalación standalone con calidad de producción desde la Fase 6 (no antes: no corresponde a este documento, que es solo de planificación) — si en el futuro se decide migrar el propio SaaS a la Opción C (VPS), ese mismo empaquetado se reutiliza sin rediseño.

## 10. Checklist de lanzamiento (habilitar clientes reales)

No se tacha ningún punto todavía — esto es la lista de verificación para cuando se apruebe pasar a producción:

- [ ] Proveedor de hosting e infraestructura aprobado y contratado (ver D-23).
- [ ] Migraciones aplicadas en producción y verificadas contra `DATABASE_DESIGN.md`.
- [ ] Variables de entorno de producción configuradas, sin ningún secreto en el repositorio.
- [ ] `/api/health` respondiendo y monitor de uptime configurado.
- [ ] Backup diario funcionando y restauración probada al menos una vez.
- [ ] Alertas de fallo de deploy y de caída configuradas.
- [ ] CI (lint + typecheck + test + build) verde en `main` antes de cada deploy.
- [ ] Dominio propio configurado con TLS válido.
- [ ] Rate limiting activo en endpoints públicos (reserva, login) — ver `SECURITY.md`.
- [ ] Simulacro de rotación de `AUTH_SECRET` ejecutado al menos una vez.
- [ ] Revisión de seguridad (`SECURITY.md`) sin pendientes críticos.
- [ ] Política de retención de datos en estado `locked` resuelta (D-11) antes de aceptar el primer cliente real.
- [ ] Términos de servicio y política de privacidad publicados (contenido legal — no es un entregable técnico, pero bloquea aceptar pagos reales).

## 11. Costos estimados y escenarios de crecimiento

| Escenario | Railway (B) | Vercel Pro + Neon pago (A) | VPS Hetzner (C) |
|---|---|---|---|
| **Lanzamiento** (<20 organizaciones, tráfico bajo) | ~US$20–30/mes | ~US$40–55/mes | ~US$8–12/mes |
| **Crecimiento** (50–200 organizaciones) | ~US$40–70/mes | ~US$60–100+/mes (cómputo de Neon crece con el uso sostenido) | ~US$12–20/mes (servidor un poco más grande) |
| **Escala** (500+ organizaciones, justifica Redis para rate limiting — D-10) | + ~US$10–15/mes por Redis administrado | + ~US$10–15/mes por Redis administrado | + ~US$10–15/mes por Redis, más esfuerzo propio de balanceo de carga |

A esto se suma, en todos los escenarios: dominio (~US$10–15/año), Resend (nivel gratuito alcanza al inicio) y, desde la Fase 5, las comisiones de Mercado Pago sobre cada cobro (no son un costo de infraestructura, son un costo variable del negocio).

## 12. Fuentes y nivel de confianza de los costos

Los números de este documento vienen de búsquedas de mercado realizadas en noviembre de 2026, principalmente de agregadores de terceros (no siempre de las páginas oficiales de cada proveedor), y varias fuentes no coinciden entre sí. Antes de aprobar un presupuesto, hay que confirmar el precio vigente en:
- `railway.com/pricing`
- `vercel.com/pricing` y `vercel.com/docs/cron-jobs/usage-and-pricing`
- `neon.com/pricing`
- `hetzner.com/cloud`

Este documento no reemplaza esa verificación — la resume para poder comparar opciones y aprobar una dirección, no para fijar un presupuesto exacto todavía.
