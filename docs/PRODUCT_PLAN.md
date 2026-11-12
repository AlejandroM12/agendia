# Plan de producto — Agendia

> Este documento define el **producto**: para quién es, qué incluye el MVP, el modelo comercial y los flujos de usuario. Las decisiones técnicas de implementación viven en `ARCHITECTURE.md` y `DATABASE_DESIGN.md`. El registro de decisiones confirmadas/pendientes vive en `DECISIONS.md`. El detalle de fases vive en `ROADMAP.md`.

## 1. Resumen ejecutivo

**Agendia** («Tu agenda, más simple») es una plataforma SaaS multi-tenant para gestión de turnos, reservas online y recordatorios automáticos, dirigida a profesionales independientes y pequeños negocios de cualquier rubro que trabaje mediante citas (peluqueros, manicuristas, centros de estética, psicólogos, nutricionistas, kinesiólogos, profesores particulares, entrenadores personales, consultorios, técnicos, etc.). No es una app vertical para un solo rubro: es genérica y configurable.

El profesional debe poder empezar a usarla en minutos, sin conocimientos técnicos. El cliente final debe poder reservar un turno desde el teléfono sin instalar nada ni registrarse.

Se comercializa en dos modalidades sobre el mismo código base:
- **Suscripción mensual (SaaS alojado)** — nosotros operamos hosting, base de datos e infraestructura.
- **Compra única con instalación independiente (standalone)** — el cliente aloja el software bajo licencia de uso, sin transferencia de código fuente.

## 2. Alcance definitivo del MVP

**Incluido:**
- Landing comercial completa en `/`, obligatoria desde el día uno (ver sección 6).
- Registro con email + contraseña, recuperación de contraseña, sesiones seguras.
- Onboarding guiado: negocio, rubro, servicios, duración, horarios, slug público.
- Activación y vencimiento de la prueba gratuita de 7 días, controlados desde servidor, **implementados junto con registro/onboarding** (la integración de cobro real queda para una fase posterior — ver `ROADMAP.md`).
- Servicios (alta, edición, activo/inactivo).
- Disponibilidad: reglas semanales recurrentes + excepciones puntuales (bloqueos, días no laborables).
- Agenda manual completa (crear, editar, reprogramar, cancelar, completar, marcar ausente, notas internas).
- Reserva pública en `/reservar/[slug]`, sin login ni contraseña del cliente, compartiendo la misma disponibilidad que la agenda manual.
- Prevención de solapamientos con garantía a nivel de base de datos (no solo validación de interfaz).
- Gestión de clientes (alta simple, historial, observaciones, sin fusión automática de duplicados).
- Notificaciones automáticas por email: confirmación, cancelación, reprogramación y recordatorio 24h antes, con reintentos e idempotencia.
- Panel de administración SaaS básico: cuentas registradas, estado de prueba/suscripción, suspender/reactivar cuentas.

**Fuera del MVP (arquitectura preparada para incorporarlo sin rediseño):**
- Envío real de WhatsApp (solo abstracción de canal, sin simulación de envíos).
- Múltiples profesionales por organización, equipos, sucursales, roles complejos.
- Cobro real vía Mercado Pago (se modela el esquema de suscripción y webhooks, idempotentes, pero sin activar cobro en producción hasta aprobar la estrategia comercial).
- Empaquetado e instalación standalone (Docker Compose, licencias firmadas) — se diseña ahora, se implementa en la Fase 6.
- Proveedores de autenticación adicionales a email/contraseña.

## 3. Modelo comercial

### A. Prueba gratuita (7 días)
- Se activa automáticamente al completar el registro.
- No requiere tarjeta.
- Inicio y vencimiento calculados y validados en servidor (nunca confiados al cliente).
- El dashboard muestra días restantes y avisos de próximo vencimiento.
- **Al vencer:** la organización pasa a un período de **acceso de solo lectura de 30 días**. Durante ese período puede consultar sus datos (turnos, clientes, historial) pero no crear ni modificar operaciones (nuevos turnos, nuevas reservas públicas quedan deshabilitadas). No hay eliminación automática de datos en ningún momento.
- Pasado ese período de solo lectura sin contratar una suscripción, la cuenta queda bloqueada (sin acceso operativo), pero los datos se conservan hasta que se defina y apruebe una política de retención a largo plazo.
- Reactivar una suscripción restaura el acceso completo sin pérdida de datos.

### B. Suscripción mensual (SaaS)
- Pago recurrente mensual. Nosotros operamos toda la infraestructura.
- Integración con Mercado Pago preparada a nivel de modelo de datos y webhooks idempotentes desde ahora; activación de cobros reales en una fase posterior, con tu aprobación explícita.
- Estados contemplados: activa, pago pendiente, pago vencido, cancelada, renovación, período de regularización.
- El acceso se controla siempre desde el servidor, nunca solo desde el frontend.

### C. Compra única con instalación independiente (standalone)
- Licencia de uso del software, instalado en infraestructura del cliente vía Docker Compose.
- No incluye transferencia de código fuente.
- Licencia verificable localmente, sin requerir conexión permanente a nuestros servidores, firmada digitalmente (Ed25519 — ver `ARCHITECTURE.md` y `DECISIONS.md`).
- Hosting, dominio, soporte y actualizaciones se presupuestan por separado.

