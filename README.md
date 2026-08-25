# 대왕날치 — dwnc.me

개인 기록의 원문과 공개 범위, 미디어 무결성을 보존하며 직접 운영하는 Astro 블로그 프로젝트다.

## 현재 상태

- 티스토리 공개 글 164개와 사진 814개 이전 완료
- 네이버 직접 작성 글 432개 보존 완료: 공개 185개 + 로컬 전용 비공개 247개
- 전역 순번 canonical 공개 글 349개와 legacy alias 349개 로컬 빌드·검증 완료
- 공개 미디어 2,889개의 결정적 R2 manifest, 공개 요청 1,410경로의 forward-deny same-origin Worker와 source-only Cloudflare fixture 완료
- 실제 배포와 DNS 변경은 미승인 상태

세부 진행 상황과 검증 증거는 `PROJECT_STATE.md`를 기준으로 한다.

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
npm run media:validate:local
npm run cloudflare:build:source
npm run cloudflare:wrangler:types:check
npm run cloudflare:wrangler:startup:check
npm run cloudflare:wrangler:bundle:check
```

`inventory:validate`와 authoritative sequence 변경은 로컬 원장·원본 인벤토리를 갖춘 보존 작업공간에서 실행한다. `build:validate:public`은 private root가 없는 상태를 주입해 hydrated 공개 결과를 검증한다. `cloudflare:build:source`는 Git 비추적 media를 읽거나 내려받지 않고 tracked manifest와 공개 content reference만으로 정적 결과를 만들며 `dist/media`가 0인지 확인한다. `cloudflare:isolated:source`는 fresh Git-style tree에서 private/raw/local media가 없는 같은 조건을 재현하고, `cloudflare:isolated:lock`은 외부 통신 없이 lock과 exact Wrangler 해석을 검사한다. 네트워크가 허용된 깨끗한 CI에서는 `cloudflare:isolated:clean`으로 실제 `npm ci`부터 다시 검증한다. 실제 production 검증은 승인된 account·public-key fingerprint, full-audit signed receipt, R2 HEAD credential과 exact Wrangler bundle 없이는 fail closed한다.

`migration/raw/`, 전체 `public/media/`, 네이버 비공개 메타데이터는 Git에 포함되지 않는다. 새 컴퓨터로 옮기기 전에는 이 로컬 자산을 별도로 백업해야 한다.

공개 미디어와 글·alias·집계 경로의 forward-deny Worker, create-only R2 sync, two-phase release, 원격 receipt, 철회·rollback 및 승인 경계는 `docs/MEDIA_SERVING_CONTRACT.md`를 기준으로 한다. production core artifact에는 version ID가 없고, signed upload authorization 뒤 version-only upload와 별도 attestation을 거쳐야 한다. traffic 전환은 Git trigger 밖에서 다시 승인한 exact version만 권위 store의 fresh status CAS·one-time execution·사후 100% 확인을 거쳐 반영하며, 불명확한 결과는 자동 재시도하지 않는다. 현재 R2 bucket·credential·원격 receipt·Cloudflare binding·version upload·traffic·DNS는 생성하거나 변경하지 않았다.
