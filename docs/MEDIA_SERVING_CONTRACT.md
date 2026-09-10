# dwnc.me 공개 미디어 전달 계약 v1

역할: 현재 미디어 제공·소유·철회 계약. 실제 운영 상태는 [PROJECT_STATE.md](../PROJECT_STATE.md), 미완료 요구사항은 [REQUIREMENTS.md](REQUIREMENTS.md)를 따른다. [상세 운영 규격](MEDIA_OPERATIONS_REFERENCE_20260909_234338.md)과 [과거 이력](history/MEDIA_SERVING_HISTORY_20260909_234338.md)은 해당 작업이 필요할 때만 읽는다.

이 문서는 공개 글이 참조하는 대용량 미디어를 동일 출처 `https://dwnc.me/media/*`로 제공하기 위한 계약이다. 기존 URL, 로컬 원본, SHA-256 증거를 바꾸지 않고 private R2 bucket을 전달용 복제본으로 사용한다.

## 1. 불변 주소와 manifest

- 공개 URL `/media/...`는 유지한다.
- R2 object key는 URL에서 선행 `/` 하나만 제거한 값이다: `key = publicPath.slice(1)`.
- 같은 SHA-256을 가진 파일이라도 public path가 다르면 별도 객체로 유지한다. URL을 합치거나 deduplicate redirect를 만들지 않는다.
- 한번 사용한 key의 `SHA-256 + size + MIME`은 불변이다. 내용이 달라지면 새 key를 배정하고 기존 key를 덮어쓰지 않는다.
- canonical backup은 기존 로컬 `public/media/`와 공개 source inventory다. R2는 보존 정본이 아니라 delivery replica다.

기존 공개 미디어의 결정적 manifest는 `src/data/public-media-r2-v1.json`이다. 다음 수치는 이전 공개 집합의 기준선이며, 웹 편집기 미디어는 별도 소유·참조 계약을 따른다.

| 항목 | 현재 최종 기준선 |
|---|---:|
| 객체 | 2,758 |
| 총 바이트 | 2,346,220,246 |
| manifest SHA-256 | `61bb577d609f97cdb014ef3a14681045fbb3bec616f2b04c8d058519b640c532` |
| full object-set SHA-256 | `9345d2f06c8bd7cda457a9d4335cdc2213e71dcd30bb9e11e6f3e1f8e11ae467` |

manifest entry는 `publicPath`, `key`, `size`, `sha256`, `contentType`, `cacheControl`만 포함한다. 제목·본문·HTML·비공개 identity·비공개 sequence·credential은 허용하지 않는다.

원본 보존 결정 B를 유지한다. 공급자 지도·LINE 스티커·placeholder는 공개 집합에서 제외하고 장소 링크·재생 안내·작성자 캡션은 보존한다. 직접 제작한 SBS GIF는 유지한다. 제외 수량·원본 확인값은 [이력](history/MEDIA_SERVING_HISTORY_20260909_234338.md)을 따른다.

```sh
npm run media:manifest:check
npm run media:validate:source
npm run media:validate:local
```

- `media:validate:source`는 로컬 미디어 bytes를 읽지 않고 공개 projection·공개 content·공개 asset evidence의 exact set만 검사한다.
- `media:validate:local`은 manifest에 봉인된 전체 로컬 파일의 exact set·크기·SHA-256·MIME/signature를 전수 검사한다. 현재 최종 2,758개·2,346,220,246바이트가 로컬·source-only 검증을 통과했다. 제외한 원본 파일은 로컬 보존 영역에 남지만 공개 manifest와 R2 업로드 대상에는 들어가지 않는다.
- manifest 갱신은 공개 content와 공개 asset evidence가 함께 준비된 경우에만 `media:manifest:write`로 수행한다. 생성 후 digest 변경은 별도 검토 대상이다.

## 2. R2 bucket과 Worker 경계

