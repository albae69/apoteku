# Image runner E2E: Bun + Playwright (Chromium) untuk menguji stack yang berjalan.
#   docker build -f docker/e2e/Dockerfile -t apoteku-e2e .

FROM oven/bun:1-debian

ENV DEBIAN_FRONTEND=noninteractive

WORKDIR /app

COPY package.json bun.lock tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN bun install --frozen-lockfile

# Chromium + pustaka sistemanya (dipakai tools/e2e-browser.ts).
RUN bunx playwright install --with-deps chromium

COPY packages/shared packages/shared
COPY tools tools

# Tempat menulis hasil uji (di-mount ke ./docs dari compose).
RUN mkdir -p /app/docs

CMD ["bun", "run", "tools/e2e.ts"]
