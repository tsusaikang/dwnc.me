# dwnc.me 요구사항과 진행 현황

최종 갱신: 2026-08-27 KST

이 문서는 사용자가 현재 상태와 다음 작업을 빠르게 확인하는 요약과 요구사항 원장이다. 구현 세부사항, 검증 수치와 인수인계 기준점은 [`PROJECT_STATE.md`](../PROJECT_STATE.md)가 담당하고, 공개 미디어의 불변 전달 규칙은 [`MEDIA_SERVING_CONTRACT.md`](MEDIA_SERVING_CONTRACT.md)가 담당한다. 세 문서가 다르면 실제 Git 상태, 검증 결과와 Cloudflare 설정 재확인 결과를 기준으로 같은 변경에서 바로잡는다.

<!-- requirements-policy: recent-complete-limit=12 -->

완료 요구사항은 이 문서에 최근 12개까지 `(Updated-at, ID)` 오름차순으로 유지한다. 13번째 완료가 생기면 같은 정렬에서 가장 오래된 완료 항목을 [`REQUIREMENTS_ARCHIVE.md`](REQUIREMENTS_ARCHIVE.md) 끝으로 옮기며 ID·완료 조건·증거·날짜를 삭제하거나 재사용하지 않는다.

## 한눈에 보는 진행 상황

### 현재 목표

최종 공개 미디어 2,758개와 Stage 3 release-source 준비를 commit `1f726f63381a903afdd04ec80c90407c742c82cd`·tree `46ec12f98c74a4fdbbc92e3749574bf085ad21ee`로 로컬 Git에 기록했고 push는 0이다. staging media·release Ed25519 key도 실제 생성해 private key는 macOS Keychain에만 보관하고 public fingerprint를 정책에 고정했다. 현재 key 안전장치·정책·문서 변경은 다음 로컬 commit 전이며, 이후 private staging R2 자격증명 재생성→단일 객체→전체 업로드·전수 대조→staging Worker 검증을 순서대로 진행한다. 실제 `dwnc.me` 도메인과 DNS는 Cloudflare에 연결되지 않았다.

### 전체 상태

| 영역 | 상태 | 현재 증거 |
|---|---|---|
| 콘텐츠 보존·새 사이트 | 완료 | 티스토리 공개 164개, 네이버 공개 185개, 비공개 로컬 247개와 canonical/alias 349개가 로컬 전수 검증을 통과했다. |
| Stage 3 로컬 안전장치 | release-source commit 완료·key 정책 후속 변경 커밋 전 | Cloudflare 관련 18개 test suite·833개 assertion, 정적 페이지 1,404개, 308 redirect 349개, 사진형 148·장문형 201 분류가 통과했다. 현재 HEAD는 `1f726f63381a903afdd04ec80c90407c742c82cd`, tree는 `46ec12f98c74a4fdbbc92e3749574bf085ad21ee`이고 push는 0이다. |
| Cloudflare Builds | 설정 재확인 완료 | account fingerprint가 정책과 일치했고 `SKIP_DEPENDENCY_INSTALL=1`, Build `npm ci && npm run cloudflare:prepare:production`, Deploy `npm run cloudflare:upload:production-version`, Version `npx wrangler versions upload`를 확인했다. 보호 절차 없이 직접 실행하는 `wrangler deploy`는 없었다. |
| staging R2 저장소 | 준비됨·사용 불가 | private bucket `dwnc-me-public-media-staging`은 객체 0, `r2.dev` 꺼짐, custom domain 0이다. 예전에 만든 bucket 한정 token 두 개는 Cloudflare에서 활성 상태지만 로컬에 비밀값이 남아 있지 않아 사용할 수 없다. 새 자격증명은 아직 만들지 않았다. |
| 최종 공개 미디어 | 완료 | 2,758개·2,346,220,246바이트, manifest SHA-256 `61bb577d609f97cdb014ef3a14681045fbb3bec616f2b04c8d058519b640c532`를 로컬·source-only 전수 검증했다. |
| 공개 요청 경로 | 완료 | 1,410경로, SHA-256 `1666d8dd85ac05c2274513cfbe438f24ead06a190f873af3b67f7e3aa373307c`로 확정했다. |
| staging Worker | signing key 완료·Worker 미실행 | media public fingerprint는 `69cb5866228f1624693b0903e60d52b0c046464040da621b2d144cb8bffb2182`, release public fingerprint는 `2655be4122fb2238d47ba539b8e86aa9d39899631a7d713106ce711ea2de1ac2`다. private key는 macOS Keychain에만 보관했고 export하지 않았다. Worker·smoke token·version·activation은 아직 없다. |
| 실제 도메인 | 미연결 | `dwnc.me` DNS·route·custom domain을 Cloudflare Worker에 연결하지 않았다. Cloudflare 안의 production 이름 자원을 변경해도 현재 사이트 방문자에게 영향이 없다. |

