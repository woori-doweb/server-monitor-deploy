# macOS 포팅 가이드

> server-monitor 를 맥 미니/iMac 같은 macOS 머신으로 옮기려는 운영자를 위한 가이드.
> 메인 코드는 Linux + Cockpit 가정이며, **그대로 복제는 불가능**합니다. 이 문서는 무엇이 막히는지·어떤 대안이 있는지·어디서부터 손대야 하는지를 정리합니다.

[English summary](#english-summary)

---

## 1. 결론 (TL;DR)

| 결정 | 답 |
|------|---|
| 그대로 복제 가능? | ❌ — Cockpit / systemd / firewalld / SELinux / dnf 가정이 모두 깨짐 |
| 부분 포팅 가능? | ✅ — UI 와 어댑터를 분리하면 가능. 모듈마다 다른 비용 |
| 가장 현실적인 길? | **데이터/대시보드 도구(Netdata + Uptime Kuma) 만 brew 로 띄우고, 통합 콘솔(`server-monitor` 플러그인) 은 포기하거나 별도 웹앱으로 재구현** |

## 2. 막히는 지점 (Linux ↔ macOS 차이)

| 의존 항목 | Linux (메인 가정) | macOS |
|---|---|---|
| **UI 호스팅** | Cockpit RPM, `/usr/share/cockpit/` 플러그인 | **Cockpit 공식 지원 없음**. 플러그인 모델 전체가 무효. |
| **서비스 매니저** | systemd (`systemctl`, `.service`) | **launchd** (`launchctl`, `.plist`). 개념 비슷하나 syntax/lifecycle 다름. |
| **방화벽** | firewalld (`firewall-cmd`) / ufw | **pf** (`pfctl`, `/etc/pf.conf`). ipfw 는 deprecated. |
| **MAC** | SELinux (`semanage fcontext`, `restorecon`) | 없음 → 관련 로직 모두 no-op |
| **패키지** | dnf / apt + `/etc/httpd/`, `/etc/nginx/` | **Homebrew** + `/opt/homebrew/etc/httpd/`, `/opt/homebrew/etc/nginx/servers/` |
| **DB** | MariaDB RPM, `/etc/my.cnf.d/`, `/var/lib/mysql/` | brew 또는 docker, `/opt/homebrew/etc/my.cnf`, `/opt/homebrew/var/mysql/` |
| **셸 도구** | `ss`, `journalctl`, `loginctl`, `findmnt` | 다수 부재 — `netstat`/`lsof`, `log show`, 직접 launchd 조회 |
| **계정** | `useradd`, `/etc/passwd` 단순 | `dscl`, `sysadminctl`, Open Directory 통합 |
| **Netdata** | RPM / apt / Docker | brew / Docker — **지원됨** |
| **Uptime Kuma** | npm + PM2 / Docker | brew nodejs / Docker — **지원됨** |

## 3. 컨버전 옵션 3가지

### 옵션 A — Cockpit 그대로 + macOS 어댑터 (비추천)

Cockpit 위에 server-monitor 플러그인을 그대로 올리는 모델 유지.

> **사실상 불가능**. Cockpit 공식 macOS 빌드 부재. 비공식 빌드를 직접 짜야 하고, 보안/SSO 모델까지 재설계. 투자 대비 효과 매우 나쁨.

### 옵션 B — UI 분리 + 자체 백엔드 (현실적 1순위)

`cockpit-plugin/` 의 React/JS UI 를 **Cockpit API 호출 → 자체 REST 호출** 로 바꾸고, 백엔드는 Node/Python 작은 daemon (예: Express, FastAPI) 으로 분리. OS-specific sudo wrapper(`server-monitor-iprule`, `server-monitor-db` 등) 만 macOS 대응으로 교체.

**작업 범위**
- [ ] `cockpit-plugin/*.js` 의 `cockpit.spawn`, `cockpit.file`, `cockpit.user` 호출 → fetch('/api/...') 로 치환
- [ ] 작은 daemon 작성 (auth, sudoers 매핑)
- [ ] `scripts/server-monitor-*` wrapper 의 Linux 명령 → macOS 등가물 (다음 표 참조)
- [ ] launchd `.plist` 작성 (Netdata, Uptime Kuma, daemon, brew httpd/mysql)

**소요**: 모듈 수에 따라 2~4주.

### 옵션 C — 데이터/대시보드만 차용 (가장 빠름, 권장 1순위)

`server-monitor` 의 **통합 UI 부분은 포기**하고, 동일한 모니터링 효과를 cross-platform 도구만으로 얻음.

```bash
# Homebrew 한 번에 설치
brew install netdata
brew install --cask docker     # Uptime Kuma 도커로 운영하면 깔끔

brew services start netdata
docker run -d --restart=always -p 3001:3001 \
  -v uptime-kuma:/app/data --name uptime-kuma louislam/uptime-kuma:1
```

reverse proxy 가 필요하면 brew nginx 또는 Caddy 사용. Cockpit 부재로 `server-monitor` 의 Sites/IP Rules/Database/Accounts 탭 기능은 빠지지만, **시스템 메트릭 + uptime + 외부 알림(슬랙/디스코드)** 만 필요하다면 충분.

**소요**: 30분 ~ 1일.

## 4. 명령 등가물 표 (옵션 B/C 진행 시 참고)

| Linux | macOS 등가 |
|---|---|
| `systemctl status X` | `launchctl list \| grep X` 또는 `sudo launchctl print system/com.example.X` |
| `systemctl restart X` | `sudo launchctl kickstart -k system/com.example.X` |
| `systemctl enable X` | `.plist` 를 `/Library/LaunchDaemons/` 에 두고 `sudo launchctl bootstrap system /Library/LaunchDaemons/com.example.X.plist` |
| `firewall-cmd --add-port=...` | `pfctl -f /etc/pf.conf` (룰을 `/etc/pf.conf` 또는 `/etc/pf.anchors/*` 에 작성) |
| `ufw allow ...` | 위와 동일 (pf) |
| `ss -ltnp` | `lsof -nP -iTCP -sTCP:LISTEN` |
| `journalctl -u X -f` | `log stream --predicate 'subsystem == "com.example.X"'` 또는 `log show --last 1h` |
| `useradd / passwd` | `sudo dscl . -create /Users/x`, `sudo dscl . -passwd /Users/x ...` 또는 `sudo sysadminctl -addUser x` |
| `dnf install / apt install` | `brew install` |
| `/etc/httpd/conf.d/` | `/opt/homebrew/etc/httpd/extra/` |
| `/etc/nginx/conf.d/` | `/opt/homebrew/etc/nginx/servers/` |
| `/var/log/httpd/` | `/opt/homebrew/var/log/httpd/` |
| SELinux `semanage fcontext` | **no-op** (macOS 는 SELinux 없음) |

## 5. launchd `.plist` 템플릿 (옵션 B)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>             <string>com.example.server-monitor</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/node</string>
    <string>/opt/server-monitor/daemon/server.js</string>
  </array>
  <key>UserName</key>          <string>monitor</string>
  <key>RunAtLoad</key>         <true/>
  <key>KeepAlive</key>         <true/>
  <key>StandardOutPath</key>   <string>/opt/server-monitor/logs/out.log</string>
  <key>StandardErrorPath</key> <string>/opt/server-monitor/logs/err.log</string>
</dict>
</plist>
```

## 6. 권장 진행 흐름

1. **무엇을 보고 싶은가?** 먼저 답하기.
   - "맥 미니 자체 상태(CPU/RAM/디스크/네트워크)" 만이면 → **옵션 C**.
   - "맥 미니가 호스팅 중인 brew 서비스 / docker 컨테이너 / 사이트 / DB 까지 UI 로 조작" 이면 → **옵션 B**.
2. **옵션 C 로 시작**해서 1주 운영해 보고, 부족함이 명확해지면 옵션 B 로 점진 확장.
3. 코드는 본 repo 의 메인 (`Linux/Apache`) 그대로 두고, macOS 어댑터는 별도 디렉토리(예: `macos-adapter/`) 로 추가하는 monorepo 패턴 권장 — `nginx-adapter/`, `workstation/` 와 동일한 사상.

---

## English summary

`server-monitor` is tightly coupled to Linux + Cockpit. macOS porting paths:

- **Option A — port Cockpit + plugin**: not viable (Cockpit lacks official macOS support).
- **Option B — strip Cockpit, run own backend daemon + UI**: 2–4 weeks. Rewrite OS-specific wrappers (`launchctl` instead of `systemctl`, `pfctl` instead of `firewall-cmd`, `dscl` instead of `useradd`, no SELinux). Reuse the Cockpit-plugin JS as a normal SPA hitting your own REST API.
- **Option C — keep only Netdata + Uptime Kuma** (recommended for most users): both have first-class macOS support via Homebrew/Docker. Lose the integrated console; keep all metrics + uptime checks. <1 day.

For Option B, see §4 for a Linux↔macOS command equivalence table and §5 for a launchd `.plist` template.
