# dwnc.me 공개 미디어 전달 계약 v1

상태: **현재 기준 HEAD `159550239419ecdb7fad22910d1da3bba4518e38`·tree `8857f6dd50843afd37d681b5314d6e41080f11df`·push 0 / staging signing key와 분리된 최소 권한 R2 자격증명 준비 완료 / 대표 객체 1개 HEAD exact·missing 2,757·mismatch 0·orphan 0 / 단일 객체 validator full GET 명령은 commit 전·실제 full GET 대기 / smoke token·Worker·version·activation 없음 / 실제 도메인·DNS 미연결**

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
- `wrangler.jsonc`의 staging bucket 이름은 현재 생성된 private staging bucket과 일치한다. binding·Worker·route는 아직 미배포 draft이며 production bucket 이름과 모든 production binding도 생성·배포를 뜻하지 않는다.
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

- `src/data/public-request-surface-v1.json`은 source-only와 full-local static tree에서 동일하게 파생되는 현재 공개 경로 1,410개의 결정적 allowlist다. SHA-256은 `1666d8dd85ac05c2274513cfbe438f24ead06a190f873af3b67f7e3aa373307c`다.
- 한 번의 strict decode·NFC 정규화 뒤 exact path가 allowlist에 없거나 encoded traversal·역슬래시·double encoding이면 `ASSETS`와 Cache API를 호출하지 않고 `404 + no-store`를 반환한다.
- allowlist hit의 `GET`·`HEAD`만 `ASSETS.fetch()`에 전달한다. Worker는 정적 HTML 내용을 재작성하지 않는다.

same-origin이므로 기본 CORS header는 넣지 않는다. CORS는 hotlink 방지 수단이 아니다. 공개 미디어 남용은 향후 cache·rate limit·WAF 관측을 통해 별도 결정한다.

## 3. upload-once sync

`scripts/inspect-public-media-r2.mjs`는 validator 자격증명으로 remote `LIST` pagination과 manifest key 전수 `HEAD`만 수행한다. `scripts/sync-public-media-r2.mjs`는 uploader 자격증명의 기본 dry-run과 create-only 적용을 담당한다. 두 명령 모두 S3-compatible API를 SigV4로 서명하되 URL·credential을 출력하지 않는다.

운영 명령은 네 개의 legacy R2 환경변수를 사용자가 직접 넘기지 않는다. 자격증명은 macOS Keychain에 보관하고, repository 밖의 create-only metadata 파일 절대경로만 `R2_CREDENTIAL_METADATA_PATH`에 지정해 `scripts/run-with-r2-credentials.mjs` wrapper를 실행한다. wrapper는 package command에 고정된 환경과 역할을 선택하고 metadata와 Keychain 값을 대조한 뒤, 자격증명 bytes를 익명 pipe FD 3으로 한 번만 child에 전달하고 메모리 buffer를 지운다. 사용자가 `--environment`, `--role`, credential metadata 인자를 덧붙이거나 legacy 자격증명 환경변수·FD를 함께 지정하면 실행 전에 거부한다.

credential 값은 저장소·manifest·receipt·로그에 기록하지 않는다. 현재 uploader `dwnc-me-public-media-staging-uploader-v3-20260827`은 exact staging bucket Object Read & Write, validator `dwnc-me-public-media-staging-validator-v2-20260827`은 같은 exact bucket Object Read only로 제한했다. 둘 다 Active이고 TTL은 2026-09-03이다. uploader access-key ID·metadata SHA-256은 각각 `6a6df74afbbc4a47fe050b11997b41b6e5e7ba9d02884eb69bb9ac88d82bb976`·`6d92f8e095050757c407bf31a02e8358c4064e7b9852f44c98037de7f331721e`, validator는 `be4156f1e29c6282568d18e504d11888907e0df9c8f67a551318a839c735ee5a`·`03011557f3ae08f1128c10bd5df0508dc50e0bdbbc5652de08f63f05e142fe0c`다.