### 미디어 정리 결과

후보 132개는 current manifest와 경로·크기·MIME·SHA가 모두 일치했고, 반복 파일을 합치면 고유 SHA-256은 65개다.

| 묶음 | 수량 | 현재 결정 | 다음 확인 |
|---|---:|---|---|
| Naver·Kakao 지도 이미지·타일·핀·축척·커서 | 99 | 제외·대체 완료 | 영향 글 5개에 장소 카드 16개를 렌더한다. 15개는 원 장소 링크, 원 주소가 없는 1개는 Naver 검색 fallback이며 구조·desktop/mobile·light/dark 시각 QA를 통과했다. |
| LINE store 스티커 | 5 | 제외·표현 보완 완료 | 링크·이미지·빈 wrapper는 0이고 본문 문자는 보존됐다. 최초 시각 QA에서 발견한 두 영향 글의 큰 세로 공백은 파생 표현 계층의 exact-boundary collapse로 해소했고 구조·build validation을 통과했다. |
| 1×1 빈 SVG/GIF placeholder | 27 | B 선택·제외 완료 | 빈 객체와 53개 video poster는 제외했다. 대신 재생 불가 안내·재생시간 53개와 작성자 캡션 23개는 유지했고, placeholder를 cover로 쓰던 13개 글의 파생 cover는 `null`로 두었다. |
| SBS 수영 방송 화면 GIF | 1 | 포함 | 본문·cover의 실제 GIF가 desktop/mobile에서 정상 렌더됨을 확인했고 사용자의 포함 결정을 유지한다. |

사용자가 소유를 확인한 사진 2,757개에 직접 제작한 SBS 수영 GIF 1개를 더한 2,758개가 최종 공개 집합이다. 지도 99개는 자산 집합에서 빼고 영향 글 5개의 장소 카드 16개로 바꾸었다. 15개는 원 장소 네이버지도 링크, 1개는 네이버지도 검색 링크다. LINE 스티커 5개와 placeholder 27개는 제외했고, SBS GIF `/media/naver/221172590451/001-e467d08a3a01.gif`의 1,299,862바이트·SHA-256 `e467d08a3a01bf5bcc53c79f2a40e89d0181a8c920e08b62a1a513c3d93656d9`는 본문과 cover에서 그대로 유지했다.

### 아직 결정할 일과 진행을 막는 조건

1. 예전 R2 token은 활성 상태지만 비밀값을 복구할 수 없어 새 uploader·read-only validator 자격증명을 다시 만들어야 한다. 이것은 사용자의 추가 의사결정이 아니라 외부 작업의 기술적 선행 조건이다.
2. staging media·release Ed25519 key는 생성·정책 고정을 마쳤지만 smoke token은 아직 생성하지 않았다. smoke token 규칙은 암호학적 난수 32바이트를 padding 없는 base64url 43문자로 표현하는 것으로 확정했다.
3. staging Worker `dwnc-me-staging`은 아직 없으며 R2 객체·receipt·Worker version·activation도 0이다. 현재 signing-key 안전장치·정책 변경의 로컬 commit과 R2 자격증명 준비 뒤에 시작한다.
4. 공유·스크랩 추정 10개, 새 글 편집 방식, 과거 댓글, 비공개 자료의 암호화 백업 정책은 Stage 3와 무관한 사용자 결정으로 남아 있다.

