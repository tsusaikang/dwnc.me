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

### `DWNC-S3-007` — staging R2 단일 객체 시험
- **Status:** `done`
- **Updated-at:** `2026-08-27`
- **Plans:** `PLAN-05`
- **Priority:** `P0`
- **Acceptance:**
  - 최종 manifest의 사용자 소유 객체 1개만 private staging bucket에 create-only로 만든다.
  - PUT 전후 HEAD와 full GET의 SHA-256·size·MIME·cache metadata가 정확히 일치하는지 검증한다.
  - 불일치하면 덮어쓰지 않고 orphan이나 기존 객체를 삭제하지 않는다.
  - receipt는 저장소 밖 보호 경로에 덮어쓰기 없이 기록하고 자격증명은 출력하지 않는다.
- **Evidence:**
  - source commit `df3c678456f6af3471d846a32e28faa5751b9a2e`·tree `bbe8306cbf6577cd556533079593872020ddc8b5`에서 대표 객체를 추가 PUT 없이 HEAD 1·status 200 full GET 1로 검증했다. PUT 0·DELETE 0이고 version은 `null`이다.
  - HEAD와 GET의 ETag `"d3ded31a7b52f467702909afbc7d5340"`·Last-Modified `2026-08-27T00:24:12.000Z`와 manifest SHA-256 세대가 일치했으며 verifiedAt은 `2026-08-27T05:07:48.418Z`다.
  - create-only validation receipt SHA-256은 `fa72b1849496a9b6e4697721cfef9d4fcd17b8f463b41dcacd714c5f9bb2352a`다.
  - 이어 PUT 없이 전수 inspection을 다시 수행해 exact 1·missing 2,757·mismatch 0·orphan 0을 확인했다. inspectedAt은 `2026-08-27T05:09:09.996Z`, receipt SHA-256은 `f00f3c13c9ae99f8a36599db85d7a180e31d8779776653bca72c2aee596d380e`다.

### `DWNC-S3-008` — staging R2 create-only bulk upload와 full audit
- **Status:** `done`
- **Updated-at:** `2026-09-04`
- **Plans:** `PLAN-05`
- **Priority:** `P0`
- **Acceptance:**
  - exact final manifest만 create-only로 업로드하고, 올바른 계정의 비공개 bucket에서 manifest 전체 GET/SHA-256와 총 bytes를 확인한다.
  - missing·mismatch·orphan을 보고하고 PUT·DELETE·overwrite 없이 `full-get-sha256` receipt를 남긴다.
- **Evidence:**
  - 실제 staging에서 객체 2,758개·2,346,220,246바이트·orphan 0과 full object-set SHA-256 `9345d2f06c8bd7cda457a9d4335cdc2213e71dcd30bb9e11e6f3e1f8e11ae467`이 일치했다.
  - 논리 LIST/HEAD/GET은 3/2,758/2,758, 실제 전송 시도는 3/2,760/2,758, HEAD retry 2·전체 retry 2, PUT/DELETE 0이다. 보존 receipt storage SHA-256은 `ce4e4f38b35063ec425c2ba5e65cc1d3a89355def51486542e6bccd3c1909bdd`이며 현재 계약 재검증을 통과했다.

### `DWNC-S3-009` — deny-only staging Worker 최초 생성과 신뢰 정책
- **Status:** `done`
- **Updated-at:** `2026-09-04`
- **Plans:** `PLAN-06`
- **Priority:** `P0`
- **Acceptance:**
  - 올바른 계정에서 `dwnc-me-staging`이 여전히 없을 때만 최소 권한·짧은 수명 열쇠로 외부 요청을 모두 거부하는 서비스를 한 번 최초 생성한다.
  - 생성 뒤 차단 코드와 설정, 적용된 정확한 version ID가 예상과 같은지 확인한다.
  - 실제 `dwnc.me` route·custom domain·DNS와 public bucket access는 생성하지 않는다.
  - 기존 안전장치와 복구 절차는 역사 증거로 보존하되 새 보조 도구·복구 체계·서명·영수증·장애주입·모의훈련·반복 독립감사를 추가하지 않는다.