- production과 staging은 서로 다른 **private** R2 bucket을 사용한다.
- `r2.dev`와 bucket 직접 public custom-domain access를 켜지 않는다. 그렇지 않으면 Worker allowlist와 철회를 우회할 수 있다.
- `wrangler.jsonc`의 staging·production bucket 이름은 각각 실제 private bucket과 일치한다. production Worker는 version 100% 활성 상태이고 `dwnc.me/*` route로 실제 서비스를 제공한다. R2의 `r2.dev`와 bucket custom domain은 계속 꺼져 있다.
- Worker는 `assets.run_worker_first: true`로 모든 요청에서 Static Assets보다 먼저 실행한다. `/media/*`는 tracked media manifest를 따르고, 그 밖의 `GET`·`HEAD`는 tracked public request-surface manifest의 exact path만 허용한다. 허용된 예전 주소 349개는 Static Assets보다 먼저 `docs/EDGE_REDIRECTS_V1.json`의 새 주소로 308 응답하고, 나머지 허용 경로만 `ASSETS`로 전달한다. 철회된 글·예전 주소·검색·RSS·sitemap·aggregate 경로는 cache/asset 조회 전에 동일한 `404 + no-store`로 닫힌다.
- 공개 Worker에는 R2 `LIST`, `PUT`, `DELETE`를 구현하지 않는다.

`/media/*` 요청 계약:

- 허용 method: `GET`, `HEAD`
- 그 외 method: `405`, `Allow: GET, HEAD`
- query, `%`, encoded path, dot segment, 역슬래시, double slash, manifest miss: 동일한 `404 + Cache-Control: no-store`
- active manifest에는 있으나 R2에서 누락된 객체: 같은 404
- R2 오류 또는 manifest와 원격 metadata 불일치: `502 + no-store`, bytes를 제공하지 않음
- `ETag`, `If-None-Match`와 `304`
- 단일 byte Range: `206`, 정확한 `Content-Range`와 slice `Content-Length`
- `If-Range`의 강한 ETag·날짜가 현재 객체와 맞을 때만 Range를 적용하고, 불일치·약한 ETag·잘못된 validator는 전체 `200`으로 처리
- `HEAD`의 Range header는 무시하고 전체 표현의 `200` metadata를 반환
- invalid·unsatisfiable·multiple Range: `416`, `Content-Range: bytes */{size}`
- `Content-Type`, `Content-Length`, `Last-Modified`, `Accept-Ranges: bytes`, `X-Content-Type-Options: nosniff`, immutable cache header
- allowlist와 객체 SHA-256이 포함된 내부 cache key로 full `200`만 Cache API에 저장한다. Range·404·405·416·502는 저장하지 않으며 cache 오류는 R2 원본 조회로 안전하게 우회한다.

비미디어 요청 계약:

- `src/data/public-request-surface-v1.json`은 source-only와 full-local static tree에서 동일하게 파생되는 기존 공개 경로 1,409개 기준선의 결정적 allowlist다. 이후 경로 수는 현재 tracked manifest와 실제 빌드 결과를 기준으로 하며, 고정된 과거 수치를 새 빌드에 강제하지 않는다. SHA-256은 `e143cefe01de35de47495e3fbd036773eb550e58f377e07467014d45f944d594`다. 빌드 결과의 `/404.html` 파일은 Cloudflare가 없는 주소의 오류 화면으로 쓸 수 있도록 유지하지만, 사용자가 직접 열 수 있는 공개 요청 목록에는 넣지 않는다.
- 한 번의 strict decode·NFC 정규화 뒤 exact path가 allowlist에 없거나 encoded traversal·역슬래시·double encoding이면 `ASSETS`와 Cache API를 호출하지 않고 `404 + no-store`를 반환한다.
- allowlist를 통과한 `GET`·`HEAD` 가운데 `docs/EDGE_REDIRECTS_V1.json`의 출발 주소 349개는 정확한 상대 `Location`과 빈 본문으로 308을 반환한다. 요청에 query가 있어도 canonical 새 주소에는 붙이지 않는다. 이때 `ASSETS`, R2와 Cache API를 호출하지 않는다.
- 나머지 allowlist hit의 `GET`·`HEAD`만 `ASSETS.fetch()`에 전달한다. Worker는 정적 HTML 내용을 재작성하지 않는다. `/404.html` 직접 GET·HEAD는 `404 + no-store`이고 `ASSETS`를 호출하지 않는다.

same-origin이므로 기본 CORS header는 넣지 않는다. CORS는 hotlink 방지 수단이 아니다. 공개 미디어 남용은 향후 cache·rate limit·WAF 관측을 통해 별도 결정한다.

### 웹 편집기에서 추가하는 미디어

