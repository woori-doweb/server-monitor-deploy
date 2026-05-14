# server-monitor — workstation (192.168.1.100 워크스테이션)

> nginx-adapter/ 패턴(`../nginx-adapter/cockpit-plugin/`)에서 **monorepo 디렉토리 분기**로 적용 (ADR-0006).
> Ubuntu 22.04 데스크탑 + Tailscale serve(tailnet-only) + 시스템 Docker + PM2(Uptime Kuma).
> 웹서버(nginx/Apache) 미사용, Cockpit `UrlRoot=/sysmon/cockpit`.

## 배포 위치 (Cockpit 글로벌 표준)

```
/usr/share/cockpit/server-monitor/
```

## 자동 배포 명령

```bash
# workstation에서
sudo bash /opt/server-monitor/workstation/scripts/install.sh
# 또는 수동:
cd /opt/server-monitor && git pull
sudo cp -r workstation/cockpit-plugin/* /usr/share/cockpit/server-monitor/
sudo chown -R root:root /usr/share/cockpit/server-monitor/
sudo find /usr/share/cockpit/server-monitor/ -type f -exec chmod 644 {} \;
sudo find /usr/share/cockpit/server-monitor/ -type d -exec chmod 755 {} \;
sudo systemctl restart cockpit.socket
```

## 접근 URL

```
https://localhost-0.your-tailnet.ts.net/sysmon/cockpit/server-monitor
```

인증: Tailscale ACL(=tailnet 멤버) + Cockpit Linux 사용자 PAM (monitor 권장, sudo 그룹 필요).

## 활성 메뉴 (74/34 대비)

| 메뉴 | 상태 | 비고 |
|---|---|---|
| Dashboard | ✅ | CPU/Memory/Disk/Network. SERVICES 배열 = tailscaled, netdata, pm2-monitor, cockpit, docker, ufw, fail2ban, ssh, cron, lightdm |
| Management/Accounts | ✅ | uid≥1000: your-org, yms, yes1021, sftp_trader, monitor 보호 |
| Management/Services | ✅ | WHITELIST: tailscaled, netdata, pm2-monitor, cockpit, docker, ufw, fail2ban, ssh, cron, lightdm, xrdp, cups, apparmor, packagekit |
| Management/Firewall | ✅ | ufw (74의 firewalld와 다른 모듈 — 34 ADR-0006 Phase 2 코드 재사용) |
| Management/Logs | ✅ | journalctl + Uptime Kuma PM2 logs + install-monitoring.log + admin-bin 작업 로그 |
| Management/System | ✅ | apt 명령, /var/run/reboot-required, cron 사용자 |
| Management/Docker | ✅ | 시스템 docker (br-* 다수, trader-admin/auth API/DB 컨테이너 추정) |
| Management/**Desktop (VNC)** | ✅ (workstation 전용) | noVNC + websockify(:6080→:5900) → Tailscale serve `/sysmon/desktop/`. 임베드 iframe + "새 탭에서 열기" 버튼 |
| Management/Reboot | ✅ | systemctl reboot |

## 비활성 메뉴 (placeholder, disabled)

| 메뉴 | 사유 |
|---|---|
| VHost | **웹서버 없음** — Tailscale serve가 path-based 라우팅. 수정은 `tailscale serve --bg --set-path=...` 직접 |
| SSL | Tailscale가 TLS 자동 종단 (`*.your-tailnet.ts.net`). certbot 미사용 |
| Database | DB 미설치 |
| IP Rules | 웹서버 없음 — IP 정책은 ufw로 (Firewall 메뉴) |

## 74/34와의 주요 차이

| 항목 | 메인 환경 (root) | nginx 어댑터 환경 | workstation (`workstation/`) |
|---|---|---|---|
| OS | Rocky Linux 9 | Ubuntu 24.04 | Ubuntu 22.04 (desktop) |
| 외부 노출 | Apache vhost | nginx vhost | **Tailscale serve (tailnet-only)** |
| TLS | Let's Encrypt + Apache | Let's Encrypt + nginx | Tailscale 자동 (ts.net) |
| DB | MariaDB | 미설치 | 미설치 |
| 방화벽 | firewalld + zone | ufw | ufw |
| 컨테이너 | PM2 + Node Uptime Kuma | Docker(시스템) + Rootless(appuser) | **PM2(Uptime Kuma) + Docker(시스템, 다수 컨테이너)** |
| Cockpit URL | `/cockpit/` | `/cockpit/` | **`/sysmon/cockpit/`** (UrlRoot) |
| 보호 도메인 | vhost-kipa, vhost-canvly | monitor-nginx.example.com, appuser-prod | **(없음)** |
| SERVICES 핵심 | httpd, mariadb, pm2 | nginx, docker, certbot.timer, duckdns-update.timer | **tailscaled, pm2-monitor, lightdm** |

## 변경된 파일 (34 base 대비)

| 파일 | 변경 |
|---|---|
| `app.js` | SERVICES 배열 → workstation (tailscaled, pm2-monitor, lightdm 추가, nginx/certbot.timer/duckdns-update.timer 제거) |
| `services.js` | WHITELIST → workstation. WARN_STOP에 tailscaled/lightdm 추가 |
| `logs.js` | LOG_SOURCES → tailscaled/netdata/pm2-monitor/uptime-kuma out·err/cockpit/install-monitoring/admin-bin |
| `utils.js` | PROTECTED_VHOSTS=[], PROTECTED_ACCOUNTS, PROTECTED_SERVICES, PROTECTED_PORTS 변경. SYSTEM_DB_USERS=[] |
| `index.html` | 헤더 라벨, 헤더 버튼(Netdata는 SSH only 표시 / Uptime은 `/sysmon/uptime/`), 비활성 sub-tab(VHost/SSL/Database/IP Rules) disabled 처리, Desktop sub-tab + 임베드 iframe 추가 |
| `vnc.js` (신규, workstation 전용) | Desktop sub-tab 모듈. SM.registerModule("desktop", init). "임베드 시작/중지" + "새 탭에서 열기" 버튼. iframe src=`/sysmon/desktop/vnc.html?path=...&autoconnect=1` |
| `manifest.json` | CSP에 `frame-src 'self'; connect-src 'self'` 추가 (iframe 임베드 허용) |
| `scripts/install.sh` (신규) | repo pull → /usr/share/cockpit/server-monitor/에 cp + perms + restart cockpit.socket |
| `scripts/server-monitor-iprule` (제거) | nginx 어댑터 환경 nginx 전용 — 웹서버 없는 workstation에 부적합 |

## 변경 이력

| 날짜 | 내용 |
|---|---|
| 2026-05-09 | 초기 작성. 34 base에서 fork. 모니터링 도메인 — Tailscale serve의 `/sysmon/cockpit/server-monitor`. 비활성 메뉴 4개(VHost/SSL/Database/IP Rules) placeholder 처리. ADR-0006 Stage 1 디렉토리 분기 패턴 준수. |
| 2026-05-09 | **Desktop (VNC) 메뉴 추가**. 호스트에 noVNC + websockify(:6080→:5900 loopback bridge) 설치 + `novnc-bridge.service` 자동기동, Tailscale serve `/sysmon/desktop` 등재. 플러그인에 `vnc.js` 추가, manifest CSP에 frame-src/connect-src 'self' 허용. ufw 3389/tcp + 5900/tcp Anywhere 제거 → 192.168.1.0/24 + 100.64.0.0/10(Tailscale CGNAT) 한정으로 좁힘. |
