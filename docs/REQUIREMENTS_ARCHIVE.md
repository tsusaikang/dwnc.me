# dwnc.me 완료 요구사항 archive

이 문서는 [`REQUIREMENTS.md`](REQUIREMENTS.md)의 recent-complete 한도에서 밀려난 완료 이력을 보존한다. 현재 원장은 완료 항목을 최근 12개까지 유지하고, 13번째 완료가 생기면 `(Updated-at, ID)` 오름차순에서 가장 오래된 완료 항목을 이곳 끝으로 옮긴다.

<!-- requirements-archive-policy: status=done order=updated-at-id-asc movement=oldest-first -->

이 보관 문서에는 완료된 항목만 날짜와 요구사항 번호 순서로 둔다. 요구사항 번호, 제목, 상태, 갱신일, 관련 계획, 우선순위, 완료 조건과 확인 근거는 삭제하거나 재사용하지 않는다. 과거 기록을 바로잡아야 하면 기존 내용을 지우지 않고 새 요구사항과 근거로 정정 관계를 남긴다.

### `DWNC-CORE-001` — 콘텐츠 보존과 로컬 사이트 기준선
- **Status:** `done`
- **Updated-at:** `2026-08-24`
- **Plans:** `PLAN-01`, `PLAN-02`, `PLAN-03`
- **Priority:** `P0`
- **Acceptance:**
  - 티스토리 공개 164개와 네이버 소유 432개를 공개·private 물리 경계에 맞게 보존한다.
  - 공개 canonical 349개, legacy alias 349개와 관련 local build/validator를 통과한다.
- **Evidence:**
  - [`PROJECT_STATE.md`](../PROJECT_STATE.md)의 현재 검증 결과.
  - [`MIGRATION_PLAN.md`](MIGRATION_PLAN.md)의 완료 기준선.

### `DWNC-S3-001` — guarded local Cloudflare media release pipeline
- **Status:** `done`
- **Updated-at:** `2026-08-25`
- **Plans:** `PLAN-05`, `PLAN-06`, `PLAN-07`
- **Priority:** `P0`
- **Acceptance:**
  - create-only R2 client, same-origin Worker, version-only upload와 staging/production 분리 gate를 구현한다.
  - local mock·artifact·release·bootstrap·staging 회귀를 통과한다.
- **Evidence:**
  - source commit `a541803bcf35fe95f761f0964e21ceff405c048b`.
  - [`PROJECT_STATE.md`](../PROJECT_STATE.md)의 12 suites·463 assertions PASS 기록.

### `DWNC-S3-002` — Cloudflare Builds raw deploy 제거
- **Status:** `done`
- **Updated-at:** `2026-08-25`
- **Plans:** `PLAN-07`
- **Priority:** `P0`
- **Acceptance:**
  - Build를 production prepare wrapper로, Deploy를 version-only wrapper로 제한한다.
  - 인증된 account·Worker·repository에서 exact server setting을 다시 읽고 raw deploy 설정과 traffic change가 0임을 확인한다.
- **Evidence:**
  - 2026-08-25 로그인된 Chrome exact readback.
  - [`PROJECT_STATE.md`](../PROJECT_STATE.md)의 Builds guard checkpoint.

### `DWNC-S3-004` — 플랫폼 후보 132개 provenance·시각 감사
- **Status:** `done`
- **Updated-at:** `2026-08-26`
- **Plans:** `PLAN-04`
- **Priority:** `P1`
- **Acceptance:**
  - current manifest와 후보 경로·size·MIME·SHA를 exact join한다.
  - 모든 고유 시각 자료를 검사하고 사용자 사진 오분류와 본문 의미 손실 가능성을 분리한다.
- **Evidence:**
  - exact candidate 132, unique SHA-256 65, manifest/disk mismatch 0.
  - 시각 분류: 지도 99, LINE 스티커 5, blank placeholder 27, SBS 수영 GIF 1.

### `DWNC-S3-003` — private staging R2와 최소 권한 자격증명 준비
- **Status:** `done`
- **Updated-at:** `2026-08-27`
- **Plans:** `PLAN-05`
- **Priority:** `P0`
- **Acceptance:**
  - 올바른 Cloudflare account fingerprint를 확인하고 R2 subscription을 활성화한다.
  - exact private bucket `dwnc-me-public-media-staging`을 만들고 public access와 object를 0으로 유지한다.
  - bucket 한정 uploader와 별도 read-only validator 자격증명을 만들고 비밀값을 repo·로그에 남기지 않는다.
