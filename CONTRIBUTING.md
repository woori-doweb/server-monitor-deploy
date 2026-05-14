# Contributing

[English](#english) · [한국어](#한국어)

## English

Thanks for taking interest. This repo is a deploy-tool, so contributions that *most* help are:

1. **Bug reports** with the exact OS / Apache or nginx version / steps to reproduce.
2. **Adapter patches** — making install.sh / templates work on a new OS variant.
3. **Plugin features** — new Cockpit-plugin tabs or fixes (cockpit-plugin/).
4. **Docs** — clearer setup guides, screenshots, more troubleshooting entries.

### Workflow

```bash
git clone https://github.com/your-org/server-monitor-deploy.git
cd server-monitor-deploy
git checkout -b feat/short-description
# … hack …
git commit -m "feat: short summary"
git push origin feat/short-description
# Open PR with a clear description and screenshots if UI-related.
```

### Pre-flight checklist before opening a PR

- [ ] `bash scripts/install.sh --dry-run` succeeds on a clean VM (or document why dry-run is not applicable).
- [ ] No real domains/IPs/passwords/PATs leaked. Run `grep -rE '(\d{1,3}\.){3}\d{1,3}|\.example\.com|gho_|ghp_' .` and review.
- [ ] Docs updated alongside code changes.
- [ ] If you added a new env var, it is documented in `env.example` and the README table.

### Coding style

- Bash: `set -euo pipefail`, quote variables, `shellcheck` clean.
- JS (cockpit plugin): plain ES modules, no build step. Match surrounding indent.
- Markdown: 2-space indent in lists, fenced code blocks with language hint.

### Security

If you found a security issue, **do not open a public PR**. See [SECURITY.md](SECURITY.md).

---

## 한국어

기여 환영합니다. 본 repo 는 deploy-tool 이므로 가장 도움 되는 기여는:

1. **버그 리포트** — 정확한 OS / Apache·nginx 버전 / 재현 절차 포함
2. **어댑터 패치** — install.sh / 템플릿을 새 OS 변종에 맞게
3. **플러그인 기능** — Cockpit 플러그인 탭 추가/수정 (`cockpit-plugin/`)
4. **문서** — 더 명확한 설치 가이드, 스크린샷, 트러블슈팅 추가

### 워크플로

```bash
git clone https://github.com/your-org/server-monitor-deploy.git
cd server-monitor-deploy
git checkout -b feat/짧은-설명
# … 작업 …
git commit -m "feat: 짧은 요약"
git push origin feat/짧은-설명
# UI 관련이면 스크린샷 포함해 PR
```

### PR 전 체크리스트

- [ ] `bash scripts/install.sh --dry-run` 가 깨끗한 VM 에서 통과 (또는 dry-run 미적용 사유 명시)
- [ ] 실제 도메인/IP/비밀번호/PAT 유출 없음. `grep -rE '(\d{1,3}\.){3}\d{1,3}|\.example\.com|gho_|ghp_' .` 검토
- [ ] 코드 변경과 함께 문서도 업데이트
- [ ] 신규 env 변수는 `env.example` 과 README 표에 기재

### 코딩 스타일

- Bash: `set -euo pipefail`, 변수 quote, `shellcheck` 통과
- JS (cockpit 플러그인): plain ES modules, 빌드 없음. 주변 들여쓰기 일치
- Markdown: 리스트 2-space, fenced code block 에 언어 명시

### 보안

보안 이슈는 **공개 PR 로 열지 마세요**. [SECURITY.md](SECURITY.md) 참조.
