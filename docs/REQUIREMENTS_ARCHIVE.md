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
