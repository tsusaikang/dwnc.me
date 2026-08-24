# dwnc.me 공개 글 주소 계약

## 1. 유일한 canonical

모든 공개 글의 영구 주소는 출처나 작성 도구와 무관하게 `/posts/{globalSequence}`다. `{globalSequence}`는 앞에 0이 없는 양의 정수이며, 공개 registry에 실제로 존재할 때만 글 주소로 인정한다.

- 최초 배정 범위는 1–596이다. 티스토리 공개 164건, 네이버 공개 185건, 네이버 비공개 247건이 한 순번 공간을 함께 사용한다.
- 최초 배정에서만 `publishedAt`의 UTC instant 오름차순, 같은 instant는 UTF-8 ASCII byte 순서의 `source:sourceId` 오름차순으로 정렬했다.
- 최초 배정 뒤에는 날짜 수정이나 과거 글 추가로 기존 순번을 재정렬하지 않는다. 새 글은 항상 현재 최댓값 + 1을 쓴다. 현재 다음 순번은 597이다.
- 삭제·취소 글은 tombstone으로 남기며 빈 번호를 재사용하지 않는다. 비공개 글이 공개로 바뀌어도 이미 받은 순번을 유지한다.
- 공개 349건만 canonical route를 만든다. 비공개 247건이 예약한 번호는 일반 404이며 공개 projection에 그 번호·identity·날짜를 노출하지 않는다.
- 가져온 frontmatter의 기존 `canonicalPath`는 provenance와 옛 주소 검증용으로 유지한다. raw, normalized, frontmatter, importer를 새 주소로 다시 쓰지 않는다.

## 2. 원장과 공개 projection

전체 순번 원장은 `migration/private/sequence/global-sequence-v1.json`에만 둔다. 디렉터리는 mode 700, 파일은 mode 600인 단일 regular file이어야 하며 symlink·hardlink를 거부하고 동일 디렉터리 임시 파일을 거쳐 atomic rename한다. 원장 entry는 `globalSequence`, `source`, `sourceId`, `visibility`, `publishedAt`, `status`만 허용하고 제목·본문·HTML을 넣지 않는다.

빌드는 `src/data/public-sequence-v1.json`만 읽는다. 이 projection은 공개 active 글에 한해 다음 다섯 필드만 포함한다.

- `globalSequence`
- `source`
- `sourceId`
- `canonicalPath`
- `legacyPaths`

projection에는 비공개 identity·날짜·순번 대응, `nextSequence`, 전체 원장 digest를 넣지 않는다. 공개 런타임 코드와 `dist/`는 전체 원장을 import하거나 경로를 참조하면 실패한다. 원장이 없는 공개 전용 환경은 projection과 공개 content·media·검증 인벤토리를 모두 갖춘 승인된 hydrated bundle에서만 빌드할 수 있으며, 새 순번 배정은 fail closed한다. Git 비추적 media가 빠진 단순 clone을 완전한 빌드 입력으로 간주하지 않는다.

감사 기준 digest는 **최초 배정의 genesis 증거**다. 이후 합법적인 공개 전환·tombstone·새 글 추가로 현재 공개 projection의 건수와 digest가 달라져도 최초 증거는 바뀌지 않는다.

- 최초 596건 allocation SHA-256: `2b71c38d4032f306419117ffbf120e888883e8da4e3e2d51f4392b350e026b66`
- 최초 공개 349건 projection SHA-256: `94c9769ea5cd3f61560943afc7032003dd2ff375b8d5c7841d947bdaf4977d01`
- 최초 공개 349건 identity-set SHA-256: `2190984504722fd7b8f4b5a0ac38ecf29948e4e18b9c890ad0a76f54f059ea69` (`source:sourceId`를 ASCII byte 순으로 정렬해 LF로 결합, trailing LF 없음)

`migration/private/sequence/bootstrap-private-metadata-v1.json`은 최초 비공개 247건에 대해 `source/sourceId/visibility/publishedAt/canonicalPath`만 담는 mode 600 sidecar다. 최초 배정 채택이 끝난 뒤 순번 도구와 validator는 제목 등이 들어 있을 수 있는 글별 private migration manifest를 읽지 않고 이 sidecar·전체 원장·journal만 사용한다. sidecar에 제목·본문·HTML이나 추가 필드가 들어오면 fail closed한다.

`src/data/public-asset-receipts-v1.json`은 공개 전환 또는 향후 native 글을 위한 build-safe asset 증거다. receipt는 공개 identity, content SHA-256, 렌더 가능한 로컬 참조의 정확한 경로·SHA-256·크기·MIME만 허용하며 제목·본문·HTML·비공개 경로를 허용하지 않는다. 참조 집합과 receipt asset 집합은 정확히 같아야 한다. 최초 imported 공개 349건의 면제 집합은 위의 불변 identity-set digest로 고정하며 mutable inventory에 행을 추가해 면제를 늘릴 수 없다. 그 밖의 identity는 asset이 0개여도 identity-bound receipt가 반드시 있어야 하고, 사용되지 않거나 중복된 receipt는 거부한다.

