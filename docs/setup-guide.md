---
type: guide
purpose: 메인 서버(app.example.com) 관제 시스템(Netdata + Uptime Kuma + Cockpit) 구축 절차 및 운영 지침
scope: [deploy]
audience: both
summary: |
  메인 서버(Rocky Linux 9.x)에 Netdata(실시간 메트릭), Uptime Kuma(서비스/SSL 모니터링),
  Cockpit(시스템 관리) 3종 모니터링 도구를 설치하고, monitor.example.com 도메인으로
  Apache 리버스 프록시를 통해 통합 접근하는 전체 절차.
related:
  [
    docs/04-배포/15.멀티사이트-VHost-SSL-설정가이드.md,
    docs/04-배포/16.MariaDB-원격접속-권한설정가이드.md,
  ]
updated: "2026-04-11"
---

# 서버 관제 시스템 구축 가이드

> 최종 수정: 2026-04-11 | 대상 서버: 메인 서버 (app.example.com)

## 1. 개요

메인 서버(app.example.com / 203.0.113.10)의 서버 상태, 서비스 가용성, SSL 만료, DB 성능, 보안 상태를 웹 UI로 통합 확인할 수 있는 관제 시스템.

### 아키텍처

```
외부 접근 (HTTPS)
    |
    v
[monitor.example.com:443] ── Apache VHost (vhost-monitor-le-ssl.conf)
    |                           |-- Basic Auth (.htpasswd-monitor)
    |
    |-- /             ──> 대시보드 랜딩 페이지
    |-- /netdata/     ──> Netdata (127.0.0.1:19999)
    |-- /uptime/      ──> Uptime Kuma (127.0.0.1:3001)
    |-- /cockpit/     ──> Cockpit (127.0.0.1:9090)
```

### 솔루션 조합

| 솔루션 | 역할 | 내부 포트 | 경로 |
|--------|------|-----------|------|
| Netdata v2.10.1 | 실시간 메트릭 (CPU/RAM/Disk/Network/MariaDB/Apache) | 19999 | /netdata/ |
| Uptime Kuma v2.2.1 | 서비스 상태 + SSL 만료 모니터링 | 3001 | /uptime/ |
| Cockpit | 시스템 관리, 로그, 보안, 스토리지 | 9090 | /cockpit/ |

## 2. 계정 정보

| 유형 | ID | PW | 용도 |
|------|-----|-----|------|
| Linux | monitor | <PASSWORD> | 모니터링 서비스 운영, Cockpit 로그인 (wheel 그룹) |
| MariaDB | monitor_db | <DB_PASSWORD> | Netdata MariaDB 플러그인 (읽기 전용) |
| Apache Basic Auth | monitor | <PASSWORD> | monitor.example.com 접근 인증 |
| Uptime Kuma | monitor | <PASSWORD> | Uptime Kuma 웹 UI 로그인 |

## 3. 접속 방법

- URL: `https://monitor.example.com/`
- 인증: Basic Auth (monitor / <PASSWORD>)
- 랜딩 페이지에서 Netdata, Uptime Kuma, Cockpit 링크 선택

## 4. 설치 구성 상세

### 4.1 DNS

| 타입 | 호스트 | 값 |
|------|--------|-----|
| A | monitor.example.com | 203.0.113.10 |

### 4.2 Linux 계정

```bash
useradd -m monitor
echo 'monitor:<PASSWORD>' | chpasswd
usermod -aG wheel monitor
mkdir -p /home/monitor/{www,logs,uptime-kuma}
chmod 711 /home/monitor
chmod 755 /home/monitor/www
```

### 4.3 Netdata

**설치**:
```bash
curl https://get.netdata.cloud/kickstart.sh > /tmp/netdata-kickstart.sh
bash /tmp/netdata-kickstart.sh --stable-channel --dont-wait --non-interactive
```

**설정 파일**:

| 파일 | 용도 |
|------|------|
| `/etc/netdata/netdata.conf` | 기본 설정 (`bind to = 127.0.0.1`) |
| `/etc/netdata/go.d/mysql.conf` | MariaDB 모니터링 |
| `/etc/netdata/go.d/apache.conf` | Apache 모니터링 (포트 8401) |
| `/etc/netdata/apps_groups.conf` | 프로세스 그룹 (app1, app3, pm2 등) |
| `/etc/netdata/health.d/custom-alarms.conf` | 커스텀 알람 |

