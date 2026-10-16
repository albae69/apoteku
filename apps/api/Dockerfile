# Image API Apoteku (Bun + Hono). Dijalankan dari repo root sebagai context:
#   docker build -f apps/api/Dockerfile -t apoteku-api .

FROM oven/bun:1-debian

WORKDIR /app

# Manifes lebih dulu supaya layer `bun install` ter-cache saat kode berubah.
COPY package.json bun.lock tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN bun install --frozen-lockfile --production

COPY packages/shared packages/shared
COPY apps/api apps/api

WORKDIR /app/apps/api
RUN chmod +x ./entrypoint.sh

ENV NODE_ENV=production \
    PORT=4000 \
    AUDIT_DIR=/app/apps/api/logs/audit

EXPOSE 4000

# Migrasi dijalankan otomatis sebelum server dinyalakan.
ENTRYPOINT ["/app/apps/api/entrypoint.sh"]