같은 로컬 전용 디렉터리에는 다음 내구성 자료를 둔다.

- `global-sequence-v1.seal.json`: 최초 allocation·sidecar·genesis event를 묶는 no-replace bootstrap seal
- `events-v1/`: generation별 no-replace append-only event와 이전 event SHA를 잇는 journal
- `.global-sequence-v1.initialization.json`: bootstrap·기존 원장 채택의 단계별 재개를 위한 no-replace 초기화 marker
- `.global-sequence-v1.transaction.json`: 진행 중인 ledger/projection 교차 파일 commit을 복구하기 위한 mode 600 marker
- `.global-sequence-v1.lock`: 동시에 두 allocator가 같은 번호를 쓰지 못하게 하는 짧은 CAS lock
- `.global-sequence-v1.lock-transfer.json`: 종료된 stale lock의 exact token·device/inode·observed generation·원 lock 바이트 SHA-256·process-age 증거와 미리 정한 recovery token을 receipt v2 자체 SHA-256으로 결속한 mode 600 marker

읽기 전용 `verify`와 validator는 디렉터리 생성·권한 변경·파일 갱신을 하지 않는다. writer만 실제 경로의 모든 ancestor·directory·leaf를 `lstat`과 inode 재확인으로 검사한 뒤 symlink·hardlink·교체 경쟁을 거부한다. 초기화는 공개 projection을 마지막에 쓰는 marker 기반 transaction이며 `recover-init`으로만 재개한다. seal이나 journal이 존재하는데 원장이 사라졌다면 `bootstrap`으로 1부터 다시 만들 수 없고, seal·sidecar·journal을 검증한 `recover`만 원래 generation을 복원할 수 있다.

### 순번 상태 변경 절차

1. `npm run sequence -- verify`와 `lock-status`로 현재 `generation`, initialization/transaction/lock transfer pending 0을 확인한다.
2. 새 글 또는 공개 전환에 필요한 공개 content entry, 로컬 media, identity-bound asset receipt를 먼저 준비한다. projection에 넣을 identity가 정확히 하나이고 draft가 아니며 모든 렌더 가능한 로컬 참조가 receipt·regular file·SHA와 일치할 때만 진행된다.
3. 입력 JSON에 방금 확인한 `expectedGeneration`을 넣고 `allocate`, `set-visibility`, `tombstone` 중 하나를 실행한다. bootstrap 뒤 `allocate`는 `source=native`만 허용한다. imported `tistory`·`naver` namespace는 동결하며, 최초 원장에 이미 있는 비공개 Naver 글의 공개 전환만 `set-visibility`로 수행한다. 오래된 generation, 중복 identity, 안전하지 않은 sourceId, route collision은 commit 전에 실패한다.
4. 초기화 marker가 남으면 `recover-init`, 일반 transaction marker가 남으면 `recover`만 실행한다. stale lock은 자동 삭제하지 않으며 먼저 `lock-status`로 최소 경과 시간과 owner process 부재를 확인한다. `unlock-stale --token <exact>` 도중 transfer receipt 생성 직후 중단돼 원 lock과 receipt가 함께 남아도 같은 token의 `recover-transfer --token <exact>`만 exact receipt·원 lock 증거를 다시 대조한다. recovery lock은 별도 exact schema `global-sequence-transfer-recovery`로 prebound recovery token·transfer ID·receipt SHA·observed generation을 함께 기록한다. recovery lock 취득 직후나 reconcile 완료 직후 다시 종료돼도, owner가 죽고 최소 age를 지난 linked lock만 device/inode/raw SHA를 재확인해 같은 recovery token으로 재획득한다. live lock, 잘못된 token, 바뀐 inode·generation·raw SHA, foreign lock은 삭제하지 않고 fail closed한다. 성공 시 state reconcile을 마친 뒤 linked recovery lock을 먼저 지우고 directory sync하며, receipt가 일반 writer를 막는 동안 권위 상태를 다시 검증한 다음 exact receipt를 마지막으로 지운다.
5. authoritative transaction이 끝난 뒤 `npm run edge-redirects:generate`, 전체 build/validator를 실행한다. 공개 projection과 edge manifest를 검증한 결과물만 public-only CI/clone으로 내보낸다.

