# dwnc.me 공개 미디어 전달 계약 v1

상태: **staging·production private R2에 최종 2,758개·2,346,220,246바이트 준비와 전체 GET/SHA-256 감사 완료 / production Worker version 100% 활성화 / 기존 apex CNAME 보존·Proxied 전환과 `dwnc.me/*` Worker route 연결 완료 / 기존 Proxied `www` CNAME과 HTTP·www→HTTPS apex redirect 유지 / 실제 대표 글·예전 주소·미디어·데스크톱·모바일 확인 완료 / R2 overwrite·delete와 Git push 0**

이 문서는 공개 글이 참조하는 대용량 미디어를 동일 출처 `https://dwnc.me/media/*`로 제공하기 위한 계약이다. 기존 URL, 로컬 원본, SHA-256 증거를 바꾸지 않고 private R2 bucket을 전달용 복제본으로 사용한다.

## 1. 불변 주소와 manifest

- 공개 URL `/media/...`는 유지한다.
- R2 object key는 URL에서 선행 `/` 하나만 제거한 값이다: `key = publicPath.slice(1)`.
- 같은 SHA-256을 가진 파일이라도 public path가 다르면 별도 객체로 유지한다. URL을 합치거나 deduplicate redirect를 만들지 않는다.
- 한번 사용한 key의 `SHA-256 + size + MIME`은 불변이다. 내용이 달라지면 새 key를 배정하고 기존 key를 덮어쓰지 않는다.
- canonical backup은 기존 로컬 `public/media/`와 공개 source inventory다. R2는 보존 정본이 아니라 delivery replica다.

현재 Git working tree의 결정적 manifest는 `src/data/public-media-r2-v1.json`이다. 아래 첫 표는 2026-08-25의 **정리 전 역사 기준선**이고, 둘째 표는 2026-08-27 전수 검증을 통과한 **현재 최종 기준선**이다. 역사 수치 2,889개를 현재 업로드 대상으로 사용하지 않는다.

| 항목 | tracked pre-curation 기준선 |
|---|---:|
| 객체 | 2,889 |
| 총 바이트 | 2,350,053,092 |
| manifest SHA-256 | `5b9eb93474c0e96b3b371d233b4ea64cc24918a31d0fb754410c968544c2b165` |

| 항목 | 현재 최종 기준선 |
|---|---:|
| 객체 | 2,758 |
| 총 바이트 | 2,346,220,246 |
| manifest SHA-256 | `61bb577d609f97cdb014ef3a14681045fbb3bec616f2b04c8d058519b640c532` |
| full object-set SHA-256 | `9345d2f06c8bd7cda457a9d4335cdc2213e71dcd30bb9e11e6f3e1f8e11ae467` |

manifest entry는 `publicPath`, `key`, `size`, `sha256`, `contentType`, `cacheControl`만 포함한다. 제목·본문·HTML·비공개 identity·비공개 sequence·credential은 허용하지 않는다.

사용자는 B를 선택했다. 지도 공급자 자산 99개는 자산 집합에서 빼고 영향 글 5개의 장소 카드 16개(원 장소 네이버지도 링크 15, 네이버지도 검색 링크 1)로 대체했다. LINE 스티커 5개와 1×1 placeholder 27개는 제외했다. placeholder를 빼도 재생 불가 안내·재생시간 53개와 작성자 캡션 23개는 남고, placeholder를 cover로 쓰던 13개 글의 파생 cover는 `null`이다. 사용자가 직접 제작한 SBS GIF `/media/naver/221172590451/001-e467d08a3a01.gif`는 1,299,862바이트·SHA-256 `e467d08a3a01bf5bcc53c79f2a40e89d0181a8c920e08b62a1a513c3d93656d9`를 그대로 포함했다.

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

- `src/data/public-request-surface-v1.json`은 source-only와 full-local static tree에서 동일하게 파생되는 현재 공개 경로 1,409개의 결정적 allowlist다. SHA-256은 `e143cefe01de35de47495e3fbd036773eb550e58f377e07467014d45f944d594`다. 빌드 결과의 `/404.html` 파일은 Cloudflare가 없는 주소의 오류 화면으로 쓸 수 있도록 유지하지만, 사용자가 직접 열 수 있는 공개 요청 목록에는 넣지 않는다.
- 한 번의 strict decode·NFC 정규화 뒤 exact path가 allowlist에 없거나 encoded traversal·역슬래시·double encoding이면 `ASSETS`와 Cache API를 호출하지 않고 `404 + no-store`를 반환한다.
- allowlist를 통과한 `GET`·`HEAD` 가운데 `docs/EDGE_REDIRECTS_V1.json`의 출발 주소 349개는 정확한 상대 `Location`과 빈 본문으로 308을 반환한다. 요청에 query가 있어도 canonical 새 주소에는 붙이지 않는다. 이때 `ASSETS`, R2와 Cache API를 호출하지 않는다.
- 나머지 allowlist hit의 `GET`·`HEAD`만 `ASSETS.fetch()`에 전달한다. Worker는 정적 HTML 내용을 재작성하지 않는다. `/404.html` 직접 GET·HEAD는 `404 + no-store`이고 `ASSETS`를 호출하지 않는다.

same-origin이므로 기본 CORS header는 넣지 않는다. CORS는 hotlink 방지 수단이 아니다. 공개 미디어 남용은 향후 cache·rate limit·WAF 관측을 통해 별도 결정한다.

### 웹 편집기에서 추가하는 미디어

- 2026-09-08 DWNC-CORE-006 운영 보완: 공개 정책을 본문과 같은 snapshot으로 확인하며 비공개·예약 전·미인증 보호 글은 canonical/alias/목록/검색/피드와 사진 모두 공개하지 않는다. 기존 imported media 소유 및 공유 참조와 native 소유를 각각 검사하고 정적 fallback보다 먼저 제한한다. 응답은 no-store로 전환하되 과거 브라우저 사본 회수는 약속하지 않는다. 페이지도 같은 글별 사진 소유 규칙을 따른다. 새 아이콘은 `media/site/{UUID}`의 별도 소유 기록과 설정 참조가 확인된 경우에만 공개하며 기존 R2 객체를 덮어쓰거나 삭제하지 않는다. 이 보완은 최종 소스의 새 빌드로 운영 반영을 완료했다.

- 위 2,758개와 그 manifest는 그대로 둔다. 웹 편집기에서 새로 올리는 이미지는 별도 private R2 binding `NATIVE_MEDIA_BUCKET`에 `media/native/{UUID}.{확장자}`라는 새 key로만 저장한다.
- 관리자 Worker만 `PUT`을 가지며 Cloudflare Access JWT의 발급처·대상·만료·서명과 허용 이메일을 애플리케이션에서도 확인한다. 공개 Worker에는 이 bucket의 `GET`·`HEAD`만 있고 쓰기 경로는 없다.
- 허용 형식은 AVIF·GIF·JPEG·PNG·WebP, 한 파일 최대 25MiB다. 브라우저가 계산한 SHA-256을 R2 checksum으로 검사하고, 응답 size와 metadata가 맞은 뒤 D1의 해당 글에 media row를 추가한다.
- 공개 Worker는 D1에서 공개 상태인 글의 본문 또는 대표 이미지로 실제 참조된 media row만 제공한다. 임시 글이나 참조하지 않는 객체는 공개하지 않는다.
- 2026-09-07 작업본 CMS는 `editor_working_copies`에만 자동저장하고 기존 공개 테이블을 명시적 공개 반영 때만 갱신한다. 따라서 작업본에 새로 참조한 이미지는 아직 공개하지 않고, 작업본에서 참조를 지운 기존 공개 이미지도 공개 반영 전까지 유지한다. 공개 Worker의 기존 참조 검사는 변경하지 않는다. 사용자 승인 후 빈 작업본 테이블과 관리자 버전을 운영에 적용했으며 공개 Worker·기존 글·R2 객체는 바꾸지 않았다.
- 기존 key와 새 native key 모두 덮어쓰기·삭제하지 않는다. 업로드는 성공했지만 D1 기록이 실패한 객체도 자동 삭제하지 않으며 공개 경로에서는 보이지 않는다.

## 3. upload-once sync

`scripts/inspect-public-media-r2.mjs`는 validator 자격증명으로 remote `LIST` pagination과 manifest key 전수 `HEAD`만 수행한다. `scripts/sync-public-media-r2.mjs`는 uploader 자격증명의 기본 dry-run과 create-only 적용을 담당한다. 두 명령 모두 S3-compatible API를 SigV4로 서명하되 URL·credential을 출력하지 않는다.

운영 명령은 네 개의 legacy R2 환경변수를 사용자가 직접 넘기지 않는다. 자격증명은 macOS Keychain에 보관하고, repository 밖의 create-only metadata 파일 절대경로만 `R2_CREDENTIAL_METADATA_PATH`에 지정해 `scripts/run-with-r2-credentials.mjs` wrapper를 실행한다. wrapper는 package command에 고정된 환경과 역할을 선택하고 metadata와 Keychain 값을 대조한 뒤, 자격증명 bytes를 익명 pipe FD 3으로 한 번만 child에 전달하고 메모리 buffer를 지운다. 사용자가 `--environment`, `--role`, credential metadata 인자를 덧붙이거나 legacy 자격증명 환경변수·FD를 함께 지정하면 실행 전에 거부한다.

credential 값은 저장소·manifest·receipt·로그에 기록하지 않는다. 2026-08-27 당시 uploader `dwnc-me-public-media-staging-uploader-v3-20260827`은 exact staging bucket Object Read & Write, validator `dwnc-me-public-media-staging-validator-v2-20260827`은 같은 exact bucket Object Read only로 제한했고 둘 다 Active·TTL 2026-09-03으로 관측됐다. uploader access-key ID·metadata SHA-256은 각각 `6a6df74afbbc4a47fe050b11997b41b6e5e7ba9d02884eb69bb9ac88d82bb976`·`6d92f8e095050757c407bf31a02e8358c4064e7b9852f44c98037de7f331721e`, validator는 `be4156f1e29c6282568d18e504d11888907e0df9c8f67a551318a839c735ee5a`·`03011557f3ae08f1128c10bd5df0508dc50e0bdbbc5652de08f63f05e142fe0c`다. 이는 현재 상태가 아닌 날짜가 고정된 역사 기록이다.

생성 실패 과정에서 비밀값 노출 가능성이 생긴 uploader v2는 즉시 revoked했다. 현재 확인된 상태는 이번 감사 validator 원격 폐기·목록 부재와 대응 Keychain 항목 부재, 기존 validator의 과거 Inactive 관측이다. uploader와 나머지 기존 원격 token의 정확한 현재 상태는 미확정이며 별도 확인 없이 삭제하지 않는다.