### 바로 다음 단계

1. 현재 signing-key 안전장치·정책·문서 변경을 검증한 뒤 로컬 Git에 commit하고 exact full SHA를 기록한다. push는 하지 않는다.
2. 올바른 Cloudflare account에서 staging bucket에만 제한된 uploader·read-only validator 자격증명을 새로 만들고, 대표 객체 1개로 create-only PUT→HEAD→GET/SHA-256 시험을 수행한다.
3. 단일 객체가 정확히 일치하면 최종 2,758개를 create-only로 올리고 모든 객체를 GET해 SHA-256·총 바이트를 대조한다.
4. 생성한 staging signing key를 사용해 보호된 smoke token과 서명 증거를 준비하고, Worker 부재 상태를 다시 확인한 뒤 deny-only staging Worker를 최초 생성한다.
5. 확정된 Git SHA와 R2 감사 증거에 묶인 staging Worker version만 올리고 100%로 적용한 뒤 정적 페이지·349 redirect·media GET/HEAD/304/206/416을 `workers.dev`에서 검증한다.
6. production 이름의 Cloudflare 자원·버전 작업이 필요하면 같은 안전 절차로 계속한다. 실제 `dwnc.me` 도메인·DNS는 연결하지 않는다.

### 최근 완료

- R2 subscription을 올바른 Cloudflare account에서 활성화하고 private staging bucket을 만들었다.
- exact staging bucket에만 접근하는 uploader와 read-only validator 자격증명을 분리해 만들었다.
- 후보 132개를 전수 재구성·시각 감사해 지도 99, 스티커 5, 빈 placeholder 27, 방송 GIF 1로 분류했다.
- 지도 99개를 영향 글 5개의 장소 카드 16개로 대체하고 15개 원 장소 링크와 1개 검색 fallback을 구조·시각 검증했다. 스티커 5개 제거 뒤 최초 시각 QA에서 찾은 세로 공백도 exact-boundary collapse로 해소해 구조·build validation을 통과했고 SBS GIF 보존을 렌더에서 확인했다.
- B 선택에 따라 placeholder 27개를 제외하면서 53개 재생 불가 안내·재생시간과 23개 캡션을 유지했고 13개 파생 cover를 `null`로 정리했다.
- 최종 2,758개·2,346,220,246바이트 manifest와 로컬·source-only·build·Worker 회귀를 검증했다.
- Cloudflare Builds의 raw deploy를 제거하고 version-only wrapper 설정을 인증된 Chrome에서 재확인했다.
- Stage 3 release-source 준비를 commit `1f726f63381a903afdd04ec80c90407c742c82cd`·tree `46ec12f98c74a4fdbbc92e3749574bf085ad21ee`로 기록했으며 push하지 않았다.
- staging media·release Ed25519 private key를 macOS Keychain에 보관하고 private export 없이 두 public fingerprint를 release policy에 고정했다.

### 이번 작업에서 하지 않는 것

- 실제 `dwnc.me` 도메인 연결과 DNS 변경
- 보호된 bootstrap/version-only 절차를 거치지 않고 직접 실행하는 `wrangler deploy`
- 기존 파일·R2 객체 덮어쓰기, 객체 삭제, orphan 자동 삭제
- Git push
- 자격증명·token·private key 값, raw Cloudflare account ID, private 콘텐츠 또는 개인식별정보의 문서·로그 기록

## 요구사항 원장

### `DWNC-S3-007` — staging R2 단일 객체 시험
- **Status:** `blocked`
- **Updated-at:** `2026-08-27`
- **Acceptance:**
  - 최종 manifest의 사용자 소유 객체 1개만 private staging bucket에 `If-None-Match: *`로 새로 만든다.
  - PUT 전후 HEAD와 full GET의 SHA-256·size·MIME·cache metadata가 정확히 일치하는지 검증한다.
  - 불일치하면 덮어쓰지 않고 orphan이나 기존 객체를 삭제하지 않는다.
  - receipt는 저장소 밖 보호 경로에 덮어쓰기 없이 기록하고 자격증명은 출력하지 않는다.