- **Evidence:**
  - bucket은 생성·첫 PUT 직전 object 0이었고 public access 꺼짐, jurisdiction `default`, location `APAC`, storage class `Standard`였다. 현재는 최종 대상 2,758개가 있으며 빠짐·내용 차이·불필요한 파일은 0개다.
  - Active uploader `dwnc-me-public-media-staging-uploader-v3-20260827`은 exact bucket Object Read & Write, Active validator `dwnc-me-public-media-staging-validator-v2-20260827`은 exact bucket Object Read only이며 TTL은 모두 2026-09-03이다.
  - uploader access-key ID SHA-256은 `6a6df74afbbc4a47fe050b11997b41b6e5e7ba9d02884eb69bb9ac88d82bb976`, metadata SHA-256은 `6d92f8e095050757c407bf31a02e8358c4064e7b9852f44c98037de7f331721e`다.
  - validator access-key ID SHA-256은 `be4156f1e29c6282568d18e504d11888907e0df9c8f67a551318a839c735ee5a`, metadata SHA-256은 `03011557f3ae08f1128c10bd5df0508dc50e0bdbbc5652de08f63f05e142fe0c`다.
  - 노출 가능성이 생긴 실패 uploader v2는 revoked했고 정상 두 자격증명의 일반 출력·로그 비밀값 노출과 clipboard 사용은 0이다. 비밀값 자체는 저장소·문서에 기록하지 않았다.

### `DWNC-S3-005` — 최종 공개 미디어 집합 확정
- **Status:** `done`
- **Updated-at:** `2026-08-27`
- **Plans:** `PLAN-04`
- **Priority:** `P0`
- **Acceptance:**
  - 사용자 소유 사진 2,757개, 지도 99개 제외, LINE 스티커 5개 제외, SBS GIF 1개 포함 결정을 공개 표현과 manifest에 반영한다.
  - B 선택에 따라 placeholder 27개를 제외하되 재생 불가 안내·재생시간 53개와 작성자 캡션 23개를 유지한다.
  - placeholder cover 13개를 파생 표현에서 `null`로 처리하고 보존용 frontmatter·정규화 본문은 바꾸지 않는다.
  - 최종 객체 수·총 바이트·manifest SHA-256을 결정적으로 생성하고 local·source-only·build 검증을 통과한다.
- **Evidence:**
  - 최종 manifest는 2,758개·2,346,220,246바이트·SHA-256 `61bb577d609f97cdb014ef3a14681045fbb3bec616f2b04c8d058519b640c532`이고, 2026-08-27 로컬·source-only 전수 검증을 통과했다.
  - 지도 99개는 영향 글 5개의 장소 카드 16개로 대체했고, 15개는 원 장소 네이버지도 링크, 1개는 네이버지도 검색 링크다.
  - SBS GIF `/media/naver/221172590451/001-e467d08a3a01.gif`의 1,299,862바이트·SHA-256 `e467d08a3a01bf5bcc53c79f2a40e89d0181a8c920e08b62a1a513c3d93656d9`는 본문·cover에서 그대로 유지했다.

### `DWNC-S3-006` — 미디어 집합 변경의 로컬 검증과 커밋
- **Status:** `done`
- **Updated-at:** `2026-08-27`
- **Plans:** `PLAN-04`, `PLAN-05`
- **Priority:** `P0`
- **Acceptance:**
  - 미디어 파생 표현, 최종 manifest, 단일 객체 CLI, staging-only artifact·smoke·fingerprint 관련 변경만 포함한다.
  - source/full-local/build/Worker·Cloudflare 회귀와 `npm run requirements:validate`, `npm run requirements:test`, `git diff --check`를 통과한다.
  - 검증된 전체 diff와 manifest digest를 확인한 뒤 version upload보다 먼저 local commit한다.
  - Git push는 하지 않는다.
- **Evidence:**
  - 최종 manifest 2,758개·2,346,220,246바이트·SHA-256 `61bb577d609f97cdb014ef3a14681045fbb3bec616f2b04c8d058519b640c532`가 로컬·source-only 검증을 통과했다.
  - 현재 Cloudflare 관련 27개 시험 묶음·15,076개 확인, 정적 페이지 1,404개, redirect 349개, request surface 1,409경로·SHA-256 `e143cefe01de35de47495e3fbd036773eb550e58f377e07467014d45f944d594`가 통과했다. `/404.html`은 내부 오류 화면으로는 남지만 공개 요청 목록에는 들어가지 않는다.
  - release-source 준비를 commit `1f726f63381a903afdd04ec80c90407c742c82cd`·tree `46ec12f98c74a4fdbbc92e3749574bf085ad21ee`로 version upload보다 먼저 기록했고 push는 0이다.