```sh
# 업로드 직전 validator 읽기 전용 분류. 현재 원격 기대값을 네 수치 모두 고정한다.
# receipt parent는 저장소 밖의 본인 소유 mode 700 디렉터리여야 한다.
R2_CREDENTIAL_METADATA_PATH=/approved/local/path/staging-validator-metadata.json \
  npm run media:r2:staging:inspect:secure -- \
  --expected-manifest-sha256=<approved-final-manifest-sha256> \
  --expected-git-commit=<approved-clean-full-git-commit> \
  --expected-git-tree=<approved-clean-git-tree> \
  --expected-exact=1 \
  --expected-missing=2757 \
  --expected-mismatch=0 \
  --expected-orphan-count=0 \
  --receipt-output=/approved/local/path/staging-r2-inspection-pre-bulk-v2.json

# 이미 존재하고 HEAD exact인 대표 객체 하나를 PUT 없이 full GET/SHA-256 검증한다.
R2_CREDENTIAL_METADATA_PATH=/approved/local/path/staging-validator-metadata.json \
  npm run media:r2:staging:validate-one:secure -- \
  --key=<exact-manifest-key> \
  --expected-manifest-sha256=<approved-final-manifest-sha256> \
  --expected-git-sha=<clean-exact-full-git-sha> \
  --receipt-output=/approved/local/path/staging-r2-one-object-validation-v1.json

# 직전 account·bucket·manifest·Git·원격 네 수치가 모두 맞을 때만 missing을 만든다.
R2_CREDENTIAL_METADATA_PATH=/approved/local/path/staging-uploader-metadata.json \
  npm run media:r2:staging:sync:secure -- --apply \
  --expected-manifest-sha256=<approved-final-manifest-sha256> \
  --expected-orphan-count=0 \
  --expected-git-commit=<approved-clean-full-git-commit> \
  --expected-git-tree=<approved-clean-git-tree> \
  --receipt-output=/approved/local/path/staging-r2-bulk-sync-v1.json

# 업로드 뒤 validator가 exact 2,758·나머지 0을 다시 강제한다.
R2_CREDENTIAL_METADATA_PATH=/approved/local/path/staging-validator-metadata.json \
  npm run media:r2:staging:inspect:secure -- \
  --expected-manifest-sha256=<approved-final-manifest-sha256> \
  --expected-git-commit=<approved-clean-full-git-commit> \
  --expected-git-tree=<approved-clean-git-tree> \
  --expected-exact=2758 \
  --expected-missing=0 \
  --expected-mismatch=0 \
  --expected-orphan-count=0 \
  --receipt-output=/approved/local/path/staging-r2-inspection-post-bulk-v2.json

# bulk와 post-inspection이 끝난 뒤 새로 수집한 fresh capture를 사용해,
# 같은 validator로 전체 2,758개를 GET/SHA-256 감사한다.
R2_CREDENTIAL_METADATA_PATH=/approved/local/path/staging-validator-metadata.json \
  npm run media:r2:staging:audit:full:secure -- \
  --expected-manifest-sha256=<approved-final-manifest-sha256> \
  --expected-orphan-count=0 \
  --expected-git-commit=<approved-clean-full-git-commit> \
  --expected-git-tree=<approved-clean-git-tree> \
  --bucket-exposure-capture=/approved/local/path/staging-r2-exposure-capture-after-bulk.json \
  --receipt-output=/approved/local/path/staging-r2-full-audit-v1.json

# 실제 Cloudflare 요청 없이 production 감사 진입점·client와 최종 원본 전량을 시험한다.
npm run media:r2:staging:audit:full:offline:test
```

인터넷 없는 전량 시험은 clean 임시 Git source snapshot에서 실제 `audit-public-media-r2-full.mjs`와 R2 client를 실행한다. full audit client만 `maxAttempts: 3`과 요청별 120초 제한을 사용한다. 이 제한은 응답 헤더 대기와 각 LIST/GET 전체 body streaming에 각각 적용하며, 공용 client 기본값과 bulk retry 정책은 바꾸지 않는다. receipt의 `requestCounts`는 성공한 논리 작업 수가 아니라 실제 전송 시도 수다. 논리 작업 수는 원격 객체 수를 반영한 LIST page 수, manifest 객체별 HEAD 2,758·GET 2,758이며, LIST·HEAD·GET 실제 시도 수는 각각 논리 작업 수 이상이면서 3배 이하여야 한다. 안전한 실행 요약은 논리 작업 수, 실제 시도 수, 둘의 차이인 작업별 retry 수와 전체 retry 수를 구분한다. PUT·DELETE는 정확히 0이어야 한다. final manifest의 로컬 원본 2,758개·2,346,220,246바이트를 read-only fake R2 응답으로 streaming하는 무통신 정상 시험은 장애가 없으므로 LIST 3→HEAD 2,758→GET 2,758, 총 5,519회와 retry 0을 그대로 확인한다. receipt의 manifest SHA-256은 `61bb577d609f97cdb014ef3a14681045fbb3bec616f2b04c8d058519b640c532`, full object-set SHA-256은 `9345d2f06c8bd7cda457a9d4335cdc2213e71dcd30bb9e11e6f3e1f8e11ae467`이어야 한다. 같은 결과 경로로 두 번째 실행하면 정확한 create-only 오류가 나며 R2 요청 0·기존 inode와 bytes 불변이어야 한다. 시험 결과는 격리된 mode 700 임시 폴더에만 만들고 종료 때 제거한다. 이 시험은 실제 Cloudflare·R2·Keychain·clipboard를 사용하지 않으므로 실제 staging R2 전수 감사 완료 근거가 아니라 실행 경로의 예행연습이다.

무통신 시험 요약은 `dwnc-r2-full-audit-offline-summary-v2` 계약을 쓴다. `liveNetworkCalls: 0`, `actualSocketCalls: 0`, `keychainCalls: 0`, `clipboardCalls: 0`처럼 증가할 수 없는 고정 숫자는 기록하지 않는다. 대신 HTTP·socket·DNS·WebSocket·worker·cluster·inspector·금지된 자식 프로그램·보관함·클립보드 등 각 보호 wrapper가 원래 함수 호출 전에 `blocked*Attempts`와 종류·순서를 증가시킨 뒤 정해진 오류로 중단한다. 차단 시험은 실제 `cluster.fork()`, `inspector.open()`, `new inspector.Session().connect()` 진입도 포함한다. 성공 경로에서 원래 자식 프로그램을 실행하는 경우는 정확한 읽기 전용 Git과 격리된 `secure_openat.py`뿐이며 `allowedOriginalChildCalls`, 명령별 수치와 순서를 함께 기록한다. 따라서 `blocked*Attempts: 0`은 그 성공 실행에서 금지 시도가 wrapper에 들어오지 않았다는 뜻일 뿐, 실제 socket 호출 수를 별도로 관측했다는 주장으로 사용하지 않는다.

검사 명령은 staging·validator 역할에 고정되어 `--apply`, production 환경 주입, uploader metadata, overwrite·delete 인자를 받지 않는다. 원격 요청은 bucket 목록 조회 `GET`과 객체별 `HEAD`뿐이며 PUT·DELETE 코드 경로가 없다. 호출자가 exact·missing·mismatch·orphan 기대값 네 개를 빠짐없이 지정해야 하며 하나라도 실제 수치와 다르면 성공으로 기록하지 않는다. v2 검사 기록은 기대값과 실제값, manifest·account fingerprint·bucket·Git commit/tree와 실제 `LIST/HEAD/GET/PUT/DELETE` 요청 수를 담고 저장소 밖의 mode 700 디렉터리에 create-only·mode 600으로 기록한다. 이 기록은 release용 `full-get-sha256` receipt를 대신하지 않는다.

bulk apply와 full audit는 어떤 `LIST`·`HEAD`·`PUT` 또는 대용량 `GET`보다 먼저 receipt 목적지를 완전히 검사한다. 부모 디렉터리는 현재 사용자 소유 mode 700이어야 하고, 대상이 이미 있거나 symlink·hardlink·안전하지 않은 상위 경로·쓰기 불가 상태이면 원격 요청 0·receipt 0으로 중단한다. 최종 기록도 같은 canonical create-only writer만 사용한다. 두 명령은 명시한 Git commit/tree와 clean 상태를 `HEAD→status→HEAD` 순서로 원격 요청 전, 원격 검사 뒤, receipt 기록 직전에 총 세 번 확인한다. tracked drift나 HEAD/tree 이동이 있으면 receipt를 만들지 않는다.

업로드 전 bucket 설정 확인용 capture와 full audit에 결속하는 capture는 서로 다른 증거다. 설정 확인 capture를 만든 뒤 bulk upload를 먼저 수행하고 그 파일을 감사에 재사용하지 않는다. bulk upload와 exact 2,758·missing/mismatch/orphan 0 post-inspection을 마친 뒤 새 900초 capture를 수집하고 곧바로 full audit를 시작한다. 첫 원격 요청 전에 capture가 fresh·private이며 exact account/Git/bucket에 결속됐는지 검사하고, 만료된 capture로는 새 감사를 시작하지 않는다. 이 검사를 통과해 시작한 단일 감사는 2,758개 전체 GET/SHA-256 처리 중 capture가 만료되어도 같은 실행의 receipt 후보를 만들 수 있다.

단일 객체 검증 명령도 staging·validator 역할에 고정한다. clean HEAD와 명시한 full Git SHA, tracked manifest의 exact key, account fingerprint와 private bucket을 첫 요청 전에 결속한다. `HEAD→status→HEAD`를 순서대로 읽는 Git 검사를 원격 요청 전, HEAD+GET 후, create-only receipt 기록 직전에 반복해 tracked file이나 HEAD가 중간에 바뀌면 기록을 만들지 않는다. R2 client의 `maxAttempts=1`로 자동 재시도를 끄고 HEAD와 status 200의 전체 GET을 각각 정확히 한 번만 허용하며, receipt 요청 수도 HEAD 1·GET 1·PUT 0·DELETE 0이어야 한다. body는 메모리에 전부 쌓지 않고 streaming SHA-256으로 확인한다. `206`, `Content-Range`, 짧거나 긴 body, metadata/checksum/ETag/Last-Modified drift, HEAD↔GET 세대 차이와 한쪽에만 있는 version ID를 거부한다. 기록은 Git SHA·manifest/entry SHA·key·bytes/SHA·MIME/cache·platform checksum·ETag·Last-Modified·nullable version을 담는다.