생성 실패 과정에서 비밀값 노출 가능성이 생긴 uploader v2는 즉시 revoked했다. 정상 생성된 두 자격증명은 일반 출력·로그 비밀값 노출 0, clipboard 사용 0이다. 2026-08-25에 만든 기존 staging token 두 개는 비밀값을 잃어 사용할 수 없지만 Cloudflare에서 아직 Active이므로 새 자격증명 검증 뒤 별도로 정리한다.

```sh
# validator 읽기 전용 분류: exact / missing / mismatch / orphan
# receipt parent는 저장소 밖의 본인 소유 mode 700 디렉터리여야 한다.
R2_CREDENTIAL_METADATA_PATH=/approved/local/path/staging-validator-metadata.json \
  npm run media:r2:staging:inspect:secure -- \
  --expected-manifest-sha256=<approved-final-manifest-sha256> \
  --receipt-output=/approved/local/path/staging-r2-inspection-v1.json

# 이미 존재하고 HEAD exact인 대표 객체 하나를 PUT 없이 full GET/SHA-256 검증한다.
R2_CREDENTIAL_METADATA_PATH=/approved/local/path/staging-validator-metadata.json \
  npm run media:r2:staging:validate-one:secure -- \
  --key=<exact-manifest-key> \
  --expected-manifest-sha256=<approved-final-manifest-sha256> \
  --expected-git-sha=<clean-exact-full-git-sha> \
  --receipt-output=/approved/local/path/staging-r2-one-object-validation-v1.json

# 직전 account·bucket·manifest 일치와 자격증명 보호 조건이 통과한 뒤에만 실행한다.
R2_CREDENTIAL_METADATA_PATH=/approved/local/path/staging-uploader-metadata.json \
  npm run media:r2:apply -- \
  --expected-manifest-sha256=<approved-final-manifest-sha256> \
  --expected-orphan-count=0 \
  --receipt-output=/approved/local/path/public-media-r2-receipt-v1.json
```

검사 명령은 staging·validator 역할에 고정되어 `--apply`, production 환경 주입, uploader metadata, overwrite·delete 인자를 받지 않는다. 원격 요청은 bucket 목록 조회 `GET`과 객체별 `HEAD`뿐이며 PUT·DELETE 코드 경로가 없다. 결과 파일은 exact·missing·mismatch·orphan 개수와 manifest·account fingerprint·bucket을 묶은 읽기 전용 검사 기록이고, release용 `full-get-sha256` receipt를 대신하지 않는다. 저장소 밖의 mode 700 디렉터리에 create-only·mode 600으로 기록한다.

단일 객체 검증 명령도 staging·validator 역할에 고정한다. clean HEAD와 명시한 full Git SHA, tracked manifest의 exact key, account fingerprint와 private bucket을 첫 요청 전에 결속한다. `HEAD→status→HEAD`를 순서대로 읽는 Git 검사를 원격 요청 전, HEAD+GET 후, create-only receipt 기록 직전에 반복해 tracked file이나 HEAD가 중간에 바뀌면 기록을 만들지 않는다. R2 client의 `maxAttempts=1`로 자동 재시도를 끄고 HEAD와 status 200의 전체 GET을 각각 정확히 한 번만 허용하며, receipt 요청 수도 HEAD 1·GET 1·PUT 0·DELETE 0이어야 한다. body는 메모리에 전부 쌓지 않고 streaming SHA-256으로 확인한다. `206`, `Content-Range`, 짧거나 긴 body, metadata/checksum/ETag/Last-Modified drift, HEAD↔GET 세대 차이와 한쪽에만 있는 version ID를 거부한다. 기록은 Git SHA·manifest/entry SHA·key·bytes/SHA·MIME/cache·platform checksum·ETag·Last-Modified·nullable version을 담는다.

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
- apply 완료 뒤 unsigned receipt 후보를 만들 수 있지만, production receipt로 인정하려면 별도 보호 환경에서 Ed25519 서명해야 함
- uploader가 만드는 후보의 검증 수준은 `head-exact`로 고정한다. production 정책의 `full-get-sha256` receipt는 단일 객체 admission이 exact인 최종 집합을 전수 GET·SHA-256 감사한 뒤에만 발급·서명한다.