- **Evidence:**
  - [`MEDIA_SERVING_CONTRACT.md`](MEDIA_SERVING_CONTRACT.md)의 upload-once 계약.
  - private staging bucket은 객체 0, `r2.dev` 꺼짐, custom domain 0으로 재확인했다.
  - 예전 token 두 개는 활성 상태지만 비밀값이 남아 있지 않아 사용할 수 없고 새 자격증명은 아직 만들지 않았다.

### `DWNC-S3-008` — staging R2 create-only bulk upload와 full audit
- **Status:** `blocked`
- **Updated-at:** `2026-08-27`
- **Acceptance:**
  - 단일 객체 admission이 exact인 final manifest만 create-only로 업로드한다.
  - overwrite·delete 없이 manifest 전체를 GET해 개별 SHA-256과 총 bytes를 전수 검증한다.
  - missing, mismatch, orphan을 각각 0 또는 명시적으로 보고하고 signed receipt 입력 후보를 만든다.
- **Evidence:**
  - 선행 요구사항 `DWNC-S3-007`이 아직 완료되지 않았다.
  - [`MEDIA_SERVING_CONTRACT.md`](MEDIA_SERVING_CONTRACT.md)의 full-get-sha256 gate.

### `DWNC-S3-009` — deny-only staging Worker 최초 생성과 신뢰 정책
- **Status:** `in-progress`
- **Updated-at:** `2026-08-27`
- **Acceptance:**
  - staging media/release public-key fingerprint와 smoke access policy fingerprint를 보호된 환경 증거로 확정한다.
  - 서명된 Worker 부재 증거와 1회용 실행 권한으로 `dwnc-me-staging` deny-only service를 한 번만 최초 생성한다.
  - 실제 `dwnc.me` route·custom domain·DNS와 public bucket access는 생성하지 않는다.
- **Evidence:**
  - smoke origin은 `https://dwnc-me-staging.dwnc.workers.dev`이고 Bearer token 정책 digest는 `d6c554c1d80c68c08605636f12f26a411f7826bc40eddaee9233a30b6551781a`다. token은 32 random bytes를 padding 없는 base64url 43문자로 만들어야 한다.
  - staging media public fingerprint는 `69cb5866228f1624693b0903e60d52b0c046464040da621b2d144cb8bffb2182`, release public fingerprint는 `2655be4122fb2238d47ba539b8e86aa9d39899631a7d713106ce711ea2de1ac2`로 release policy에 고정했다. private key는 macOS Keychain에만 보관했고 export하지 않았다.
  - 실제 smoke token·Worker는 아직 생성하지 않아 Worker bootstrap 완료 조건은 남아 있다. production account/media/release fingerprint는 `null`을 유지한다.

### `DWNC-S3-010` — staging version-only upload·activation·synthetic smoke
- **Status:** `blocked`
- **Updated-at:** `2026-08-27`
- **Acceptance:**
  - local commit과 full audit receipt에 묶인 staging version만 version-only로 업로드한다.
  - 해당 version ID를 staging에 100% 적용하고 모호한 결과는 자동 재시도하지 않는다.
  - 정적 페이지, 349 redirects와 media GET·HEAD·304·206·416·ETag·Range를 `workers.dev`에서 검증한다.
  - 실제 `dwnc.me` 도메인·DNS는 변경하지 않는다.
- **Evidence:**
  - 선행 요구사항 `DWNC-S3-008`과 `DWNC-S3-009`가 아직 완료되지 않았다.
  - [`MEDIA_SERVING_CONTRACT.md`](MEDIA_SERVING_CONTRACT.md)의 version-only와 staging smoke 계약.

