# Image web Apoteku: build SPA dengan Vite, sajikan lewat nginx.
#   docker build -f apps/web/Dockerfile -t apoteku-web .

FROM oven/bun:1-debian AS build

WORKDIR /app

COPY package.json bun.lock tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN bun install --frozen-lockfile

COPY packages/shared packages/shared
COPY apps/web apps/web

WORKDIR /app/apps/web

# String kosong = API dipanggil secara relatif (/api/...) pada origin yang sama,
# lalu nginx mem-proxy ke service `api`. Lihat apps/web/nginx.conf.
ENV VITE_API_URL=""
RUN bun run build


FROM nginx:1.27-alpine

COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80