**MariaDB 모니터링 계정**:
```sql
CREATE USER 'monitor_db'@'localhost' IDENTIFIED BY '<DB_PASSWORD>';
GRANT USAGE, REPLICATION CLIENT, PROCESS ON *.* TO 'monitor_db'@'localhost';
GRANT SELECT ON `app1`.* TO 'monitor_db'@'localhost';
GRANT SELECT ON `app3_db`.* TO 'monitor_db'@'localhost';
GRANT SELECT ON `app_app-reward_db`.* TO 'monitor_db'@'localhost';
GRANT SELECT ON `performance_schema`.* TO 'monitor_db'@'localhost';
FLUSH PRIVILEGES;
```

**Apache mod_status** (`/etc/httpd/conf.d/server-status.conf`):
```apache
# 별도 내부 포트 사용 (VHost SPA RewriteRule 충돌 방지)
Listen 127.0.0.1:8401

<VirtualHost 127.0.0.1:8401>
    <Location "/server-status">
        SetHandler server-status
        Require local
    </Location>
</VirtualHost>

ExtendedStatus On
```

**커스텀 알람 임계값**:

| 항목 | 경고 (warn) | 위험 (crit) |
|------|------------|------------|
| 디스크 사용량 | 85% | 95% |
| CPU 사용량 | 80% | 95% |
| RAM 사용량 | 85% | 95% |
| MariaDB 연결 수 | 100 | 150 |
| Apache 워커 사용률 | 75% | 90% |

### 4.4 Uptime Kuma

**설치 경로**: `/home/monitor/uptime-kuma`

```bash
cd /home/monitor
git clone https://github.com/louislam/uptime-kuma.git uptime-kuma
cd uptime-kuma && npm run setup
```

**PM2 설정** (`/home/monitor/uptime-kuma/ecosystem.config.js`):
```javascript
module.exports = {
  apps: [{
    name: "uptime-kuma",
    script: "server/server.js",
    cwd: "/home/monitor/uptime-kuma",
    env: {
      NODE_ENV: "production",
      UPTIME_KUMA_PORT: 3001,
      UPTIME_KUMA_HOST: "127.0.0.1"
    }
  }]
};
```

**등록할 모니터**:

| 이름 | 타입 | 대상 | 간격 |
|------|------|------|------|
| app.example.com HTTPS | HTTP(s) | https://app.example.com | 60초 |
| gallery.example.com HTTPS | HTTP(s) | https://gallery.example.com | 60초 |
| app.example.com SSL | Certificate | https://app.example.com | 1일 |
| gallery.example.com SSL | Certificate | https://gallery.example.com | 1일 |
| MariaDB | TCP | 127.0.0.1:3306 | 60초 |

### 4.5 Cockpit

```bash
dnf install -y cockpit cockpit-storaged cockpit-networkmanager
systemctl enable --now cockpit.socket
```

**설정** (`/etc/cockpit/cockpit.conf`):
```ini
[WebService]
ListenStream=127.0.0.1:9090
AllowUnencrypted=true
Origins = https://monitor.example.com
UrlRoot=/cockpit

[Session]
IdleTimeout=15
```

### 4.6 Apache VHost

**설정 파일**:
- HTTP: `/etc/httpd/conf.d/vhost-monitor.conf`
- SSL: `/etc/httpd/conf.d/vhost-monitor-le-ssl.conf` (certbot 자동 생성)

**Basic Auth**: `/etc/httpd/.htpasswd-monitor`
```bash
htpasswd -cb /etc/httpd/.htpasswd-monitor monitor '<PASSWORD>'
chmod 640 /etc/httpd/.htpasswd-monitor
chown root:apache /etc/httpd/.htpasswd-monitor
```

**랜딩 페이지**: `/home/monitor/www/index.html`

### 4.7 SSL

```bash
certbot --apache --non-interactive --agree-tos --email admin@app.example.com -d monitor.example.com
```

| 항목 | 값 |
|------|-----|
| 인증서 경로 | /etc/letsencrypt/live/monitor.example.com/fullchain.pem |
| 키 경로 | /etc/letsencrypt/live/monitor.example.com/privkey.pem |
| 만료일 | 2026-07-10 |
| 자동갱신 | certbot-renew.timer (활성) |

## 5. 운영 가이드

### 5.1 일상 점검 항목

