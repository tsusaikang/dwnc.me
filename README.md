# 대왕날치 — dwnc.me

개인 기록의 원문과 공개 범위, 미디어 무결성을 보존하며 직접 운영하는 Astro 블로그 프로젝트다.

## 현재 상태

사용자가 확인할 현재 목표·진행 상황·바로 다음 단계와 stable requirement ID는 [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md)를 기준으로 한다. 구현 세부사항과 검증 기준점은 [`PROJECT_STATE.md`](PROJECT_STATE.md)가 담당한다.

- 티스토리 공개 글 164개와 사진 814개 이전 완료
- 네이버 직접 작성 글 432개 보존 완료: 공개 185개 + 로컬 전용 비공개 247개
- 전역 순번 canonical 공개 글 349개와 legacy alias 349개 로컬 빌드·검증 완료
- 최종 공개 미디어 2,758개·2,346,220,246바이트·manifest SHA-256 `61bb577d609f97cdb014ef3a14681045fbb3bec616f2b04c8d058519b640c532` 로컬 원본 기준 전수 검증 완료
- 공개 요청 1,410경로·SHA-256 `1666d8dd85ac05c2274513cfbe438f24ead06a190f873af3b67f7e3aa373307c`, 정적 페이지 1,404개, 308 redirect 349개 검증 완료
- Cloudflare 관련 22개 test suite·1,590개 assertion과 사진형 148·장문형 201 분류 통과
- 시험용 비공개 R2 저장소에 공개 미디어 2,758개를 모두 올렸다. 빠진 파일, 내용이 다른 파일, 목록에 없는 불필요한 파일은 0개였고 기존 파일을 덮어쓰거나 삭제하지 않았다. 다음에는 모든 파일의 실제 내용을 다시 내려받아 원본과 비교한다.
- Cloudflare 계정 번호를 사진 업로드용 열쇠와 분리해 이 Mac의 안전한 보관함에서 불러오는 기능을 만들고 시험했다. 계정 번호는 그 자체로 로그인하거나 파일을 바꿀 수 있는 열쇠가 아니며, 잘못된 계정에서 작업하는 일을 막는 확인 표지로만 쓴다. 실제 계정 번호 저장과 Cloudflare 조회는 아직 하지 않았다.
- 시험용 Worker와 사이트 버전은 아직 올리지 않았고 실제 `dwnc.me` 주소와 DNS도 연결하지 않았다.
- 기술 참고: staging R2 전체 업로드에 사용한 당시 기준 source commit은 `ccec8bb855e45ef679a4b99faf0f0633a99e089e`·tree `241a654acc387233d4e2d5e076754b345619e9ac`이며, 해당 실행과 관련한 push는 0이다.

B 선택에 따라 지도 99개, LINE 스티커 5개, 1×1 placeholder 27개를 최종 R2 집합에서 제외했다. 지도는 영향 글 5개의 장소 카드 16개로 바꿔 15개 원 장소 네이버지도 링크와 1개 검색 링크를 제공한다. placeholder video poster를 빼도 재생 불가 안내·재생시간 53개와 작성자 캡션 23개는 남고, placeholder cover 13개의 파생 cover는 `null`이다. 사용자가 직접 제작한 SBS GIF 1개는 본문·cover에서 정확히 유지한다.

Cloudflare staging smoke는 `https://dwnc-me-staging.dwnc.workers.dev`와 Bearer token을 쓴다. token은 암호학적 난수 32바이트를 padding 없는 base64url 43문자로 표현하며, 접근 정책 digest는 `d6c554c1d80c68c08605636f12f26a411f7826bc40eddaee9233a30b6551781a`다. staging media·release Ed25519 private key는 macOS Keychain에만 보관하고 export하지 않았다. public fingerprint는 각각 `69cb5866228f1624693b0903e60d52b0c046464040da621b2d144cb8bffb2182`·`2655be4122fb2238d47ba539b8e86aa9d39899631a7d713106ce711ea2de1ac2`로 policy에 고정했다. R2 전체 업로드는 완료됐고, 전체 파일 내용 감사·smoke token·Worker 생성·version upload·activation은 아직 수행하지 않았다.

계정 번호 보관 기능은 macOS Keychain의 전용 항목만 사용하며 R2 업로드용·검사용 열쇠를 읽지 않는다. 계정 번호는 클립보드에서 한 번만 읽은 직후 지우고, 프로젝트에 기록된 계정 확인값과 일치할 때만 새 항목으로 저장한다. 보호된 확인 파일은 기본 위치를 쓰든 별도 위치를 지정하든 프로젝트 밖에 있어야 한다. 실제 위치가 프로젝트 안이거나, 중간 폴더가 다른 위치를 가리키는 연결이면 계정 번호와 열쇠를 읽기 전에 멈춘다. 확인 파일에는 원래 번호 대신 확인값과 용도만 남긴다. 저장 도중 확인 파일이 완성되지 않으면 실패 파일은 지우거나 덮어쓰지 않고 그대로 보존하며, `cloudflare:account-target:recover`가 첫 파일 이름에서 정해지는 단 하나의 두 번째 확인 파일을 새로 만들어 복구한다. 다른 복구 파일 이름은 받지 않는다. 두 확인 파일이 모두 불완전하면 자동으로 더 진행하지 않고, 기존 파일과 보관 항목을 그대로 둔 채 사용자의 판단이 필요한 상태로 멈춘다.