## 4. 원격 receipt와 production gate

production receipt는 manifest digest, 객체 수·총 bytes, 검증시각과 key별 size·SHA-256·MIME·ETag·canonical Last-Modified·nullable S3 version ID뿐 아니라 target environment·bucket·Cloudflare account fingerprint와 검증 수준을 canonical ordering으로 담는다. 집합 단위 manifest 결속은 이 receipt에서 수행하고, detached Ed25519 signature와 public key trust anchor를 함께 검증한다.

tracked `src/data/public-media-release-policy-v1.json`은 Worker binding·bucket·요구 검증 수준과 `r2.dev 비활성·custom domain 0`인 private exposure 정책을 고정한다. staging media Ed25519 public-key SPKI fingerprint는 `69cb5866228f1624693b0903e60d52b0c046464040da621b2d144cb8bffb2182`, release fingerprint는 `2655be4122fb2238d47ba539b8e86aa9d39899631a7d713106ce711ea2de1ac2`로 고정했다. private key는 macOS Keychain에만 보관하고 export하지 않는다. production account·media·release fingerprint는 모두 `null`을 유지하므로 staging key나 receipt로 production gate를 통과할 수 없다.

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

서명 receipt만으로 이후 원격 삭제를 증명할 수 없으므로 production gate는 봉인된 최종 manifest 전체의 HEAD를 매번 수행한다. 최초 upload 뒤에는 `media:r2:audit:full`로 최종 manifest 전체 원격 GET·SHA-256·총 바이트를 감사하고 그 결과만 `full-get-sha256` receipt 후보로 발급한다. 역사 기준선 2,889개를 최종으로 간주하지 않으며, 실제 서명과 control-plane private exposure 증거는 보호 환경에서 별도로 결속한다.

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

- 임시 public directory에는 tracked `_redirects`와 `.assetsignore`만 넣고, 빌드된 static tree에서 공개 request-surface manifest를 다시 계산해 tracked 1,410경로·SHA-256 `1666d8dd85ac05c2274513cfbe438f24ead06a190f873af3b67f7e3aa373307c`와 exact 일치시킨다.
- local media를 읽거나 내려받지 않고 manifest↔renderable reference exact set을 검증한다.
- `dist/media`는 0이어야 한다.
- 기존 route·alias·검색·RSS·sitemap·taxonomy·link·privacy validator를 remote-media mode로 그대로 실행한다.
- Worker·R2·redirect fixture는 mock만 사용하며 live network call은 0이다.
- private root가 없는 경로를 주입하고 private directory를 만들지 않는다.

Cloudflare release는 순환하지 않는 두 단계로 나눈다.

