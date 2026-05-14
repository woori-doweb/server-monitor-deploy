#!/bin/bash
set -euo pipefail

# server-monitor 제거 스크립트
# Usage: sudo bash scripts/uninstall.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BASE_DIR="$(dirname "$SCRIPT_DIR")"
cd "$BASE_DIR"

[ -f .env ] && source .env || { echo ".env 파일이 없습니다."; exit 1; }

echo "server-monitor 제거: $SERVER_NAME"
echo ""

read -p "정말 제거하시겠습니까? (y/N): " confirm
[ "$confirm" != "y" ] && exit 0

# Stop Uptime Kuma
pm2 delete uptime-kuma 2>/dev/null || true
pm2 save 2>/dev/null || true
echo "Uptime Kuma PM2 제거"

# Remove Apache configs
rm -f /etc/httpd/conf.d/vhost-monitor.conf
rm -f /etc/httpd/conf.d/vhost-monitor-le-ssl.conf
rm -f /etc/httpd/conf.d/server-status.conf
rm -f /etc/httpd/.htpasswd-monitor
httpd -t 2>&1 && systemctl restart httpd
echo "Apache VHost 제거"

# Remove Netdata custom configs
rm -f /etc/netdata/go.d/mysql.conf
rm -f /etc/netdata/go.d/apache.conf
rm -f /etc/netdata/health.d/custom-alarms.conf
systemctl restart netdata 2>/dev/null || true
echo "Netdata 커스텀 설정 제거 (Netdata 자체는 유지)"

# Remove Cockpit config
rm -f /etc/cockpit/cockpit.conf
echo "Cockpit 설정 제거"

# Remove SSL cert
certbot delete --cert-name "$SERVER_DOMAIN" --non-interactive 2>/dev/null || true
echo "SSL 인증서 제거"

# Remove DB user
mysql -u root -p"$DB_ROOT_PASS" -e "DROP USER IF EXISTS '$DB_MONITOR_USER'@'localhost'; FLUSH PRIVILEGES;" 2>/dev/null || true
echo "MariaDB 모니터링 계정 제거"

echo ""
echo "제거 완료. monitor 리눅스 계정과 /home/monitor/ 디렉토리는 수동으로 삭제하세요."
echo "  userdel -r monitor"
