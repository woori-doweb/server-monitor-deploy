# server-monitor — 보조 서버 (Ubuntu/nginx/ufw/Docker)

> 메인 서버 server-monitor 패턴(`../cockpit-plugin/`)에서 **monorepo 디렉토리 분기**로 적용 (ADR-0006).
> 같은 repo 내 별도 디렉토리: `nginx-adapter/`

## 배포 위치 (Cockpit 글로벌 표준)

```
/usr/share/cockpit/server-monitor/
```

## 자동 배포 명령

```bash
# 보조 서버에서
cd /opt/server-monitor && git pull
sudo cp -r nginx-adapter/cockpit-plugin/* /usr/share/cockpit/server-monitor/
sudo chown -R root:root /usr/share/cockpit/server-monitor/
sudo find /usr/share/cockpit/server-monitor/ -type f -exec chmod 644 {} \;
sudo find /usr/share/cockpit/server-monitor/ -type d -exec chmod 755 {} \;
sudo systemctl restart cockpit.socket
```

## 접근 URL

```
https://monitor-nginx.example.com/cockpit/server-monitor
```

인증: Cockpit Linux 사용자 인증 (monitor 권장, sudo 그룹).

## Phase 1 (현재) — 활성 메뉴

| 메뉴 | 상태 |
|---|---|
| Dashboard | ✅ CPU/Memory/Disk/Network/Memory Advisor (nginx 어댑터 환경 SERVICES 배열 적용) |
| Management/Accounts | ✅ uid≥1000 사용자 (dev260427/appuser/monitor) |
| Management/SSH 키 | ✅ ~/.ssh/authorized_keys |
| Management/SSL | ✅ certbot --nginx, certbot.timer |
| Management/Services | ✅ nginx 어댑터 환경 WHITELIST: nginx/docker/netdata/cockpit/ufw/fail2ban/ssh/cron/certbot/duckdns/packagekit |
| Management/Logs | ✅ nginx/docker/fail2ban/ufw/duckdns/journalctl |
| Management/System | ✅ apt 명령, /var/run/reboot-required, cron 사용자 갱신 |

## Phase 2 (예정) — 비활성 + placeholder 표시

| 메뉴 | 사유 | Phase 2 계획 |
|---|---|---|
| VHost | Apache 가정 → nginx로 다른 명령 체계 | nginx VHost 모듈 신규 작성 |
| PM2 | nginx 어댑터 환경은 Docker 운영, PM2 미설치 | Docker 컨테이너 모듈 (시스템 + Rootless 분기) |
| Database | DB 미설치 | PostgreSQL 도입 시 또는 영구 비활성 (Phase 3) |
| Firewall | firewalld → ufw | ufw 모듈 신규 작성 |

## 메인 서버과의 주요 차이

| 항목 | 메인 서버 (root `cockpit-plugin/`) | nginx 어댑터 환경 (`nginx-adapter/cockpit-plugin/`) |
|---|---|---|
| OS | Rocky Linux 9 | Ubuntu 24.04 |
| 웹서버 | Apache (httpd) | nginx |
| DB | MariaDB | 미설치 |
| 방화벽 | firewalld + zone | ufw + IP 화이트리스트 |
| 컨테이너 | (PM2 + Node Uptime Kuma) | Docker (시스템) + Rootless Docker (appuser) |
| SSL email | admin@example.com | mobile141107@gmail.com |
| 보호 도메인 | vhost-kipa.conf, vhost-canvly.conf | monitor-nginx.example.com, app.example.com |

## 변경된 파일 (메인 서버 base 대비)

| 파일 | 변경 |
|---|---|
| `app.js` | SERVICES 배열 → nginx 어댑터 환경. PM2 호출 → docker ps 컨테이너 체크 |
| `services.js` | WHITELIST → nginx 어댑터 환경. PM2 services 함수 미사용 |
| `system.js` | dnf → apt list --upgradable + reboot-required, cron 사용자, disk usage 경로 |
| `logs.js` | LOG_SOURCES → nginx/docker/fail2ban/ufw/duckdns/journalctl |
| `ssl.js` | --apache → --nginx, httpd → nginx, certbot-renew.timer → certbot.timer |
| `utils.js` | PROTECTED_VHOSTS, PROTECTED_ACCOUNTS, PROTECTED_PORTS, SYSTEM_DB_USERS 변경 |
| `management.js` | VHost·PM2 모듈 → placeholder. PROTECTED_VHOSTS 참조 |
| `firewall.js` | 전체 비활성 → placeholder |
| `database.js` | 전체 비활성 → placeholder |
| `index.html` | 헤더 라벨, SSL email 기본값, SSL method `nginx`, sub-tab 라벨에 (Phase 2) 표시 |

## 변경 이력

| 날짜 | 내용 |
|---|---|
| 2026-04-30 | Phase 1 초기 작성. 메인 서버 base에서 fork. 모니터링 도메인 monitor-nginx.example.com 적용. |