- **Evidence:**
  - smoke origin은 `https://dwnc-me-staging.dwnc.workers.dev`이고 Bearer token 정책 digest는 `d6c554c1d80c68c08605636f12f26a411f7826bc40eddaee9233a30b6551781a`다. token은 32 random bytes를 padding 없는 base64url 43문자로 만들어야 한다.
  - staging media public fingerprint는 `69cb5866228f1624693b0903e60d52b0c046464040da621b2d144cb8bffb2182`, release public fingerprint는 `2655be4122fb2238d47ba539b8e86aa9d39899631a7d713106ce711ea2de1ac2`로 release policy에 고정했다. private key는 macOS Keychain에만 보관했고 export하지 않았다.
  - 최초 생성용 설정은 외부 요청을 모두 404로 거부하고 공개 주소·미리보기 주소·route·asset·binding을 만들지 않는다. 장애 확인용 로그는 켜되 자동 요청 상세 기록은 끄고, 정해진 로그 설정이 생성 뒤 실제 Cloudflare 설정과 같은지 원본 응답의 확인값까지 대조한다. Cloudflare가 로그 보존 값을 생략하면 기본값 `켜짐`으로만 해석하며, 명시적으로 `꺼짐`이나 `값 없음`을 돌려주면 성공으로 인정하지 않는다.
  - Worker를 만들기 전 계정의 `workers.dev` 이름이 정확히 `dwnc`인지 별도로 읽고, 올바른 계정 확인값과 함께 서명된 확인 자료와 1회용 허가에 묶는다. 생성 뒤에도 다시 읽어 값이 달라졌으면 성공으로 기록하지 않는다.
  - 생성된 차단용 프로그램은 “확인 완료” 표시만 믿지 않는다. Cloudflare에서 실제 프로그램 파일을 다시 내려받아 파일이 정확히 1개인지, 이름과 바이트 수와 SHA-256이 로컬 차단 코드와 완전히 같은지 확인한다. 그 상태를 연속해서 두 번 읽어 적용 중인 deployment ID·version ID·배분, 공개·미리보기 주소, 로그 설정과 프로그램 내용이 모두 같아야 한다.
  - 각 Cloudflare 응답은 최대 1MiB까지만 읽고, 원본은 계정 번호와 열쇠를 제외한 채 프로젝트 밖의 정해진 보호 폴더에 새 파일로만 보존한다. 첫 파일 쓰기가 중간에 끊긴 경우에만 자동으로 정해진 두 번째 파일 하나를 쓸 수 있으며, 완성됐지만 내용이 다른 첫 파일을 두 번째 파일로 우회할 수 없다. 실행 전에 허가 파일, 준비·시작·결과·상태 기록과 모든 원본·복구·최종 결과 파일 18곳을 전부 확인해 하나라도 이미 있거나 일부만 기록됐거나 상위 폴더가 안전하지 않으면 Cloudflare 조회와 생성 명령을 시작하지 않는다.
  - 승인 유효기간과 Git 상태는 첫 조회 직전, 1회용 허가를 기록하기 직전, 허가 기록 뒤 Worker 생성 명령을 실행하기 직전까지 세 번 확인한다. 따라서 확인이나 허가 기록에 시간이 걸려 승인이 만료되거나 Git 상태가 바뀌어도 생성 명령은 실행하지 않는다. 현재 Git 기록이 승인된 기록과 정확히 같고 tracked 변경과 일반 untracked 파일이 없어야 한다. `.gitignore`에 명시된 생성 결과·로컬 원본은 Git 상태에서 제외되지만, 최초 생성 payload는 별도 임시 폴더의 고정 차단 코드·설정·빈 환경 파일만 사용해 그 자료가 업로드에 섞이지 않는다.
  - 현재 전용 로컬 시험에서 상태·원본 검증 3,718개, 중단 복구 1,023개, 실제 runner→복구 자식 139개, 실제 실행 흐름 1,819개를 통과했다. 정상 흐름은 생성 전 Cloudflare 확인 2회, 준비·허가·시작·결과 기록, 봉인된 Wrangler 생성 명령 정확히 1회, 현재 상태 A·B 조회와 최종 상태 기록 순서로 고정한다. 복구 흐름은 생성 명령·Wrangler·whoami 없이 exact account token 확인과 계정 주소 GET 2회, 현재 상태 A·B GET만 호출한다. 부모 확인 직후 다른 실행이 상태 기록을 먼저 완성해도 이번 인증 조회·이번 자식 상태 조회·기록된 과거 요청 수를 분리한다. 각 현재 상태 조회는 Worker 존재, deploy 가능한 version이 정확히 1개인지, deployment 하나가 한 version에 100%인지, 계정 주소, 공개·미리보기 상태, 설정, 실제 차단 코드와 version 설명을 확인한다. 자식 출력 buffer는 성공·오류·크기 초과·비정상 종료와 listener 등록 실패에서도 모두 0으로 덮고 해제한다. 비밀값·압축 응답·크기 초과·여러 version/deployment·분할 적용·결과 version 불일치·두 조회의 변화·기록 충돌·Git 변경·승인 만료·임시 파일 정리 실패 때는 성공으로 넘어가지 않는다. 이 과정의 실제 Cloudflare 조회·Worker 생성·설정 변경·배포·DNS 변경은 0회다.
  - 정확한 staging 계정에서만 쓸 짧은 수명 관리 열쇠의 로컬 전달 도구는 완성했다. 새 Account API token의 정확한 53자 형식(`cfat_` + 영문·숫자 40자 + 소문자 16진수 8자)만 받고 접두사 없는 예전 token은 거부한다. Cloudflare 화면에서 `계정 > Workers Scripts > Edit`로 고르는 권한은 API permission의 `Workers Scripts Write`와 같은 Worker script 쓰기 권한이며, 이 한 가지만 허용한다. 사용 시작부터 만료까지 48시간 이하·실행 시 남은 시간이 60분 이상이어야 한다. 열쇠는 새 Keychain 항목에만 저장하고 프로젝트 밖의 기본 확인 파일과 고정 예비 파일에는 계정·열쇠·token ID 원문 대신 확인값만 기록한다. 두 경로의 안전성과 현재 상태를 열쇠나 API보다 먼저 확인하고 실제 기록 직전에 다시 확인한다. 현재 고정 payload는 원문 402바이트·Keychain 문자열 536자이며, 공용 Keychain 운반 상한 1,024자 안에서만 허용한다. 실행 때는 성공 응답이면서 오류 목록이 비어 있는 열쇠 상태, 계정의 `workers.dev=dwnc`, Wrangler의 `Account API Token` 및 계정 1개 일치를 먼저 확인한다. 그 뒤 익명 FD 3으로 허용된 자식에만 넘기고, 실제 Wrangler 자식만 token 환경변수를 받는다. Wrangler 4.125의 실제 본체와 필요한 최소 660개 파일의 전체 내용 확인값을 검증해 격리 폴더에 새 읽기 전용 사본을 만든 뒤, 이 사본을 현재 Node 절대경로로 직접 실행한다. 변조·symlink·확인 직후 교체가 있으면 열쇠를 읽거나 자식을 시작하기 전에 중단한다. 빈 HOME·XDG·임시 폴더·빈 환경 파일과 고정 PATH를 사용하고 로그인 정보 자동 대체, 외부 환경 덮어쓰기, 로그와 사용량 전송을 끈다. FD 쓰기·실행 시작·종료 오류가 나면 자식 실행을 종료하고 출력 통로가 닫힌 것을 확인한 뒤 임시 폴더를 정리한다. R2·DNS·Zone·route·삭제·production 명령은 허용 목록에 없다.
  - 재개용 stdin runner는 shell·TTY·clipboard를 사용하지 않고 **non-TTY FIFO 또는 socket**에서 정확한 53바이트 뒤 EOF만 한 번 받는다. regular file·줄바꿈·짧거나 긴 입력·추가 바이트·시간 초과·입력 오류를 거부하며 성공·실패의 모든 소유 Buffer를 0으로 덮고 출력은 고정 schema와 허용 code만 사용한다. runner 단독으로 anonymous 여부를 주장하지 않는다. 실제 main bridge가 shell 없이 고정 `/usr/local/bin/node`, exact runner script·cwd·args, direct `child.stdin` socketpair와 `HOME`·`USER`·`LOGNAME`·`PATH`·`LANG`·`LC_ALL`·`__CF_USER_TEXT_ENCODING` exact 7-key 환경으로 spawn하는 것이 실제 신뢰 경계다. runner는 module-derived repository root와 cwd exact match, exact 7-key 이름, 모든 환경 값 안의 token/account 패턴 부재, 빈 Node execArgv와 channel kind를 먼저 확인하지만 stdin을 소비하지 않으며 clean Git·full HEAD는 bridge가 전달 직전 별도 read-only gate로 확인한다. 실제 모드는 그 뒤 manager를 dynamic import·호출하고, 기존 initializer가 primary·recovery metadata destination과 Keychain 부재를 먼저 확인한 뒤 lazy source `preflight()`의 channel/state 0-read 검사와 `readOnceAndClear()`의 exact input 1회 수신을 수행한다. `clear()`는 unread input을 소비하지 않고 listener·timer·소유 buffer만 정리한다. npm은 상속 환경과 shell 경계 때문에 실제 전달 경로로 쓰지 않으며 package command를 두지 않는다. manager 호출 전 신호는 manager import/call 0으로, initializer 선검사 뒤 input 읽기 전·중 `SIGTERM`·`SIGHUP`·`SIGINT`·`SIGQUIT`·`SIGUSR1`은 token 검증·Keychain/metadata write 0인 고정 실패로 끝난다. exact input 소유 callback 뒤에는 같은 신호의 기본 종료 동작만 manager terminal cleanup까지 막고 진행 중인 단일 초기화를 중단하거나 성공 결과를 unknown/failure로 뒤집지 않으며 자동 retry는 0이다. manager 자체 오류는 기존 고정 분류를 유지한다. 같은 reader의 고정 비민감 `--probe`만 manager import 없이 직접 1회 읽으며 fetch·Keychain·metadata/file write·native spawn·manager import/call이 각각 정확히 0회다. clean commit `132c1bbf509aa6349fdb48c4ccfe21909bc30004`의 main in-app-browser E2E에서 첫 probe는 sentinel 본문을 `s` 40자로 잘못 넣어 요구된 `P` 40자와 달랐기 때문에 고정 `PROBE` 오류로 거부됐고 child raw 출력·외부 요청·Keychain 접근 0, browser clipboard clear를 유지했다. 정확한 고정 sentinel 재실행은 browser read 53바이트, child exit 0·stdout, `inputKind=socket`·`inputReads=1`·`bufferZeroed=true`·`sideEffects=0`, runner clipboard 접근 0·browser clipboard clear·raw child output 0·overflow 0·stderr 0으로 통과했다. observer aggregate의 `false`는 fixed 성공 schema에 없는 parsed result `code`를 `0`과 중복 비교한 판정식 오류였고 실제 `exit.code=0`과 schema 대조로 E2E GO를 확정했으며 추가 재실행은 0이다. stdin 전용 435개·기존 관리-token 378개·requirements validator·diff 검사가 통과했다. 전체 `cloudflare:test`의 R2 entrypoint 정적 계약 실패는 관련 파일이 HEAD와 동일한 기존 기준선 문제다. 이는 실제 token 생성·전달·초기화 승인이 아니며 `DWNC-S3-009` 완료 상태도 바꾸지 않는다. 다음에 제안하는 단일 승인 범위는 2026-09-05 만료·Workers Scripts Write 한 권한의 새 token 1개 생성, 검증된 direct bridge 초기화 1회, 모든 gate 통과 시 봉인된 deny-only bootstrap 1회, 성공·실패 terminal cleanup의 해당 token 1회 삭제와 목록 부재 확인까지이며 모호한 결과는 재시도하지 않는다.
  - 기존 21-field `dwnc-cloudflare-bootstrap-authorization-v1` 계약과 consumer·executor·recovery를 바꾸지 않고 staging 전용 운영 creator `cloudflare:staging:bootstrap-authorization:create`를 추가했다. CLI는 서명된 service 부재·account subdomain의 receipt/signature/public-key 절대경로 6개와 저장소 밖 output 절대경로만 받는다. creator는 두 증거를 tracked release key로 검증하고 `exists=false`, exact account fingerprint·environment·Worker·`dwnc` subdomain·request hash·expiry를 요구한다. 현재 clean HEAD·tree를 생성 전과 create-only 저장 전·후에 대조하되 기존 authorization에는 `sourceGitSha`만 기록하고 새 approval·tree field를 추가하지 않는다. 기존 export로 deny source/config SHA와 두 fresh request hash·최대 15초를 계산하고, crypto UUIDv4·32바이트 nonce hash, 현재 시각·정확히 5분 뒤 만료를 만든 뒤 기존 validator를 통과한 canonical 후보만 mode 600으로 새로 쓰고 exact 재읽기한다. account ID·token 원문은 입력·출력·파일·argv·환경변수에 두지 않으며 후보는 기존 signer로 별도 서명한다. creator 53개, 기존 bootstrap 3,718개·실행 흐름 1,819개·signing 107개 검사는 live network·실제 Keychain·clipboard 0으로 통과했다. 실제 증거 수집·후보 생성·서명·Worker 생성은 0회다.
  - 관리 token의 terminal cleanup에는 새 CLI를 추가하지 않는다. Cloudflare UI에서 exact token 행을 한 번 삭제하고 새로고침 뒤 이름 부재를 확인한 경우에만 기존 PLAN-05 방식으로 고정 service `me.dwnc.cloudflare-staging-worker-control.v1`·account `dwnc:staging:workers-scripts-edit`에 `security delete-generic-password`를 정확히 한 번 실행한다. 이어 같은 identity를 `-w` 없이 presence-only로 조회해 exit 44를 확인한다. primary/recovery metadata와 immutable evidence는 보존하며, 원격 대상이나 삭제·부재 결과가 모호하면 local delete는 0회다.
  - `dwnc-me-staging-worker-control-20260904` Account API token은 Workers Scripts Write 한 권한과 2026-09-05 만료로 생성됐다. 최초 `npm run cloudflare:staging:control-token:init`은 `CLOUDFLARE_E_ACCOUNT_CLIPBOARD`로 clipboard 단계에서 실패했다. 재시도·복구·후속 외부 요청 0, token 검증·Keychain·metadata 생성 불성립 상태에서 중단했다. 이후 사용자 승인으로 Cloudflare UI에서 해당 token을 정확히 1회 삭제했고, 즉시 목록과 새로고침 후 목록 모두 0건을 확인했다. 내장 브라우저 clipboard는 raw read 0으로 내용을 읽지 않고 빈 문자열로 덮어써 비웠다. 다른 token·Worker·version·deployment·공개 endpoint·DNS·route·traffic·R2 변경은 0이다. 이 요구사항은 아직 미완료이며, 새 token 생성·새 전달·재시도는 새 사용자 승인 전에 하지 않고 `DWNC-S3-010`도 시작하지 않는다.
  - 위 두 항목의 승인 제안·대기 문장은 첫 실패 직후, 이어진 단일 승인 범위는 두 번째 실행 직전의 당시 상태를 기록한다.
  - 승인된 재개 실행에서 `dwnc-me-staging-worker-control-20260904-v2`를 Workers Scripts Write 한 권한·2026-09-05 만료로 UI에서 한 번 생성하고 browser copy 1회→direct stdin actual init 1회를 수행했다. runner는 53바이트를 받았지만 기존 account-target Keychain 확인이 `CLOUDFLARE_E_ACCOUNT_STORE_KEYCHAIN`으로 먼저 실패해 `inputReads=0`, `bufferZeroed=true`, `durableState=none`, raw child output 0과 clipboard clear를 유지했다. token verify·subdomain GET·Keychain/metadata write·bootstrap·deploy·Worker/version/deployment/public endpoint·DNS/route/traffic·R2 변경은 모두 0회이며 재시도하지 않았다. terminal cleanup에서 해당 exact UI 행을 한 번 삭제하고 즉시·새로고침 후 부재를 확인했으며 token action 행은 이전 2개로 돌아왔다. primary/recovery control metadata와 고정 control-token Keychain 항목은 부재였고 presence-only 조회만 사용해 비밀 read·write·delete는 0회였다. exact 7-key 환경과 일반 환경의 비밀 없는 비교에서 account-target 항목은 모두 존재, control-token 항목은 모두 exit 44·not-found였으므로 환경 가시성이나 항목 부재가 원인은 아니다. actual secret read 없이 원인은 기존 account-target의 `-w` 비밀 읽기/잠금 해제 또는 읽은 내용 검증 경계까지로만 좁혔다. 이번 승인 묶음은 terminal 상태로 소진됐고, 정확한 원인 보강과 새 사용자 승인 전에는 다시 실행하지 않는다. authorization creator commit `045a314cfac6db8ce977ae072cd1ce8be1d1655e`는 완료됐지만 이번 실행에서 사용하지 않았으며 `DWNC-S3-009`는 미완료·`DWNC-S3-010`은 차단 상태다.

  - 승인된 v3 실행에서는 `dwnc-me-staging-worker-control-20260904-v3`를 Workers Scripts Write·2026-09-05 만료·All IPs로 UI에서 한 번 생성하고 browser copy 1회→direct stdin 초기화 1회를 수행했다. 호출자는 53바이트 전달 뒤 자체 buffer를 0으로 덮고 clipboard를 비웠으며 overflow는 없었다. 직접 관측값은 child exit 1·stderr 296바이트와 메인 observer의 stdout JSON parse 실패이며, stderr 내용은 읽거나 해석하지 않았다. runner 정적 계약상 처리된 exit 1 실패 JSON은 stderr로 나가고 stdout은 비지만, 296바이트가 될 수 있는 허용 오류는 `CLOUDFLARE_E_ACCOUNT_STORE_KEYCHAIN`, `CLOUDFLARE_E_ACCOUNT_STORE_LOCATION`, `CLOUDFLARE_E_ACCOUNT_STORE_METADATA`, `CLOUDFLARE_E_STAGING_CONTROL_EXISTS`, `CLOUDFLARE_E_STAGING_CONTROL_VERIFY` 다섯 가지이므로 이번 오류는 특정할 수 없다. 성공 영수증·재시도·외부 bootstrap은 0회다. exact UI 행을 즉시 한 번 삭제했고 즉시·새로고침 후 모두 0건, 목록은 기존 두 행으로 돌아왔다. 하위 감사에서 `durableLocalState=none`, control-token primary/recovery metadata와 고정 Keychain 항목은 모두 부재였고 Account ID·token 원문 read/output은 0회였다. 감사 자체의 외부 write/delete·파일 수정·retry도 0회이며 authorization creator는 사용하지 않았다. 다음 시도 전 메인 observer는 exit 0이면 stdout, exit 1이면 stderr를 제한된 크기로 해석하고 고정 schema를 확인해야 한다. 나머지 원인과 수정 범위는 그 결과로 판단한다. 이번 승인 묶음은 소진됐고 `DWNC-S3-009`는 미완료·NO-GO, `DWNC-S3-010`은 차단 상태다.
  - 후속 v5 token은 initializer `ACCOUNT_STORE_KEYCHAIN`, direct-frame `VERIFY`, network tool 경계 실패 뒤 dashboard 방식으로 전환했으며 exact v5 token을 삭제해 기존 두 행만 남겼다. 2026-09-04 dashboard에서 `dwnc-me-staging`을 직접 생성했다. 최초 비활성 HelloWorld version은 `330216b8`, 당시 100% 활성 deny-only version은 `2b543790`이었다. 활성 응답은 정확히 404 `Not found`와 `no-store`·`text/plain; charset=utf-8`·`nosniff` header를 반환했다. 당시 `workers.dev`·preview는 disabled이고 custom domain·route·binding은 없었다. dashboard preview가 initial version에 GET 2회를 보냈지만 production DNS·route·traffic과 R2 영향은 0이다.