### `DWNC-S3-011` — production 이름 Cloudflare 자원·버전 준비
- **Status:** `planned`
- **Updated-at:** `2026-08-27`
- **Acceptance:**
  - staging 결과, full Git SHA와 Cloudflare version ID를 기록한다.
  - staging에서 통과한 안전 절차를 production 이름의 R2·Worker version에도 같게 적용한다. 앞 단계가 통과하면 추가 승인 요청 때문에 임의로 멈추지 않는다.
  - production이라는 이름은 현재 실제 도메인 트래픽을 뜻하지 않으며, `dwnc.me` 도메인·DNS·route는 연결하지 않는다.
- **Evidence:**
  - 현재 production R2·자격증명·새 Worker version 변경은 0이고 `dwnc.me` 도메인과 DNS는 Cloudflare Worker에 미연결 상태다.
  - [`MEDIA_SERVING_CONTRACT.md`](MEDIA_SERVING_CONTRACT.md)의 two-phase production 안전 절차.

### `DWNC-OPS-001` — 공유·스크랩 추정 10개 처리 결정
- **Status:** `decision-needed`
- **Updated-at:** `2026-08-26`
- **Acceptance:**
  - 10개 각각을 링크형 기록 또는 제외로 결정한다.
  - 원문 복제나 공개 registry·검색·RSS·sitemap 편입은 권리와 공개 범위를 증명한 경우에만 허용한다.
- **Evidence:**
  - [`PROJECT_STATE.md`](../PROJECT_STATE.md)에 공개 목록과 직접 작성 목록 차이 10개가 미해결로 기록돼 있다.

### `DWNC-OPS-002` — 지속적인 새 글 작성 방식 결정
- **Status:** `decision-needed`
- **Updated-at:** `2026-08-26`
- **Acceptance:**
  - 저장소 기반 편집 또는 로그인형 편집기의 운영·보안·백업 방식을 선택한다.
  - 새 글도 append-only global sequence와 public asset receipt 계약을 따른다.
- **Evidence:**
  - [`URL_CONTRACT.md`](URL_CONTRACT.md)의 native-only allocation 계약.

### `DWNC-OPS-003` — 댓글과 private backup 정책 결정
- **Status:** `decision-needed`
- **Updated-at:** `2026-08-26`
- **Acceptance:**
  - 과거 댓글을 이식·읽기 전용 보존·제외 중 하나로 결정한다.
  - private raw·본문·미디어의 암호화 백업과 복구 검증 절차를 정한다.
  - private 콘텐츠나 identity를 공개 저장소·로그에 노출하지 않는다.
- **Evidence:**
  - [`PROJECT_STATE.md`](../PROJECT_STATE.md)의 댓글·암호화 백업 미해결 항목.

### `DWNC-P2-001` — 후속 접근성·탐색 개선
- **Status:** `planned`
- **Updated-at:** `2026-08-26`
- **Acceptance:**
  - 공개 이미지 대체텍스트를 원본 불변 범위의 파생 정책으로 개선한다.
  - tag 660개의 추가 탐색과 검증된 fragment map을 별도 설계한다.
  - 종료된 티스토리 영상 fallback의 표시 문제를 파생 표현에서 보완한다.
- **Evidence:**
  - [`PROJECT_STATE.md`](../PROJECT_STATE.md)의 P2 접근성·tag·fragment·fallback 항목.

## 최근 완료된 요구사항

### `DWNC-CORE-001` — 콘텐츠 보존과 로컬 사이트 기준선
- **Status:** `done`
- **Updated-at:** `2026-08-24`
- **Acceptance:**
  - 티스토리 공개 164개와 네이버 소유 432개를 공개·private 물리 경계에 맞게 보존한다.
  - 공개 canonical 349개, legacy alias 349개와 관련 local build/validator를 통과한다.
- **Evidence:**
  - [`PROJECT_STATE.md`](../PROJECT_STATE.md)의 현재 검증 결과.
  - [`MIGRATION_PLAN.md`](MIGRATION_PLAN.md)의 완료 기준선.