private→public은 기존 sequence를 유지하며 준비된 안전한 공개 content와 asset receipt가 없으면 실패한다. tombstone은 sequence와 journal 이력을 유지하지만 projection·route·alias·검색·RSS·sitemap에서 글을 제거한다. 공개→비공개로 상태를 되돌리는 명령은 허용하지 않고 공개 철회는 tombstone으로만 표현한다. bootstrap 뒤 새 글은 `source=native`로만 배정하며 public/private 어느 visibility든 날짜와 무관하게 항상 `nextSequence`를 소비하고 취소 번호도 재사용하지 않는다.

`npm run sequence -- verify`, `npm run sequence:self-test`, `npm run sequence:cli-test`, `npm run sequence:validate`가 genesis 불변 증거, 현재 동적 projection, visibility 전환, tombstone, lock/CAS, 초기화·transaction 장애 복구, 경로 권한, asset receipt와 공개/비공개 경계를 검증한다. 순수 self-test는 synthetic promotion/tombstone, immutable genesis identity 면제, orphan/duplicate receipt 거부, 14개 렌더 asset 참조와 active embed·은닉 참조 거부, receipt-backed dist 누락·변조·HTML payload와 signature/MIME 불일치 거부, 모든 초기화 fault point, transfer receipt와 linked recovery lock의 이중 hard-exit·exact 재획득을 포함한 117개 fixture다. 별도 CLI test 5개는 제목·본문·HTML 없이 허용 메타데이터와 최소 공개 문서만 복제한 임시 `migration/private/sequence`에서 실제 `recover-transfer` argv를 실행해 recovery lock 취득 직후, reconcile 직후, recovery lock 제거 뒤 receipt 제거 전 강제 종료와 재실행 성공을 검증하고, 최종 `verify`와 lock·receipt pending 0을 확인한다. `npm run build:validate:public`은 private root가 존재하지 않는 경로를 주입해 현재 hydrated 공개 projection·content·media·dist 검증을 수행하고, private 디렉터리 생성 0과 권위 private root 무변경을 확인한다. 이 공개 전용 환경은 allocation·promotion·tombstone·authoritative recovery를 할 수 없다. projection과 edge manifest의 release/export는 authoritative transaction과 전체 검증이 끝난 뒤에만 한다.

## 3. 옛 주소 alias

공개 imported 글의 옛 주소는 정확한 identity→globalSequence 대응을 통해서만 유지한다.

| 종류 | 옛 주소 | 최종 주소 |
| --- | --- | --- |
| 티스토리 공개 164건 | `/{sourceId}` | `/posts/{globalSequence}` |
| 네이버 공개 185건 | `/naver/{sourceId}` | `/posts/{globalSequence}` |

옛 숫자를 새 순번으로 복사하거나 비슷한 글로 추정 연결하지 않는다. 로컬 정적 빌드의 alias 349개는 본문 복제 없이 `noindex, nofollow`, 최종 absolute canonical, 즉시 meta refresh, `location.replace`, 일반 안내와 최종 링크만 가진다. alias는 검색, RSS, sitemap에서 제외한다.

`docs/EDGE_REDIRECTS_V1.json`은 같은 **현재** 공개 projection으로 `npm run edge-redirects:generate`를 실행해 만드는 provider-neutral 308 manifest다. 이는 향후 호스팅 승인 뒤 edge 설정 입력으로 쓸 계약 자료이며 현재 provider 설정, 배포, DNS를 변경하지 않는다. authoritative sequence transaction이 완료되기 전의 projection이나 edge manifest를 release 대상으로 복사하지 않는다.

## 4. 공개 본문 링크 변환

공개 projection으로 만든 중앙 registry가 실제 대상을 증명한 경우에만 과거 authored URL을 `/posts/{globalSequence}`로 바꾼다. 변환은 공개 HTML 표현 계층에서만 수행한다.

- `dwnc.me`, `www.dwnc.me`, `dwnc.tistory.com`의 검증된 숫자 주소와 `/m/{id}` 변형을 인식한다.
- 네이버 주소는 `tsusai` owner와 허용된 path/query 구조가 모두 확인될 때만 인식한다. `PostView.naver`, `PostView.nhn`, `Redirect=Log`, `logNo`, `postNo`의 검증된 변형을 지원한다.
- 새 `/posts/{globalSequence}`도 positive integer/no-leading-zero/registry-hit 세 조건을 모두 만족해야 내부 글로 인식한다.
- host는 소문자화하고 URL은 한 번만 decode한 뒤 NFC로 정규화한다. path·query·fragment의 `%`는 완전한 hex pair와 유효한 UTF-8이어야 한다.
- encoded slash·backslash·dot segment·double encoding, custom port, userinfo, lookalike host, 다른 네이버 사용자, `naver.me`는 내부화하지 않는다.
- 내부화한 링크의 query와 확인되지 않은 fragment를 버리고 `target`과 외부 링크용 `rel` token을 제거한다.
- 표시문자 전체가 같은 URL일 때만 표시문자를 새 canonical로 바꾼다. 임의 제목·설명은 바꾸지 않는다.
- link card의 알려진 탐색용 URL 속성도 registry hit만 새 canonical로 바꾼다. 외부 card metadata와 media는 그대로 둔다.
- 네이버 편집기의 제목·이미지·지도·영상·프로필·URL 복사·player control은 authored 링크와 DOM 구조로 구분해 제거하거나 unwrap한다. 전역 href 정규식 치환은 금지한다.