1. `https://monitor.example.com/netdata/` 접속 → CPU, RAM, 디스크 이상 여부
2. `https://monitor.example.com/uptime/` 접속 → 서비스 상태, SSL 만료일
3. `https://monitor.example.com/cockpit/` 접속 → 시스템 로그, 보안 업데이트

### 5.2 서비스 관리

```bash
# Netdata
systemctl status netdata
systemctl restart netdata

# Uptime Kuma (PM2)
pm2 list
pm2 restart uptime-kuma
pm2 logs uptime-kuma

# Cockpit
systemctl status cockpit.socket
systemctl restart cockpit.socket
```

### 5.3 업데이트

```bash
# Netdata (자동 업데이트 활성화됨 - /etc/cron.daily/netdata-updater)
# 수동: /usr/libexec/netdata/netdata-updater.sh

# Uptime Kuma
cd /home/monitor/uptime-kuma
git pull
npm run setup
pm2 restart uptime-kuma

# Cockpit
dnf update cockpit*
```

### 5.4 백업 대상

| 대상 | 경로 | 설명 |
|------|------|------|
| Uptime Kuma DB | /home/monitor/uptime-kuma/data/ | SQLite DB (모니터 설정, 이력) |
| Netdata 설정 | /etc/netdata/ | 플러그인, 알람 설정 |
| Cockpit 설정 | /etc/cockpit/cockpit.conf | Cockpit 설정 |
| VHost 설정 | /etc/httpd/conf.d/vhost-monitor*.conf | Apache 프록시 설정 |

## 6. 트러블슈팅

| 증상 | 원인 | 해결 |
|------|------|------|
| monitor.example.com 접속 불가 | DNS 미전파 또는 Apache 중단 | `nslookup monitor.example.com`, `systemctl status httpd` |
| 401 Unauthorized | Basic Auth 비밀번호 불일치 | `htpasswd -b /etc/httpd/.htpasswd-monitor monitor '<PASSWORD>'` |
| Netdata 502 | Netdata 서비스 중단 | `systemctl restart netdata` |
| Uptime Kuma 502 | PM2 프로세스 중단 | `pm2 restart uptime-kuma` |
| Cockpit 404/502 | cockpit.conf UrlRoot 누락 또는 socket 중단 | `UrlRoot=/cockpit` 확인, `systemctl restart cockpit.socket` |
| server-status 403 | Require local 설정 | 내부 포트(8401)로만 접근, 외부 접근 불가 |
| Netdata MariaDB 데이터 없음 | monitor_db 권한 부족 | `SHOW GRANTS FOR 'monitor_db'@'localhost'` 확인 |
| SSL 만료 | certbot-renew.timer 비활성 | `systemctl enable --now certbot-renew.timer` |

## 7. 주의사항

- **포트 외부 노출 금지**: 19999, 3001, 9090은 firewalld에서 외부에 열지 않음. Apache 리버스 프록시만 사용
- **기존 VHost 수정 금지**: 운영 중인 사이트 vhost(예: `vhost-app.conf`)는 `PROTECTED_VHOSTS` 에 등록하여 절대 수정하지 않음
- **httpd 재시작 전**: 반드시 `httpd -t`로 문법 검사 통과 확인
- **비밀번호 관리**: 이 문서의 비밀번호는 운영 환경용이며, 외부 유출 주의
- **server-status 분리**: SPA RewriteRule과 충돌 방지를 위해 별도 내부 포트(8401) 사용

## 8. 실제 적용 사례

### monitor.example.com 구축 (2026-04-11)

```
1. DNS A 레코드 설정: monitor.example.com → 203.0.113.10
2. Linux monitor 계정 생성 (uid=1004, wheel 그룹)
3. Netdata v2.10.1 설치 (kickstart 스크립트)
4. MariaDB monitor_db 계정 생성 (읽기 전용)
5. Apache mod_status 설정 (내부 포트 8401)
6. Netdata MariaDB/Apache 플러그인 + 커스텀 알람 설정
7. Uptime Kuma v2.2.1 설치 (PM2 관리)
8. Cockpit 설치 (dnf, UrlRoot=/cockpit)
9. Apache VHost 생성 (vhost-monitor.conf)
   - Basic Auth + Netdata/Uptime Kuma/Cockpit 리버스 프록시
10. certbot SSL 발급 (만료: 2026-07-10)
11. 전체 검증 완료 (14/14 통과)
```