Cloudflare 계정 번호는 로그인 열쇠가 아니지만 잘못된 계정에서 작업하는 일을 막는 확인 표지이므로 사진 업로드용·검사용 열쇠와 분리한다. 기본 순서는 `cloudflare:account-target:preflight` → Cloudflare 화면의 **Copy** 1회 → `cloudflare:account-target:init`이다. 사전검사는 정책·기본/고정 recovery 경로·기존 metadata·전용 Keychain 상태와 클립보드 도구의 사용 가능 여부만 확인하고 clipboard read 0·clear 0을 반환한다. 이 단계나 그보다 앞에서 실패하면 기존 clipboard를 읽거나 비우지 않는다. 초기화는 사전검사가 `ready`일 때만 계정 번호 읽기를 시도하고, 시도한 뒤에는 성공 여부와 관계없이 즉시 clipboard를 비운다. 메인 전용 자체 브라우저에서는 별도의 명시적 `in-app-browser-visible-account-id-buffer-v1` source를 사용할 수 있다. 이 경로는 화면에 보이는 Account ID를 메인이 정확히 한 번 읽고 출력·파일 기록 없이 즉시 exact 32-byte lowerhex owned Buffer로 바꾼 뒤에만 라이브러리에 넘긴다. 라이브러리는 DOM 문자열을 받지 않으며 전달받은 Buffer를 즉시 별도 소유하고 호출자 Buffer를 0으로 덮는다. source는 1회만 읽을 수 있다. `initializeCloudflareAccountTarget`에 전달한 뒤에는 사전검사·경로·의존성·source 선택을 포함한 성공·실패 모두 cleanup하고, 독립 preflight만 호출했다면 값을 읽지 않고 유지하므로 호출자가 즉시 cleanup해야 한다. evidence에는 kind·preflight/read 횟수·ownership 이전·실제 retained byte 수(32 또는 0)·cleanup과 정확한 `clipboardRead: false`, `clipboardCleared: false`만 남긴다. 이 경로에서도 fingerprint mismatch는 Keychain·metadata write 전에 중단하고, 저장 직전 상태 재확인·create-only·사후검증은 기본 경로와 같다. 이후 올바른 staging 계정 확인값인지 검사하고, 저장 직전에 Keychain과 두 metadata 위치를 다시 확인한 뒤 Keychain 항목과 primary metadata를 create-only로 만든다. 성공 뒤에는 Keychain 값과 primary의 canonical 내용이 일치하고 recovery가 없는 정상 상태인지 다시 확인한다. 기존 항목은 덮어쓰지 않는다. loader는 metadata를 첫 확인하고 Keychain 값을 읽은 뒤 metadata를 다시 확인하고 Keychain 값을 두 번째로 읽는다. 두 Keychain 값이 exact 일치하지 않거나 중간에 사라지면 token·API·Wrangler·child·쓰기 같은 후속 작업을 0회로 유지한다. `runBoundedChild`는 native child를 최대 15,000ms만 실행하고 `SIGTERM` 뒤 250ms, `SIGKILL` 뒤 250ms의 상한으로 반드시 settle한다. stdout·stderr는 각각 고정 상한을 넘으면 종료하며 input·stdout·stderr·수집 chunk와 호출자가 받은 buffer까지 정상·nonzero·signal·spawn/stream/stdin 오류·oversize·timeout·never-close에서 모두 0으로 덮는다. clipboard는 실제 read attempt 뒤 성공·실패 경로의 `finally`에서 비운다. `cloudflare:account-target:inspect`는 `verifyCloudflareAccountTarget`만 사용해 raw account string allocation 0이다. 실제 consumer 경계에서만 `accountIdBytes.toString('ascii')`가 소스와 동적 시험 모두 정확히 1회이며, 이 문자열은 언어 특성상 buffer처럼 0으로 덮을 수 없으므로 출력·파일 기록 없이 참조를 즉시 버리는 것이 보안상 남는 한계다. 계정 번호 관리 명령과 읽기 작업 runner는 기본 경로와 명시 경로 모두 정규화된 경로·실제 경로가 repository 밖인지 먼저 확인한다. repository 내부, 실제 repository를 가리키는 경로, 기존 ancestor symlink는 정책·Keychain을 읽거나 clipboard 내용을 읽기 전에 `CLOUDFLARE_E_ACCOUNT_STORE_LOCATION`으로 거부하며 원래 경로를 출력하지 않는다. 보호된 확인 파일에는 원래 계정 번호를 넣지 않고 스키마, Keychain 항목 이름, 계정 확인값, 생성 시각과 용도만 기록한다. 저장 도중 확인 파일이 비어 있거나 일부만 남으면 Keychain 항목과 실패 파일을 삭제·덮어쓰기하지 않는다. `cloudflare:account-target:recover`와 loader의 recovery 경로는 primary의 `.json` 이름에서 파생한 exact `-recovery.json` 하나뿐이며, 외부 호출자가 같은 폴더의 다른 경로를 넣어도 Keychain 읽기 전에 거부한다. 두 파일이 모두 불완전하면 새 복구 파일을 자동으로 늘리지 않고 `CLOUDFLARE_E_ACCOUNT_STORE_RECOVERY_EXHAUSTED`로 중단하며, 기존 두 파일과 Keychain 항목을 그대로 보존한다.

자체 브라우저의 Node 환경과 일반 macOS Node 환경을 분리해야 할 때는 `cloudflare:account-target:loopback:init`만 사용한다. 이 명령은 고정 project root에서 full Git commit·tree와 일반/untracked clean 상태를 확인한 뒤 `127.0.0.1`의 임시 port에만 60초 동안 bind하고, 초기화 직전 같은 Git 확인을 한 번 더 한다. protocol은 magic 8 bytes, version 1 byte, 정책 SHA-256 32 bytes, crypto-random nonce 32 bytes, exact lowerhex Account ID 32 bytes가 이어지는 105 bytes다. 첫 연결 하나의 정확한 frame만 받고 split 전송은 허용하지만 초과·미달·trailing·두 번째 연결·wrong magic/version/policy/nonce/account 형식은 초기화 전에 중단한다. nonce는 이 1회 연결을 위해 ready JSON에만 60초 동안 예외적으로 공개하며 argv·환경변수·파일에는 넣지 않는다. Account ID는 argv·환경변수·파일·socket 응답·일반 출력에 넣지 않고 브라우저 client, 수신 chunk와 내부 Buffer를 성공·실패 모두 0으로 덮는다. host는 4KiB 이하의 고정 schema ready JSON 한 줄과 final JSON 한 줄만 쓰고 stack·경로·원문은 출력하지 않는다. 인증 뒤에는 기존 `InAppBrowserAccountIdBufferSource`·initializer·verify를 그대로 사용하고 60초 processing watchdog을 건다. 실패·timeout·결과 불명은 재시도·recover·delete를 자동 실행하지 않고 durable state를 `none` 또는 `unknown`으로만 기록한 뒤 중단한다.

localhost를 쓰지 않는 보조 경로는 `cloudflare:account-target:stdin:init`의 secure non-echo TTY stdin receiver다. 고정 Git commit·tree·clean을 시작 때와 입력 직후 두 번 확인하고, `READY` 뒤 한 줄 최대 33바이트에서 exact 32-byte lowerhex만 받아 `InAppBrowserAccountIdBufferSource`와 기존 initializer에 넘긴다. bounded input timeout, `SIGTERM`·`SIGHUP`·종료의 모든 경로에서 echo를 복구하고 입력·source·buffer를 정리하며 고정된 안전 상태만 출력한다. 이 구현은 commit `4467a7e468a6aa72f3f26c4e12e9ce3b8d5c9779`·tree `9c6505ef46393b139c923ad5a43f0605c4b14611`에 기록됐고 stdin 112·account-target 698·diff 검사 PASS, 독립 지적 0, push 0이다. 다만 자체 브라우저 virtual clipboard는 Mac 시스템 clipboard와 공유가 보장되지 않으며 비민감 1회 probe도 browser write 1·macOS read 1·match false·system clipboard write 0이었다. 비민감 Terminal 시험은 receiver `READY` 뒤 Computer Use가 `com.apple.Terminal`로 값을 전달하기 전에 정책으로 차단해 local paste·receiver input 0, receiverStopped·echoRestored true였고 브라우저 시험 clipboard를 비웠다. 재시도·대체 앱 우회는 하지 않는다. 따라서 이 receiver는 제품이 안전한 로컬 target을 허용하거나 사용자가 원문을 도구 출력 없이 직접 입력하는 명시적 handoff가 있을 때만 사용한다.

account-target native child environment는 exact 7 keys다. `HOME`·`USER`·`LOGNAME`은 `os.userInfo()`에서, `PATH`는 `/usr/bin:/bin:/usr/sbin:/sbin`, `LANG`·`LC_ALL`은 `C`, `__CF_USER_TEXT_ENCODING`은 uid에서 계산한다. parent `process.env`의 `TMPDIR`, 모든 proxy, `DYLD_*`, `NODE_*`, Cloudflare·R2·AWS 값은 전달 0이며 proxy·DYLD·Node poison 값도 전달 0이다. 객체는 `Object.create(null)`로 만들고 `Object.freeze`하며, clipboard/Keychain instance의 `environment` property도 writable false·configurable false여서 항목 추가·변경·교체를 모두 거부한다. 시험용 `NATIVE_SPAWN_GUARD`는 `in globalThis`로 존재만 검사하고 값을 읽거나 함수로 호출하지 않으며, 존재하면 실제 `spawn` 전에 고정 오류로 중단한다.

2026-08-28 계정 대상 시험을 보강하던 중 mock `store` 연결 한 곳이 빠져 기본 native spawn 경로가 사용됐다. `/usr/bin/security find-generic-password … -w` 실제 read command 1회가 확정됐고 second read 0, Keychain write/update 0, clipboard/network/Cloudflare 0이었다. 실제 account-target 초기화와 metadata 쓰기도 0이다. 이후 `Symbol.for('dwnc.cloudflare.account-target.native-spawn-guard.v1')` 전역 감시를 시험 시작부터 설치해 예기치 않은 native spawn을 즉시 실패시키도록 했고, account-target 610 assertions와 당시 전체 26 suites·15,024 assertions, 이번 전체 27 suites·15,076 assertions 재실행에서 추가 native spawn 0을 확인했다.

private-exposure control-plane 증거 수집은 `cloudflare:r2:exposure:fetch` 하나로 제한한다. 부모 작업에 원래 계정 번호를 입력받지 않고 위 전용 Keychain 항목을 metadata 재검사 전후 두 번 읽어 정책의 staging account fingerprint와 두 값이 모두 일치하는지 먼저 확인한다. 중간 변경·삭제면 token read·API·child start·write를 0회로 유지한다. 사진 업로드용·검사용 Keychain 항목은 읽지 않는다. 목적은 `staging-r2-private-exposure-read`, 대상은 exact bucket `dwnc-me-public-media-staging`만 허용한다. token 권한은 대상 account 하나의 `Workers R2 Storage: Read`만 쓰고 만료는 생성 뒤 15분 이내로 둔 뒤 capture 직후 즉시 revoke한다. Cloudflare API token의 resource 범위는 account 단위이므로 exact bucket 제한은 이 로컬 명령의 고정 path·GET-only audit가 추가로 강제한다. 짧은 수명의 token은 macOS clipboard에서 한 번 읽고 즉시 지운 뒤 framed anonymous pipe FD 3으로 child에만 전달한다. 성공·실패에서 clipboard를 비우고 그 값을 담은 메모리 buffer를 0으로 덮는다. 계정 번호는 필요한 child의 환경에만 전달하며 argv·token frame·stdout·stderr에는 넣지 않는다. child의 credential decoder는 한 번만 호출하되 FD 내부에서는 frame 최대 길이+1의 고정 buffer로 EOF까지 반복해서 읽는다. frame이 먼저 완성돼도 writer EOF 전에는 성공하지 않고, 여러 chunk와 지연 도착은 허용하되 trailing byte·길이·digest·oversize drift는 거부한다. token을 환경변수·argv·디스크·Keychain에 두지 않으며 legacy token 환경변수, 부모 account 환경변수와 inherited FD는 첫 요청 전에 거부한다. non-secret expected Git commit/tree는 별도 환경으로 결속한다.