1. `cloudflare:prepare:production`은 clean Git SHA와 `WORKERS_CI_COMMIT_SHA`가 같을 때만 source-only build를 수행한다. Wrangler dry-run의 생성시각 README·source map·metafile 경로는 버리고 안정적인 `worker.js` bytes, static tree, upload/promotion 전용 config, redirects, media manifest·signed remote receipt만 read-only artifact에 결속한다. 이 core에는 build UUID·시각·Cloudflare version ID가 없다.
2. 보호 환경의 짧은 Ed25519 upload authorization이 artifact SHA, account fingerprint, Worker name, source SHA, build UUID, nonce와 만료를 승인한다. `cloudflare:upload:production-version`은 보호된 고정 attempt directory에 authorization SHA를 no-replace로 소비한 뒤 exact artifact의 `worker.js`를 `versions upload --no-bundle --strict`로만 올린다. 첫 API 요청 전 account·Worker·artifact·Wrangler version·empty env·resource auto-create 금지를 확인하고, `WRANGLER_OUTPUT_FILE_PATH`의 session과 정확히 한 개의 `version-upload` event를 검사하며 traffic은 바꾸지 않는다.
3. `cloudflare:version:fetch`가 exact version ID를 `versions view --json`으로 다시 읽고 raw stdout SHA, script ETag, handlers, runtime, bindings, assets, annotation을 artifact와 대조한다. 보호 signer가 만든 짧은 version attestation 없이는 다음 단계로 갈 수 없다.
4. 같은 payload의 staging upload는 별도 signed secret authorization이 승인한 `DWNC_STAGING_SMOKE_TOKEN` 한 값만 더한다. token은 암호학적 난수 32바이트를 padding 없는 base64url 43문자로 표현한다. repository 밖의 mode-600 외부 파일을 regular file·non-symlink·link count 1·inode·size로 검증해 읽은 bytes를 익명 pipe FD 3, 즉 `/dev/fd/3`으로만 Wrangler `--secrets-file`에 전달한다. 중간 regular 임시 파일은 만들지 않고 전달 뒤 메모리 buffer를 지우며 argv·환경·NDJSON·artifact·result에 평문을 넣지 않는다. 이후 별도 signed activation authorization과 lock 안에서 다시 읽은 exact previous-version 100% status를 검증한 뒤 `cloudflare:staging:activate`가 전용 최소 config로 exact ID를 100%에 올린다. timeout·nonzero·split·unknown은 pending/invoking/outcome과 lock을 보존하고 자동 재실행하지 않으며, owner-dead·5분 경과 exact token의 status-only recovery에서 target 100%가 확인될 때만 candidate를 확정한다. candidate 기록 직후 hard-exit recovery는 현재 attempt의 claim·pending·invoking과 committed outcome에서 재도출한 candidate bytes가 exact 일치할 때만 lock을 정리한다. 이어 Bearer로 보호한 `https://dwnc-me-staging.dwnc.workers.dev`에서 version marker, static·349 redirects·media·조건부 요청·range·cache 경로를 확인하고 staging status와 smoke/probe receipt를 production 후보에 결속한다.
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

Cloudflare Cache API는 저장 시 쓴 내부 cache key를 사용하므로 공개 URL만으로 모든 캐시 사본을 exact purge할 수 있다고 약속하지 않는다. 보안 경계는 모든 요청에서 Cache API·Static Assets보다 먼저 실행되는 최신 static/media allowlist와, 전체 공개 request surface를 artifact에서 파생해 누적 withdrawn hash와 대조하는 signed promotion head다. 철회 release 뒤 과거 전체 Worker·static·redirect·manifest version을 직접 재승격하거나 `wrangler rollback`하면 재노출될 수 있으므로 verifier가 거부한다. 화면을 되돌릴 때도 최신 projection·redirect·media deny floor를 합성한 새 artifact/version을 만들어 forward rollback한다. staging은 sampling 100%이고 cache smoke는 Bearer token으로 보호한 `workers.dev` endpoint에서 수행한다.

## 8. 현재 Cloudflare 상태와 남은 작업

최신 사전점검에서 올바른 Cloudflare account fingerprint가 정책과 exact 일치했다. 원격 작업 직전 private staging bucket `dwnc-me-public-media-staging`은 객체 0, `r2.dev` 꺼짐, custom domain 0, jurisdiction `default`, location `APAC`, storage class `Standard`였다. 최초 validator inspection은 exact 0·missing 2,758·mismatch 0·orphan 0으로 통과했다. 이어 첫 key에 create-only PUT을 최대 1회 수행했으나 post-HEAD에서 `x-amz-version-id` 부재를 당시 parser가 거부해 admission receipt는 만들어지지 않았다. 호환 commit 뒤 PUT 없이 다시 검사해 해당 객체 1개가 exact이고 missing 2,757·mismatch 0·orphan 0임을 확인했다. 두 번째 읽기 전용 검사 기록 SHA-256은 `27bf50a94fb6166a01201f3fb3a4a2dfc954b3d983e29a47f53ea38cbab31cd3`이다. exact bucket 한정 Object Read & Write uploader와 별도 Object Read validator는 Active·TTL 2026-09-03이고, 실패 uploader v2는 revoked했다. 2026-08-25의 사용 불가능한 기존 두 token만 후속 정리 전까지 Active다. staging media·release Ed25519 private key는 macOS Keychain에만 보관하고 public fingerprint를 policy에 고정했다. 정상 생성 자격증명의 일반 출력·로그 비밀값 노출, clipboard 사용, private key export는 모두 0이다. staging Worker, smoke token, version, activation은 없다.

