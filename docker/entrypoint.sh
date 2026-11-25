#!/bin/sh
set -e
# Дерекқор схемасын жаңарту. Деректер жоғалатын өзгеріс болса — тоқтайды (--accept-data-loss жоқ).
if [ "${SKIP_DB_PUSH:-0}" != "1" ]; then
  npx prisma db push --skip-generate
fi
exec "$@"
