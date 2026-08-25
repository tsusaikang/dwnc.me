# dwnc.me 공개 미디어 전달 계약 v1

상태: **로컬 구현·fixture 완료 / R2 resource·credential·원격 receipt·배포 없음**

이 문서는 공개 글이 참조하는 대용량 미디어를 동일 출처 `https://dwnc.me/media/*`로 제공하기 위한 계약이다. 기존 URL, 로컬 원본, SHA-256 증거를 바꾸지 않고 private R2 bucket을 전달용 복제본으로 사용한다.

## 1. 불변 주소와 manifest

- 공개 URL `/media/...`는 유지한다.
- R2 object key는 URL에서 선행 `/` 하나만 제거한 값이다: `key = publicPath.slice(1)`.
- 같은 SHA-256을 가진 파일이라도 public path가 다르면 별도 객체로 유지한다. URL을 합치거나 deduplicate redirect를 만들지 않는다.
- 한번 사용한 key의 `SHA-256 + size + MIME`은 불변이다. 내용이 달라지면 새 key를 배정하고 기존 key를 덮어쓰지 않는다.
- canonical backup은 기존 로컬 `public/media/`와 공개 source inventory다. R2는 보존 정본이 아니라 delivery replica다.

현재 결정적 manifest는 `src/data/public-media-r2-v1.json`이다.

| 항목 | 기준선 |
|---|---:|
| 객체 | 2,889 |
| 총 바이트 | 2,350,053,092 |
| manifest SHA-256 | `5b9eb93474c0e96b3b371d233b4ea64cc24918a31d0fb754410c968544c2b165` |

manifest entry는 `publicPath`, `key`, `size`, `sha256`, `contentType`, `cacheControl`만 포함한다. 제목·본문·HTML·비공개 identity·비공개 sequence·credential은 허용하지 않는다.

```sh
npm run media:manifest:check
npm run media:validate:source
npm run media:validate:local
```

- `media:validate:source`는 로컬 미디어 bytes를 읽지 않고 공개 projection·공개 content·공개 asset evidence의 exact set만 검사한다.
- `media:validate:local`은 2,889개 로컬 파일의 exact set·크기·SHA-256·MIME/signature를 전수 검사한다.
- manifest 갱신은 공개 content와 공개 asset evidence가 함께 준비된 경우에만 `media:manifest:write`로 수행한다. 생성 후 digest 변경은 별도 검토 대상이다.

## 2. R2 bucket과 Worker 경계

- production과 staging은 서로 다른 **private** R2 bucket을 사용한다.
- `r2.dev`와 bucket 직접 public custom-domain access를 켜지 않는다. 그렇지 않으면 Worker allowlist와 철회를 우회할 수 있다.
- `wrangler.jsonc`의 bucket 이름은 승인 전 생성 대상 이름을 고정한 draft일 뿐이며, 현재 실제 resource 존재를 뜻하지 않는다.
- Worker는 `assets.run_worker_first: true`로 모든 요청에서 Static Assets보다 먼저 실행한다. `/media/*`는 tracked media manifest, 그 밖의 `GET`·`HEAD`는 tracked public request-surface manifest의 exact path에 들어 있을 때만 `ASSETS`로 전달한다. 따라서 철회된 글·legacy alias·검색·RSS·sitemap·aggregate 경로도 cache/asset 조회 전에 동일한 `404 + no-store`로 닫힌다.
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

- `src/data/public-request-surface-v1.json`은 source-only와 full-local static tree에서 동일하게 파생되는 현재 공개 경로 1,410개의 결정적 allowlist다.
- 한 번의 strict decode·NFC 정규화 뒤 exact path가 allowlist에 없거나 encoded traversal·역슬래시·double encoding이면 `ASSETS`와 Cache API를 호출하지 않고 `404 + no-store`를 반환한다.
- allowlist hit의 `GET`·`HEAD`만 `ASSETS.fetch()`에 전달한다. Worker는 정적 HTML 내용을 재작성하지 않는다.

same-origin이므로 기본 CORS header는 넣지 않는다. CORS는 hotlink 방지 수단이 아니다. 공개 미디어 남용은 향후 cache·rate limit·WAF 관측을 통해 별도 결정한다.

## 3. upload-once sync

`scripts/sync-public-media-r2.mjs`는 S3-compatible API를 SigV4로 서명하되 URL·credential을 출력하지 않는다. 기본은 dry-run이며 remote `LIST` pagination과 desired key 전수 `HEAD`를 수행한다.

필수 환경변수 이름:

- `R2_ACCOUNT_ID`
- `R2_BUCKET_NAME`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`

credential 값은 저장소·manifest·receipt·로그에 기록하지 않는다. uploader token은 해당 bucket의 Object Read+Write로 제한하고, production validator는 별도 Object Read token을 사용한다.

```sh
# 읽기 전용 분류: exact / missing / mismatch / orphan
npm run media:r2:dry-run -- --environment=staging

# 사용자 승인 뒤에만. digest exact match가 추가로 필요하다.
npm run media:r2:apply -- \
  --environment=staging \
  --expected-manifest-sha256=5b9eb93474c0e96b3b371d233b4ea64cc24918a31d0fb754410c968544c2b165 \
  --receipt-output=/approved/local/path/public-media-r2-receipt-v1.json
```

적용 규칙:

- missing object만 `If-None-Match: *` create-only PUT
- body SHA-256 checksum과 객체별 크기·MIME·cache metadata 저장. 객체 metadata에는 전체 manifest digest를 넣지 않아 append·철회 때 기존 immutable 객체를 재업로드하지 않는다.
- 429·5xx·network 오류만 bounded exponential retry
- 성공 응답 유실 뒤 재시도에서 412가 나면 HEAD가 exact일 때만 idempotent 성공
- `--environment`와 `wrangler.jsonc`의 exact bucket을 첫 원격 요청 전에 대조해 staging/production 교차 오조작을 거부
- mismatch는 중단하며 overwrite하지 않음
- orphan은 개수만 보고하고 삭제하지 않음
- resume은 재실행 HEAD 결과를 기준으로 하며 로컬 journal을 권위 자료로 삼지 않음
- apply 완료 뒤 unsigned receipt 후보를 만들 수 있지만, production receipt로 인정하려면 별도 보호 환경에서 Ed25519 서명해야 함
- uploader가 만드는 후보의 검증 수준은 `head-exact`로 고정한다. production 정책의 `full-get-sha256` receipt는 별도 승인된 전수 원격 바이트 감사 뒤에만 발급·서명한다.

## 4. 원격 receipt와 production gate

production receipt는 manifest digest, 객체 수·총 bytes, 검증시각과 key별 size·SHA-256·MIME·ETag뿐 아니라 target environment·bucket·Cloudflare account fingerprint와 검증 수준을 canonical ordering으로 담는다. 집합 단위 manifest 결속은 이 receipt에서 수행하고, detached Ed25519 signature와 public key trust anchor를 함께 검증한다.

tracked `src/data/public-media-release-policy-v1.json`은 production Worker binding·bucket·요구 검증 수준과 `r2.dev 비활성·custom domain 0`인 private exposure 정책을 고정한다. production receipt에는 Cloudflare control-plane 감사시각과 증거 SHA-256을 함께 서명하고, 이 증거는 gate 시점 기준 최대 900초·미래 편차 120초만 허용한다. account fingerprint와 Ed25519 public-key SPKI fingerprint는 아직 `null`이며 승인된 resource와 trust anchor가 확정되기 전에는 production gate가 fail closed한다. 임의 env public key나 staging receipt로 production 검증을 통과할 수 없다.

필수 환경변수 이름:

- `PUBLIC_MEDIA_REMOTE_RECEIPT_PATH`
- `PUBLIC_MEDIA_REMOTE_SIGNATURE_PATH`
- `PUBLIC_MEDIA_REMOTE_PUBLIC_KEY_PATH`
- 위 R2 read-only 변수 4개

```sh
npm run media:validate:remote
npm run cloudflare:verify:production
```

exact Wrangler `4.125.0`은 로컬 dependency와 lock에 설치·고정됐지만, 현재 실제 production receipt·signature·credential·trust fingerprint가 없으므로 위 production gate는 의도적으로 fail closed한다. 합성 Ed25519 fixture만 저장소 안에서 target 결속과 signature를 검증하며 실제 서명을 만들어 내지 않는다.

서명 receipt만으로 이후 원격 삭제를 증명할 수 없으므로 production gate는 2,889개 HEAD를 매번 수행한다. 최초 upload 뒤에는 `media:r2:audit:full`로 2,889개 전체 원격 GET·SHA-256·총 바이트를 감사하고 그 결과만 `full-get-sha256` receipt 후보로 발급한다. 실제 서명과 control-plane private exposure 증거는 보호 환경에서 별도로 결속한다.

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

- 임시 public directory에는 tracked `_redirects`와 `.assetsignore`만 넣고, 빌드된 static tree에서 공개 request-surface manifest를 다시 계산해 tracked 1,410경로와 exact 일치시킨다.
- local media를 읽거나 내려받지 않고 manifest↔renderable reference exact set을 검증한다.
- `dist/media`는 0이어야 한다.
- 기존 route·alias·검색·RSS·sitemap·taxonomy·link·privacy validator를 remote-media mode로 그대로 실행한다.
- Worker·R2·redirect fixture는 mock만 사용하며 live network call은 0이다.
- private root가 없는 경로를 주입하고 private directory를 만들지 않는다.

Cloudflare release는 순환하지 않는 두 단계로 나눈다.

1. `cloudflare:prepare:production`은 clean Git SHA와 `WORKERS_CI_COMMIT_SHA`가 같을 때만 source-only build를 수행한다. Wrangler dry-run의 생성시각 README·source map·metafile 경로는 버리고 안정적인 `worker.js` bytes, static tree, upload/promotion 전용 config, redirects, media manifest·signed remote receipt만 read-only artifact에 결속한다. 이 core에는 build UUID·시각·Cloudflare version ID가 없다.
2. 보호 환경의 짧은 Ed25519 upload authorization이 artifact SHA, account fingerprint, Worker name, source SHA, build UUID, nonce와 만료를 승인한다. `cloudflare:upload:production-version`은 보호된 고정 attempt directory에 authorization SHA를 no-replace로 소비한 뒤 exact artifact의 `worker.js`를 `versions upload --no-bundle --strict`로만 올린다. 첫 API 요청 전 account·Worker·artifact·Wrangler version·empty env·resource auto-create 금지를 확인하고, `WRANGLER_OUTPUT_FILE_PATH`의 session과 정확히 한 개의 `version-upload` event를 검사하며 traffic은 바꾸지 않는다.
3. `cloudflare:version:fetch`가 exact version ID를 `versions view --json`으로 다시 읽고 raw stdout SHA, script ETag, handlers, runtime, bindings, assets, annotation을 artifact와 대조한다. 보호 signer가 만든 짧은 version attestation 없이는 다음 단계로 갈 수 없다.
4. 같은 payload의 staging upload는 별도 signed secret authorization이 승인한 `DWNC_STAGING_SMOKE_TOKEN` 한 값만 더한다. 검증한 외부 mode-600 파일의 평문 경로를 Wrangler가 다시 열게 하지 않고, 하나의 no-replace handle에서 positional write·fsync·fstat·positional read/hash 검증을 마친 뒤 같은 handle을 unlink한 inherited descriptor `/dev/fd/3`로 `--secrets-file`에 전달한다. 검증 뒤 경로 재open은 금지하며 argv·환경·NDJSON·artifact·result에는 평문을 넣지 않는다. 이후 별도 signed activation authorization과 lock 안에서 다시 읽은 exact previous-version 100% status를 검증한 뒤 `cloudflare:staging:activate`가 전용 최소 config로 exact ID를 100%에 올린다. timeout·nonzero·split·unknown은 pending/invoking/outcome과 lock을 보존하고 자동 재실행하지 않으며, owner-dead·5분 경과 exact token의 status-only recovery에서 target 100%가 확인될 때만 candidate를 확정한다. candidate 기록 직후 hard-exit recovery는 현재 attempt의 claim·pending·invoking과 committed outcome에서 재도출한 candidate bytes가 exact 일치할 때만 lock을 정리한다. 이어 signed-header synthetic non-Access origin에서 version marker, static·349 redirects·media·조건부 요청·range·cache 경로를 확인하고 staging status와 smoke/probe receipt를 production 후보에 결속한다.
5. `cloudflare:promotion:verify`는 version attestation, 최신 full-media/private-exposure receipt, staging 동일-payload 증거, 보호된 signed active head, signed pre-status와 시한부 signed promotion authorization을 검증한다. source Git ancestry, 단조 generation, 누적 withdrawn surface와 retired artifact/payload/version을 통과한 exact `versions deploy <ID>@100%` argv 배열과 그 SHA만 승인 범위로 만든다.
6. 별도 사용자 승인을 받은 `cloudflare:promotion:execute`는 authorization을 영구 one-time claim하고 권위 store lock을 잡은 뒤 status를 다시 읽어 active version 100%를 fresh CAS한다. `execFile`로 exact argv를 한 번만 수행하고 raw command/status와 구조화 outcome을 no-replace로 보존한다. target 100%일 때만 signed active head를 원자 교체한다. 이전 version 100%, split, timeout 또는 unknown은 모두 ambiguous로 lock·pending·증거를 유지하며 자동 재시도하지 않는다. owner가 죽고 5분이 지난 뒤에만 `cloudflare:promotion:lock-status -- --include-recovery-token`으로 얻은 exact token을 같은 executor에 전달해 deployment를 다시 실행하지 않는 명시적 status-only recovery를 수행한다.

artifact upload config는 `find_additional_modules=false`를 강제한다. promotion config에는 assets·bindings·vars·routes·triggers·observability가 없어 traffic 변경 뒤 비버전 설정 PATCH가 섞이지 않는다. 현재 top-level 이름은 안전장치가 아니다. Workers Builds가 이름을 override할 수 있으므로 raw `wrangler deploy`는 production overwrite 위험이 있는 P0 blocker다.

Cloudflare Dashboard의 2026-08-25 승인된 Stage 3 Builds guard exact readback은 다음과 같다.

- `SKIP_DEPENDENCY_INSTALL=1`
- Build: `npm ci && npm run cloudflare:prepare:production`
- Deploy: `npm run cloudflare:upload:production-version`
- traffic promotion은 Git trigger 밖의 별도 승인 job

변경 전 readback은 `Build=None`, `Deploy=npx wrangler deploy`였고, 변경 후 raw live deploy 설정·실행은 0이다. 같은 작업에서 traffic·DNS·route·custom domain·binding·R2·Worker version·Git history 변경은 모두 0이었다. production Worker `dwnc-me`는 존재하고 staging Worker `dwnc-me-staging`은 부재한 것으로 확인했다. 최초 Worker가 부재한 환경에서는 `versions upload`로 bootstrap할 수 없으므로, `workers_dev=false`, `preview=false`, route·custom domain·trigger·asset·binding 0인 deny-all service를 별도 승인·signed service-existence evidence·one-time authorization 아래 한 번만 만든다. 최초 existence 명령은 raw Cloudflare JSON capture와 5분 이내의 구조화 evidence 후보를 함께 mode 600으로 보존한다. executor는 그 서명을 검증한 뒤에도 실제 deploy 직전 API를 다시 읽어 15초 이내이며 `success=false`, `result=null`, errors가 service-not-found code `10007`·`10090` 중 하나뿐인 404만 부재로 인정한다. 이 최초 service는 내부 deny version이 100%이지만 외부 요청 surface는 0이며, 일반 release가 bootstrap으로 자동 전환되지는 않는다.

## 6. redirects와 canonical

- `docs/EDGE_REDIRECTS_V1.json`이 provider-neutral 원본이다.
- `public/_redirects`는 해당 원본에서 결정적으로 생성하며 exact 349개의 308 rule만 가진다.
- `/media/*`, wildcard, query, fragment rule은 금지한다.
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

Cloudflare Cache API는 저장 시 쓴 내부 cache key를 사용하므로 공개 URL만으로 모든 캐시 사본을 exact purge할 수 있다고 약속하지 않는다. 보안 경계는 모든 요청에서 Cache API·Static Assets보다 먼저 실행되는 최신 static/media allowlist와, 전체 공개 request surface를 artifact에서 파생해 누적 withdrawn hash와 대조하는 signed promotion head다. 철회 release 뒤 과거 전체 Worker·static·redirect·manifest version을 직접 재승격하거나 `wrangler rollback`하면 재노출될 수 있으므로 verifier가 거부한다. 화면을 되돌릴 때도 최신 projection·redirect·media deny floor를 합성한 새 artifact/version을 만들어 forward rollback한다. staging은 sampling 100%이고 cache smoke는 Access 앞 endpoint에서 증명할 수 없으므로 signed-header로 보호된 별도 synthetic non-Access endpoint를 사용한다.

## 8. 아직 필요한 승인

다음은 현재 수행하지 않았다.

- staging·production private R2 bucket 생성
- read-only validator token과 별도 uploader token 생성
- 2,889개 객체 dry-run·upload·원격 full verification
- production receipt의 보호 환경 full-GET/SHA 감사·서명과 account/public-key fingerprint 확정
- staging·production bucket의 `r2.dev` 비활성·custom domain 0 control-plane 감사 증거 확정
- 실제 account·bucket·trust fingerprint로 release policy 완성
- signed-header로 보호된 별도 synthetic non-Access staging endpoint에서 staging 고유 version의 동일 payload, 349 redirects, static, media·cache smoke 수행. 일반 Access hostname은 Cache API 증거로 사용하지 않음
- production 또는 staging Worker가 아직 없을 경우 별도 deny-all/bootstrap 승인, raw service-existence capture, signed evidence와 실행 직전 fresh-absence capture
- staging smoke secret의 보호된 생성·signed one-value authorization과 외부 0700/0600 입력 경로
- Cloudflare dashboard build command·binding·route 설정
- 보호된 release job에서 `npm ci` → deterministic artifact → signed upload authorization → version-only upload → version-detail attestation을 직렬 실행
- Git trigger 밖에서 exact version ID promotion 승인, signed pre-status·generation CAS, 사후 deployment-status 100% 확인과 active-head 서명
- cache/WAF 관측 정책과 provider purge 방어 심화 절차
- 배포, DNS, traffic 전환

각 항목은 사용자 승인과 직전 preflight를 거쳐 별도로 실행한다.