- 기존 비공개 이전 미디어는 opaque UUID key와 글별 private 소유 기록을 사용한다. 본문·정책·소유 기록은 원자적으로 신규 삽입하고 제목·본문·ID 목록·개별 원본 경로를 로그·Git·공개 빌드에 기록하지 않는다.
- imported SVG·ICO·MP4는 일반 이미지 첨부와 별도 허용 경로를 쓴다. 인증된 관리자만 비공개 소유 파일을 읽으며 SVG는 CSP sandbox, MP4는 단일 byte Range를 적용한다.
- 클립보드 이미지도 기존 첨부와 같은 업로드·소유·새 key·공개 참조 규칙을 쓴다. HTML 소스 변환은 이미지 태그를 제외하고 원격 이미지를 가져오거나 업로드하지 않는다.
- 공개 정책은 본문과 같은 snapshot으로 확인한다. 비공개·예약 전·미인증 보호 글은 canonical·alias·목록·검색·피드·미디어를 모두 제한하며 정적 fallback보다 먼저 검사한다. imported 공유 참조와 native 소유를 각각 확인하고 페이지에도 같은 소유 규칙을 적용한다.
- 새 사이트 아이콘은 `media/site/{UUID}`의 별도 소유 기록과 설정 참조를 확인한 경우에만 공개한다. 제한 응답은 no-store이며 과거 브라우저 사본 회수는 보장하지 않는다.
- 알려진 공백: CSS 배경으로만 참조한 미디어의 공개 전환 참조 수집 보완은 DWNC-CORE-012에서 착수 대기다. 이전 완료와 이 결함의 해결을 혼동하지 않는다.

- 위 2,758개와 그 manifest는 그대로 둔다. 웹 편집기에서 새로 올리는 이미지는 별도 private R2 binding `NATIVE_MEDIA_BUCKET`에 `media/native/{UUID}.{확장자}`라는 새 key로만 저장한다.
- 관리자 Worker만 `PUT`을 가지며 Cloudflare Access JWT의 발급처·대상·만료·서명과 허용 이메일을 애플리케이션에서도 확인한다. 공개 Worker에는 이 bucket의 `GET`·`HEAD`만 있고 쓰기 경로는 없다.
- 허용 형식은 AVIF·GIF·JPEG·PNG·WebP, 한 파일 최대 25MiB다. 브라우저가 계산한 SHA-256을 R2 checksum으로 검사하고, 응답 size와 metadata가 맞은 뒤 D1의 해당 글에 media row를 추가한다.
- 공개 Worker는 D1에서 공개 상태인 글의 본문 또는 대표 이미지로 실제 참조된 media row만 제공한다. 임시 글이나 참조하지 않는 객체는 공개하지 않는다.
- 작업본은 `editor_working_copies`에만 자동저장하고 공개 테이블은 명시적 공개 반영 때 갱신한다. 작업본에서 추가한 사진은 아직 공개하지 않고, 작업본에서 제거한 기존 공개 사진도 공개 반영 전까지 유지한다.
- 기존 key와 새 native key 모두 덮어쓰기·삭제하지 않는다. 업로드는 성공했지만 D1 기록이 실패한 객체도 자동 삭제하지 않으며 공개 경로에서는 보이지 않는다.

## 3. upload-once sync

missing 객체만 `If-None-Match: *`로 신규 생성하고 exact 객체는 재사용한다. SHA-256·크기·MIME 불일치는 중단하며 overwrite·delete는 하지 않는다. orphan은 집계만 하며 자동 삭제하지 않는다. credential은 repository·로그·receipt에 기록하지 않는다.

