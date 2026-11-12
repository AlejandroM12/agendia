# Agendia

Plataforma SaaS de turnos, reservas online y recordatorios automáticos para profesionales
independientes. Ver `docs/` para la planificación completa (producto, arquitectura, modelo de
datos, roadmap y registro de decisiones).

## Stack

Next.js (App Router) · TypeScript · Tailwind CSS · shadcn/ui · PostgreSQL · Prisma 7 ·
Auth.js (NextAuth v5) · Zod.

## Requisitos

- Node.js 20+
- PostgreSQL alcanzable (en desarrollo, un contenedor Docker local es suficiente)

## Configuración local

1. Copiar el archivo de variables de entorno:

   ```bash
   cp .env.example .env.local
   ```

2. Completar `.env.local` con una base de datos PostgreSQL real y un `AUTH_SECRET` propio
   (`openssl rand -base64 32`).

3. Instalar dependencias:

   ```bash
   npm install
   ```

4. Aplicar las migraciones:

   ```bash
   npm run db:migrate
   ```

5. Levantar el servidor de desarrollo:

   ```bash
   npm run dev
   ```

   La app queda disponible en [http://localhost:3000](http://localhost:3000).

## Scripts

| Script | Descripción |
|---|---|
| `npm run dev` | Servidor de desarrollo. |
| `npm run build` | Build de producción. |
| `npm run start` | Sirve el build de producción. |
| `npm run lint` | ESLint. |
| `npm run typecheck` | Chequeo de tipos de TypeScript sin emitir archivos. |
| `npm run db:migrate` | Aplica migraciones de Prisma (`prisma migrate dev`). |
| `npm run db:studio` | Abre Prisma Studio. |

## Variables de entorno

Ver `.env.example` para la lista completa y comentada. Nunca commitear `.env.local` ni ningún
archivo con secretos reales.