### `DWNC-S3-012` — 사용 불가능한 기존 staging R2 token 정리
- **Status:** `done`
- **Updated-at:** `2026-09-04`
- **Plans:** `PLAN-05`
- **Priority:** `P1`
- **Acceptance:**
  - `PLAN-05`의 실제 전수 비교가 통과해 현재 작업용 열쇠가 정상임을 확인한다.
  - 이번 작업에 사용한 짧은 수명 열쇠와 2026-08-25에 만든 사용 불가능한 기존 uploader·validator token 두 개만 정확히 식별해 정리한다.
  - 새 자격증명, bucket, 객체, Worker, domain·DNS에는 다른 변경을 하지 않는다.
- **Evidence:**
  - 이번 full audit에 쓴 짧은 수명 validator token은 Cloudflare 화면에서 삭제·목록 부재를 확인했다. 대응하는 고정 Keychain 항목 하나도 비밀값 read 0·exact delete 1 뒤 부재를 확인했다. v3/v3b metadata·dashboard evidence와 모든 capture·receipt는 보존했다.
  - tracked staging account 확인값이 일치한 R2 Account API token 표에서 `dwnc-me-staging-r2-validator`와 `dwnc-me-staging-r2-uploader`의 이름·exact staging bucket 권한·2026-08-25 생성·Active 상태를 보존 생성 증거와 정확히 결속했다. 사용자 승인 후 validator와 uploader를 이 순서로 각각 한 번 삭제했고 각 행 0과 최종 목록 부재를 확인했다. 이전 관측 User API token 다섯 개 이름은 그대로이며 다른 Cloudflare 변경은 0회다.
  - 새 validator는 대표 객체를 HEAD 1·full GET 1·PUT 0·DELETE 0으로 검증했고 receipt SHA-256은 `fa72b1849496a9b6e4697721cfef9d4fcd17b8f463b41dcacd714c5f9bb2352a`다.

### `DWNC-S3-013` — Cloudflare 계정 번호를 열쇠와 분리해 안전하게 보관
- **Status:** `done`
- **Updated-at:** `2026-09-04`
- **Plans:** `PLAN-05`, `PLAN-06`, `PLAN-07`
- **Priority:** `P0`
- **Acceptance:**
  - 올바른 Cloudflare 계정을 한 번 확인하고 계정 번호를 업로드·검사용 열쇠와 분리해 macOS 보관함에 둔다.
  - 원문을 프로젝트·로그·일반 출력에 남기지 않고 기존 항목이나 파일을 덮어쓰거나 삭제하지 않는다.
- **Evidence:**
  - 초기 localhost·virtual clipboard·Terminal 전달 실패는 accepted connection·local paste·초기화를 0회로 유지한 채 중단했으며, 이후 승인된 안전 전달로 account target 초기화와 비표시 일치 확인을 완료했다.
  - 원문은 프로젝트 파일·argv·환경변수·일반 출력에 남기지 않았고, 계정 대상 전용 시험 698개와 secure stdin 시험 112개를 통과했다.
