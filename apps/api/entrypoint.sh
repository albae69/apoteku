#!/bin/sh
# Entrypoint API: tunggu MySQL → migrasi → (opsional) seed → jalankan server.
set -e

echo "[api] menunggu MySQL & menjalankan migrasi..."
attempt=0
until bun run src/db/migrate.ts; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 60 ]; then
    echo "[api] migrasi gagal setelah 60 percobaan, menyerah." >&2
    exit 1
  fi
  echo "[api] DB belum siap (percobaan $attempt), ulangi dalam 2 detik..."
  sleep 2
done

if [ "${SEED_ON_START:-false}" = "true" ]; then
  echo "[api] mengisi data contoh (SEED_ON_START=true)..."
  bun run src/db/seed.ts
fi

echo "[api] menjalankan server di port ${PORT:-4000}..."
exec bun run src/index.ts