수집기는 원격 요청 전·세 GET 뒤·receipt 직전에 exact HEAD·tree·clean 상태를 다시 확인한다. 요청은 재시도 없이 `GET /accounts/{account}/r2/buckets/dwnc-me-public-media-staging` → managed-domain GET → custom-domains GET의 정확히 세 번뿐이고, POST·PUT·PATCH·DELETE·HEAD는 모두 0이어야 한다. 각 응답 body는 stream으로만 읽고 1MiB까지 보존한다. BYOB reader가 가능한 실제 fetch body는 1MiB+1번째 byte에서, 일반 reader는 처음 초과 chunk를 관측한 즉시 cancel하고 이후 producer를 소비하지 않는다. 200과 non-200에 같은 cap을 적용하며 UTF-8은 replacement 없이 fatal decode한다. 첫 응답의 jurisdiction을 canonical `default`로 검증한 뒤 세 요청 모두 `cf-r2-jurisdiction: default`를 적용한다. bucket location `apac`, storage class `Standard`, `r2.dev` 비활성, custom domain 0이 아니면 receipt를 만들지 않는다. raw API body는 저장소 밖의 본인 소유 mode 700 디렉터리에 create-only·mode 600으로만 보존하고, 일반 출력에는 account fingerprint·response SHA-256·canonical 필드와 요청 수만 남긴다. 실제 capture 직후 token은 폐기한다.

capture 파일 생성 뒤 canonical evidence 파일 생성이 실패하거나 첫 파일 쓰기의 성공 여부만 불명확한 경우에는 새 credential이나 API 재호출 없이 `cloudflare:r2:exposure:recover`를 사용한다. recovery는 외부 mode 600 canonical capture의 contract·raw response SHA·nested evidence·900초 freshness, tracked policy의 account fingerprint·exact bucket, 명시한 Git commit/tree와 현재 clean 상태를 다시 검증하고 evidence가 없을 때만 create-only로 생성한다. capture를 수정·삭제·재생성하지 않으며 evidence가 이미 있거나 capture 변조·만료·wrong Git/account/bucket이면 중단한다. 따라서 recovery 결과의 credential read와 API request는 모두 0이다.

