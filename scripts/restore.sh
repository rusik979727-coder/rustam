#!/usr/bin/env bash
# Резерв көшірмеден қалпына келтіру. ЕСКЕРТУ: қазіргі деректер ауыстырылады!
#   ./scripts/restore.sh backups/beles-YYYYMMDD-HHMMSS.tgz.gpg
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
FILE="${1:?Файл көрсетіңіз: ./scripts/restore.sh backups/beles-....tgz.gpg}"
read -r -p "Қазіргі деректер ӨШІРІЛІП, $FILE-дан қалпына келтіріледі. Жалғастыру үшін RESTORE деп жазыңыз: " ok
[ "$ok" = "RESTORE" ] || { echo "Тоқтатылды"; exit 1; }
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
gpg --batch --yes --pinentry-mode loopback --passphrase "$BACKUP_PASSPHRASE" -d "$FILE" > "$TMP/beles.tgz"
tar -C "$TMP" -xzf "$TMP/beles.tgz"
docker compose stop app cron
docker compose exec -T db pg_restore -U beles -d beles --clean --if-exists --no-owner < "$TMP/db.dump"
docker compose up -d app cron
echo "✓ Қалпына келтірілді"