S3 version-id 호환 보강은 commit `159550239419ecdb7fad22910d1da3bba4518e38`·tree `8857f6dd50843afd37d681b5314d6e41080f11df`로 로컬 Git에 기록했고 push는 0이다. 단일 객체 validator-only HEAD+streaming full-GET 명령과 이 상태 기록은 다음 로컬 commit 전이다.

현재 최종 manifest는 2,758개·2,346,220,246바이트·SHA-256 `61bb577d609f97cdb014ef3a14681045fbb3bec616f2b04c8d058519b640c532`이고 로컬·source-only·build·Worker 회귀를 통과했다. 최초 빈-bucket 검사 기록 SHA-256은 `d058fce27c6a9114751fcbf5f2ba67f2dda9b8f385ad1d733c2864c847e4e263`, 현재 exact 1·missing 2,757 검사 기록 SHA-256은 `27bf50a94fb6166a01201f3fb3a4a2dfc954b3d983e29a47f53ea38cbab31cd3`이다. 첫 uploader 실행의 PUT은 최대 1회였고 재시도·overwrite·DELETE는 0이다. 해당 객체 full GET/SHA-256과 단일 객체 validation receipt는 아직 없다. 정리 전 2,889개는 역사 기준선일 뿐 현재 원격 작업 기준이 아니다.

다음은 현재 수행하지 않았다.

- 단일 객체 validator-only 명령을 commit한 뒤 HEAD exact인 첫 객체를 PUT 없이 full GET/SHA-256 검증
- staging 단일 객체 validation receipt 완료, final manifest 객체 create-only upload·원격 full verification
- 새 자격증명 작동 확인 뒤 2026-08-25의 사용 불가능한 Active token 두 개 정리
- production receipt의 보호 환경 full-GET/SHA 감사·서명과 account/public-key fingerprint 확정
- staging·production bucket의 `r2.dev` 비활성·custom domain 0 control-plane 감사 증거 확정
- production account·bucket·media/release trust fingerprint로 production release policy 완성. staging public fingerprint는 이미 고정됨
- Bearer token으로 보호한 `https://dwnc-me-staging.dwnc.workers.dev`에서 staging 고유 version의 동일 payload, 349 redirects, static, media·cache smoke 수행
- production 또는 staging Worker가 아직 없을 경우 별도 deny-all/bootstrap 승인, raw service-existence capture, signed evidence와 실행 직전 fresh-absence capture
- staging smoke token의 보호된 생성·signed one-value authorization과 외부 0700/0600 입력 경로. token은 암호학적 난수 32바이트→padding 없는 base64url 43문자로 고정하고 정책 digest `d6c554c1d80c68c08605636f12f26a411f7826bc40eddaee9233a30b6551781a`를 대조함
- staging Worker binding·route 설정. production Builds의 안전한 build·version-only wrapper guard는 완료됨
- 보호된 release job에서 `npm ci` → deterministic artifact → signed upload authorization → version-only upload → version-detail attestation을 직렬 실행
- Git trigger 밖에서 exact version ID promotion 승인, signed pre-status·generation CAS, 사후 deployment-status 100% 확인과 active-head 서명
- cache/WAF 관측 정책과 provider purge 방어 심화 절차
- 실제 `dwnc.me` 도메인·DNS·route·traffic 연결과 Git push

승인된 순서의 앞 단계가 통과하면 직전 preflight를 거쳐 계속하고, 단순히 추가 승인을 받기 위해 임의로 중단하지 않는다. 실제 도메인·DNS는 연결되지 않았으므로 Cloudflare의 `production` 이름을 쓰는 Worker·R2·version 작업도 현재 방문자에게 영향을 주지 않으며 승인 범위 안에서 계속할 수 있다. 단, 실제 도메인·DNS 변경, Git push, 보호 절차 없는 `wrangler deploy`, 객체 덮어쓰기·삭제, 비밀값 기록은 하지 않는다.
