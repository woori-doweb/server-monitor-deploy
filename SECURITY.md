# Security Policy

[English](#english) · [한국어](#한국어)

## English

### Supported versions

`main` branch is the only supported version. Patches are not back-ported to older tags.

### Reporting a vulnerability

**Please do NOT open public GitHub issues for security reports.**

Instead, contact the maintainer privately:

- Open a [GitHub Security Advisory](https://github.com/your-org/server-monitor-deploy/security/advisories/new) (preferred — encrypted, GitHub-native), or
- Email the maintainer directly with `[SECURITY] server-monitor-deploy` in the subject.

We will acknowledge receipt within **7 days** and aim to issue a fix or mitigation guidance within **30 days** for confirmed high-severity issues.

### Threat model assumptions

This project is operator-installed and **assumes a trusted operator with root on the monitored host**. It is **not** intended to be exposed to the public Internet without additional protections:

- Cockpit, Netdata, Uptime Kuma paths MUST be guarded by Basic Auth + IP whitelist (see `config/templates/` vhost templates).
- Destructive UI actions (service stop, IP-rule change, DB user delete) require typed-confirmation modals in the plugin.
- `.env` MUST contain unique, strong passwords. **Never re-use the placeholder values from `env.example`.**

### Known limitations

- The Cockpit plugin runs as the logged-in operator (typically `monitor` or `root`). There is no per-action audit log beyond Apache/Cockpit access logs.
- Adapters (`nginx-adapter/`, `workstation/`) inherit the same model with different OS-level integration (ufw vs firewalld, etc.).

---

## 한국어

### 지원 버전

`main` 브랜치만 지원. 과거 태그로 백포트하지 않습니다.

### 취약점 신고

**공개 이슈로 보고하지 마세요.**

대신 다음 비공개 채널 중 하나를 이용:

- [GitHub Security Advisory](https://github.com/your-org/server-monitor-deploy/security/advisories/new) (권장 — 암호화·표준 채널), 또는
- 메인테이너에게 직접 이메일 (제목: `[SECURITY] server-monitor-deploy`)

확인 후 **7일 이내** 접수 응답, 확인된 고심각도 이슈는 **30일 이내** 패치 또는 완화 가이드 제공 목표.

### 위협 모델 전제

본 프로젝트는 **운영자가 모니터링 호스트에 root 권한을 가진다는 가정** 위에 동작합니다. 별도 보호 장치 없이 **공개 인터넷에 그대로 노출**하지 마세요:

- Cockpit / Netdata / Uptime Kuma 경로는 Basic Auth + IP 화이트리스트 필수 (`config/templates/` 의 vhost 템플릿 참조)
- 플러그인의 destructive 액션(서비스 중단, IP Rule 변경, DB user 삭제)은 모달 타입드 확인 후 실행
- `.env` 의 비밀번호는 반드시 강력한 신규 값으로. `env.example` 의 placeholder 값을 그대로 사용 금지.

### 알려진 한계

- Cockpit 플러그인은 로그인한 운영자 권한(보통 `monitor` 또는 `root`) 으로 실행됩니다. Apache/Cockpit 액세스 로그 외 별도 액션 audit 로그는 없음.
- 어댑터(`nginx-adapter/`, `workstation/`) 는 동일 모델을 다른 OS-level 통합(ufw vs firewalld 등) 으로 적용 — 동일한 보안 가정 적용.
