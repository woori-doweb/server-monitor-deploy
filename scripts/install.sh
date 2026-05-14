#!/bin/bash
set -euo pipefail

# ============================================================
# server-monitor install script
# Usage: sudo bash scripts/install.sh
# .env 파일이 필요합니다. cp env.example .env && vi .env
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BASE_DIR="$(dirname "$SCRIPT_DIR")"
cd "$BASE_DIR"

# Load .env
if [ ! -f .env ]; then
    echo "ERROR: .env 파일이 없습니다. cp env.example .env 후 수정하세요."
    exit 1
fi
source .env

echo "============================================================"
echo " server-monitor 설치: $SERVER_NAME ($SERVER_DOMAIN)"
echo "============================================================"

# URL-encode password for DSN
DB_MONITOR_PASS_ENCODED=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$DB_MONITOR_PASS', safe=''))")

# Template substitution function
render_template() {
    local template="$1"
    local output="$2"
    cp "$template" "$output"
    sed -i "s|{{SERVER_NAME}}|$SERVER_NAME|g" "$output"
    sed -i "s|{{SERVER_DOMAIN}}|$SERVER_DOMAIN|g" "$output"
    sed -i "s|{{SERVER_IP}}|$SERVER_IP|g" "$output"
    sed -i "s|{{SERVER_OS}}|$SERVER_OS|g" "$output"
    sed -i "s|{{MONITOR_USER}}|$MONITOR_USER|g" "$output"
    sed -i "s|{{MONITOR_PASS}}|$MONITOR_PASS|g" "$output"
    sed -i "s|{{DB_MONITOR_USER}}|$DB_MONITOR_USER|g" "$output"
    sed -i "s|{{DB_MONITOR_PASS}}|$DB_MONITOR_PASS|g" "$output"
    sed -i "s|{{DB_MONITOR_PASS_ENCODED}}|$DB_MONITOR_PASS_ENCODED|g" "$output"
    sed -i "s|{{HTPASSWD_USER}}|$HTPASSWD_USER|g" "$output"
    sed -i "s|{{HTPASSWD_PASS}}|$HTPASSWD_PASS|g" "$output"
    sed -i "s|{{NETDATA_PORT}}|$NETDATA_PORT|g" "$output"
    sed -i "s|{{UPTIME_KUMA_PORT}}|$UPTIME_KUMA_PORT|g" "$output"
    sed -i "s|{{COCKPIT_PORT}}|$COCKPIT_PORT|g" "$output"
    sed -i "s|{{SERVER_STATUS_PORT}}|$SERVER_STATUS_PORT|g" "$output"
    sed -i "s|{{SSL_EMAIL}}|$SSL_EMAIL|g" "$output"
    sed -i "s|{{SITES_INFO}}|$SITES_INFO|g" "$output"
    sed -i "s|{{DISK_WARN}}|$DISK_WARN|g" "$output"
    sed -i "s|{{DISK_CRIT}}|$DISK_CRIT|g" "$output"
    sed -i "s|{{CPU_WARN}}|$CPU_WARN|g" "$output"
    sed -i "s|{{CPU_CRIT}}|$CPU_CRIT|g" "$output"
    sed -i "s|{{RAM_WARN}}|$RAM_WARN|g" "$output"
    sed -i "s|{{RAM_CRIT}}|$RAM_CRIT|g" "$output"
    sed -i "s|{{MARIADB_CONN_WARN}}|$MARIADB_CONN_WARN|g" "$output"
    sed -i "s|{{MARIADB_CONN_CRIT}}|$MARIADB_CONN_CRIT|g" "$output"
    sed -i "s|{{APACHE_WORKER_WARN}}|$APACHE_WORKER_WARN|g" "$output"
    sed -i "s|{{APACHE_WORKER_CRIT}}|$APACHE_WORKER_CRIT|g" "$output"
    echo "  rendered: $output"
}

# Generate DB GRANTS from DB_NAMES
generate_db_grants() {
    local grants=""
    IFS=',' read -ra DBS <<< "$DB_NAMES"
    for db in "${DBS[@]}"; do
        db=$(echo "$db" | xargs)  # trim whitespace
        grants="${grants}GRANT SELECT ON \`${db}\`.* TO '${DB_MONITOR_USER}'@'localhost';\n"
    done
    echo -e "$grants"
}

# ── Phase 1: Linux 계정 ──
echo ""
echo "[Phase 1] Linux 계정 생성..."
if id "$MONITOR_USER" &>/dev/null; then
    echo "  $MONITOR_USER 계정 이미 존재"
else
    useradd -m "$MONITOR_USER"
    echo "$MONITOR_USER:$MONITOR_PASS" | chpasswd
    usermod -aG wheel "$MONITOR_USER"
    echo "  $MONITOR_USER 계정 생성 완료 (wheel 그룹)"
fi

mkdir -p /home/$MONITOR_USER/{www,logs,uptime-kuma}
chmod 711 /home/$MONITOR_USER
chmod 755 /home/$MONITOR_USER/www

# SELinux
setsebool -P httpd_can_network_connect 1 2>/dev/null || true
echo "  디렉토리 및 SELinux 설정 완료"

# ── Phase 2: Netdata ──
echo ""
echo "[Phase 2] Netdata 설치..."
if systemctl is-active netdata &>/dev/null; then
    echo "  Netdata 이미 설치됨, 설정만 업데이트"
else
    curl -Ss https://get.netdata.cloud/kickstart.sh > /tmp/netdata-kickstart.sh
    bash /tmp/netdata-kickstart.sh --stable-channel --dont-wait --non-interactive
    echo "  Netdata 설치 완료"
fi

