#!/usr/bin/env bash
# install.sh — server-monitor Cockpit 플러그인을 workstation에 배포
# 실행 위치: /opt/server-monitor (이 repo가 /opt/server-monitor에 clone되어 있어야 함)
set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/server-monitor}"
PLUGIN_SRC="${REPO_DIR}/workstation/cockpit-plugin"
PLUGIN_DST="/usr/share/cockpit/server-monitor"

if [[ ! -d "$PLUGIN_SRC" ]]; then
  echo "[!] $PLUGIN_SRC not found. clone: git clone https://github.com/your-org/server-monitor.git $REPO_DIR" >&2
  exit 1
fi

if [[ "${EUID}" -ne 0 ]]; then
  echo "[!] root 권한 필요. sudo bash $0" >&2
  exit 2
fi

echo "[1/5] git pull (REPO_DIR=$REPO_DIR)"
( cd "$REPO_DIR" && git pull --ff-only ) || echo "[~] git pull 실패 — 로컬 변경 그대로 사용"

echo "[2/5] cp -r $PLUGIN_SRC/* $PLUGIN_DST/"
mkdir -p "$PLUGIN_DST"
cp -r "$PLUGIN_SRC"/* "$PLUGIN_DST"/

echo "[3/5] perms (root:root, 644 / 755)"
chown -R root:root "$PLUGIN_DST"
find "$PLUGIN_DST" -type f -exec chmod 644 {} \;
find "$PLUGIN_DST" -type d -exec chmod 755 {} \;

echo "[4/5] restart cockpit.socket"
systemctl restart cockpit.socket

echo "[5/5] verify (manifest + plugin URL)"
if [[ -f "$PLUGIN_DST/manifest.json" ]]; then
  echo "  manifest: OK ($(stat -c '%s' "$PLUGIN_DST/manifest.json") B)"
fi
SYSMON_URL="https://localhost-0.your-tailnet.ts.net/sysmon/cockpit/server-monitor"
echo "  URL: $SYSMON_URL"
echo
echo "[+] install complete — Tailscale 멤버 브라우저에서 위 URL 접속, Cockpit 로그인 후 Server Monitor 메뉴 확인"
