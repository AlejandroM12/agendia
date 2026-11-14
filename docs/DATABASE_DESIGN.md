# Modelo de datos — Agendia

> Este documento define exclusivamente el **modelo de datos conceptual**. Las decisiones de infraestructura y patrones de ejecución están en `ARCHITECTURE.md`. No es un `schema.prisma` real todavía — es la referencia para construirlo en la Fase 1.

## 1. Principios del modelo

- Multi-tenant por `Organization`: toda tabla con datos privados referencia `organizationId` (directa o indirectamente vía `professionalId`), y toda consulta debe filtrar por ese campo del lado del servidor.
- El MVP restringe a **un `Professional` activo por `Organization`**, pero el modelo admite N `User`/`Membership` por organización desde ahora, para no rediseñar al incorporar equipos.
- Timestamps en UTC; la interpretación horaria depende del `timezone` de la `Organization` (default `America/Argentina/Buenos_Aires`).
- Los enlaces públicos sensibles (cancelar/reprogramar turno) usan tokens opacos, nunca IDs secuenciales.

## 2. Entidades

### Organization
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid | |
| name | string | |
| slug | string, único | base del enlace público (`/reservar/[slug]`) |
| timezone | string (IANA) | default `America/Argentina/Buenos_Aires` |
| deploymentMode | enum: `saas` \| `standalone` | informativo; el comportamiento real lo define la env var de la app |
| trialStartedAt | datetime | |
| trialEndsAt | datetime | calculado en servidor al registrarse (+14 días) |
| status | enum: `trial` \| `trial_readonly` \| `locked` \| `active` \| `past_due` \| `canceled` \| `suspended` | ver sección 4 |
| readonlyUntil | datetime, nullable | fin del período de 30 días de solo lectura tras `trial` |
| createdAt | datetime | |

### User
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid | |
| email | string, único | |
| passwordHash | string | bcrypt/argon2 |
| name | string | |
| createdAt | datetime | |

### PasswordResetToken
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid | |
| userId | uuid (FK User) | |
| tokenHash | string | el token en claro nunca se persiste |
| expiresAt | datetime | corta duración (ej. 1 hora) |
| usedAt | datetime, nullable | invalidado tras uso |

### Membership
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid | |
| organizationId | uuid (FK) | |
| userId | uuid (FK) | |
| role | enum: `owner` \| `admin` | simple en el MVP; deja lugar a roles de equipo futuros |

### Professional
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid | |
| organizationId | uuid (FK) | |
| displayName | string | |
| bio | string, opcional | |
| publicSlug | string, único | puede coincidir con el slug de la organización en el MVP (1 profesional = 1 org) |
| active | boolean | |

### Service
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid | |
| professionalId | uuid (FK) | |
| name | string | |
| description | string, opcional | |
| durationMinutes | int | |
| price | decimal, opcional | |
| active | boolean | servicios inactivos no aparecen en nuevas reservas públicas |

### AvailabilityRule (recurrente semanal)
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid | |
| professionalId | uuid (FK) | |
| weekday | int (0-6) | |
| startTime | time | |
| endTime | time | |

### AvailabilityException (puntual)
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid | |
| professionalId | uuid (FK) | |
| date | date | |
| type | enum: `block_full_day` \| `block_range` | |
| startTime | time, opcional | solo si `block_range` |
| endTime | time, opcional | solo si `block_range` |
| reason | string, opcional | nota interna |

### Customer
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid | |
| organizationId | uuid (FK) | |
| name | string | |
| email | string, opcional | |
| phone | string, opcional | |
| notes | string, opcional | observaciones internas |
| createdAt | datetime | |

### Appointment
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid | |
| organizationId | uuid (FK) | |
| professionalId | uuid (FK) | |
| serviceId | uuid (FK) | |
| customerId | uuid (FK) | |
| startsAt | datetime (UTC) | |
| endsAt | datetime (UTC) | |
| status | enum: `confirmed` \| `completed` \| `canceled` \| `no_show` | sin estado "pendiente" en el MVP: una reserva pública confirma directamente si el horario está disponible |
| source | enum: `manual` \| `public_booking` | |
| cancelToken | string, único, opaco | usado en `/cancelar/[token]` y `/reprogramar/[token]` |
| notes | string, opcional | notas internas del profesional |
| createdAt / updatedAt | datetime | |

**Constraint crítica:** exclusion constraint en PostgreSQL sobre `(professionalId, tsrange(startsAt, endsAt))` para turnos no cancelados, vía extensión `btree_gist`. Ver `ARCHITECTURE.md` sección 5.

### Notification
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid | |
| appointmentId | uuid (FK) | |
| type | enum: `confirmation` \| `cancellation` \| `reschedule` \| `reminder_24h` | |
| channel | enum: `email` \| `whatsapp` | `whatsapp` reservado, sin implementación activa |
| scheduledFor | datetime | |
| status | enum: `pending` \| `sent` \| `failed` \| `canceled` | |
| attempts | int | |
| lastError | string, opcional | |
| sentAt | datetime, opcional | |
| idempotencyKey | string, único | evita envíos duplicados ante reprocesamiento |

### Plan
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid | |
| name | string | |
| priceMonthly | decimal | configurable, sin valores definitivos aún |
| currency | string | |
| features | json | |
| maxProfessionals | int | |

### Subscription
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid | |
| organizationId | uuid (FK) | |
| planId | uuid (FK) | |
| status | enum: `active` \| `pending` \| `past_due` \| `canceled` | |
| mercadoPagoSubscriptionId | string, opcional | se completa al activar la integración real |
| currentPeriodEnd | datetime | |
| createdAt | datetime | |

### License (modalidad standalone — Fase 6)
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid | |
| organizationId | uuid (FK) | |
| productId | string | |
| scope | string | |
| maxProfessionals | int | |
| featuresEnabled | json | |
| issuedAt | datetime | |
| expiresAt | datetime, opcional | |
| signature | string | firma Ed25519 |
| publicKeyId | string | referencia a la clave pública embebida que valida la firma |

### AuditLog
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid | |
| organizationId | uuid (FK), opcional | |
| userId | uuid (FK), opcional | |
| action | string | |
| entityType | string | |
| entityId | uuid | |
| metadata | json | |
| createdAt | datetime | |

## 3. Relaciones (resumen)

```
Organization 1──N User (vía Membership)
Organization 1──1 Professional   (regla del MVP; el modelo soporta 1──N)
Professional 1──N Service
Professional 1──N AvailabilityRule
Professional 1──N AvailabilityException
Organization 1──N Customer
Professional 1──N Appointment ──N Service, ──1 Customer
Appointment 1──N Notification
Organization 1──1 Subscription (activa a la vez)
Organization 1──1 License (modo standalone)
```

## 4. Estados de `Organization.status` (ciclo comercial)

```
trial ──(14 días)──► trial_readonly ──(30 días, solo lectura)──► locked
  │                                                                │
  └─────────────────► active (al contratar suscripción) ◄─────────┘
active ──► past_due ──► canceled / regularización ──► active
```

- `trial`: acceso completo.
- `trial_readonly`: solo lectura (consulta de turnos/clientes/historial); sin alta de turnos nuevos ni reservas públicas nuevas. Duración: 30 días.
- `locked`: sin acceso operativo; los datos se conservan (sin eliminación automática) hasta definir una política de retención a largo plazo.
- `active`: suscripción vigente, acceso completo.
- La transición entre estados se evalúa en un único punto centralizado del servidor, no en validaciones dispersas por pantalla.
