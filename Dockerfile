# syntax=docker/dockerfile:1

# Imagen de producción de Agendia. La misma imagen sirve para el SaaS y para
# una instalación independiente (DEPLOYMENT_MODE). Tres etapas:
#   deps    → dependencias exactas del lockfile
#   builder → cliente de Prisma + build de Next.js (también corre migraciones)
#   runner  → servidor autocontenido, sin dependencias de desarrollo, usuario sin privilegios

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 BUILD_STANDALONE=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# El build no se conecta a la base ni necesita secretos reales: estos
# valores solo existen durante esta etapa y no llegan a la imagen final.
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    AUTH_SECRET="build-time-placeholder" \
    npx prisma generate && \
    DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    AUTH_SECRET="build-time-placeholder" \
    npm run build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S agendia && adduser -S agendia -G agendia
COPY --from=builder --chown=agendia:agendia /app/.next/standalone ./
COPY --from=builder --chown=agendia:agendia /app/.next/static ./.next/static
COPY --from=builder --chown=agendia:agendia /app/public ./public
COPY --from=builder --chown=agendia:agendia /app/scripts/worker.mjs ./scripts/worker.mjs
USER agendia
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
CMD ["node", "server.js"]