실제 `dwnc.me` 도메인과 DNS는 Cloudflare Worker에 연결되지 않았다. 따라서 Cloudflare에서 production이라는 이름의 Worker·R2·version 작업을 진행해도 현재 방문자에게 영향이 없다. 단, 실제 도메인·DNS 연결, Git push, 보호 절차 없이 직접 실행하는 `wrangler deploy`, 객체 덮어쓰기·삭제는 하지 않는다.

완료 요구사항은 최근 12개까지 현재 원장에 남기고 이후 [`docs/REQUIREMENTS_ARCHIVE.md`](docs/REQUIREMENTS_ARCHIVE.md)로 이동한다.

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

`inventory:validate`와 authoritative sequence 변경은 로컬 원장·원본 인벤토리를 갖춘 보존 작업공간에서 실행한다. `build:validate:public`은 private root가 없는 상태를 주입해 hydrated 공개 결과를 검증한다. `cloudflare:build:source`는 Git 비추적 media를 읽거나 내려받지 않고 tracked manifest와 공개 content reference만으로 정적 결과를 만들며 `dist/media`가 0인지 확인한다. `cloudflare:isolated:source`는 fresh Git-style tree에서 private/raw/local media가 없는 같은 조건을 재현하고, `cloudflare:isolated:lock`은 외부 통신 없이 lock과 exact Wrangler 해석을 검사한다. 네트워크가 허용된 깨끗한 CI에서는 `cloudflare:isolated:clean`으로 실제 `npm ci`부터 다시 검증한다. 실제 production 이름의 자원에서도 account·public-key fingerprint, full-audit signed receipt, R2 HEAD 자격증명과 정확한 Wrangler bundle이 없으면 안전하게 중단한다.

`migration/raw/`, 전체 `public/media/`, 네이버 비공개 메타데이터는 Git에 포함되지 않는다. 새 컴퓨터로 옮기기 전에는 이 로컬 자산을 별도로 백업해야 한다.

공개 미디어와 글·alias·집계 경로의 forward-deny Worker, create-only R2 sync, two-phase release, 원격 receipt, 철회·rollback 및 안전 절차는 `docs/MEDIA_SERVING_CONTRACT.md`를 기준으로 한다. core artifact에는 version ID가 없고, signed upload authorization 뒤 version-only upload와 별도 attestation을 거쳐야 한다. version 적용은 Git trigger 밖에서 해당 version만 권위 store의 fresh status CAS·1회 실행·사후 100% 확인을 거쳐 반영하며, 불명확한 결과는 자동 재시도하지 않는다. staging R2 업로드 당시 기준 source commit은 `ccec8bb855e45ef679a4b99faf0f0633a99e089e`·tree `241a654acc387233d4e2d5e076754b345619e9ac`이며 push는 0이다. private staging R2의 2,758개 upload와 strict post-inspection은 완료됐고, canonical control-plane evidence·전체 full GET/SHA-256 감사·staging Worker는 아직 없다. bulk receipt는 업로드 운영 기록일 뿐 서명하거나 release 입력으로 쓰지 않으며, staging 전체 GET/SHA-256 감사 receipt만 staging용으로 별도 서명한다. 향후 production은 별도의 production 전수 감사 receipt와 서명 신뢰값이 필요하다.

업로드 전 bucket 설정 확인용 capture는 만들지 못했지만 bulk와 exact post-inspection은 별도 자격증명으로 완료했다. 다음에는 새 900초 capture를 수집하고 즉시 full audit를 시작해야 하며, 감사 시작과 receipt 후보 생성이 모두 `expiresAt` 전이어야 한다. 만료되면 새 capture와 아직 쓰지 않은 새 receipt 경로로 2,758개 감사를 처음부터 다시 실행한다. 전체 감사 전에 보호된 영수증 경로와 exact Git commit/tree/clean 상태도 먼저 확인한다.

Cloudflare의 비공개 설정을 읽을 때는 `cloudflare:account-target:init`으로 한 번 보관한 계정 번호를 사용한다. 이후 `cloudflare:account-target:inspect`는 원래 번호를 보여 주지 않고 올바른 계정인지 여부만 확인한다. 짧게 사용하는 읽기 전용 열쇠는 시스템 클립보드에서 한 번 읽어 자식 작업에만 전달하며, 계정 번호와 열쇠를 명령어나 화면 출력에 넣지 않는다. control-plane capture만 생성되고 canonical evidence 기록이 실패한 경우에는 `cloudflare:r2:exposure:recover`가 새 token이나 API 호출 없이 secure capture·Git·policy·freshness를 다시 검증하고 누락 evidence만 create-only로 생성한다.
