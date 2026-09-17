# 대왕날치 — dwnc.me

개인 기록의 원문과 공개 범위, 미디어 무결성을 보존하며 직접 운영하는 Astro 블로그 프로젝트다.

## 문서 읽기

1. [AGENTS.md](AGENTS.md): 작업 방식과 승인·보존 경계.
2. [PROJECT_STATE.md](PROJECT_STATE.md): 현재 목표·실제 상태·다음 행동.
3. [현재 요구사항](docs/REQUIREMENTS.md): 유효한 미완료 항목만 관리한다. 완료 항목은 [요구사항 이력](docs/REQUIREMENTS_ARCHIVE.md)으로 옮기고 기본 읽기 대상에서 제외한다.

주소 작업은 [주소 계약](docs/URL_CONTRACT.md), 미디어 작업은 [미디어 계약](docs/MEDIA_SERVING_CONTRACT.md), Git 자동 배포는 [배포 안내](docs/GIT_DELIVERY_20260910_142007.md)에서 시작한다. 필요한 상세 운영 규격은 각 계약에서, 활성 상세 요구사항은 현재 원장에서 연결한다. 과거 수치·인증·배포 과정은 [미디어 운영 이력](docs/history/MEDIA_SERVING_HISTORY_20260909_234338.md) 등 해당 이력이 필요할 때만 조회한다. README에 현재 상태나 완료 과정을 중복 누적하지 않는다.

## 로컬 미리보기

```sh
npm ci
npm run dev
```

## 검증

```sh
npm run inventory:validate
npm run sequence:self-test
npm run sequence:cli-test
npm run sequence:validate
npm run build
npm run build:validate
npm run build:validate:public
npm run media:manifest:check
npm run media:validate:source
npm run media:validate:local
npm run media:r2:hardening:test
npm run requirements:validate
npm run requirements:test
npm run cloudflare:test
npm run cloudflare:build:source
npm run cloudflare:wrangler:types:check
npm run cloudflare:wrangler:startup:check
npm run cloudflare:wrangler:bundle:check
```

`inventory:validate`와 authoritative sequence 변경은 로컬 원장·원본 인벤토리를 갖춘 보존 작업공간에서 실행한다. `build:validate:public`은 private root가 없는 상태를 주입해 hydrated 공개 결과를 검증한다. `cloudflare:build:source`는 Git 비추적 media를 읽거나 내려받지 않고 tracked manifest와 공개 content reference만으로 정적 결과를 만들며 `dist/media`가 0인지 확인한다. `cloudflare:isolated:source`는 fresh Git-style tree에서 private/raw/local media가 없는 같은 조건을 재현하고, `cloudflare:isolated:lock`은 외부 통신 없이 lock과 exact Wrangler 해석을 검사한다. 네트워크가 허용된 깨끗한 CI에서는 `cloudflare:isolated:clean`으로 실제 `npm ci`부터 다시 검증한다. 실제 production 이름의 자원에서도 올바른 계정인지 보여 주는 확인값, 공개 서명 열쇠가 맞는지 보여 주는 긴 확인 번호, 전체 파일 검사에 서명한 결과 기록, R2 읽기 전용 자격증명과 정확한 Wrangler 실행 묶음이 없으면 안전하게 중단한다.

`migration/raw/`, 전체 `public/media/`, 네이버 비공개 메타데이터는 Git에 포함되지 않는다. 새 컴퓨터로 옮기기 전에는 이 로컬 자산을 별도로 백업해야 한다.