## 5. 알 수 없거나 공개가 아닌 대상

- 공개 registry miss는 다른 글, tombstone, 비공개 순번으로 추정 연결하지 않는다.
- 현재 증거화된 owned registry miss 2회는 공개 출발 identity와 발생 횟수만 allowlist하고 대상 URL·ID가 없는 중립 note로 바꾼다.
- 공개 본문에 이미 있는 민감 링크 중립 placeholder 3회·2글은 그대로 유지한다.
- 비공개 247건과 공유·스크랩 미결정 10건은 공개 registry, projection, route, alias, redirect, 검색, RSS, sitemap에 넣지 않는다.
- 내부화 대상으로 증명된 75개를 제외한 authored 외부 href 352개는 exact multiset을 유지한다.

## 6. Fragment 후속 계약

현재 imported 공개 349건에는 다른 글의 fragment를 가리키는 authored 링크가 0건이다. 알려진 네이버 플랫폼 fragment는 버린다. 향후 native deep link도 대상의 실제 렌더 DOM ID map을 전수 생성·검증하기 전까지 fragment를 버린다. 존재를 증명하지 않은 fragment를 보존한다고 기록하거나 출력하지 않는다.

## 7. 검증 계약

`npm run build:validate`는 다음을 전수 검사한다.

- genesis 원장 596, 1–596 연속, 최초 next 597, 최초 공개 349·비공개 247와 두 genesis digest
- 현재 원장의 append-only 연속 sequence·generation·nextSequence, bootstrap 뒤 native-only allocation, seal·sidecar·journal replay와 initialization/transaction/lock-transfer pending 0
- 현재 공개 projection의 필드·identity·canonical·alias collision 0, 비공개 mapping 0, projection-backed content 정확히 1개, identity-bound content/asset receipt 일치
- 최초 공개 면제 identity 349개의 불변 digest, mutable inventory injection 거부, 비-genesis current public의 receipt 필수, orphan·duplicate receipt 0
- 현재 projection의 모든 로컬 공개 자산을 manifest 또는 identity-bound receipt 증거와 dist의 exact 경로·크기·SHA-256·MIME로 대조하고 HTML payload·unsafe attachment 거부
- 현재 active public canonical article와 imported alias의 동적 개수, private/tombstone reserved route 0
- 현재 alias의 noindex/canonical/refresh/JS/fallback, 검색·RSS·sitemap 포함 0
- 정식 글 meta canonical·OG, 홈·아카이브·분류·태그·검색·RSS·sitemap·관련 글·이전/다음·본문 링크가 모두 `/posts/{globalSequence}`
- authored 내부 링크 75(Tistory 39 + Naver 36), 과거 joinable URL 0, broken target 0
- URL 표시문자 canonical 21, 탐색 metadata canonical 57, 외부 href 352 불변
- unavailable 2, 민감 중립 3회·2글, Naver platform self anchor 0
- Tistory Markdown 의미와 공개 media 순서·SHA, 기존 taxonomy·video·privacy 계약
- genesis baseline에서는 sitemap URL 1,054와 물리 HTML 1,404(정식·일반 페이지·404 + alias 349). 이후 합법적인 현재 projection에서는 같은 산식으로 동적 계산

## 8. 호스팅 승인 뒤 edge 체크리스트

- [ ] `docs/EDGE_REDIRECTS_V1.json` 349개를 provider 설정으로 변환하고 308 exact mapping을 검증한다.
- [ ] `http://dwnc.me/*` → `https://dwnc.me/*`
- [ ] `http(s)://www.dwnc.me/*` → `https://dwnc.me/*`
- [ ] canonical trailing slash와 `/index.html`을 한 번에 제거한다.
- [ ] GET/HEAD 모두 chain·loop 없이 한 hop으로 끝나는지 확인한다.
- [ ] query·fragment 제거 정책과 cache behavior를 확인한다.
- [ ] alias가 검색·RSS·sitemap에 들어가지 않는지 재검증한다.

배포, DNS, traffic, provider edge 설정은 사용자의 별도 승인 전 수행하지 않는다.
