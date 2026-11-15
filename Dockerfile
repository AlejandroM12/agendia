# syntax=docker/dockerfile:1

# Imagen de producción de Agendia. La misma imagen sirve para el SaaS y para
# una instalación independiente (DEPLOYMENT_MODE). Tres etapas:
#   deps     → dependencias exactas del lockfile
#   builder  → cliente de Prisma + build de Next.js
#   migrator → solo migraciones y scripts de operación (sin el código de la app)
#   runner   → servidor autocontenido, sin dependencias de desarrollo, usuario sin privilegios

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 BUILD_STANDALONE=1
# Datos públicos que las páginas estáticas (landing, sitemap) fijan al
# construir. No son secretos. docker-compose.yml los toma de .env.production.
ARG APP_URL=http://localhost:3000
ARG CONTACT_EMAIL=
ARG PRICE_MONTHLY=9900
ARG PRICE_ONE_TIME=149000
ARG PRICE_LICENSE_RENEWAL=
ARG PRICE_TEAM_MONTHLY=19900
ARG PRICE_LICENSE_TEAM=249000
# Publicación comercial de los planes con equipo (apagada por defecto): ver lib/features.ts.
ARG PUBLISH_TEAM_PLANS=
ENV APP_URL=$APP_URL CONTACT_EMAIL=$CONTACT_EMAIL PRICE_MONTHLY=$PRICE_MONTHLY PRICE_ONE_TIME=$PRICE_ONE_TIME     PRICE_LICENSE_RENEWAL=$PRICE_LICENSE_RENEWAL PRICE_TEAM_MONTHLY=$PRICE_TEAM_MONTHLY PRICE_LICENSE_TEAM=$PRICE_LICENSE_TEAM PUBLISH_TEAM_PLANS=$PUBLISH_TEAM_PLANS
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

# Imagen auxiliar: aplica migraciones y corre los scripts de operación
# (scripts/*.mjs). No contiene el código fuente de la aplicación, así que
# también es la que se entrega en una instalación independiente.
FROM node:24-alpine AS migrator
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json prisma.config.ts ./
COPY prisma ./prisma
COPY scripts ./scripts
CMD ["npx", "prisma", "migrate", "deploy"]

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