[상세 인증·업로드·재시도·원격 감사 규칙](MEDIA_OPERATIONS_REFERENCE_20260909_234338.md#3-upload-once-sync)을 따른다. bulk 업로드 기록과 전수 GET/SHA-256 감사 receipt는 구분한다.

## 4. 원격 receipt와 production gate

staging과 production의 account·bucket·전용 trust fingerprint를 분리한다. staging receipt나 서명을 production에 재사용하지 않는다. production gate는 manifest 전체 HEAD와 별도 전수 GET/SHA-256 감사·private exposure·서명 결속을 확인하며 필요한 자료가 없으면 닫힌다.

[receipt·서명·trust·환경 변수 상세](MEDIA_OPERATIONS_REFERENCE_20260909_234338.md#4-원격-receipt와-production-gate)를 따른다.

## 5. 빌드 모드

- full-local: `npm run build` → `npm run build:validate`. 보존 작업공간의 로컬 미디어를 복사·전수 확인한다.
- source-only: `npm run cloudflare:build:source`. 비공개 원본·로컬 미디어를 읽거나 내려받지 않고 tracked 공개 자료로 빌드하며 `dist/media`는 0이어야 한다.
- 운영 반영에는 최종 소스로 새로 만든 묶음을 쓴다. version 업로드와 traffic 적용은 분리하며 실제 승인 범위·정확한 대상·현재 상태를 대조한다. 결과가 불명확하면 배포를 자동 반복하지 않는다.
- raw `wrangler deploy`와 과거 번들 재사용은 허용하지 않는다. [상세 빌드·version-only·staging smoke·승격·최초 생성 규칙](MEDIA_OPERATIONS_REFERENCE_20260909_234338.md#5-빌드-모드)을 해당 경로에서 따른다.

## 6. redirects와 canonical

- `docs/EDGE_REDIRECTS_V1.json`이 provider-neutral 원본이다.
- `public/_redirects`는 해당 원본에서 결정적으로 생성하며 exact 349개의 308 rule만 가진다.
- `/media/*`, wildcard, query, fragment rule은 금지한다.
- Worker도 같은 JSON 원본을 bundle에 직접 포함하고 시작할 때 schema, `https://dwnc.me`, 349개, status 308, 출발·도착 주소 중복, 안전하지 않은 경로와 `/media` 충돌을 거부한다. 요청 query는 canonical `Location`에 전달하지 않는다.
- Static Assets는 `html_handling: drop-trailing-slash`로 Astro `trailingSlash: never`와 맞춘다.
- HTTP→HTTPS, www→apex, `/index.html` 정규화는 이 파일에 임의 추가하지 않고 실제 hosting 승인 뒤 별도 edge 계약으로 검증한다.

## 7. 철회·tombstone·rollback

공개 글을 tombstone 또는 비공개로 전환할 때는 article projection, static request surface와 media allowlist를 함께 갱신한다.

1. 새 manifest에서 해당 public media key 제거
2. 글 canonical·legacy alias·집계 경로를 제거한 static tree와 request-surface manifest, Worker release 검증
3. 새 release 적용
4. article·alias·집계 페이지의 과거 노출과 media가 모두 forward deny 404인지 확인
5. provider cache purge가 가능하면 방어 심화로 실행하되 성공을 보안 경계로 간주하지 않음
6. 보존기간 뒤 별도 승인으로만 remote orphan quarantine/delete 검토

Cloudflare Cache API는 저장 시 쓴 내부 cache key를 사용하므로 공개 URL만으로 모든 캐시 사본을 exact purge할 수 있다고 약속하지 않는다. 보안 경계는 모든 요청에서 Cache API·Static Assets보다 먼저 실행되는 최신 static/media allowlist와, 전체 공개 request surface를 artifact에서 파생해 누적 withdrawn hash와 대조하는 signed promotion head다. 철회 release 뒤 과거 전체 Worker·static·redirect·manifest version을 직접 재승격하거나 `wrangler rollback`하면 재노출될 수 있으므로 verifier가 거부한다. 화면을 되돌릴 때도 최신 projection·redirect·media deny floor를 합성한 새 artifact/version을 만들어 forward rollback한다. staging은 sampling 100%이고 cache smoke는 Bearer token으로 보호한 `workers.dev` endpoint에서 수행한다.

## 8. Cloudflare 진행 이력과 현재 상태

현재 배포와 다음 행동은 [공식 상태](../PROJECT_STATE.md)에서만 관리한다. [과거 실행·인증·감사 이력](history/MEDIA_SERVING_HISTORY_20260909_234338.md)은 필요할 때 조회한다.

2026-09-05 운영 전환에서 production private R2 전수 감사와 Worker 100% 활성화를 완료했다. 기존 apex CNAME을 보존해 Proxied로 전환하고 `dwnc.me/*` route를 연결했으며 기존 Proxied `www` CNAME과 HTTP·www→HTTPS apex 이동을 유지했다. 당시 대표 글·예전 주소·미디어와 데스크톱·390×844 모바일 화면 확인을 완료했다. 이 기록은 이후 전체 상황 점검이나 새 배포의 완료를 대신하지 않는다.
