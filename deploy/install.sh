#!/usr/bin/env bash
# Белес CRM орнату/жаңарту. Жоба қалтасында (мыс. /opt/beles) іске қосыңыз:  ./deploy/install.sh
# Бірінші рет: .env жасайды (кездейсоқ құпия кілттермен), іске қосады, бас менеджер құрады.
# Келесі рет (жаңарту): git pull && ./deploy/install.sh
set -euo pipefail
cd "$(dirname "$0")/.."
rand() { openssl rand -hex "${1:-32}"; }

if [ ! -f .env ]; then
  read -r -p "Домен (мыс. crm.beles.kz): " DOMAIN
  umask 077
  cat > .env <<ENV
# ---- Белес CRM production ----
DOMAIN="$DOMAIN"
POSTGRES_PASSWORD="$(rand 24)"
AUTH_SECRET="$(rand 48)"
# Резерв көшірме шифры — ЖОҒАЛТПАҢЫЗ (онсыз көшірмені ашу мүмкін емес). Бөлек жерде сақтаңыз!
BACKUP_PASSPHRASE="$(rand 24)"
BACKUP_KEEP_DAYS="30"
# BACKUP_RCLONE_REMOTE="s3:beles-backups"

WEBHOOK_SECRET="$(rand 24)"
CRON_SECRET="$(rand 24)"
ESCALATION_MINUTES="15"
REMINDER_HOURS="24"

# Telegram (бас менеджерге есеп)
TELEGRAM_BOT_TOKEN=""
TELEGRAM_CHAT_ID=""

# WhatsApp Cloud API (Meta)
WA_TOKEN=""
WA_PHONE_NUMBER_ID=""
WA_VERIFY_TOKEN="$(rand 16)"
META_APP_SECRET=""
WA_TPL_REMINDER="appointment_reminder"
WA_TPL_FOLLOWUP="patient_followup"
WA_TPL_LANG="kk"
IG_VERIFY_TOKEN="$(rand 16)"

# SMS (Mobizon) — міндетті емес
MOBIZON_API_KEY=""
ENV
  echo "✓ .env жасалды (құпия кілттер кездейсоқ). BACKUP_PASSPHRASE-ті бөлек қауіпсіз жерге көшіріп алыңыз!"
  FIRST=1
fi

echo "→ Жинау және іске қосу (бірнеше минут)"
docker compose up -d --build
docker compose ps

if [ "${FIRST:-0}" = "1" ]; then
  read -r -p "Бас менеджер логині: " LOGIN
  read -r -p "Бас менеджердің аты-жөні: " NAME
  docker compose run --rm -T app npx tsx scripts/create-admin.ts "$LOGIN" "$NAME"
  chmod +x scripts/backup.sh
  ( crontab -l 2>/dev/null | grep -v 'beles.*backup.sh'; echo "30 2 * * * $(pwd)/scripts/backup.sh >> /var/log/beles-backup.log 2>&1" ) | crontab -
  echo "✓ Күнделікті резерв көшірме 02:30-ға қойылды"
fi

set -a; . ./.env; set +a
echo
echo "✓ Дайын: https://$DOMAIN"
echo "  Meta webhook (WhatsApp): https://$DOMAIN/api/webhooks/whatsapp   Verify token: $WA_VERIFY_TOKEN"
echo "  Сайт формалары:          https://$DOMAIN/api/webhooks/lead  (X-Webhook-Secret: WEBHOOK_SECRET)"
echo "  Мониторинг:              https://$DOMAIN/api/health"
