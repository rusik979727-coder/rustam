# Белес CRM — production image
FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates tini \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS build
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Продакшнда PostgreSQL (dev-те SQLite)
ARG DB_PROVIDER=postgresql
RUN sed -i "s/provider = \"sqlite\"/provider = \"${DB_PROVIDER}\"/" prisma/schema.prisma \
  && npx prisma generate \
  && NEXT_TELEMETRY_DISABLED=1 npm run build

FROM base AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
# tsx (cron, admin құру) және prisma CLI (схема) үшін толық node_modules
COPY --from=build /app /app
RUN mkdir -p /app/uploads && chown -R node:node /app/uploads /app/.next
USER node
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--", "/app/docker/entrypoint.sh"]
CMD ["npx", "next", "start", "-H", "0.0.0.0"]
