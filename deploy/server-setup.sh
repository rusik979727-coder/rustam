#!/usr/bin/env bash
# Жаңа Ubuntu 22.04/24.04 серверін дайындау (root атынан бір рет):
#   curl -fsSL https://raw.githubusercontent.com/<repo>/main/deploy/server-setup.sh | bash
#   немесе: bash deploy/server-setup.sh
# Не істейді: жаңартулар, Docker, firewall (тек 22/80/443), fail2ban, автоматты қауіпсіздік жаңартулары.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "root атынан іске қосыңыз (sudo -i)"; exit 1; }
export DEBIAN_FRONTEND=noninteractive

echo "→ Жүйені жаңарту"
apt-get update -y && apt-get upgrade -y
apt-get install -y ca-certificates curl git gnupg ufw fail2ban unattended-upgrades

echo "→ Docker"
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker

echo "→ Firewall: тек SSH, HTTP, HTTPS"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

echo "→ fail2ban (SSH құпиясөз таңдаудан қорғау)"
systemctl enable --now fail2ban

echo "→ Қауіпсіздік жаңартулары автоматты"
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "→ Уақыт белдеуі"
timedatectl set-timezone Asia/Almaty || true

# SSH-ты тек кілтпен кіретін ету — тек кілт қосылып тұрса (әйтпесе серверден құлыпталып қаласыз)
if [ -s /root/.ssh/authorized_keys ] || ls /home/*/.ssh/authorized_keys >/dev/null 2>&1; then
  echo "→ SSH: құпиясөзбен кіруді өшіру (кілт табылды)"
  mkdir -p /etc/ssh/sshd_config.d
  printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin prohibit-password\n' > /etc/ssh/sshd_config.d/99-beles.conf
  systemctl reload ssh || systemctl reload sshd || true
else
  echo "! SSH кілті табылмады — құпиясөзбен кіру қалдырылды. Кілт қосып, скриптті қайта іске қосыңыз."
fi

echo "✓ Сервер дайын. Келесі қадам: git clone ... /opt/beles && cd /opt/beles && ./deploy/install.sh"
