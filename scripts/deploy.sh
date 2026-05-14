#!/bin/bash
# server-monitor auto-pull deploy script
# cron: */2 * * * * /bin/bash /home/monitor/server-monitor/scripts/deploy.sh

REPO_DIR="/home/monitor/server-monitor"
LOG_FILE="/home/monitor/logs/deploy.log"
LOCK_FILE="/tmp/server-monitor-deploy.lock"

# Prevent concurrent runs
if [ -f "$LOCK_FILE" ]; then
    exit 0
fi
trap "rm -f $LOCK_FILE" EXIT
touch "$LOCK_FILE"

cd "$REPO_DIR" || exit 1

# Fetch remote
git fetch origin main 2>/dev/null

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

# No changes
if [ "$LOCAL" = "$REMOTE" ]; then
    exit 0
fi

echo "$(date '+%Y-%m-%d %H:%M:%S') Deploy started: $LOCAL -> $REMOTE" >> "$LOG_FILE"

# Pull changes
git pull origin main >> "$LOG_FILE" 2>&1

# Detect which files changed
CHANGED=$(git diff --name-only "$LOCAL" "$REMOTE")
echo "Changed files: $CHANGED" >> "$LOG_FILE"

RESTART_NETDATA=false
RESTART_HTTPD=false
RESTART_COCKPIT=false
RESTART_UPTIME=false

# Apply config/active/ changes to actual locations
for file in $CHANGED; do
    case "$file" in
        config/active/netdata-mysql.conf)
            cp "$REPO_DIR/$file" /etc/netdata/go.d/mysql.conf
            RESTART_NETDATA=true
            ;;
        config/active/netdata-apache.conf)
            cp "$REPO_DIR/$file" /etc/netdata/go.d/apache.conf
            RESTART_NETDATA=true
            ;;
        config/active/netdata-custom-alarms.conf)
            cp "$REPO_DIR/$file" /etc/netdata/health.d/custom-alarms.conf
            RESTART_NETDATA=true
            ;;
        config/active/vhost-monitor.conf)
            cp "$REPO_DIR/$file" /etc/httpd/conf.d/vhost-monitor.conf
            RESTART_HTTPD=true
            ;;
        config/active/vhost-monitor-le-ssl.conf)
            cp "$REPO_DIR/$file" /etc/httpd/conf.d/vhost-monitor-le-ssl.conf
            RESTART_HTTPD=true
            ;;
        config/active/server-status.conf)
            cp "$REPO_DIR/$file" /etc/httpd/conf.d/server-status.conf
            RESTART_HTTPD=true
            ;;
        config/active/cockpit.conf)
            cp "$REPO_DIR/$file" /etc/cockpit/cockpit.conf
            RESTART_COCKPIT=true
            ;;
        config/active/ecosystem.config.js)
            cp "$REPO_DIR/$file" /home/monitor/uptime-kuma/ecosystem.config.js
            RESTART_UPTIME=true
            ;;
        www/index.html)
            cp "$REPO_DIR/$file" /home/monitor/www/index.html
            chown monitor:monitor /home/monitor/www/index.html
            ;;
        cockpit-plugin/*)
            # Sync cockpit plugin files
            cp "$REPO_DIR/$file" /usr/share/cockpit/server-monitor/$(basename "$file")
            RESTART_COCKPIT=true
            echo "  cockpit plugin updated: $(basename $file)" >> "$LOG_FILE"
            ;;
        scripts/server-monitor-db)
            # Sync MariaDB wrapper script (no service restart needed; cockpit spawns it on demand)
            cp "$REPO_DIR/$file" /usr/local/bin/server-monitor-db
            chown root:root /usr/local/bin/server-monitor-db
            chmod 755 /usr/local/bin/server-monitor-db
            echo "  wrapper updated: server-monitor-db" >> "$LOG_FILE"
            ;;
        scripts/server-monitor-iprule)
            # Sync IP-rule wrapper script (httpd reload는 wrapper 자체가 수행)
            cp "$REPO_DIR/$file" /usr/local/bin/server-monitor-iprule
            chown root:root /usr/local/bin/server-monitor-iprule
            chmod 755 /usr/local/bin/server-monitor-iprule
            echo "  wrapper updated: server-monitor-iprule" >> "$LOG_FILE"
            ;;
    esac
done

# Restart affected services
if [ "$RESTART_HTTPD" = true ]; then
    if httpd -t 2>&1 | grep -q "Syntax OK"; then
        systemctl restart httpd
        echo "  httpd restarted" >> "$LOG_FILE"
    else
        echo "  ERROR: httpd syntax error, skipped restart" >> "$LOG_FILE"
    fi
fi

if [ "$RESTART_NETDATA" = true ]; then
    systemctl restart netdata
    echo "  netdata restarted" >> "$LOG_FILE"
fi

if [ "$RESTART_COCKPIT" = true ]; then
    systemctl restart cockpit.socket
    echo "  cockpit restarted" >> "$LOG_FILE"
fi

if [ "$RESTART_UPTIME" = true ]; then
    pm2 restart uptime-kuma 2>/dev/null
    echo "  uptime-kuma restarted" >> "$LOG_FILE"
fi

echo "$(date '+%Y-%m-%d %H:%M:%S') Deploy completed" >> "$LOG_FILE"
echo "---" >> "$LOG_FILE"