### Precios
Configurables mediante un modelo de planes en base de datos. No se definen cifras en esta etapa.

## 4. Landing comercial (`/`)

Es la página de entrada del dominio principal — nunca un login directo — y parte obligatoria del MVP, orientada a convertir visitantes en usuarios.

**Secciones:**
1. **Header:** logo, funcionalidades, cómo funciona, precios, iniciar sesión, CTA destacado "Probar gratis 7 días".
2. **Hero:** propuesta de valor directa (ej. "Tus turnos organizados. Tus clientes siempre informados."), subtítulo explicativo, CTA principal "Comenzar gratis" y secundario "Ver cómo funciona", vista previa visual del dashboard y de la experiencia de reserva.
3. **Beneficios:** menos tiempo organizando turnos, reservas 24hs, agenda centralizada, recordatorios automáticos, menos tareas administrativas, mejor experiencia para los clientes. Sin promesas cuantificadas sin evidencia (ej. no afirmar reducción de ausencias).
4. **Funcionalidades:** agenda inteligente, reservas online, gestión de clientes, servicios personalizados, horarios configurables, recordatorios automáticos, reprogramación y cancelaciones.
5. **Cómo funciona (3 pasos):** crear cuenta y configurar servicios → compartir enlace de reservas → administrar turnos desde cualquier dispositivo.
6. **Para quién es:** variedad de rubros, sin limitar el producto a ninguno.
7. **Precios:** prueba gratuita 7 días, suscripción mensual, compra única con instalación independiente — valores configurables, sin cifras definitivas todavía.
8. **FAQ:** funcionamiento de la prueba, si requiere tarjeta, cómo reciben turnos los profesionales, cómo reservan los clientes, qué pasa al vencer la prueba (acceso de solo lectura de 30 días), diferencia entre suscripción y compra única, qué incluye la instalación independiente.
9. **CTA final:** invitación a iniciar la prueba gratuita.
10. **Footer:** navegación, contacto, información comercial, enlaces legales configurables.

**Requisitos de diseño:** mobile-first, diseño premium, animaciones sutiles, tipografía cuidada, jerarquía visual clara, componentes reutilizables, buen contraste, accesibilidad, SEO técnico, Open Graph, metadatos, optimización de imágenes, buen rendimiento (Core Web Vitals). Sin testimonios, clientes ni integraciones inventadas.

**Identidad resuelta (ver `DECISIONS.md`, D-01):** nombre comercial **Agendia**, eslogan provisional «Tu agenda, más simple», paleta celeste/blanco/grises (primary `#0284C7`, primary light `#E0F2FE`, surface `#F8FAFC`, border `#E2E8F0`, texto `#0F172A`), tipografía Geist. La configuración de marca está centralizada en `lib/brand.ts` y los tokens de color en `app/globals.css`, para poder cambiarla sin tocar el resto del código.

## 5. Mapa de rutas

**Públicas:**
`/` · `/precios` · `/login` · `/registro` · `/reservar/[slug]` · `/cancelar/[token]` · `/reprogramar/[token]`

**Profesional (requiere sesión + organización activa):**
`/dashboard` · `/dashboard/onboarding` · `/dashboard/agenda` · `/dashboard/turnos` · `/dashboard/clientes` · `/dashboard/servicios` · `/dashboard/disponibilidad` · `/dashboard/recordatorios` · `/dashboard/configuracion` · `/dashboard/facturacion`

**Administración SaaS (deshabilitada en modo standalone):**
`/admin` · `/admin/usuarios` · `/admin/suscripciones` · `/admin/licencias` · `/admin/pagos` · `/admin/configuracion`

**APIs internas relevantes:**
`/api/booking/[slug]/slots` (disponibilidad en tiempo real) · `/api/cron/notifications` (procesamiento del worker de notificaciones) · `/api/webhooks/mercadopago`

Los enlaces de cancelación/reprogramación usan un token opaco por turno, no el slug ni un ID adivinable.

## 6. Flujos principales de usuario

1. **Alta de profesional:** landing → "Probar gratis" → registro → onboarding (negocio, rubro, servicios, duración, horarios, slug) → dashboard con prueba activa contada desde servidor.
2. **Reserva pública:** cliente abre `/reservar/[slug]` → ve servicios activos → elige servicio → ve horarios disponibles calculados en servidor → completa nombre y contacto → confirma → recibe email de confirmación con enlaces de cancelación/reprogramación.
3. **Gestión manual de turno:** el profesional crea/edita un turno desde el dashboard usando las mismas reglas de disponibilidad y solapamiento que la reserva pública (un único camino de validación, no dos lógicas distintas).
4. **Recordatorio automático:** al confirmarse un turno se programa un recordatorio 24h antes; si el turno se cancela o reprograma, el recordatorio pendiente se recalcula o se cancela — nunca se envía un recordatorio de un turno cancelado.
5. **Vencimiento de prueba:** a los 7 días la cuenta pasa a solo lectura (30 días) según una política centralizada de acceso, no validaciones dispersas; el profesional puede contratar una suscripción para recuperar el acceso completo sin perder datos.

## 7. Para quién es

El producto debe presentarse en la landing mostrando diversidad de rubros (estética, salud, educación, bienestar, servicios técnicos) sin posicionarse como una solución vertical de ninguno de ellos en particular.
