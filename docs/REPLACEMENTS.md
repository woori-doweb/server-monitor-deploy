# 외부 배포 시 식별자 매핑 표

이 repo 는 내부 운영용 monorepo 에서 환경 종속 식별자를 일괄 치환한 **공개 배포본** 입니다.
원본 코드에서 사용된 운영 환경(도메인/IP/계정/조직명) 은 모두 일반화 placeholder 또는 RFC 5737 / RFC 1918 의 documentation/private 영역 값으로 치환되었습니다.

운영자 본인 환경에 맞게 다시 채울 때 참고하세요.

## 1. 도메인

| 원본 카테고리 | 본 배포본 표기 |
|---|---|
| 모니터링 메인 도메인 | `monitor.example.com` |
| 모니터링 보조(nginx 환경) 도메인 | `monitor-nginx.example.com` |
| 메인 앱 도메인 | `app.example.com` |
| 갤러리 앱 도메인 | `gallery.example.com` |
| 외부 API 도메인 | `app-api.example.com` |
| 정적 사이트 도메인 | `app-static.example.com` |
| 어드민 콘솔 도메인 | `app-crm.example.com` |
| 모노레포 도메인 | `app-mono.example.com` |
| Tailscale tailnet | `your-tailnet.ts.net` |
| 조직 도메인 | `example.com` |

## 2. IP

| 카테고리 | 본 배포본 표기 | 표기 출처 |
|---|---|---|
| 공인 서버 IP (메인) | `203.0.113.10` | RFC 5737 TEST-NET-3 |
| 공인 서버 IP (레거시) | `203.0.113.20` | RFC 5737 |
| 공인 서버 IP (보조 호스트) | `203.0.113.30` | RFC 5737 |
| 공인 서버 IP (nginx 어댑터) | `203.0.113.40` | RFC 5737 |
| 사무실 공인 IP | `198.51.100.10` | RFC 5737 TEST-NET-2 |
| 사내 LAN | `192.168.1.0/24`, host `.100` | RFC 1918 |
| 로컬 루프백 | `127.0.0.1` | (그대로 유지) |

## 3. Linux 계정

| 카테고리 | 본 배포본 표기 |
|---|---|
| 모니터링 전용 | `monitor` (유지) |
| 시스템 표준 | `root`, `apache`, `nginx` (유지) |
| 앱 #1 | `app1` |
| 앱 #2 | `app2` |
| 앱 #3 | `app3` |
| CRM 앱 | `app-crm` |
| SaaS 앱 | `app-saas` |
| 정적 사이트 | `app-static` |
| 모노레포 앱 | `app-mono` |
| 로케일/번역 앱 | `app-locale` |
| 리워드 앱 | `app-reward` |
| Rootless Docker 운영자 | `appuser` |

## 4. DB 이름·계정

| 카테고리 | 본 배포본 표기 |
|---|---|
| 앱 DB user (#1) | `app1_user` |
| 앱 DB (#3) | `app3_db` |
| CRM DB | `app_crm_db` |
| SaaS DB | `app_saas_db` |
| 모노레포 DB | `app_mono_db` |
| 리워드 DB | `app_reward_db` |
| 로케일 DB | `app_locale_db` |

## 5. 조직/서비스명

| 카테고리 | 본 배포본 표기 |
|---|---|
| 운영 조직 (GitHub org / 사내 명칭) | `your-org` |
| 운영자 (GitHub user) | `your-username` |
| 서비스명 A~G | `ProjectA` ~ `ProjectG` |
| 기관명 | `Organization` / `Example Bank` / `Example Org` |

## 6. 호스트명

| 카테고리 | 본 배포본 표기 |
|---|---|
| Ubuntu 보조 호스트 | `your-host` |

## 7. 한국어 표현

| 원본 표기 | 본 배포본 표기 |
|---|---|
| "메인 서버" / 메인 서버 | "메인 서버" |
| "보조 서버" 환경 | "보조 서버" / "nginx 어댑터 환경" |
| "워크스테이션" 환경 | "워크스테이션" |
| "레거시 서버" | "레거시 서버" |
| "보조 호스트" | "보조 호스트" |

## 8. 운영자 본인 환경 적용 절차

```bash
git clone https://github.com/your-org/server-monitor-deploy.git my-monitor
cd my-monitor

# 1) 도메인·IP 검색·치환 (예: 환경에 맞게)
find . -type f \( -name '*.md' -o -name '*.conf' -o -name '*.template' \
                  -o -name '*.js' -o -name '*.html' -o -name '*.sh' \) \
  -exec sed -i \
    -e 's/monitor\.example\.com/<your-monitor-domain>/g' \
    -e 's/203\.0\.113\.10/<your-server-ip>/g' \
  {} +

# 2) env.example → .env 작성
cp env.example .env
$EDITOR .env

# 3) 설치
sudo bash scripts/install.sh
```

> 정규식 치환은 작업 전 git diff 로 검토 후 적용. `.git` 디렉토리는 치환 제외 필수.

## 9. 비밀정보 부재 보장

본 repo 는 push 전 다음을 모두 0 건으로 검증:

- GitHub PAT (`gho_…`, `ghp_…`)
- SSH/DB 평문 비밀번호 (`password = "…"`, `secret = "…"`)
- 실제 운영 도메인/IP (위 §1~§3 의 원본 값들)
- 실제 운영 조직·서비스명

운영자가 `.env` 를 작성한 뒤 **`.gitignore` 에 의해 자동 제외**되므로 실수로 커밋되지 않습니다. 단, `git add -f` 강제 추가 시 주의.