# Render and apply Netdata configs
mkdir -p /etc/netdata/go.d /etc/netdata/health.d
render_template config/templates/mysql.conf.template /etc/netdata/go.d/mysql.conf
render_template config/templates/apache.conf.template /etc/netdata/go.d/apache.conf
render_template config/templates/custom-alarms.conf.template /etc/netdata/health.d/custom-alarms.conf

# Append web bind config
if ! grep -q "bind to" /etc/netdata/netdata.conf 2>/dev/null; then
    render_template config/templates/netdata.conf.append /tmp/netdata-web.conf
    cat /tmp/netdata-web.conf >> /etc/netdata/netdata.conf
    rm /tmp/netdata-web.conf
    echo "  netdata.conf 바인드 설정 추가"
fi

# Append apps_groups
if ! grep -q "Custom Process Groups" /etc/netdata/apps_groups.conf 2>/dev/null; then
    cat config/templates/apps_groups.conf.append >> /etc/netdata/apps_groups.conf
    echo "  apps_groups.conf 추가"
fi

systemctl restart netdata && systemctl enable netdata
echo "  Netdata 설정 적용 완료"

# ── Phase 2b: MariaDB 모니터링 계정 ──
echo ""
echo "[Phase 2b] MariaDB 모니터링 계정..."
DB_GRANTS=$(generate_db_grants)
sed "s|{{DB_GRANTS}}|$DB_GRANTS|g" sql/init-monitor-db.sql.template | \
  sed "s|{{DB_MONITOR_USER}}|$DB_MONITOR_USER|g" | \
  sed "s|{{DB_MONITOR_PASS}}|$DB_MONITOR_PASS|g" > /tmp/init-monitor-db.sql
mysql -u root -p"$DB_ROOT_PASS" < /tmp/init-monitor-db.sql 2>/dev/null && echo "  DB 계정 생성 완료" || echo "  DB 계정 이미 존재하거나 오류"
rm -f /tmp/init-monitor-db.sql

# ── Phase 2c: Apache mod_status ──
echo ""
echo "[Phase 2c] Apache mod_status..."
render_template config/templates/server-status.conf.template /etc/httpd/conf.d/server-status.conf
echo "  server-status.conf 적용"

# ── Phase 3: Uptime Kuma ──
echo ""
echo "[Phase 3] Uptime Kuma 설치..."
if [ -d "/home/$MONITOR_USER/uptime-kuma/node_modules" ]; then
    echo "  Uptime Kuma 이미 설치됨"
else
    cd /home/$MONITOR_USER
    git clone https://github.com/louislam/uptime-kuma.git uptime-kuma
    cd uptime-kuma && npm run setup
    cd "$BASE_DIR"
    echo "  Uptime Kuma 설치 완료"
fi

render_template config/templates/ecosystem.config.js.template /home/$MONITOR_USER/uptime-kuma/ecosystem.config.js
chown -R $MONITOR_USER:$MONITOR_USER /home/$MONITOR_USER/

if pm2 describe uptime-kuma &>/dev/null; then
    pm2 restart uptime-kuma
else
    pm2 start /home/$MONITOR_USER/uptime-kuma/ecosystem.config.js
fi
pm2 save
echo "  Uptime Kuma PM2 등록 완료"

# ── Phase 4: Cockpit ──
echo ""
echo "[Phase 4] Cockpit..."
dnf install -y cockpit cockpit-storaged cockpit-networkmanager -q 2>/dev/null || true
mkdir -p /etc/cockpit
render_template config/templates/cockpit.conf.template /etc/cockpit/cockpit.conf
systemctl enable --now cockpit.socket
echo "  Cockpit 설정 완료"

# ── Phase 5: Apache VHost ──
echo ""
echo "[Phase 5] Apache VHost..."
htpasswd -cb /etc/httpd/.htpasswd-monitor "$HTPASSWD_USER" "$HTPASSWD_PASS" 2>/dev/null
chmod 640 /etc/httpd/.htpasswd-monitor
chown root:apache /etc/httpd/.htpasswd-monitor

render_template config/templates/index.html.template /home/$MONITOR_USER/www/index.html
chown $MONITOR_USER:$MONITOR_USER /home/$MONITOR_USER/www/index.html

render_template config/templates/vhost-monitor.conf.template /etc/httpd/conf.d/vhost-monitor.conf

httpd -t 2>&1 || { echo "ERROR: Apache 설정 오류!"; exit 1; }
systemctl restart httpd
echo "  Apache VHost 적용 완료"

# ── Phase 6: SSL ──
echo ""
echo "[Phase 6] SSL 인증서..."
if [ -d "/etc/letsencrypt/live/$SERVER_DOMAIN" ]; then
    echo "  SSL 인증서 이미 존재"
else
    certbot --apache --non-interactive --agree-tos --email "$SSL_EMAIL" -d "$SERVER_DOMAIN"
    echo "  SSL 발급 완료"
fi

# ── Phase 7: 검증 ──
echo ""
echo "[Phase 7] 검증..."
echo -n "  Netdata: "; systemctl is-active netdata
echo -n "  Cockpit: "; systemctl is-active cockpit.socket
echo -n "  Uptime Kuma: "; pm2 pid uptime-kuma >/dev/null && echo "running" || echo "stopped"
echo -n "  HTTPS: "; curl -sk -o /dev/null -w "%{http_code}" -u "$HTPASSWD_USER:$HTPASSWD_PASS" "https://$SERVER_DOMAIN/" 2>/dev/null
echo ""

echo ""
echo "============================================================"
echo " 설치 완료: https://$SERVER_DOMAIN/"
echo " 인증: $HTPASSWD_USER / $HTPASSWD_PASS"
echo "============================================================"