Cloudflare의 현재 [공식 S3 호환표](https://developers.cloudflare.com/r2/api/s3/api/)에서 R2는 `HeadObject`와 `GetObject`를 지원하지만 `GetBucketVersioning`과 `PutBucketVersioning`은 지원하지 않는다. 따라서 S3 응답의 `x-amz-version-id`는 필수 무결성 header가 아니다. 없으면 canonical `null`로 기록한다. HEAD와 GET 양쪽에 있으면 값이 정확히 같아야 하고, 양쪽 모두 없으면 허용하며, 한쪽에만 있으면 세대가 달라진 것으로 보고 실패한다. 두 경우 모두 key·ETag·Content-Length·Content-Type·Cache-Control·Last-Modified·객체 SHA-256 metadata·manifest-entry SHA-256·platform SHA-256 checksum을 계속 정확히 대조하므로 version-id 허용 변경이 무결성 검사를 느슨하게 만들지 않는다.

적용 규칙:

- missing object만 `If-None-Match: *` create-only PUT
- body SHA-256 checksum과 객체별 크기·MIME·cache metadata 저장. 객체 metadata에는 전체 manifest digest를 넣지 않아 append·철회 때 기존 immutable 객체를 재업로드하지 않는다.
- 429·5xx·network 오류만 bounded exponential retry
- 성공 응답 유실 뒤 재시도에서 412가 나면 HEAD가 exact일 때만 idempotent 성공
- `--environment`와 `wrangler.jsonc`의 exact bucket을 첫 원격 요청 전에 대조해 staging/production 교차 오조작을 거부
- mismatch는 중단하며 overwrite하지 않음
- orphan은 개수만 보고하고 삭제하지 않음
- resume은 재실행 HEAD 결과를 기준으로 하며 로컬 journal을 권위 자료로 삼지 않음
- apply 완료 뒤 만드는 `dwnc-public-media-r2-bulk-sync-v1` receipt는 업로드·재시도·post-HEAD 결과를 남기는 운영 증거일 뿐이다. release artifact나 `media-receipt` signer 입력으로 사용하지 않으며, signer도 이 contract를 거부한다.
- 서명 가능한 미디어 receipt contract는 `dwnc-public-media-r2-receipt-v1`뿐이다. 단일 객체 admission이 exact인 최종 집합을 전수 GET·SHA-256 감사해 `full-get-sha256` 검증 수준을 얻은 뒤 별도 보호 환경에서만 서명한다.
- apply는 첫 inspection의 exact 객체를 건너뛰고 missing 객체만 조건부 PUT한다. 중간 실패 뒤 재실행하면 이미 exact가 된 객체는 다시 PUT하지 않는다.
- bulk receipt는 `initialMissing`, `exactSkipped`, `conditionalCreateOperations`, 실제 `If-None-Match:*` 요청 수, `actualCreated`, exact 객체로 확인해 복구한 412 수, 전후 exact·missing·mismatch·orphan, 실제 `LIST/HEAD/GET/PUT/DELETE` 수를 구분한다. `DELETE=0`과 overwrite 0이 아니면 유효하지 않다.
- post-inspection은 exact 2,758·missing 0·mismatch 0·승인 orphan 0을 모두 강제한다. 하나라도 다르면 `apply-complete`를 출력하거나 receipt를 만들지 않는다.

## 4. 원격 receipt와 production gate

staging bulk receipt와 staging full-audit receipt, 향후 production full-audit receipt를 구분한다. staging의 `dwnc-public-media-r2-bulk-sync-v1`은 운영 기록이며 서명하지 않는다. staging 전체 감사가 만드는 `dwnc-public-media-r2-receipt-v1`만 staging `media-receipt` key로 별도 서명할 수 있고, 그 서명은 staging artifact에만 유효하다. 향후 production은 production account·bucket을 대상으로 새 exposure capture와 전수 GET/SHA-256 감사를 수행해 별도의 production receipt를 만들고 production 전용 `media-receipt` 신뢰값으로 서명해야 한다. staging receipt나 서명을 production으로 승격하거나 재사용하지 않는다.

production receipt는 manifest digest, 객체 수·총 bytes, 검증시각과 key별 size·SHA-256·MIME·ETag·canonical Last-Modified·nullable S3 version ID뿐 아니라 target environment·bucket·Cloudflare account fingerprint와 검증 수준을 canonical ordering으로 담는다. 집합 단위 manifest 결속은 이 receipt에서 수행하고, detached Ed25519 signature와 public key trust anchor를 함께 검증한다.

tracked `src/data/public-media-release-policy-v1.json`은 Worker binding·bucket·요구 검증 수준과 `r2.dev 비활성·custom domain 0`인 private exposure 정책을 고정한다. staging media Ed25519 public-key SPKI fingerprint는 `69cb5866228f1624693b0903e60d52b0c046464040da621b2d144cb8bffb2182`, release fingerprint는 `2655be4122fb2238d47ba539b8e86aa9d39899631a7d713106ce711ea2de1ac2`다. production media fingerprint는 `3277f416d8657bebaff3dcfcbe57dafd683fdfc6cefe36306b5046ca48ff890a`, release fingerprint는 `11b44ae3c3c8743ede7881ea40ebf59243711246d100e3383ad23b220c5cc0bb`로 고정했다. private key는 macOS Keychain에만 보관하고 export하지 않는다.

production remote 검증 entrypoint의 비자격증명 증거 경로:

- `PUBLIC_MEDIA_REMOTE_RECEIPT_PATH`
- `PUBLIC_MEDIA_REMOTE_SIGNATURE_PATH`
- `PUBLIC_MEDIA_REMOTE_PUBLIC_KEY_PATH`
- R2 자격증명은 wrapper가 `R2_CREDENTIALS_FD=3`으로 전달하며 legacy access-key 환경변수 네 개를 직접 받지 않는다.

```sh
npm run media:validate:remote
npm run cloudflare:verify:production
```

exact Wrangler `4.125.0`은 로컬 dependency와 lock에 설치·고정됐지만, 현재 실제 production receipt·signature·credential·trust fingerprint가 없으므로 위 production gate는 의도적으로 fail closed한다. 합성 Ed25519 fixture만 저장소 안에서 target 결속과 signature를 검증하며 실제 서명을 만들어 내지 않는다.

서명 receipt만으로 이후 원격 삭제를 증명할 수 없으므로 production gate는 봉인된 최종 manifest 전체의 HEAD를 매번 수행한다. 최초 upload 뒤에는 validator 역할에 고정된 `media:r2:staging:audit:full:secure`로 최종 manifest 전체 원격 GET·SHA-256·총 바이트를 감사하고 그 결과만 `full-get-sha256` receipt 후보로 발급한다. 감사 전에 secure receipt 목적지와 exact Git commit/tree/clean 상태를 검사한다. bulk와 post-inspection 뒤 새로 수집한 900초 canonical private-exposure capture를 exact SHA-256으로 결속하고, 첫 원격 요청 전에 capture가 fresh·private이며 exact account/Git/bucket에 결속됐는지 검사한다. 이 검사를 통과해 시작한 단일 감사 실행은 전수 HEAD/GET 해시 도중 capture가 만료되어도 완료할 수 있지만, 만료된 capture로 새 감사 실행을 시작하거나 재사용할 수는 없다. receipt는 실제 `LIST/HEAD/GET/PUT/DELETE` 수, 전체 object/byte 수, key·size·SHA를 정렬해 계산한 full object-set SHA-256, 감사 `startedAt`, Git commit/tree와 세 번의 Git 검사, exposure capture SHA-256을 담는다. 역사 기준선 2,889개를 최종으로 간주하지 않으며, 실제 서명은 보호 환경에서 별도로 수행한다.

## 5. 빌드 모드

### 보존 작업공간의 full-local 빌드

```sh
npm run build
npm run build:validate
```

기존 동작을 유지하며 `public/media`를 `dist/media`로 복사하고 local bytes를 전수 검증한다.

### Cloudflare source-only 빌드

```sh
npm run cloudflare:build:source
```

- 임시 public directory에는 tracked `_redirects`와 `.assetsignore`, 고정된 나눔 글꼴 6개와 LICENSE/README만 넣고, 빌드된 static tree에서 공개 request-surface manifest를 다시 계산해 최신 tracked manifest와 일치시킨다. 2026-09-08 로컬 보완의 최종 경로 수는 1,417개다. `/404.html` 파일은 빌드에 남지만 이 공개 목록에서는 제외한다. public 전체나 local media는 복사하지 않는다.
- local media를 읽거나 내려받지 않고 manifest↔renderable reference exact set을 검증한다.
- `dist/media`는 0이어야 한다.
- 기존 route·alias·검색·RSS·sitemap·taxonomy·link·privacy validator를 remote-media mode로 그대로 실행한다.
- Worker·R2·redirect fixture는 mock만 사용하며 live network call은 0이다.
- private root가 없는 경로를 주입하고 private directory를 만들지 않는다.

Cloudflare release는 순환하지 않는 두 단계로 나눈다.

1. `cloudflare:prepare:production`은 clean Git SHA와 `WORKERS_CI_COMMIT_SHA`가 같을 때만 source-only build를 수행한다. Wrangler dry-run의 생성시각 README·source map·metafile 경로는 버리고 안정적인 `worker.js` bytes, static tree, upload/promotion 전용 config, redirects, media manifest·signed remote receipt만 read-only artifact에 결속한다. 이 core에는 build UUID·시각·Cloudflare version ID가 없다.
2. 보호 환경의 짧은 Ed25519 upload authorization이 artifact SHA, account fingerprint, Worker name, source SHA, build UUID, nonce와 만료를 승인한다. `cloudflare:upload:production-version`은 보호된 고정 attempt directory에 authorization SHA를 no-replace로 소비한 뒤 exact artifact의 `worker.js`를 `versions upload --no-bundle --strict`로만 올린다. 첫 API 요청 전 account·Worker·artifact·Wrangler version·empty env·resource auto-create 금지를 확인하고, `WRANGLER_OUTPUT_FILE_PATH`의 session과 정확히 한 개의 `version-upload` event를 검사하며 traffic은 바꾸지 않는다.
3. `cloudflare:version:fetch`가 exact version ID를 `versions view --json`으로 다시 읽고 raw stdout SHA, script ETag, handlers, runtime, bindings, assets, annotation을 artifact와 대조한다. 보호 signer가 만든 짧은 version attestation 없이는 다음 단계로 갈 수 없다.
4. 같은 payload의 staging upload는 별도 signed secret authorization이 승인한 `DWNC_STAGING_SMOKE_TOKEN` 한 값만 더한다. token은 암호학적 난수 32바이트를 padding 없는 base64url 43문자로 표현한다. repository 밖의 mode-600 외부 파일을 regular file·non-symlink·link count 1·inode·size로 검증해 읽은 bytes를 익명 pipe FD 3, 즉 `/dev/fd/3`으로만 Wrangler `--secrets-file`에 전달한다. 중간 regular 임시 파일은 만들지 않고 전달 뒤 메모리 buffer를 지우며 argv·환경·NDJSON·artifact·result에 평문을 넣지 않는다. 이후 별도 signed activation authorization과 lock 안에서 다시 읽은 exact previous-version 100% status를 검증한 뒤 `cloudflare:staging:activate`가 전용 최소 config로 exact ID를 100%에 올린다. timeout·nonzero·split·unknown은 pending/invoking/outcome과 lock을 보존하고 자동 재실행하지 않으며, owner-dead·5분 경과 exact token의 status-only recovery에서 target 100%가 확인될 때만 candidate를 확정한다. candidate 기록 직후 hard-exit recovery는 현재 attempt의 claim·pending·invoking과 committed outcome에서 재도출한 candidate bytes가 exact 일치할 때만 lock을 정리한다. 이어 Bearer로 보호한 `https://dwnc-me-staging.dwnc.workers.dev`에서 version marker, 일반 페이지 GET·HEAD 2건, `/404.html` GET·HEAD 2건, media GET·HEAD·304·206·416 5건, 349 redirects의 GET·HEAD 698건, cache 1~3건과 무인증 차단 1건을 확인한다. 첫 cache 확인이 성공하면 총 709건이고, 실제 cache 확인 횟수에 따라 전체 요청 수를 receipt에 기록해 staging status와 smoke/probe receipt를 production 후보에 결속한다.

staging 원격 점검 runner는 token 파일을 읽거나 child를 시작하기 전에 tracked manifest/policy와 staging artifact 전체를 검증한다. 이어 `docs/EDGE_REDIRECTS_V1.json`에서 결정적으로 렌더한 349개가 tracked `public/_redirects`, sealed artifact `static/_redirects`, artifact receipt의 `redirectsSha256`과 byte-exact인지 확인한다. collector도 같은 canonical 349개 배열만 받아 URL을 만들며 exact HTTPS origin 밖의 URL은 받지 않는다. absolute·protocol-relative·query·backslash·duplicate·extra-token 변조 fixture는 fetch 0, token read 0, child start 0으로 실패한다.

각 smoke HTTP 요청은 기본 10초, 전체 실행은 8분, body cancel은 100ms로 제한한다. 응답은 `Accept-Encoding: identity`로 받고 필요한 body만 streaming reader로 읽으며 GET media/cache는 manifest size, `/about`은 sealed static size, Range는 1 byte, HEAD·304·416·redirect body는 0 byte를 상한으로 한다. 필요 없는 404·cache miss·unauthenticated body와 완료되지 않은 reader는 즉시 cancel하고 모든 timer를 정리한다. `/about`은 sealed SHA-256·size·MIME, cache HIT media는 manifest SHA-256·size·ETag·MIME를 확인한다. 304는 GET과 같은 ETag·empty body, 416은 GET과 같은 ETag·`Content-Range: bytes */{size}`·empty body를 요구한다. wrong body/digest/size/etag/mime/header, nonempty 304/416, never-ending·oversize·abort·cancel fixture를 거부한다. child stdout/stderr는 write callback과 backpressure drain을 absolute deadline 안에서 모두 기다리고, error/close/never-drain이면 output을 닫은 뒤 관련 promise가 모두 settle한 다음 buffer를 0으로 덮는다. 전용 staging 시험 179 assertions와 인터넷·외부 프로그램 차단 보강 전 전체 Cloudflare 27 suites·15,076 assertions가 통과했다. 고정된 프로그램 원본 157개·SHA-256 `b67874a204d71b05da4678847c7bf56acce2a3ee5eb5ce532f6a3ee77cfad9db`에서 마지막 R2 전량 예행연습을 2026-08-28 19:14:54.924 KST에 완료했고, 전량 194 assertions·차단 경계 152 assertions·영향 범위 829 assertions를 통과했다. 실행 전후 source SHA-256은 같았다. 금지 경로는 원래 호출 전에 차단됐고 외부 Cloudflare·R2·보관함·클립보드 작업은 수행하지 않았다. 이번 변경은 로컬 파일 12개의 commit 전 상태이고 push는 0이다.
5. `cloudflare:promotion:verify`는 version attestation, 최신 full-media/private-exposure receipt, staging 동일-payload 증거, 보호된 signed active head, signed pre-status와 시한부 signed promotion authorization을 검증한다. source Git ancestry, 단조 generation, 누적 withdrawn surface와 retired artifact/payload/version을 통과한 exact `versions deploy <ID>@100%` argv 배열과 그 SHA만 승인 범위로 만든다.
6. 앞 단계의 서명·상태 조건이 통과하면 `cloudflare:promotion:execute`는 authorization을 영구 one-time claim하고 권위 store lock을 잡은 뒤 status를 다시 읽어 active version 100%를 fresh CAS한다. 기술적 선행 조건이 모두 맞는데도 단순히 추가 승인을 받기 위해 임의로 중단하지 않는다. `execFile`로 exact argv를 한 번만 수행하고 raw command/status와 구조화 outcome을 no-replace로 보존한다. target 100%일 때만 signed active head를 원자 교체한다. 이전 version 100%, split, timeout 또는 unknown은 모두 ambiguous로 lock·pending·증거를 유지하며 자동 재시도하지 않는다. owner가 죽고 5분이 지난 뒤에만 `cloudflare:promotion:lock-status -- --include-recovery-token`으로 얻은 exact token을 같은 executor에 전달해 deployment를 다시 실행하지 않는 명시적 status-only recovery를 수행한다.

artifact upload config는 `find_additional_modules=false`를 강제한다. promotion config에는 assets·bindings·vars·routes·triggers·observability가 없어 traffic 변경 뒤 비버전 설정 PATCH가 섞이지 않는다. 현재 top-level 이름은 안전장치가 아니다. Workers Builds가 이름을 override할 수 있으므로 raw `wrangler deploy`는 production overwrite 위험이 있는 P0 blocker다.

Cloudflare Dashboard의 최신 Stage 3 Builds guard exact readback은 올바른 account fingerprint와 일치했고 다음과 같다.

- `SKIP_DEPENDENCY_INSTALL=1`
- Build: `npm ci && npm run cloudflare:prepare:production`
- Deploy: `npm run cloudflare:upload:production-version`
- Version: `npx wrangler versions upload`
- traffic promotion은 Git trigger 밖의 별도 승인 job

변경 전 readback은 `Build=None`, `Deploy=npx wrangler deploy`였고, 변경 후 raw live deploy 설정·실행은 0이다. 원격 admission 직전 private staging bucket은 객체 0, `r2.dev` 꺼짐, custom domain 0, jurisdiction `default`, location `APAC`, storage class `Standard`로 재확인했다. exact bucket 한정 uploader·validator는 Active이고 2026-08-25의 사용 불가능한 기존 두 token은 후속 정리 전까지 Active다. staging Worker `dwnc-me-staging`은 아직 없다. 최초 Worker가 부재한 환경에서는 `versions upload`로 bootstrap할 수 없으므로, route·custom domain·trigger·asset·binding 0인 deny-all service를 signed service-existence evidence·one-time authorization 아래 한 번만 만든다. 실제 `dwnc.me` 도메인과 DNS는 Cloudflare Worker에 연결되지 않았다.

최초 생성 절차의 로컬 안전장치는 다음과 같이 보강했다. 이는 아직 Cloudflare에 Worker를 만든 것이 아니라, 실제 실행 전에 잘못된 대상을 걸러 내는 검사 규칙을 완성한 것이다.

- 생성 전 계정의 `workers.dev` 하위 이름을 별도 API로 읽어 정확히 `dwnc`인지 확인하고, 원래 계정 번호 대신 계정 확인값과 함께 서명 자료·1회용 허가에 묶는다. 실행 직전 15초 이내에 다시 읽고, 생성 뒤에도 값이 바뀌지 않았는지 확인한다.
- deny-only 설정은 `workers_dev=false`, `preview_urls=false`, 추가 module 탐색 금지, `logpush=false`, tail consumer·tag 없음으로 고정한다. observability는 전체·logs sampling `1`, logs enabled, invocation logs disabled, persist enabled, 외부 log destination 없음이고 traces는 disabled·destination 없음·propagation policy 없음이어야 한다. 공식 API에서 `logs.persist`가 생략되면 문서화된 기본값 `true`로만 해석하고, 명시적인 `false`나 `null`은 거부한다. 그 밖에 공식 API가 생략할 수 있는 기본값도 같은 의미로만 정규화하며, 문서에 없는 새 설정 key나 값 변화는 성공으로 넘기지 않는다. 생성 뒤 [`/script-settings` 공식 API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/settings/methods/get/) 원본 응답과 SHA-256을 보존한다.
- 생성 결과의 version 상세에서 binding 0·asset 없음·fetch handler를 확인한다. 이어 [`/content/v2` 공식 API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/content/methods/get/)의 multipart 응답에서 module 정확히 1개만 인정하고, 내려받은 바이트와 SHA-256이 로컬 `DENY_ALL_WORKER_SOURCE`와 완전히 같아야 한다. `cf-entrypoint`가 있으면 exact `deny-all-worker.js`만 허용하고, 없으면 exact 단일 module이 증명될 때만 그 이름으로 추론해 근거 종류를 따로 기록한다. quoted boundary, header·parameter 순서와 대소문자, 허용 preamble·epilogue·boundary 공백, filename·part MIME 생략 같은 표준 표현 차이는 허용하되 part 본문 바이트는 바꾸지 않는다. 단순한 `verified=true` 표시는 성공 근거로 사용하지 않는다.
- 생성 뒤 [현재 deployment 목록](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/deployments/methods/list/)을 먼저 읽고, deploy 가능한 version 목록·account subdomain·script 공개/미리보기 상태·전체 script settings·content·version detail 여섯 응답을 읽은 뒤 deployment를 다시 읽는다. 이 8개짜리 묶음을 연속 두 번 확인한다. deploy 가능한 version과 deployment는 각각 정확히 하나여야 하고, 각 묶음 안에서 앞뒤 deployment 원문과 ID·설명·strategy·전체 version 배분이 같아야 한다. 두 묶음의 의미 상태도 같고 승인된 하나의 version ID가 100%일 때만 기록을 만든다. 같은 version 100%여도 deployment ID가 바뀌거나 중간 목록이 잠깐 달라졌다 돌아오면 실패한다.
- 모든 GET은 `Accept-Encoding: identity`로 압축하지 않은 응답을 요구한다. 서버가 gzip·br 등 다른 압축 형식을 보내면 본문을 읽기 전에 취소한다. 정상 응답뿐 아니라 오류 응답도 공통 streaming reader로 최대 1MiB까지만 읽는다. `Content-Length`가 더 크면 읽기 전에, 길이를 알 수 없는 응답은 1MiB를 한 바이트라도 넘는 즉시 body를 취소한다. JSON은 `application/json`과 UTF-8만 허용한다. 생성 직전 Worker 부재·계정 하위 이름, Wrangler 생성 결과, 생성 뒤 상태 A·B의 총 5종 원본 자료는 사용자 홈 아래 정해진 프로젝트 전용 보호 폴더에 primary와 고정 recovery 한 자리만 사용해 새 파일로 기록하고 덮어쓰지 않는다. recovery는 primary가 미완성일 때만 허용하며, 완성됐지만 대상·내용이 다른 primary나 안전한 파일 읽기 실패를 우회하지 않는다. 후보에는 실제 경로 대신 응답 역할·요청 확인값·status·시작/완료 시각·byte 수·SHA-256과 deployment/version 결속값만 넣는다. 계정 원본 번호·token·Authorization·전체 API URL·절대 경로는 출력·증거 파일에 넣지 않는다. 절대 경로 검사는 쉼표·세미콜론·괄호·대괄호·따옴표·제어문자 뒤의 macOS/POSIX·Windows·UNC 경로까지 거부하지만, 저장소 안의 안전한 상대경로와 정상 HTTPS·Workers 주소는 허용한다.
- 실제 생성 이후의 전체 흐름은 별도 실행 코어로 분리했다. 코어는 network·명령 실행·시각·Git 검사·보호 파일 검사와 읽기/쓰기·임시 파일 기능을 모두 호출자가 빠짐없이 전달해야 하며, 실제 기능으로 자동 대체하거나 OAuth·일반 `HOME` 로그인 정보에 기대지 않는다. 빈 값·일부만 전달한 경우 첫 API와 Wrangler 실행 전에 거부한다. 정상 흐름은 생성 직전 GET 2회, `prepared → one-time claim → started → 봉인 Wrangler 1회 → result → 현재 상태 A/B → status receipt` 순서로 고정한다. 1회용 허가 파일, 단계 기록 3개, 상태 primary/recovery, 원본 5종의 primary/recovery와 최종 후보까지 고정 출력 18개는 첫 API 전에 모두 안전성과 부재를 확인한다. 생성 직전 두 원본을 쓴 뒤에도 아직 만들지 않은 출력과 recovery 자리를 다시 확인한다. 기존 후보·부분 파일·recovery·허가 파일이나 안전하지 않은 상위 폴더가 있으면 API·Wrangler를 0회로 유지한다.
- 1회용 허가 creator는 기존 21-field `dwnc-cloudflare-bootstrap-authorization-v1`만 만든다. staging 고정 CLI `cloudflare:staging:bootstrap-authorization:create`는 service 부재와 account subdomain에 대한 receipt/signature/public-key 절대경로 6개와 저장소 밖 output 절대경로만 받는다. 두 증거는 tracked release key 서명, `exists=false`, exact account fingerprint·environment·Worker·`dwnc` subdomain·request hash·만료가 모두 맞아야 한다. 현재 clean HEAD와 tree를 생성 전·저장 전·저장 뒤 대조하지만 기존 허가에는 `sourceGitSha`만 기록하고 schema·consumer·executor·recovery나 approval/tree field는 추가하지 않는다. creator는 기존 export의 deny source/config SHA와 fresh request hash·최대 15초, crypto UUIDv4와 32바이트 nonce hash, 현재 시각부터 정확히 5분인 TTL을 사용한다. 기존 validator가 승인한 canonical 후보만 mode 600 create-only로 쓰고 exact 재읽기하며, 후보 서명은 기존 signer만 사용한다. account ID·token 원문은 입력·출력·파일·argv·환경변수에 두지 않는다.
- 승인 만료와 Git 상태는 첫 GET 직전, 1회용 허가를 기록하기 직전, 허가 기록 뒤 생성 명령을 실행하기 직전까지 세 번 확인한다. 세 번 모두 현재 HEAD가 허가의 `sourceGitSha`와 같고 tracked 변경과 일반 untracked 파일이 없어야 하며, 확인 중이나 허가 기록 뒤의 HEAD/tree 이동과 승인 만료도 거부한다. `dist/`, `.astro/`, `public/media/`, 비공개 원본처럼 `.gitignore`에 명시된 생성물·로컬 자료는 이 Git 상태에 포함하지 않지만, bootstrap payload는 repository가 아니라 새 임시 폴더의 exact 차단 코드·설정·빈 env 파일만 사용하고 추가 module 탐색을 꺼 두었으므로 이 파일들이 업로드 입력에 들어갈 경로가 없다. 임시 출력 닫기나 임시 폴더 삭제가 실패하면 원래 오류가 있었는지와 무관하게 경로·비밀값 없는 고정 cleanup 오류로 중단한다.
- 가짜 API·가짜 Wrangler와 프로젝트 밖 임시 보호 폴더로 정상 완료, 비밀값 유입, 생성 도구 실패, 1MiB 초과 출력, 생성 뒤 설정 불일치, entrypoint 불일치, 모든 고정 출력 충돌, Git dirty·중간 변경·허가 만료, 임시 파일 닫기·삭제 실패를 끝까지 시험했다. 이 절차를 처음 완성했을 당시의 중간 점검에서는 로컬 모의 전체 Cloudflare 시험 23개·5,689개 확인이 통과했고, 이 중 최초 생성 검증·실행 코어 시험은 4,126개였다. 실행 코어 시험은 가짜 API 85회·가짜 Wrangler 8회를 사용했으며 실제 network·Cloudflare 변경·배포는 0회였다. 이후 인증 전달 기반까지 포함한 현재 전체 수치는 아래 기록과 프로젝트 상태 문서의 최신 점검 결과를 따른다.
- 생성 명령이 성공한 뒤 결과 기록 전에 작업이 끊기는 상황의 status-only 복구를 로컬에 완성했다. `cloudflare:staging:service:bootstrap:recover`는 같은 생성 명령·Wrangler·whoami를 다시 실행하지 않는다. 인증은 정확한 계정의 `/tokens/verify`와 `/workers/subdomain` GET 각 1회로만 하고, 이 2회를 현재 Worker 상태 A/B GET과 분리해 최종 기록에 계수한다. 부모의 로컬 확인 뒤 다른 실행이 상태 기록을 먼저 완성한 경우에도, 이번 부모의 인증 GET 2회·이번 자식의 상태 GET 0회·기록에 남은 과거 총 요청 수를 서로 섞지 않는다. 자식은 `기존 기록인지·기록된 총 요청 수·이번 자식의 상태 요청 수`만 4KiB 이하 한 줄 canonical JSON으로 반환하고 부모가 형식과 상태 기록 일치를 다시 확인한다. 준비 기록은 있으나 시작 기록이 없고 두 번 모두 Worker가 없으면 `never-started`, 시작 기록 뒤 두 번 모두 없으면 `absent-after-start`, 시작 기록 뒤 exact deny code·설정·subdomain·workers.dev 비활성·단일 version·단일 deployment 100%가 두 번 같으면 `exact-recovered`다. 원래 결과 기록에 version ID가 있으면 두 조회의 version과도 같아야 한다. 여러 version/deployment, 분할 적용, 조회 변화, 기록·시각 손상, 시작 기록 없이 Worker가 존재하는 경우는 `ambiguous`로 기존 자료를 보존하고 중단한다. deploy 가능한 version 목록은 `page=1..10`, `per_page=50`의 고정 범위에서 모든 쪽의 `result_info`와 전체 수·중복·변화를 검사해 전체가 정확히 하나임을 증명한다. 500개는 10쪽을 모두 읽고 단일 version 조건 위반으로 처리하며, 501개·11쪽·중복·쪽 사이 전체 수 변화는 경계에서 거부한다. 첫 상태 기록이 미완성일 때만 고정 recovery 파일 한 곳을 쓰며, 그 위치는 운영체제가 알려 주는 현재 사용자의 홈 폴더로만 계산하고 인수·환경변수·일반 호출 옵션으로 바꾸지 못한다. 완성된 primary 또는 `부분 primary + 완성 recovery` 기록은 서명 자료·단계 hash chain·시간 순서·현재 Git·분류를 다시 계산한 뒤 Keychain·token 검증·whoami·작업 자식·API를 모두 0회로 유지한다. 원래 생성 runner의 metadata/preflight/permission 확인값은 준비 기록에 고정하고, 지금 복구 runner의 세 확인값은 상태 기록에 별도로 고정하므로 같은 최소 권한의 새 짧은 수명 token으로 복구할 수 있다. 정확한 대상 계정 한 곳에만 유효한 짧은 수명 Account API token 전달 도구의 로컬 바탕도 완성했다. Cloudflare 화면에서 공식 API 권한명 [`Workers Scripts Write`](https://developers.cloudflare.com/fundamentals/api/reference/permissions/), 사용자 화면에서는 `계정 > Workers Scripts > Edit` 한 가지만 선택해야 한다. Cloudflare API는 이 최소 권한 밖의 권한이 없는지 token 확인 응답으로 알려 주지 않으므로, 생성 직전 화면의 권한 요약을 확인하는 것이 실제 최소 권한 확인 근거다. User Details 권한은 추가하지 않는다.

  token은 새 Account API token의 정확한 53자 형식(`cfat_` + 영문·숫자 40자 + 소문자 16진수 확인부 8자)만 허용한다. 접두사 없는 예전 token, 길이가 다른 값, 밑줄이 섞인 값, 16진수가 아닌 확인부는 첫 API 전에 거부한다. 다음 날 만료를 기본으로 하되 시작부터 만료까지 48시간 이하, 실행 시 남은 시간 60분 이상이어야 한다. R2·DNS·Zone·KV·route·삭제·production 명령은 허용 목록에 없다. 전용 Keychain 항목과 프로젝트 밖의 고정 기본/예비 metadata는 create-only이고 덮어쓰기·삭제하지 않는다. 현재 canonical payload의 정확한 최대치는 원문 402바이트·base64url 536자이며, 실제 Keychain과 시험용 MemoryStore 모두 1,024자 상한을 적용하고 1,025자는 거부한다. 기존 서명 private key의 512자 형식 검증은 넓히지 않았다. metadata에는 계정·token·token ID 원문과 계정 이름 대신 domain-separated SHA-256 확인값, 활성 상태, 시작·만료·확인 시각, 권한 계약 확인값만 기록한다. 초기화는 두 metadata 위치의 안전성과 부재를 Keychain·clipboard·API보다 먼저 확인하고 기록 직전에 대상 위치를 다시 확인한다. 복구도 primary와 거기서 정해지는 recovery 한 곳의 안전성·부재·완성·부분 상태를 먼저 분류한다. 안전하지 않거나 이미 완성된 출력과 충돌하면 Keychain·API·쓰기 0회로 멈추며, primary가 일부만 기록되고 recovery가 비어 있을 때만 recovery를 새로 쓴다. Keychain 저장 뒤 metadata 기록이 중단되면 기존 항목을 바꾸지 않고 고정 예비 파일 한 곳으로만 복구하며, 두 파일이 모두 불완전하면 자동 진행하지 않는다.

  실행 runner는 token 확인 API의 `success=true`와 빈 `errors`를 함께 요구하되 `messages` 배열의 안내는 허용하고, 잘못된 HTTP 상태나 압축 응답은 본문을 취소한다. 이어 exact account의 `/workers/subdomain`이 `dwnc`인지 읽고, 고정 Wrangler 4.125의 `whoami --json`이 `Account API Token`·계정 정확히 1개·exact ID인지 확인한다. User Details를 추가하지 않아 email은 요구하지 않는다. runner는 3KB 안내 launcher가 아니라 실제 `wrangler-dist/cli.js` 20,524,522바이트의 SHA-256과 실행에 필요한 최소 묶음 660파일·207,434,085바이트의 경로·실행권한 분류·개별 내용 확인값을 고정 tree SHA-256으로 검증한다. 검증 직후 이 전체 묶음을 격리 인증 폴더에 create-only로 복제하고, 일반 파일은 mode 400·실행 파일은 mode 500으로 바꾼 뒤 파일 목록·바이트·tree SHA를 다시 확인한다. `.bin` shebang, 원본 launcher와 PATH의 `node`는 실행하지 않고 현재 `process.execPath`로 격리된 실제 CLI 사본을 직접 실행한다. 그보다 먼저 별도 SHA-256으로 고정한 탐색 차단기를 Node의 `--require`로 불러, Node 기본 모듈과 격리 사본 안의 파일만 허용하고 상위 `/private/tmp/node_modules` 같은 외부 package 경로는 실행 전에 막는다. Node 자체도 permission mode에서 읽기·쓰기를 격리 인증 폴더 하나로 제한하고 child process 권한을 주지 않는다. WebSocket 선택 보조 package도 `WS_NO_BUFFER_UTIL=1`과 `WS_NO_UTF_8_VALIDATE=1`로 고정한다. HOME·XDG·임시 폴더와 0바이트 env file은 새 빈 폴더에 만들고 PATH는 `/usr/bin:/bin`으로 고정한다. `.env`·부모 환경·`NODE_OPTIONS`·저장된 OAuth·외부 extra·로그·사용량·오류 보고를 사용하지 않는다. token은 부모 env·argv·regular file에 넣지 않고 framed anonymous FD 3으로 허용된 작업 자식에만 전달한다. Wrangler를 실제 실행하는 최종 자식에서만 `CLOUDFLARE_API_TOKEN` 환경변수를 만든다. FD가 없거나 쓰기가 일부에서 실패하거나 자식 실행·종료가 실패하면 write FD를 닫고 `SIGTERM`, 필요하면 `SIGKILL`로 종료한 뒤 bounded `close` 확인을 마쳐야 격리 폴더를 정리한다. byte buffer는 0으로 덮는다. JavaScript 문자열은 언어 특성상 같은 방식으로 덮을 수 없으므로 열쇠를 담았던 반환 객체와 Wrangler 자식 환경 객체의 필드를 사용 직후 빈 문자열로 바꾸고 남은 참조를 즉시 버린다. service 존재 확인과 workers.dev 상태 확인은 token을 읽은 뒤 정책·계정 확인이 실패해도 `finally`에서 열쇠를 비운다. service 존재 확인, workers.dev 상태 확인, bootstrap, status-only bootstrap recovery는 새 runner에만 연결하고, 과거 읽기 전용 runner의 workers.dev 분기와 공개 `:fd` npm 명령은 제거했다. 복구 명령은 sealed Wrangler를 호출하지 않고 GET만 허용하며, bootstrap 생성 명령만 sealed Wrangler 자식을 정확히 한 번 호출한다. version upload·상세 확인·deployment 상태·activation·workers.dev enable은 허용된 이름으로만 등록했으나 기존 로컬 검증을 새 credential helper에 안전하게 연결하기 전에는 token 읽기·API·Wrangler 0회로 중단한다. 실제 token 생성·Keychain·clipboard·Cloudflare 검증은 아직 0회이며, 사용을 마치면 사용자가 Cloudflare 화면에서 token을 폐기해야 한다.

  terminal local cleanup에는 새 코드를 만들지 않고 기존 PLAN-05 절차를 쓴다. Cloudflare UI에서 exact token 행을 한 번 삭제하고 새로고침 뒤 부재가 확인된 경우에만 고정 service `me.dwnc.cloudflare-staging-worker-control.v1`·account `dwnc:staging:workers-scripts-edit`의 `security delete-generic-password`를 정확히 한 번 실행한다. 이어 같은 identity를 `-w` 없이 presence-only로 조회해 exit 44를 확인하고 primary/recovery metadata와 immutable evidence는 보존한다. 원격 대상이나 삭제·부재가 모호하면 local delete는 0회다.

  deny-only 최초 생성 공개 진입점은 현재 staging만 허용한다. production 입력은 계정 번호·token·FD를 읽기 전에 `CLOUDFLARE_E_BOOTSTRAP_ENVIRONMENT`로 거부한다. production 최초 생성은 별도 최소 권한 runner·복구 계약·승인이 준비되기 전에는 사용할 수 없다.

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

아래의 날짜별 staging 실패·복구 문단은 당시 판단 근거를 보존한 역사 기록이다. 현재 권위 상태는 이 절의 마지막 문단과 [`PROJECT_STATE.md`](../PROJECT_STATE.md)를 따른다.

2026-08-25 당시 사전점검에서 올바른 Cloudflare account fingerprint가 정책과 exact 일치했다. 원격 작업 직전 private staging bucket `dwnc-me-public-media-staging`은 객체 0이었고 dashboard 관측값은 `r2.dev` 꺼짐, custom domain 0, jurisdiction `default`, location `APAC`, storage class `Standard`였다. 최초 validator inspection은 exact 0·missing 2,758·mismatch 0·orphan 0으로 통과했다. 이어 첫 key에 create-only PUT을 최대 1회 수행했으나 post-HEAD에서 `x-amz-version-id` 부재를 당시 parser가 거부해 admission receipt는 만들어지지 않았다. 호환 commit 뒤 PUT 없이 다시 검사해 해당 객체 1개가 exact이고 missing 2,757·mismatch 0·orphan 0임을 확인했다. 두 번째 읽기 전용 검사 기록 SHA-256은 `27bf50a94fb6166a01201f3fb3a4a2dfc954b3d983e29a47f53ea38cbab31cd3`이다. 당시 exact bucket 한정 Object Read & Write uploader와 별도 Object Read validator는 Active·TTL 2026-09-03이었고 실패 uploader v2는 revoked했으며, 사용 불가능한 기존 두 token도 Active로 관측됐다. 이는 당시 상태의 역사 기록이다. 현재는 기존 validator 하나가 Inactive였던 관측만 확정됐고 나머지 기존 원격 token 상태·정리는 미해결이다. staging media·release Ed25519 private key는 macOS Keychain에만 보관하고 public fingerprint를 policy에 고정했다. staging Worker, smoke token, version, activation은 없다.

단일 객체 validator-only HEAD+streaming full-GET 명령은 source commit `df3c678456f6af3471d846a32e28faa5751b9a2e`·tree `bbe8306cbf6577cd556533079593872020ddc8b5`에 포함됐고 push는 0이다. 같은 source에서 대표 객체를 PUT 없이 검증해 request HEAD 1·GET 1·PUT 0·DELETE 0, ETag `"d3ded31a7b52f467702909afbc7d5340"`, Last-Modified `2026-08-27T00:24:12.000Z`, version `null`을 확인했다. 검증 시각은 `2026-08-27T05:07:48.418Z`, validation receipt SHA-256은 `fa72b1849496a9b6e4697721cfef9d4fcd17b8f463b41dcacd714c5f9bb2352a`다. 이어 `2026-08-27T05:09:09.996Z`에 inspection을 다시 수행해 exact 1·missing 2,757·mismatch 0·orphan 0을 확인했고 post-one inspection receipt SHA-256은 `f00f3c13c9ae99f8a36599db85d7a180e31d8779776653bca72c2aee596d380e`다.

현재 최종 manifest는 2,758개·2,346,220,246바이트·SHA-256 `61bb577d609f97cdb014ef3a14681045fbb3bec616f2b04c8d058519b640c532`이고 full object-set SHA-256은 `9345d2f06c8bd7cda457a9d4335cdc2213e71dcd30bb9e11e6f3e1f8e11ae467`이다. 로컬·source-only·build·Worker 회귀와 실제 감사 진입점의 인터넷 없는 2,758개 전량 예행연습을 통과했다. bulk 안전장치는 commit `ccec8bb855e45ef679a4b99faf0f0633a99e089e`·tree `241a654acc387233d4e2d5e076754b345619e9ac`에 기록했고 push는 0이다. 같은 source의 clean 상태에서 pre exact 1·missing 2,757·mismatch 0·orphan 0을 확인하고 기존 1개를 건너뛴 채 missing 2,757개만 조건부 생성했다. bulk와 독립 post-inspection 모두 exact 2,758·missing 0·mismatch 0·orphan 0이며 overwrite·DELETE는 0이다. bulk receipt SHA-256은 `2974384ff720326830f5f3dcd9e2439dc56af4ec96c813bade88a2d0b7815444`, post-inspection receipt SHA-256은 `f562129e14a65918bfebac26de313ff5e461ad3067774f9084a0e0514def0d84`다. 정리 전 2,889개는 역사 기준선일 뿐 현재 원격 작업 기준이 아니다. 로컬 전량 예행연습은 실제 staging R2의 full GET/SHA-256 receipt를 대신하지 않는다.

private-exposure 설정 확인에 쓰려고 만든 읽기 전용 API token 두 개는 안전한 전달에 실패해 각각 API GET 0·capture 0 상태로 폐기했다. 이후 계정 번호와 짧은 읽기 전용 열쇠를 서로 분리했다. 계정 번호 쪽은 복사 전에 아무것도 읽거나 지우지 않는 사전검사와, 읽기 시도 뒤에만 즉시 비우는 초기화로 나눴다. 전용 계정 번호 사전검사·보관·복구 시험 610개와 control-plane 전달 시험 81개, 기존 private-exposure 시험 145개가 모두 통과했다. 여기에 시험용 Worker 관리 열쇠 보관·복구·계정 확인·FD 전달·격리된 Wrangler 시험 378개, 중단 복구 1,023개, 실제 runner→복구 자식 139개, R2 전량 예행연습을 포함했다. 인터넷·외부 프로그램 차단 보강 전의 전체 Cloudflare 로컬 검사는 27개 묶음·15,076개를 통과했고, 현재 원본으로 전량 예행연습 전용 194개와 차단 경계 전용 152개를 통과했다. native child의 15초→TERM→KILL 상한, 모든 성공·실패 buffer 0, exact 7-key environment와 parent secret/settings 전달 0, presence-only guard와 proxy/DYLD/Node poison 전달 0, verify-only inspect의 raw string 0과 실제 consumer 경계의 string 1회를 포함한다. 개발 중 mock 누락으로 실제 Keychain read command 1회가 있었고 second read 0, Keychain 저장·변경 0, clipboard·network·Cloudflare 0이었다. 전역 guard 뒤 추가 native spawn도 0이다. 계정 대상 변경은 명령 등록과 처리·검사 파일 4개에 한정됐고, 실제 Keychain·metadata 초기화와 계정 번호 저장은 0회였다. token 값과 raw account ID는 기록하지 않았다. 계정 번호 저장 전 사전검사는 이미 준비 완료다. 앞으로 브라우저 작업은 Codex 자체 브라우저만 사용하고 Chrome과 Edge는 사용하지 않는다.

현재 자체 브라우저의 계정은 이 프로젝트의 staging 확인값과 정확히 일치함을 이미 한 번 확인했고, 같은 세션과 탭에서는 반복 확인하지 않는다.

연결 대기를 15초에서 60초로 늘린 최소 변경은 commit `5a49c79fbd1e4d76d22fe736f6d22940aa6c856e`·tree `f246b062473f5544d3ea432dbd7d2864a2d63086`에 기록했다. 전용 시험·기존 회귀시험·독립 검토를 통과했고 push는 0회다. 이전 브라우저 탭 확인 도구 출력에 계정 식별자가 포함된 URL이 1회 표시된 사실은 그대로 유지하되 원문과 URL을 다시 기록하지 않았다. 첫 실제 실행의 `BRIDGE_E_BIND`는 일반 격리 환경의 localhost bind 제한이 원인으로 확인됐고, 권한 확장 host를 정확히 1회 시작해 ready를 받았다. 자체 브라우저 client send 1회는 `BRIDGE_E_CLIENT_CONNECT`로 실패했고 host는 accepted connection 0회 후 `BRIDGE_E_TIMEOUT`·`durableState=none`으로 종료됐다. 후속 비민감 clipboard probe는 browser write 1·macOS read 1·match false·system clipboard write 0이었다. secure non-echo stdin receiver를 구현했지만 비민감 Terminal 시험은 receiver `READY` 뒤 Computer Use가 `com.apple.Terminal`로 값을 넘기기 전에 안전 정책으로 차단됐다. local paste·receiver input은 0, receiverStopped·echoRestored는 true였고 브라우저 시험 clipboard는 비웠으며 재시도·대체 앱 우회는 0회였다. 이번 stdin/Terminal 경로의 Account ID copy·read·paste·initialize는 모두 0회다. 앞선 localhost 경로의 누계는 browser memory 처리·client send 시도 1회, host accepted·success 0회이며 Keychain·metadata 작성은 전체 0회다. 새 token 생성·API 조회, R2 private-exposure capture·full audit와 기타 Cloudflare 원격 변경도 0회다. 별도 진단 실수로 loopback 회귀시험을 한 번 잘못 호출해 sandbox bind 1회 뒤 `BRIDGE_E_BIND`로 즉시 끝났고 accepted connection·payload·initialize·Keychain·Cloudflare는 0회, 재시도는 0회였다. 현재 지원되는 자동 전달 경로가 없어 `PLAN-05`는 중단하며, 제품이 허용하는 안전한 로컬 receiver target이나 사용자가 원문을 도구 출력 없이 non-echo receiver에 직접 입력하는 명시적 handoff가 있을 때만 재개한다.

위 문단은 실패 당시의 진단 이력이다. 이후 승인된 안전 전달로 account target 초기화를 완료하고, 짧은 수명 read-only 자격증명으로 staging bucket의 비공개 상태와 실제 2,758개 full GET/SHA-256를 확인했다. 보존 receipt는 논리 LIST/HEAD/GET 3/2,758/2,758, 실제 전송 시도 3/2,760/2,758, HEAD retry 2·PUT/DELETE 0이며 현재 bounded-read-retry 계약을 통과한다. 이번 validator token은 Cloudflare에서 삭제·목록 부재를 확인했고 대응 Keychain 항목 하나도 비밀값 read 0·exact delete 1 뒤 부재를 확인했다. v3/v3b metadata·dashboard evidence와 모든 capture·receipt는 보존했다. `PLAN-05`에는 사용 불가능한 기존 원격 token의 정확한 상태 확인과 정리만 남았다.

인수인계 상태: `PLAN-05`의 원격 감사는 완료됐지만 과거 이름 미기록 token 두 개의 exact identity는 현재 증거로 확정할 수 없다. 식별 근거가 확보되거나 사용자가 완료조건 변경을 승인해 `PLAN-05`가 공식적으로 닫히기 전까지 `PLAN-06`은 차단한다.

완료했거나 남아 있는 후속 상태는 다음과 같다.

- 올바른 계정의 별도 보관과 원문을 표시하지 않는 일치 검사 완료
- 짧은 수명의 최소 권한 token으로 bucket 비공개 설정 GET 3회 증거를 남기고 해당 관리 token 폐기 완료
- fresh/private/account/Git/bucket 결속 뒤 실제 2,758개 원격 full GET/SHA-256 완료. 시작 검사를 통과한 단일 실행은 해시 중 capture 만료 후에도 완료할 수 있음
- 이번 validator 원격 폐기와 로컬 Keychain 정리는 완료. 사용 불가능한 기존 원격 token의 정확한 상태 확인과 정리만 남아 있음
- production receipt의 보호 환경 full-GET/SHA 감사·서명과 account/public-key fingerprint 확정
- production bucket의 `r2.dev` 비활성·custom domain 0 canonical control-plane 감사 증거 확정. staging은 canonical capture와 receipt로 완료
- production account·bucket·media/release trust fingerprint로 production release policy 완성. staging public fingerprint는 이미 고정됨
- Bearer token으로 보호한 `https://dwnc-me-staging.dwnc.workers.dev`에서 staging 고유 version의 동일 payload, redirect GET·HEAD 698건, `/about` GET·HEAD, `/404.html` GET·HEAD, media 5건, cache 1~3건과 무인증 차단 1건 smoke 수행
- staging Worker가 아직 없으므로 deny-all 최초 생성의 실제 실행, raw service-existence·계정 `workers.dev=dwnc` capture, 두 signed evidence와 실행 직전 fresh capture. status-only 복구의 로컬 구현·실패 시험은 완료됐고 실제 Cloudflare 복구 실행은 0회임
- staging smoke token의 보호된 생성·signed one-value authorization과 외부 0700/0600 입력 경로. token은 암호학적 난수 32바이트→padding 없는 base64url 43문자로 고정하고 정책 digest `d6c554c1d80c68c08605636f12f26a411f7826bc40eddaee9233a30b6551781a`를 대조함
- staging Worker binding·route 설정. production Builds의 안전한 build·version-only wrapper guard는 완료됨
- 보호된 release job에서 `npm ci` → deterministic artifact → signed upload authorization → version-only upload → version-detail attestation을 직렬 실행
- Git trigger 밖에서 exact version ID promotion 승인, signed pre-status·generation CAS, 사후 deployment-status 100% 확인과 active-head 서명
- cache/WAF 관측 정책과 provider purge 방어 심화 절차
- 실제 `dwnc.me` 도메인·DNS·route·traffic 연결과 Git push

2026-09-05 현재 `PLAN-05`부터 `PLAN-08`까지 완료됐다. production private R2는 2,758개·2,346,220,246바이트와 full object-set SHA-256 일치를 확인했고, 준비된 production Worker version을 100% 활성화했다. 기존 apex CNAME은 삭제하지 않고 DNS only에서 Proxied로 전환해 Worker route `dwnc.me/*`를 추가했다. 기존 Proxied `www` CNAME은 유지했다. Custom Domain은 기존 DNS와 충돌해 사용하지 않았고 DNS 삭제도 하지 않았다. 기존 redirect 설정이 HTTP apex와 HTTPS `www`를 HTTPS apex의 같은 경로·query로 이동시키므로 새 redirect rule은 만들지 않았다. 실제 루트, Naver·Tistory 대표 글, 두 legacy alias, 대표 GIF와 데스크톱·390×844 모바일 화면이 정상이고 가로 넘침·핵심 잘림·깨진 이미지가 없다. 이후 DNS·route·traffic 변경, Git push, 보호 절차 없는 `wrangler deploy`, R2 객체 덮어쓰기·삭제와 비밀값 기록은 별도 승인 없이 하지 않는다.