### `DWNC-S3-001` — guarded local Cloudflare media release pipeline
- **Status:** `done`
- **Updated-at:** `2026-08-25`
- **Acceptance:**
  - create-only R2 client, same-origin Worker, version-only upload와 staging/production 분리 gate를 구현한다.
  - local mock·artifact·release·bootstrap·staging 회귀를 통과한다.
- **Evidence:**
  - source commit `a541803bcf35fe95f761f0964e21ceff405c048b`.
  - [`PROJECT_STATE.md`](../PROJECT_STATE.md)의 12 suites·463 assertions PASS 기록.

### `DWNC-S3-002` — Cloudflare Builds raw deploy 제거
- **Status:** `done`
- **Updated-at:** `2026-08-25`
- **Acceptance:**
  - Build를 production prepare wrapper로, Deploy를 version-only wrapper로 제한한다.
  - 인증된 account·Worker·repository에서 exact server setting을 다시 읽고 raw deploy 설정과 traffic change가 0임을 확인한다.
- **Evidence:**
  - 2026-08-25 로그인된 Chrome exact readback.
  - [`PROJECT_STATE.md`](../PROJECT_STATE.md)의 Builds guard checkpoint.

### `DWNC-S3-003` — private staging R2와 최소 권한 자격증명 준비
- **Status:** `done`
- **Updated-at:** `2026-08-26`
- **Acceptance:**
  - 올바른 Cloudflare account fingerprint를 확인하고 R2 subscription을 활성화한다.
  - exact private bucket `dwnc-me-public-media-staging`을 만들고 public access와 object를 0으로 유지한다.
  - bucket 한정 uploader와 별도 read-only validator 자격증명을 만들고 비밀값을 repo·로그에 남기지 않는다.
- **Evidence:**
  - 2026-08-25~26 인증된 Chrome post-action readback: subscription active, exact private bucket, object 0.
  - 자격증명 생성 결과는 scope와 존재만 확인했으며 값과 외부 저장 경로는 문서화하지 않았다.

### `DWNC-S3-004` — 플랫폼 후보 132개 provenance·시각 감사
- **Status:** `done`
- **Updated-at:** `2026-08-26`
- **Acceptance:**
  - current manifest와 후보 경로·size·MIME·SHA를 exact join한다.
  - 모든 고유 시각 자료를 검사하고 사용자 사진 오분류와 본문 의미 손실 가능성을 분리한다.
- **Evidence:**
  - exact candidate 132, unique SHA-256 65, manifest/disk mismatch 0.
  - 시각 분류: 지도 99, LINE 스티커 5, blank placeholder 27, SBS 수영 GIF 1.

### `DWNC-S3-005` — 최종 공개 미디어 집합 확정
- **Status:** `done`
- **Updated-at:** `2026-08-27`
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
- **Acceptance:**
  - 미디어 파생 표현, 최종 manifest, 단일 객체 CLI, staging-only artifact·smoke·fingerprint 관련 변경만 포함한다.
  - source/full-local/build/Worker·Cloudflare 회귀와 `npm run requirements:validate`, `npm run requirements:test`, `git diff --check`를 통과한다.
  - 검증된 전체 diff와 manifest digest를 확인한 뒤 version upload보다 먼저 local commit한다.
  - Git push는 하지 않는다.
- **Evidence:**
  - 최종 manifest 2,758개·2,346,220,246바이트·SHA-256 `61bb577d609f97cdb014ef3a14681045fbb3bec616f2b04c8d058519b640c532`가 로컬·source-only 검증을 통과했다.
  - Cloudflare 관련 18개 suite·833 assertions, 정적 페이지 1,404개, redirect 349개, request surface 1,410경로·SHA-256 `1666d8dd85ac05c2274513cfbe438f24ead06a190f873af3b67f7e3aa373307c`가 통과했다.
  - release-source 준비를 commit `1f726f63381a903afdd04ec80c90407c742c82cd`·tree `46ec12f98c74a4fdbbc92e3749574bf085ad21ee`로 version upload보다 먼저 기록했고 push는 0이다.
