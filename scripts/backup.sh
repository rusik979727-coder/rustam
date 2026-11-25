#!/usr/bin/env bash
# Белес CRM резерв көшірмесі: дерекқор + жүктелген файлдар, шифрланған (AES-256, gpg).
# Серверде күн сайын: crontab -e →  30 2 * * * /opt/beles/scripts/backup.sh >> /var/log/beles-backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE .env-те жоқ}"
DIR="${BACKUP_DIR:-./backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"
TS="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$DIR"; chmod 700 "$DIR"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

docker compose exec -T db pg_dump -U beles -d beles --format=custom > "$TMP/db.dump"
docker compose exec -T app tar -C /app -cf - uploads > "$TMP/uploads.tar"
tar -C "$TMP" -czf "$TMP/beles.tgz" db.dump uploads.tar
gpg --batch --yes --pinentry-mode loopback --passphrase "$BACKUP_PASSPHRASE" \
    --symmetric --cipher-algo AES256 -o "$DIR/beles-$TS.tgz.gpg" "$TMP/beles.tgz"
chmod 600 "$DIR/beles-$TS.tgz.gpg"
find "$DIR" -name 'beles-*.tgz.gpg' -mtime +"$KEEP_DAYS" -delete
echo "$(date -Is) ✓ $DIR/beles-$TS.tgz.gpg ($(du -h "$DIR/beles-$TS.tgz.gpg" | cut -f1))"

# Сыртқы көшірме (міндетті емес): rclone конфигурацияланса, басқа жерге де жібереді
if [ -n "${BACKUP_RCLONE_REMOTE:-}" ] && command -v rclone >/dev/null; then
  rclone copy "$DIR/beles-$TS.tgz.gpg" "$BACKUP_RCLONE_REMOTE" && echo "  ↳ $BACKUP_RCLONE_REMOTE"
fi
