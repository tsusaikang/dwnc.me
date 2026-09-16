# dwnc.me 완료 요구사항 archive

이 문서는 완료 요구사항과 완료 계획의 역사 자료다. 현재 유효한 미완료 항목은 [`REQUIREMENTS.md`](REQUIREMENTS.md)에서 관리하며, 평소에는 이 보관 문서를 읽지 않고 필요한 ID나 과거 근거만 조회한다.

<!-- requirements-archive-policy: status=done order=updated-at-id-asc -->

완료된 요구사항은 모두 이곳으로 이동해 `(Updated-at, ID)` 오름차순으로 보존한다. 번호·제목·완료 조건·근거·날짜는 유지하고 번호를 재사용하지 않는다. 과거의 대기·승인 문장은 당시 이력이며 현재 실행 권한이 아니다.

## 완료 요구사항

### `DWNC-CORE-001` — 콘텐츠 보존과 로컬 사이트 기준선
- **Status:** `done`
- **Updated-at:** `2026-08-24`
- **Plans:** `PLAN-01`, `PLAN-02`, `PLAN-03`
- **Priority:** `P0`
- **Acceptance:**
  - 티스토리 공개 164개와 네이버 소유 432개를 공개·private 물리 경계에 맞게 보존한다.
  - 공개 canonical 349개, legacy alias 349개와 관련 local build/validator를 통과한다.
- **Evidence:**
  - [당시 상태 기록](history/PROJECT_STATE_HISTORY_20260909_234401.md)의 현재 검증 결과.
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
  - [당시 상태 기록](history/PROJECT_STATE_HISTORY_20260909_234401.md)의 12 suites·463 assertions PASS 기록.

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
  - [당시 상태 기록](history/PROJECT_STATE_HISTORY_20260909_234401.md)의 Builds guard checkpoint.

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

### `DWNC-S3-010` — staging version-only upload·activation·synthetic smoke
- **Status:** `done`
- **Updated-at:** `2026-09-05`
- **Plans:** `PLAN-06`
- **Priority:** `P0`
- **Acceptance:**
  - 확정된 Git 기록을 기준으로 관련 빌드와 검사를 한 묶음만 실행하고, staging version만 version-only로 업로드한다.
  - 해당 version ID를 staging에 100% 적용하고 모호한 결과는 자동 재시도하지 않는다.
  - 일반 페이지 GET·HEAD, 예전 주소 349개의 GET·HEAD 총 698건, `/404.html`의 404, media GET·HEAD·304·206·416·ETag·Range를 `workers.dev`에서 검증한다.
  - 통과한 정확한 Git SHA와 Cloudflare version ID를 기록하고 실제 `dwnc.me` 도메인·DNS는 변경하지 않는다.
- **Evidence:**
  - runtime source commit `05962c4c0872b5234d3a45298ab0e44d123d03da`의 artifact SHA-256은 `81cf14fcaab0245c380d6e4e8d274df14dee41dde7bacfa19d510449a180d501`다. version `bb59f4ee-55f5-4626-858b-0653d7e79900`을 version-only로 올려 staging에 100% 적용했다.
  - live 종합 점검에서 이전 주소 GET 349·HEAD 349는 모두 308·빈 body·query 제거, media GET 200·HEAD 200·304·206·416·MIME·ETag·Range, `/404.html` GET·HEAD와 cache를 통과했고 모든 live 응답의 version이 정확히 일치했다.
  - `/` GET·HEAD는 200 `text/html`, HEAD는 빈 body였고 `/about` GET body는 artifact와 byte-exact였다. `/about` GET·HEAD 200·MIME·version·header parity와 HEAD 빈 body도 확인했다.
  - 앞선 `debfe664…`는 path normalization 결함으로 `/`가 404였고 `4bd84ef8…`는 이를 고친 뒤 full collector의 과도한 고정 Content-Length 비교에서 멈췄다. 실제 live 응답은 의도한 streaming 계약을 충족했으며 smoke collector fix commit `ab5489a91c5f6b159a344e49f9d0e066cfb5eaa4`에서 이 false-negative를 교정했다. staging smoke unit 181개와 media-worker 5,796개가 PASS했다.
  - 최종 `workers.dev`·preview는 off이고 custom domain·route는 0이며 ASSETS와 staging R2 binding은 유지됐다. 2026-08-27 account token은 `DWNC-S3-012` 대상이 아니므로 보존했다. production DNS·route·traffic, R2 overwrite·delete, Git push는 모두 0회다.
  - [`MEDIA_SERVING_CONTRACT.md`](MEDIA_SERVING_CONTRACT.md)의 version-only와 staging smoke 계약.

### `DWNC-S3-011` — production 이름 Cloudflare 자원·버전 준비
- **Status:** `done`
- **Updated-at:** `2026-09-05`
- **Plans:** `PLAN-07`
- **Priority:** `P1`
- **Acceptance:**
  - staging 결과, full Git SHA와 Cloudflare version ID를 기록한다.
  - staging이 통과한 뒤 최종 운영에 실제 필요한 production 이름의 R2·Worker version만 같은 절차로 준비한다. 새 보조 도구·모의훈련·반복 검증은 추가하지 않고 각 단계별 새 승인 대기 때문에 멈추지 않는다.
  - production이라는 이름은 현재 실제 도메인 트래픽을 뜻하지 않으며, `dwnc.me` 도메인·DNS·route는 연결하지 않는다.
- **Evidence:**
  - private production R2에 2,758개·2,346,220,246바이트를 create-only로 준비했고 전체 GET/SHA-256 감사에서 orphan 0·retry 0·PUT 0·DELETE 0과 object-set SHA-256 `9345d2f06c8bd7cda457a9d4335cdc2213e71dcd30bb9e11e6f3e1f8e11ae467` 일치를 확인했다. production uploader·validator 자격과 signing private key는 Keychain에만 보관했다.
  - source commit `68f2225bf647061e4740f2dc136cc9fd8f937fdb`의 artifact `be178dbe3618d3f1c9300bae265780a3d77841bac2120457d985f88393a34615`를 version `476acc86-b11d-4ba4-a699-cb26c551a93d`으로 version-only 업로드하고 bindings·assets·ETag·runtime attestation과 서명을 완료했다.
  - 기존 active version `f0a8bec2-b57b-45af-b2f6-227dd045b3f8` 100%는 그대로이고 DNS·route·traffic·public endpoint 변화는 0이다. 현재 tooling 기준은 commit `f88aac20ec98426539b9450299d7c84b31d8ba4f`이며 artifact source와 구분한다.
  - [`MEDIA_SERVING_CONTRACT.md`](MEDIA_SERVING_CONTRACT.md)의 two-phase production 안전 절차.

### `DWNC-S3-014` — 실제 도메인 연결과 production 운영 전환
- **Status:** `done`
- **Updated-at:** `2026-09-05`
- **Plans:** `PLAN-08`
- **Priority:** `P0`
- **Acceptance:**
  - 사용자의 결정 뒤 준비된 production Worker version을 100% 활성화하고 실제 `dwnc.me`가 새 사이트를 제공하도록 연결한다.
  - 실제 주소에서 대표 글, Tistory·Naver 예전 주소 이동, 대표 미디어와 데스크톱·모바일 화면을 확인한다.
  - 기존 DNS를 불필요하게 삭제하지 않고 R2 객체 덮어쓰기·삭제와 Git push를 하지 않는다.
- **Evidence:**
  - production version을 100% 활성화하고 기존 apex CNAME을 삭제하지 않은 채 DNS only에서 Proxied로 전환해 Worker route `dwnc.me/*`를 연결했다. 기존 Proxied `www` CNAME은 유지했다.
  - Custom Domain은 기존 DNS와 충돌해 사용하지 않았고 DNS 삭제는 0회다. 기존 redirect 설정이 HTTP apex와 HTTPS `www`를 HTTPS apex의 같은 경로·query로 이동시키므로 새 redirect rule은 만들지 않았다.
  - 실제 루트, `/posts/596`의 제목·본문·이미지 10개, `/posts/411`의 제목·이미지 25개, `/1`→`/posts/433`, `/naver/220404726308`→`/posts/1`, 대표 GIF 표시를 확인했다.
  - 데스크톱이 정상이고 390×844 모바일의 홈과 `/posts/596`에서 모바일형 레이아웃, 가로 넘침·핵심 잘림·깨진 이미지가 모두 0이다. R2 덮어쓰기·삭제와 Git push도 0회다.

### `DWNC-OPS-002` — 지속적인 새 글 작성 방식 결정
- **Status:** `done`
- **Updated-at:** `2026-09-06`
- **Plans:** `PLAN-09`
- **Priority:** `P1`
- **Acceptance:**
  - Cloudflare Access 이메일 OTP와 애플리케이션의 토큰 확인을 모두 통과한 허용 사용자만 별도 관리자 Worker의 작성 API와 화면을 사용할 수 있다.
  - 기존 공개 글 349편은 원래 주소·번호·날짜·본문·분류·이미지 참조를 보존한 D1 편집 사본으로 관리자 목록에 표시되고 선택·수정할 수 있다.
  - 새 글은 D1을 권위 자료로 사용하고 첫 발행 때 597부터 원자적으로 순번을 배정하며, 임시저장·미리보기·발행·발행 후 수정과 카테고리·태그를 지원한다.
  - 새 이미지는 기존 2,758개 저장소와 분리된 private R2에 새 UUID key로만 저장하고 기존 객체를 덮어쓰거나 삭제하지 않는다.
  - 공개 Worker에는 쓰기 API가 없고, 발행된 글은 홈·아카이브·카테고리·태그·검색·RSS·사이트맵에 재배포 없이 반영된다.
- **Evidence:**
  - [`URL_CONTRACT.md`](URL_CONTRACT.md)의 597 이후 D1 순번 계약과 [`MEDIA_SERVING_CONTRACT.md`](MEDIA_SERVING_CONTRACT.md)의 신규 native 미디어 경계.
  - Zero Trust Free plan과 staging·production 데이터 저장소, 이메일 OTP Access 앱, production 관리자·공개 Worker 운영 반영을 완료했다. 로그인 뒤 관리자 목록 349편과 #595의 편집 필드 로드, public 전환 뒤 live 홈과 `/posts/595` 정상 표시를 확인했으며 실제 글 내용은 변경하지 않았다.

### `DWNC-CORE-002` — 작업본 자동저장과 명시적 공개 반영
- **Status:** `done`
- **Updated-at:** `2026-09-07`
- **Plans:** `PLAN-09`
- **Priority:** `P0`
- **Acceptance:**
  - 기존 공개 글의 자동저장은 작업본에만 기록하고 공개 글과 공개 이미지 참조를 바꾸지 않는다.
  - 작업본 저장 상태와 마지막 저장 성공 여부를 화면에 표시하며 실패 시 내용을 유지하고 같은 화면에서 재시도한다.
  - 공개 반영 전에 미저장 변경을 먼저 저장하고, 성공한 최신 작업본만 공개한다.
  - 로그인 만료 시 편집 화면의 내용을 유지한 채 재로그인 후 이어간다.
  - 다른 탭·세션의 수정은 자동 덮어쓰기하지 않고 최신본 불러오기와 현재 작성본 유지 중 가능한 선택을 쉬운 말로 제공한다.
  - 새 글·기존 글·이미지·링크 카드·미리보기·발행·기존 주소를 유지한다.
  - 관련 통상 시험과 내장 브라우저 확인, 공식 상태·요구사항 갱신을 완료하며 실제 외부 활성화는 별도 승인 뒤 수행한다.
- **Evidence:**
  - [당시 상태 기록](history/PROJECT_STATE_HISTORY_20260909_234401.md)의 2026-09-07 작업본 CMS 로컬 완료 기록. 실제 SQLite 저장·동시 수정 시험, 실행 UI의 실패/재로그인/충돌 시험과 내장 브라우저의 저장·공개 분리/새 글/미리보기/이미지/링크 카드 확인을 통과했다.
  - 2026-09-07 사용자 승인 후 운영 작업본 테이블 추가와 관리자 버전 활성화를 완료했다. 실제 관리자에서 공개 반영·작업본 상태·기존 글과 이미지·선택 삭제 도구막대를 확인했고 공개 글도 정상이다. 실제 글의 수정·발행·삭제는 수행하지 않았다.

### `DWNC-CORE-003` — 기본 서식 편집과 기존 글 서식 보존
- **Status:** `done`
- **Updated-at:** `2026-09-07`
- **Plans:** `PLAN-09`
- **Priority:** `P0`
- **Acceptance:**
  - 기존·신규 글에 문단/제목, 크기, 굵게/기울임/밑줄/취소선, 색/배경색, 정렬, 목록, 인용, 구분선, 링크, 기본 표와 실행취소/다시실행을 가볍게 지정할 도구를 제공한다.
  - 기존 글의 주요 서식·표·이미지·링크 카드 구조를 보존하고 저장·재열기·미리보기·공개 후에도 서식이 유지된다.
  - 글의 출처와 본문 형식을 분리하고 기존 Markdown 글은 읽기만으로 변환 저장하지 않는다.
  - 작업본 자동저장과 명시적 공개 반영, 실패·재로그인·충돌 처리, 이미지·카드 선택/삭제를 유지한다.
  - 합성 데이터의 통상 실행 시험과 내장 브라우저 확인을 마치고 실제 서비스 적용 직전에 승인받는다.
- **Evidence:**
  - 2026-09-07 공개된 기존 글의 실제 서식과 현 편집기·저장 처리 진단을 완료했다. [당시 상태 기록](history/PROJECT_STATE_HISTORY_20260909_234401.md)의 현재 우선 작업 절에 범위·결정과 진행 상태를 기록한다.
  - 공통 시각 편집과 서식 도구, 명시적 본문 형식과 출처 분리, 서식 보존과 native HTML 이미지 공개 참조를 로컬 구현했다. 기존/신규 서식 저장·재열기·미리보기·공개와 기존 CMS 회귀, 공개 파생 글의 서식 보존 시험을 통과했다.
  - 합성 내장 브라우저에서 선택 서식·실행취소·링크·표·새 글 #597·미리보기·공개 반영·재열기·이미지 선택 중 본문 무변경을 확인했다. 모바일 실측은 도구가 크기 변경을 적용하지 않아 미확인으로 기록한다. 실제 운영 글은 변경하지 않았다.
  - 마지막 연속 크기·굵기·색 지정 후 입력도 실제 스타일 유지로 확인했다. 최종 source-only 공개 빌드와 관리자 번들 검사를 통과했다. 세부 변경·검증·운영 적용 순서는 [당시 상태 기록](history/PROJECT_STATE_HISTORY_20260909_234401.md)에 기록한다.
  - 실제 서비스 적용 승인과 정확한 로그인 권한 동의 후 형식 열 추가 → 공개 프로그램 → 관리자 프로그램 운영 적용을 완료했다. 자체 내장 브라우저에서 서식 도구·작업본 안내·미리보기·기존 이미지·긴 본문의 삭제 도구·공개 /posts/595를 확인했다. 기존 글·사진·정적 파일·주소 연결 설정을 유지했고 인증 메모리 세션은 종료했다. 자세한 활성 버전과 확인 결과는 [당시 상태 기록](history/PROJECT_STATE_HISTORY_20260909_234401.md)에 기록한다.
  - 운영 사용자 보고로 좁은 화면에서 전체 글 목록 아래에 편집 화면이 숨는 문제를 재현했다. 목록 높이 제한·선택 성공 후 편집칸 이동·글 목록 복귀를 수정해 관리자에 반영했다. 합성 긴 목록에서 처음/끝 선택을, 실제 운영 700×720에서 #596·#595 선택과 편집 이동을 확인했으며 기존 저장/실패 상태 시험도 통과했다. 실제 글 내용은 변경하지 않았다.

### `DWNC-CORE-004` — 티스토리를 참고한 집중 작성 화면
- **Status:** `done`
- **Updated-at:** `2026-09-07`
- **Plans:** `PLAN-09`
- **Priority:** `P0`
- **Acceptance:**
  - 글 목록과 편집 화면을 분리하고 상단 사진·서식 도구, 중앙의 분류·제목·넓은 본문·태그, 하단 저장 상태·미리보기·공개 반영으로 구성한다. 기존 요약 등 글 정보도 유지한다.
  - 목록 왕복과 미리보기에서 현재 입력과 본문 구조를 유지하며 성공한 글 선택·새 글 생성 후 편집 영역을 바로 보여 준다.
  - 별도 미리보기 화면에 PC/모바일 폭 선택과 닫기·Escape·포커스 복귀를 제공한다.
  - 기존 서식·이미지·링크 카드·삭제 도구, 작업본 자동저장·명시적 공개 반영·저장 실패·재로그인·충돌 처리와 새 글 주소 계약을 유지한다.
  - 합성 통상 시험과 1280/700/390px 내장 브라우저 확인, 문서 갱신을 마치고 새 화면을 외부에 활성화하기 직전에 승인받는다.
- **Evidence:**
  - 사용자가 티스토리 편집 화면을 참고하도록 요청하고 내장 브라우저에서 로그인했다. 실제 빈 글쓰기 화면의 배치·첨부·문단 메뉴·PC/Mobile 미리보기 흐름을 확인했다. 기존 티스토리 글이나 dwnc.me 글은 변경하지 않았다.
  - 역할·구현 범위·보존 계약과 승인 경계는 [당시 상태 기록](history/PROJECT_STATE_HISTORY_20260909_234401.md)의 현재 우선 작업에 기록했다. 로컬 개편·관련 저장/실패/로그인/충돌/미리보기 시험·최종 형식 검사·관리자 번들 생성을 완료했다.
  - 자체 내장 브라우저의 1280/700/390px에서 글쓰기·고정 메뉴·별도 PC/모바일 미리보기·사진 패널·긴 본문 이미지 삭제 도구를 확인했고, 합성 새 글 입력과 작업본 자동저장도 확인했다. 실제 글은 변경하지 않았다.
  - runtime source `347758395dece6868b39750e344cda60d8f14893`의 새 작성 화면을 사용자 승인 후 실제 관리자에 적용했고 활성 코드는 준비 번들과 일치한다. DB·공개 프로그램·사진·실제 글은 변경하지 않았다. 사용자 재로그인 후 실제 운영 #595의 목록/편집 왕복·서식 도구·기존 이미지/카드·저장 상태, PC/모바일 미리보기와 Escape/포커스 복귀, 390px 화면의 가로 넘침 없음과 공개 버튼 표시까지 확인했다. 실제 글 내용은 변경하지 않았고 운영 적용과 화면 확인을 완료했다.

### `DWNC-CORE-005` — 공개 글의 읽는 시간·배경·본문 글꼴 정리
- **Status:** `done`
- **Updated-at:** `2026-09-08`
- **Plans:** `PLAN-09`
- **Priority:** `P0`
- **Acceptance:**
  - 기존/신규 공개 글에서 `읽는 데 n분` 표시를 제거한다.
  - 글 읽는 영역의 배경을 자연스럽게 통일하고 원문 형광펜·표·도해의 의도적 배경색을 유지한다.
  - 일반 문장과 굵은 문장의 본문 글꼴을 일관되게 표시하고 실제 굵기·개별 서식·코드·링크·사진은 유지한다.
  - 원문/정규화 자료나 실제 저장 본문을 바꾸지 않고 공개 표현에서 수정한다. 로컬 통상 시험·빌드·내장 브라우저 비교·문서 갱신 후 실제 공개 화면에 적용한다. 운영 반영 승인은 후속 DWNC-CORE-006의 전체 보완과 함께 받았다.
- **Evidence:**
  - 읽는 시간 제거·흰 읽기면·본문 글꼴 정리를 DWNC-CORE-006과 함께 운영 반영했다. 실제 #595의 표시와 사진 로딩, 다른 원본의 사진 배치·글꼴 및 #588 도해 조작을 확인했다. 원문과 실제 저장 본문은 변경하지 않았다. 세부 소스·빌드·운영 확인과 한계는 [당시 상태 기록](history/PROJECT_STATE_HISTORY_20260909_234401.md) 최신 완료 절을 따른다.

### `DWNC-CORE-006` — 원본 블로그 표시·티스토리 편집/관리 기능 재비교와 보완
- **Status:** `done`
- **Updated-at:** `2026-09-08`
- **Plans:** `PLAN-09`
- **Priority:** `P0`
- **Acceptance:**
  - 네이버·티스토리 공개 원문과 새 블로그 표시를 서식 유형과 실제 대표 화면으로 비교해 불일치를 보완한다. 이미 확정된 공개 범위와 미디어 대체·제외 결정은 유지한다.
  - 티스토리 편집기(네이버 편집기 제외)의 도구·사용 흐름 및 카테고리 등 관리 메뉴 모든 요소를 현재 구현과 대조하고 필요한 기능을 개발한다. 서비스 전용 기능과 사용자 선택이 필요한 외부 연결은 구분한다.
  - 작업본 저장·명시적 공개·저장 실패/재로그인/충돌 대응, 기존 미디어·서식·공개 주소를 유지하며 실제 글 내용은 변경하지 않는다.
  - 메인은 내장 브라우저·통합·공식 상태, 실무는 하위 에이전트에 위임한다. 통상 시험과 화면 확인 후 승인된 운영 반영까지 완료한다. Git push와 기존 금지사항은 유지한다.
- **Evidence:**
  - 원본 표시·편집/관리 1차 보완과 페이지·공지·서식, 예약·비공개·보호·빈 초안 삭제, 아이콘·시간대·CCL을 통합 시험하고 최종 소스로 새 빌드해 운영 반영했다. 실제 관리자와 공개 글의 사진·글꼴·도해 조작까지 확인했다. 실제 글·사진·주소는 유지했다. 댓글·방명록·통계·광고·구독·팀블로그는 미답변 선택 범위로 남으며 구현 또는 완료로 간주하지 않는다. 세부 소스·빌드·운영 확인과 한계는 [당시 상태 기록](history/PROJECT_STATE_HISTORY_20260909_234401.md) 최신 완료 절을 따른다.

### `DWNC-CORE-007` — 연락 이메일 공개와 조회 통계
- **Status:** `done`
- **Updated-at:** `2026-09-08`
- **Plans:** `PLAN-09`
- **Priority:** `P1`
- **Acceptance:**
  - 댓글·방명록 대신 `tsusai@msn.com` 이메일 안내와 메일 링크를 공개한다. 실제 메일은 보내지 않는다.
  - 기존 글도 조회수 0부터 새로 집계하고 관리자에서 일별·글별 조회수를 확인한다. 방문자 수와 혼동하지 않으며 IP 등 개인 식별 정보는 저장하지 않는다.
  - 댓글·방명록·구독은 구현하지 않고 광고 자리와 삽입 설계는 후순위, 팀블로그는 현재 제외한다.
  - 기존 글 내용·작업본·사진·주소를 유지하고 통상 시험 후 최종 소스로 새 빌드해 승인된 운영 반영과 실제 확인까지 마친다.
- **Evidence:**
  - 이메일 안내와 통계를 최종 소스의 새 빌드로 함께 운영 반영했다. 통합 시험과 합성 브라우저에서 0→1 집계·검색·그래프를 확인했다. 실제 관리자0 표시 후 공개 글1회 열람과 이메일 링크 확인, 통계 새로고침에서 오늘/누적1을 확인했다. 기존 글 내용·사진·주소는 유지했으며 실제 글 변경/삭제와 메일 발송은 하지 않았다. 세부 기록은 [당시 상태 기록](history/PROJECT_STATE_HISTORY_20260909_234401.md) 최신 완료 절을 따른다.

### `DWNC-CORE-008` — 공개 사이트의 관리자 도구와 글 편집 연결
- **Status:** `done`
- **Updated-at:** `2026-09-08`
- **Plans:** `PLAN-09`
- **Priority:** `P1`
- **Acceptance:**
  - 관리자 로그인 상태가 확인된 경우 공개 사이트에서 관리자·새 글·통계·설정으로 바로 이동하고 목록/본문의 정확한 글·페이지를 편집하도록 연결한다.
  - 일반 방문자에게 관리 도구를 표시하지 않고 기존 인증 검증을 유지한다. 인증값과 개인 식별값을 공개 화면이나 클라이언트 저장소에 전달하지 않는다.
  - 기존 작성 탭의 미저장 입력을 보호하고 단순 화면 진입만으로 글·초안을 생성하거나 변경하지 않는다. 기존 글 내용·사진·주소는 유지한다.
  - 통상 시험과 화면 확인 후 최종 소스로 새 빌드해 승인된 운영 반영과 실제 확인을 마친다.
- **Evidence:**
  - 로그인 확인·정확한 글 선택·미저장 입력 유지·새 초안 자동생성 없음·비로그인 숨김과 통합 시험을 통과했다. 최종 소스로 새 빌드해 운영 반영했다. 실제 공개 본문의 편집하기 클릭으로 해당 작업본이 새 탭에 열리고, 홈의 글별 연결과 통계 바로 열림을 확인했다. 실제 글 내용·사진·주소·Access 설정은 유지했다. 상세 운영 결과와 시험 범위는 [당시 상태 기록](history/PROJECT_STATE_HISTORY_20260909_234401.md) 최신 완료 절을 따른다.

### `DWNC-CORE-009` — 본문에서 선택한 사진을 대표이미지로 지정
- **Status:** `done`
- **Updated-at:** `2026-09-08`
- **Plans:** `PLAN-09`
- **Priority:** `P1`
- **Acceptance:**
  - 편집기에서 실제 본문 사진을 클릭/선택하면 `이 사진을 대표이미지로 지정`을 제공하고 현재 글의 소유 사진만 지정한다.
  - 기존 대표이미지 선택 메뉴·미저장 입력·본문 서식·사진·공개 주소를 유지한다. 작업본 자동저장과 명시적 공개 반영을 따른다.
  - 합성 자료 시험과 브라우저 확인 후 최종 소스로 새 빌드해 운영 반영한다. 실제 글의 대표이미지나 내용을 시험 목적으로 변경하지 않는다.
- **Evidence:**
  - 본문 사진 선택 도구에 지정 버튼을 추가했다. 소유사진/설명·본문보존·공개본불변·자동저장·로그인복구 시험과 전체 빌드를 통과했다. 합성 브라우저 지정→작업본 저장→다시 열어 유지 확인 후 최종 새 빌드를 운영 반영했다. 실제 운영 #596의 사진 선택 시 활성 버튼 표시를 확인했으며 실제 대표이미지 변경/저장/공개는 하지 않았다. 상세 결과는 [당시 상태 기록](history/PROJECT_STATE_HISTORY_20260909_234401.md) 최신 완료 절을 따른다.

### `DWNC-CORE-010` — 클립보드 사진과 HTML 소스 붙여넣기
- **Status:** `done`
- **Updated-at:** `2026-09-08`
- **Plans:** `PLAN-09`
- **Priority:** `P1`
- **Acceptance:**
  - 클립보드 이미지 붙여넣기를 기존 사진 첨부처럼 업로드·커서 위치 삽입하고 실패/재로그인에서 현재 입력과 재시도 대상을 유지한다.
  - 일반 텍스트 HTML 소스를 인식해 지원하는 서식을 즉시 적용한다. 지원하지 않는 태그는 제거하되 글자는 남기고 실행 코드/외부 자원은 실행하거나 가져오지 않는다. 일반 문장·비교기호는 텍스트로 유지한다.
  - 기존 웹페이지 서식 붙여넣기, 사진 소유, 작업본 자동저장·명시적 공개 반영·기존 본문/사진/주소를 유지한다.
  - 실제 사용자 클립보드나 운영 글을 시험에 쓰지 않는다. 통상 시험·합성 브라우저 확인 뒤 최종 소스로 새 빌드해 운영 반영한다.
- **Evidence:**
  - 이미지 순서/커서/중복방지/실패·로그인재시도, HTML소스·코드편집기 강조서식 우선처리/변환실패 원문보존/기존rich서식유지 시험을 통과했다. 합성브라우저에서 사진삽입·HTML제목/굵기/목록변환·자동저장·다시열어보존을 확인하고 최종새빌드를 운영 반영했다. 운영 편집기에 새handler가 전달되고 기존글이오류없이 열리는 것을 읽기확인했다. 실제 글/클립보드 변경은 없으며 상세근거와 시험범위는 [당시 상태 기록](history/PROJECT_STATE_HISTORY_20260909_234401.md) 최신완료 절을 따른다.

### `DWNC-CORE-011` — 원본 비공개 글의 관리자 전용 이전
- **Status:** `done`
- **Updated-at:** `2026-09-09`
- **Plans:** `PLAN-09`
- **Priority:** `P1`
- **Acceptance:**
  - 로컬 보존된 비공개247편을 로그인한 관리자가 목록에서 조회·편집할 수 있도록 이전한다. 일반 방문자에게는 글과 사진을 공개하지 않는다.
  - 원본 서식·사진·예약 순번과 기존 공개 글·작업본을 유지한다. 공개 검색/목록/RSS/sitemap 및 직접 미디어 주소에 노출하지 않는다.
  - 비공개 제목·본문·ID 목록과 비밀값을 로그·공식 문서·Git·공개 빌드에 남기지 않는다.
  - 사용자가 비공개247편 본문·사진의 운영 DB/비공개 저장소 신규 전송과 관리자 전용 조회·편집을 승인했다. 기존 원본·공개글·작업본·예약번호를 보존하고 공개 전환하지 않는다. 같은 이전 범위의 실행 승인을 다시 요구하지 않는다.
- **Evidence:**
  - 기존 CMS importer는 공개349만 허용하며 관리자 조회는 가져오기 완료된 글을 표시한다. 비공개247이 처음부터 CMS 이전 입력에서 제외된 것이 원인이다.
  - 원본을 보존하면서247편과 참조 미디어2731개(사진2726·MP4 5)를 운영 CMS에 신규 이전했다. 모든 글의 private정책·본문·미디어행 일치를 확인했으며 기존 글/작업본 갱신과 R2 덮어쓰기·삭제는 없다.
  - 최종 소스 새 빌드·운영 반영 완료. 메인 내장 브라우저에서 비공개 목록247편과 실제 본문·사진 로딩을 확인했다. 편집 연결은 합성 저장 시험 및 실제247편 메모리 정규화 실패0·본문변경0으로 확인했으며 실제 글을 시험 수정하지 않았다.
  - 이전 후 공개 canonical/alias/미디어 대표12요청404와 공개 목록·검색·RSS·sitemap 등6면 노출0을 확인했다. 제목·본문·개별ID·원본경로·비밀은 기록하지 않았다. 상세 결과는 [당시 상태 기록](history/PROJECT_STATE_HISTORY_20260909_234401.md) 최신 완료 절을 따른다.

### `DWNC-CORE-013` — 편집기 이미지 정렬·표시 폭·한 줄 배열
- **Status:** `done`
- **Updated-at:** `2026-09-11`
- **Plans:** `PLAN-09`
- **Priority:** `P1`
- **Acceptance:**
  - 이번 명시 승인에 따라 최종 소스를 Git으로 전달하고 Cloudflare가 새로 빌드해 양쪽 서비스에 반영한 뒤 운영 읽기 확인을 마친다.
  - 구현된 기능과 보존 조건은 [신규 기능 요구사항](history/신규_기능_요구사항_20260911_173052.md)을 유지한다. 기존 글·작업본·사진·공개 주소·미디어 접근 정책을 보존하고 실제 글을 시험 변경·삭제하지 않는다.
- **Evidence:**
  - 2026-09-11 로컬 구현·`editor:test`·`check`·내장 브라우저 확인 완료. 정렬·원본 이하 폭·2개/3개 그룹과 저장/재열기·실행 취소/다시 실행을 확인했다. 문단 720px·전체 1200px 기준으로 확대가 필요한 옵션을 제한하며 모바일도 같은 기준이다.
  - 사용자가 2026-09-11 신규 기능 배포를 명시 승인했다. 최종 소스 `b5cda3f`의 공개·관리자 Cloudflare 새 빌드와 양쪽 활성 버전 100% 반영을 확인했고 공개 홈·공개 글 200 및 새 CSS 전달을 읽기 확인했다. 실제 IME·운영체제 메뉴 실행 취소는 직접 확인하지 않았으며 관련 입력 경로는 합성 시험 근거만 있다. `CORE-012`의 별도 착수 대기를 유지한다.

  - 실제 관리자 로그인 후 내부 UI는 아직 확인하지 않았으며 해당 확인은 `DWNC-OPS-007`에 남긴다. 배포 식별값과 검증 범위는 [완료 상세](history/신규_기능_요구사항_20260911_173052.md)에 보존한다.


### `DWNC-CORE-014` — 티스토리 실사용 기반 이미지 직접 이동·그룹 편집
- **Status:** `done`
- **Updated-at:** `2026-09-12`
- **Plans:** `PLAN-09`
- **Priority:** `P1`
- **Acceptance:**
  - 내장 브라우저로 티스토리 실제 편집 동작을 먼저 관찰하고 본문 사이 사진 이동·2개/3개 묶기·분리·그룹 내 순서를 끌어 놓기로 조작한다. 선택 사진 가까이에 정렬·크기 도구를 제공한다. 세부 조건은 [이미지 직접 조작 요구사항](history/이미지_직접조작_요구사항_20260911_183325.md)을 따른다.
  - 기존 확대 금지·캡션·본문 서식·실행 취소/다시 실행·작업본 분리·저장/재열기·PC/모바일 표시와 원본·미디어 접근 정책을 보존한다.
  - 티스토리 미로그인 시 로그인 요청, 기존 게시물 변경/발행 금지·새 미저장 시험 범위를 지킨다. 사용자가 승인한 운영 신규 비공개 합성 시험 글 하나의 생성·수정으로 실제 확인한다. 기존 글은 변경하지 않고 시험 글 삭제·공개 전환은 하지 않는다.
- **Evidence:**
  - 2026-09-11 사용자가 현재 모달 조작에 개선을 요구하며 티스토리 직접 관찰, 본문 사진 이동·그룹을 끌어 놓기로 해결하고 신규 비공개 글 하나에서 시험하도록 명시했다. 티스토리 합성 새 화면에서 2/3장 묶기·순서·분리·너비/정렬을 실제 관찰하고 구현 중이다. 관찰 성공과 이동되지 않은 시도, 자동저장 표시는 상세 요구사항에 구분했다. 새 배포·시험 글 생성은 미실행이다. 완료된 `CORE-013`을 다시 열지 않는다.
  - 2026-09-12 최종 소스 `a7b76ff`의 양쪽 Git 자동 빌드 성공·100% 활성화, 운영 신규 비공개 합성 시험 글 1개에서 드래그 2/3장 묶기·순서·문단 사이 분리 이동·실행 취소/다시 실행·인라인 크기/정렬·캡션·저장/재열기·모바일 미리보기 확인까지 완료했다. 기존 글은 변경하지 않았고 시험 글 공개·삭제는 하지 않았다. 로컬 PC/390px 합성 시험과 최종 source-only 빌드도 통과했다. 확인 범위·한계는 완료 상세에 둔다.

### `DWNC-CORE-015` — 관리자 로고에서 블로그 홈 열기
- **Status:** `done`
- **Updated-at:** `2026-09-12`
- **Plans:** `PLAN-09`
- **Priority:** `P1`
- **Acceptance:**
  - 관리자 좌측 상단 dwnc.me 로고를 누르면 공개 블로그 홈을 새 탭으로 열고 기존 편집 화면과 외형을 유지한다.
  - 키보드로 사용할 수 있는 링크와 새 탭 안내를 제공하며 최종 소스 Git 자동 배포 후 운영 클릭을 확인한다. 기존 글·작업본은 변경하지 않는다.
- **Evidence:**
  - `src/lib/admin-ui.ts`의 로고를 `https://dwnc.me/` 링크로 바꾸고 `target="_blank"`, `rel="noopener noreferrer"`, 새 탭 접근성 안내와 기존 외형·키보드 초점 표시를 적용했다.
  - 최종 소스 `bb2afbc`의 source-only 빌드, 관리자 UI·공개/관리자 링크 시험, 설정 검사와 Git 진입점 시험을 통과했다. Git 자동 배포 성공과 공개 `4e6e2b0e`·관리자 `1ce5d314` 각각 100% 활성화를 확인했다.
  - 운영 관리자에서 새 링크 속성과 클릭 후 관리자 화면 유지를 확인했다. 내장 브라우저가 팝업 탭을 노출하지 않아 클릭에 따른 실제 새 탭 생성은 미확인이다. 링크 주소를 별도 새 탭으로 열어 공개 홈 정상 표시를 확인했다. 기존 글·작업본은 변경하지 않았다.

### `DWNC-CORE-016` — 카테고리 표현·탐색과 중복 분류 정리
- **Status:** `done`
- **Updated-at:** `2026-09-12`
- **Plans:** `PLAN-09`
- **Priority:** `P1`
- **Acceptance:**
  - ‘갈래’를 더 익숙한 용어로 통일한다. 추천은 관리자와 같은 ‘카테고리’이며 메뉴·패널·전체 목록·현재 위치·관련 글·접근성 안내에 일관되게 적용한다.
  - 작은 `+` 버튼 대신 자식이 있는 행 전체로 펼침/접기하고 꺾쇠로 상태를 표시하는 방식을 적용한다. 펼친 첫 항목 ‘해당 카테고리 전체 보기’로 부모와 하위 글 전체에 접근하며 자식 없는 행은 글 목록으로 바로 이동한다. 키보드·모바일과 현재 분류의 펼침 상태를 유지한다.
  - 사용자가 같은 분류로 확인한 ‘일상’·‘일상 이야기’를 ‘일상’으로 표시 통합하는 방식을 적용한다. 원본 출처/분류·기존 글/작업본·공개 상태·기존 글 및 카테고리 주소를 유지한다. 기존 글 categoryId 일괄 덮어쓰기나 원본 분류 삭제를 전제하지 않는다.
  - 수락한 제안에 따라 정적 화면과 Worker·공개/관리자 선택의 일관성을 보완하고 관련 시험·최종 소스 Git 자동 배포·내장 브라우저 확인을 완료한다. 조회수 초기화 직후 개발 열람으로 통계를 다시 오염시키지 않는다.
- **Evidence:**
  - 2026-09-12 사용자 요청과 화면을 확인했다. `taxonomy.ts`에서 네이버 `daily`와 티스토리 `daily-stories`가 따로 정의돼 있으며 현재 행 링크/별도 펼침 버튼이 분리돼 있다. 이번에는 읽기 검토와 제안만 했으며 구현·분류 병합·배포는 하지 않았다.

  - 2026-09-12 사용자가 추천안 전체와 최종 소스 Git 자동 배포·운영 확인을 승인했다. 기존 데이터·주소·미커밋 변경을 보존하며 개발 확인 접속을 조회수에서 제외한다.
  - 최종 소스 `409161f`의 양쪽 Git 자동 배포·운영 확인 완료. 상세와 조회수 관측 한계는 [카테고리 탐색 개선 기록](history/카테고리_탐색_개선_20260912_171354.md)을 따른다.

### `DWNC-OPS-007` — Git 소스 기반 Cloudflare 빌드·배포 전환
- **Status:** `done`
- **Updated-at:** `2026-09-12`
- **Plans:** `PLAN-09`
- **Priority:** `P1`
- **Acceptance:**
  - GitHub의 최종 소스로 Cloudflare가 새 빌드해 공개 블로그와 관리자 프로그램에 반영한다. 생성된 이전 배포 번들을 재사용하지 않는다.
  - HTML/CSS/JS와 관련 소스·설정·의존성은 Git으로 관리하고 실제 글·작업본 DB와 사진 저장소는 기존 것을 보존한다. 배포에 데이터 이전·DB 내용 변경·R2 동기화를 포함하지 않는다.
  - 기존 공개 주소·인증·비공개 접근 정책을 유지한다. raw deploy, DNS·route 변경, R2 덮어쓰기·삭제, 실제 글 시험 수정·삭제와 비밀·비공개 콘텐츠 기록을 금지한다.
  - 실제 Git 연결과 Cloudflare 빌드·배포 성공, 공개·관리자 읽기 확인까지 마쳐야 완료한다. 로컬 준비만으로 완료 처리하지 않는다.
- **Evidence:**
  - 2026-09-10 사용자가 Git 소스에서 Cloudflare가 가져가도록 전환을 요청하고 내장 브라우저 사용을 허용했다. GitHub 로그인·대상 공개 저장소를 확인했고 기존 소스 전용 빌드 경로가 있다. 계정을 확인하고 양쪽 Worker를 기존 토큰으로 저장소/main에 연결했다. 이번 push·자동 배포를 명시 승인받아 원격 main에 소스를 전달했고 실제 CI가 시작됐다.
  - 대상별 배포 진입점·합성 시험과 빌드 환경 호환 수정을 확인했다. 기존 토큰으로 실제 CI 인증 사전 확인까지 통과했으며 연결 설정·실행 계약은 [Git 배포 안내](GIT_DELIVERY_20260910_142007.md)에 둔다. 실제 양쪽 빌드·배포는 성공했고 공개 화면은 확인했다. 관리자 내부 읽기 확인은 남아 있다.
  - 현재 제약·계정 접근 상태와 다음 행동은 [`PROJECT_STATE.md`](../PROJECT_STATE.md)에 유지한다. 결함 6건의 착수 대기와 구분한다.
  - 2026-09-12 최종 소스 `a7b76ff`가 공개·관리자 양쪽 Git 자동 빌드에 성공하고 100% 활성화됐다. 공개 홈 읽기와 인증된 관리자 내부 목록/편집기 진입을 확인해 남은 조건을 완료했다. `CORE-014`가 별도로 승인받은 새 비공개 합성 글 시험 외 기존 실제 콘텐츠는 변경하지 않았다.

### `DWNC-OPS-008` — Google·개인 Microsoft 관리자 로그인 추가
- **Status:** `done`
- **Updated-at:** `2026-09-12`
- **Plans:** `PLAN-09`
- **Priority:** `P1`
- **Acceptance:**
  - Cloudflare Access를 유지하면서 사용자가 지정한 Google 계정으로 `admin.dwnc.me`에 로그인한다. 기존 이메일 OTP와 24시간 세션을 유지한다.
  - Google OAuth를 연결하고 대상 관리자 앱의 정확 계정 허용을 적용한다. 조직 전체·도메인 전체 접근 허용이나 불필요한 데이터 권한은 추가하지 않는다.
  - Google 실제 로그인·관리자 진입을 확인하고 기존 글·작업본·미디어를 변경하지 않는다. 기존 단일 계정 설정과 배포된 선택적 추가 정확 이메일 지원 코드는 보존한다.
  - 새 이메일·클라이언트 비밀값을 소스·문서·로그에 기록하지 않는다. 필요한 소스 변경은 기존 Git 자동 배포 경로로 반영하며 raw 배포·DNS/route·R2 덮어쓰기/삭제를 하지 않는다.
  - 당초 Microsoft 개인 계정용 OIDC 연결·추가 정확 이메일 운영 설정·Microsoft 실제 로그인 조건은 2026-09-12 사용자의 명시 취소로 범위에서 제외한다. Microsoft 로그인 추가나 Azure 가입을 이어서 진행하지 않는다.
- **Evidence:**
  - 사용자 2026-09-12 요청으로 두 로그인 방식과 지정 계정 추가가 승인됐다. Google 프로젝트 생성 승인과 사용자의 직접 정책 동의·Create 후 OAuth 클라이언트와 Access Google 연결을 완료했다. 기존 인증을 로그아웃하고 요청 Google 계정으로 다시 로그인해 관리자 목록·활성화된 새 글 쓰기를 확인했다. 기존 글·작업본은 변경하지 않았다. Microsoft는 회사와 무관한 개인 계정으로 다뤘으며, 사용자가 진행한 개인용 Azure 가입 2/3 주소 정보·약관 화면에서 주소 빈칸·약관 미동의·Next 비활성을 확인했다. 가입은 완료되지 않았으며 사용자의 Microsoft 로그인 취소에 따라 메인이 가입 탭을 닫았다.
  - `src/lib/access-auth.ts`의 `ACCESS_ADDITIONAL_ALLOWED_EMAILS` 선택적 설정과 인증·세션 합성 회귀 보완을 완료했다. 기존 계정 유지·정확 주소만 허용·다른 계정 거부·서명/issuer/audience/만료 확인을 유지한다. 인증 관련 3파일은 최종 소스 빌드·Git 진입점 시험 후 `d95264d`로 커밋·push했고 공개·관리자 자동 배포 및 100% 활성화를 완료했다. 기존 인증의 관리자와 공개 홈도 정상이다. Google은 기본 허용 계정과 일치해 추가 secret 없이 동작한다. Microsoft 앱·IdP·운영 추가 이메일 secret은 생성하지 않았으며 사용자 취소에 따라 추가하지 않는다. Automanix 설정은 변경하지 않았다. Google 완료와 Microsoft 범위 취소를 반영해 이 항목을 마감했다.

### `DWNC-CORE-017` — 편집기 URL 자동 링크와 자체 작성 글 누락 보완
- **Status:** `done`
- **Updated-at:** `2026-09-13`
- **Plans:** `PLAN-09`
- **Priority:** `P1`
- **Acceptance:**
  - 2026-09-13 후속 지시로 구현과 자체 작성 글 누락 보완이 승인됐다. 티스토리 링크 수정·해제 UX를 확인한다.
  - 후속 편집기 구현에서 웹주소 입력·붙여넣기의 자동 링크를 지원하고 기존 링크·코드·문장부호·한글 입력을 올바르게 처리한다.
  - 사용자가 명시적으로 링크를 해제한 의도를 저장·재열기 후에도 유지하며 자동 링크가 임의로 되살리지 않는다.
  - 원래 링크가 없던 이전 596편은 그대로 둔다. 기존 본문 열기·저장만으로 소급 자동 링크하지 않는다. 자체 서비스 작성 중 자동 링크 부재로 빠진 주소만 최신 작업본·공개본을 확인해 보완한다.
  - 최종 소스를 커밋·GitHub 푸시하여 Git 자동 배포하고 운영 편집기와 보완 글을 확인한다.
  - 원본·기존 주소·공개 상태·미디어·다른 편집 내용을 보존하고 개발 확인 접속에는 기존 조회수 제외 방법을 적용한다.
- **Evidence:**
  - 최종 기능 소스 `107c0ce`의 공개·관리자 Git 자동 배포 Success와 활성 버전 `f523244f`·`f554e044`를 확인했다.
  - [완료 기록](history/자동링크_구현_진행_20260913_201937.md)에 최종 로컬 자동시험·빌드·브라우저, 티스토리 실제 UX, 자체 글 보완과 운영 검증 한계를 기록했다.
  - 최신 작업본과 공개본이 같은 상태에서 `/posts/597`의 Logitech URL 한 곳을 보완·공개 반영했다. 운영 링크를 확인했고 원래 미링크인 이전 596편은 그대로 두었다.
  - 운영 최종 코드와 목록을 확인했다. 비공개 합성 글 실입력은 자동 승인 검토가 차단해 미실행이며 본문 미변경을 확인했다. 로컬 동작 검증과 구분한다.
  - [직전 전수 조사](history/자동링크_및_이전글_조사_20260913_174723.md)에서 참조로 읽히는 미링크 URL 10편 12곳은 모두 보관 원본부터 일반 텍스트였다. 이관 중 anchor 손실은 발견하지 못했으며 과거 명시적 해제 의도는 확정할 수 없다.

### `DWNC-CORE-018` — 같은 카테고리 글 전체 페이지 탐색
- **Status:** `done`
- **Updated-at:** `2026-09-14`
- **Plans:** `PLAN-09`
- **Priority:** `P1`
- **Acceptance:**
  - 이전/다음 카드의 대상을 같은 표시 카테고리 안의 시간순 이웃으로 제한한다. 두 일상 통합과 목록의 날짜·순번 정렬을 함께 사용하고 첫·끝·한 편 경계를 처리한다.
  - 글 하단 같은 카테고리 목록에서 접근 가능한 해당 카테고리 전체 글을 최신순으로 5개씩 제공한다. 최초 현재 글이 포함된 페이지와 현재 글 표시를 제공한다.
  - 페이지 번호를 최대 7개 표시하고 «/»로 이전·다음 번호 묶음에 접근한다. 첫·끝·작은 목록·모바일·키보드 사용을 지원한다.
  - 시간순 이동 카드도 페이지 방향과 맞춰 왼쪽에 다음 글(더 나중), 오른쪽에 이전 글(더 오래된 글)을 둔다. 처음/마지막 글의 빈쪽 자리와 기존 링크·시간순 의미는 유지한다.
  - 페이지 선택 시 본문을 재요청하거나 조회수를 추가하지 않고 목록만 변경한다.
  - 정적 화면과 운영 Worker가 같은 규칙을 사용하며 일상 표시 통합·원본 분류·본문·작업본·주소·기존 공개/비공개/보호 접근 정책을 유지한다.
  - 관련 로컬 시험·브라우저 확인과 최종 소스 커밋·GitHub 푸시·Git 자동 배포·운영 확인을 마친다. 운영 글 읽기는 기존 조회수 제외 방식을 사용한다.
- **Evidence:**
  - 2026-09-14 사용자가 5개씩 표시·번호 약 7개·«/»로 전체 페이지 접근을 요청했다. 기존 코드는 이전 2개/이후 3개 고정이 아니라 발행 시각이 가까운 다른 글 5개를 골랐다. [구현·검증 기록](history/카테고리_글_페이지_탐색_20260914_224127.md).
  - 최종 소스 `73c856b`의 양쪽 Git 자동 배포와 운영 첫·중간 글 방향을 확인했다. 공개 활성 버전 `dc4e36e7`, 관리자 `a335084f`. 로컬·운영 페이지 탐색 및 검증 한계는 위 완료 기록을 따른다.
  - 최종 소스 f101b5c의 공개·관리자 Git 자동 배포 Success와 활성 버전 49b9767c·d82fb08c를 확인했다. 공개 글 운영 확인과 로컬 편집/미리보기 서식 보존 확인을 마쳤다.

### `DWNC-CORE-019` — 본문 기본 글꼴을 제목 계열로 변경
- **Status:** `done`
- **Updated-at:** `2026-09-15`
- **Plans:** `PLAN-09`
- **Priority:** `P1`
- **Acceptance:**
  - 후속: 일반 본문을 18px로 통일하고 크기 프리셋은 비례 확대한다. 명시적 px 크기는 유지하며 구분 불가능한 과거 px 저장값을 임의로 재해석하지 않는다.
  - 제목의 글꼴 구성을 확인해 설명하고 본문의 일반 구간 기본 글꼴을 같은 계열로 바꾼다.
  - 명시적으로 지정한 부분 글꼴·이탤릭·굵게·코드 서식은 유지하고 본문 HTML·원본·작업본·주소를 변경하지 않는다.
  - 공개 글과 본문 미리보기의 기본 글꼴이 일치하며 관리 도구 등 본문 밖 UI는 변경하지 않는다.
  - 관련 로컬 확인 후 최종 소스를 GitHub에 저장하고 Git 자동 배포·운영 확인을 완료한다. 운영 글 확인은 조회수 제외 경로를 사용한다.
- **Evidence:**
  - 2026-09-14 사용자가 `/posts/587` 제목 화면을 보여주며 일반 본문의 기본 글꼴만 제목과 같게 잠시 바꿔보도록 요청했다. 명시적 글꼴·이탤릭 보존을 강조했다.
  - [글꼴 조사·구현 기록](history/본문_기본글꼴_변경_20260914_231435.md)에 기기별 글꼴 구분과 완료 근거를 둔다.
  - 최종 소스 f101b5c의 공개·관리자 Git 자동 배포 Success와 활성 버전 49b9767c·d82fb08c를 확인했다. 공개 글 운영 확인과 로컬 편집/미리보기 서식 보존 확인을 마쳤다.
  - 크기 후속 최종 소스94002d0의 양쪽 Git 배포 Success·활성 버전f1e55dfd/9f4488a7과 운영587 일반18px·본문 HTML/제목 크기 불변을 확인했다. 선택 서식·입력·저장/재열기와 커서 경계는 로컬 합성으로 확인했다.

### `DWNC-CORE-020` — 모든 글 대표이미지와 최근 기록 카드 구성
- **Status:** `done`
- **Updated-at:** `2026-09-15`
- **Plans:** `PLAN-09`
- **Priority:** `P1`
- **Acceptance:**
  - 모든 글의 기존 연도별 구분·순서·전체 글 접근을 유지하면서 작은 대표이미지와 제목·날짜·카테고리를 함께 제공한다.
  - 최근 기록은 최신8편을 같은 비중의2열 카드로 표시하고 모바일은1열로 읽는다. 긴 제목과 사진 없는 글도 자연스럽게 표시한다.
  - 기존 공개 대표이미지만 사용하고 빈 이미지 상자나 임의 대표사진 선정을 추가하지 않는다. 기존 글·작업본·분류·주소·사진 및 공개 접근 정책은 유지한다.
  - 정적 화면과 운영 화면의 구성을 맞추고 카테고리 둘러보기·모든 글 접근·관리자 편집 링크를 유지한다.
  - 관련 시험·브라우저 확인과 최종 소스 Git 자동 배포·운영 확인 후 모든 저장소 관리 변경을 커밋·푸시한다. 운영 글 확인은 조회수 제외 경로를 쓴다.
- **Evidence:**
  - 사용자가 대표이미지 포함 목록과 최근 기록의 대안을 문의하고 추천한 구성을 “변경 시작”으로 승인했다.
  - [구현·확인 기록](history/글목록_대표이미지와_최근기록_20260915_004728.md).


### `DWNC-CORE-021` — 운영 최신 콘텐츠의 링크·대표이미지·요약 전수조사
- **Status:** `done`
- **Updated-at:** `2026-09-16`
- **Plans:** `PLAN-09`
- **Priority:** `P1`
- **Acceptance:**
  - 2026-09-15 승인된 읽기 전용 조사를 이어간다. 2026-09-16 사용자가 미확인 항목의 재확인을 요청했다. 초기 보고서가 있어도 실제 표시 미확인 상태를 전체 완료로 처리하지 않으며, 추가 착수 승인을 묻지 않고 같은 ID로 재확인한다.
  - 착수한 작업에서 운영 DB/API의 현재 전체 글 목록과 최신 반영본을 조회해 새 글과 기존 글 수정분까지 조사 대상에 포함한다. 조회 시점·범위와 미공개 작업본의 존재·반영본과의 차이를 구분한다.
  - 전체 대상의 내부·외부 링크와 링크 카드 목적지를 현재 주소 기준으로 대조하고, 내부 링크의 외부 링크 표시, 대표이미지 누락·잘못된 이미지, 대상 글과 맞지 않는 제목·요약을 실제 표시와 비교해 조사한다. 오래된 카드 정보와 남아 있는 정적 대체 경로가 실제 표시 원인인지 구분한다.
  - 결과에는 조사 대상과 확인 범위, 발견한 문제와 수정 대상, 확인하지 못한 항목 및 이유를 정리한다. 실제 문제가 없는 이미지 부재·요약과 오류를 구분하며, 접근 불가 항목을 확인 완료로 처리하지 않는다.
  - 운영 데이터에 접근할 수 없으면 해당 콘텐츠에 의존하는 조사를 보류하고 제한을 밝힌다. 이관 덤프·파생 파일은 과거 비교·재현에만 쓰며 최신 조사 입력으로 대체하지 않는다. 과거 6개 글·7개 카드 집계를 이번 전수조사 결과로 재사용하지 않는다.
  - 이 요구사항의 완료조건은 전수조사와 결과·수정 대상 정리다. 콘텐츠 일괄 수정·재이관·덤프 삭제·미공개 작업본 공개 승인을 뜻하지 않는다. 후속 수정 시에도 최신 내용을 다시 확인하고 기존 revision 충돌 방지와 작업본/반영본 구분을 유지한다. 비공개 본문·이미지·개인 식별값은 공개 기록이나 Git에 남기지 않는다.
- **Evidence:**
  - 2026-09-15 사용자가 내부 링크의 외부 표시·대표이미지·요약 문제 전수조사를 다음번에 하도록 요구사항에 남기라고 명시했다.
  - 같은 날 사용자가 “할 일 중에 '전수조사 하기' 있지? 그거 진행해볼까? (컨텍스트 괜찮나?)”라고 지시해 조사 착수를 승인했다. 현재 대화에서는 공식 상태와 인수인계를 정리하고 실제 조사는 새 작업에서 실행하기로 했다. 2026-09-15 인수인계 당시 운영 데이터 전수조회는 미실행이었다.
  - 2026-09-15 인수인계 당시 확인은 과거 이관 자료 6개 글·7개 카드와 일부 운영 페이지에 한정됐으며 최신 운영 전체 콘텐츠 전수조사는 하지 않은 상태였다. AI의 최신 데이터 선택 기준은 [AGENTS.md](../AGENTS.md#ai-작업의-콘텐츠-기준)에 반영돼 있다.

- **초기 조사 근거(2026-09-16):** 최신 운영 반영본598편·작업본3개를 전수 분석했고 문제·수정 대상·미확인 이유를 [조사 결과](history/운영콘텐츠_전수조사_결과_20260916_142620.md)로 정리했다. 실제 표시 확인은 공개91편과 문제 사례에 한정되며 나머지259편·일부 외부사이트·비공개 화면 및 전체 사진 육안 적합성은 미확인으로 명시했다. 초기 데이터 분석과 결과 정리는 마쳤으나 재확인이 남아 `in-progress`로 되돌렸다. 콘텐츠 수정·공개·재이관은 수행하지 않았다.

- **재확인 완료조건:** 공개 본문 미확인259편, 대표이미지의 실제 로드·내용 적합성, 인증된 비공개 화면·대표216개, 외부 카드의 프레임/앱/접속 실패 항목을 다시 확인한다. 새 글·변경분은 최신 목록으로 갱신하고 반영본/작업본을 구분한다. 본문·카드·실제 이미지 표시를 확인한 항목만 해소하며, 그래도 막히면 항목별 새 시도·실제 장애·필요한 다음 행동을 남긴다. 확인되지 않은 상태를 정상으로 처리하지 않는다.

- **재확인 결과(2026-09-16):** [재조사 결과](history/운영콘텐츠_미확인재조사_결과_20260916_200742.md). 최신598편·작업본3개와 공개350편을 갱신했고 마감 대조에서 변화가 없었다. 공개 미확인259편과 인증된 비공개248편의 제목·본문·링크·이미지 DOM을 대조했다. 공개 대표258개 중244개 로드·14개 실패, 비공개 대표216개 모두 로드(빈1×1 SVG11개 포함)를 확인하고 실제 그림의 의미를 검토했다. 외부 미확인12개는 모두 재접근해9개 해소·이용불가1개·계속막힘2개로 구분했다. 위키 연결 실패와 카페 로그인 필요는 내용 정상으로 판정하지 않았으며 후속 접근 조건을 보고서에 남겼다. 이번 완료는 승인된 재조사·결과 정리를 뜻하며, 외부2개 내용 확인이나 콘텐츠 수정 완료를 뜻하지 않는다. 기존 결과와 비공개 로컬 근거를 보존했다.

- **추가 승인:** 사용자가 2026-09-16 “문제되는 부분은 끝까지 확인해야지? 필요하다면 수정하고”라고 지시했다. 확정된 대표이미지·카드·요약 오류를 최신 내용에 맞게 보완하고 정상 저장·반영·화면 확인까지 진행한다. 공개 글은 수정 내용을 반영하고 비공개 글은 비공개를 유지한다. 의도가 불명확한 사진 선택은 임의로 바꾸지 않는다. 정상 UI의 revision 충돌 방지와 작업본 우선 읽기를 유지한다. 재이관·비공개 공개·권한 변경은 하지 않는다.


- **진행·검증·재개 근거:** [오류 수정 진행 기록](history/운영콘텐츠_오류수정_진행_20260916_211008.md). 자동 승인 검토 이후 사용자가 제시한 수정 범위를 명시 승인했으며 재개했다.

- **추가 수정 마감(2026-09-16):** [최종 결과](history/운영콘텐츠_오류수정_결과_20260916_231001.md). 명시 승인 범위의 대표27·요약322·카드6 수정, 영상 메뉴 겹침·HTML 전체교체 보완과 Git 자동 배포·운영 확인을 마쳤다. 카드 수정 중 발생한 본문 중첩은 원인 수정과6편 원래 구조 복원 후 다시 확인했다. 최종598편·작업본331개를 대조해 공개350·비공개248·기존작업본3개 보존, 예상 밖 변경0을 확인했다. 카페는 인증된 원문으로 해소했다. 위키1개 내용은 외부 연결 문제로 계속 미확인이며, 접근조건과 확인 한계를 기록한 상태다. 이를 정상으로 판정하거나 외부 원문 복구 완료로 주장하지 않는다.

### `DWNC-CORE-022` — 관리자 목록 생성일·수정일 분리와 날짜 정렬
- **Status:** `done`
- **Updated-at:** `2026-09-17`
- **Plans:** `PLAN-09`
- **Priority:** `P1`
- **Acceptance:**
  - 관리자 글 목록에 생성일과 수정일을 각각 명확한 라벨로 표시한다. 사이트 시간대에 맞추고 날짜가 없거나 유효하지 않으면 잘못된 날짜를 표시하지 않는다.
  - 생성일은 저장된 createdAt을 사용한다. 이관 글은 원글 발행일, 자체 작성 글은 최초 초안 생성 시각이라는 의미를 알린다. 수정일은 기존 작업본 우선 updatedAt을 유지하고 작업본 저장도 포함됨을 알린다. publishedAt이나 이관 작업 시각으로 대신하지 않는다.
  - 생성일 최신순·생성일 오래된순·수정일 최신순·수정일 오래된순4개만 제공한다. 기본은 기존 수정일 최신순이며 제목 정렬은 제공하지 않는다.
  - 검색·종류·카테고리·공개상태 필터의 전체 결과를 날짜순으로 정렬한 뒤 페이지를 나눈다. 정렬 변경 시 첫 페이지로 이동하고, 페이지 이동에서도 정렬 기준을 유지한다. 같은 날짜의 순서는 안정적이어야 한다.
  - 기존 본문·원래 생성일·수정일·발행일·작업본·공개 상태·공개 주소를 변경하지 않는다. 표시와 목록 조회 기능만 보완한다.
  - 관련 회귀·합성 내장 브라우저·최종 소스 빌드, 기존 Git 자동 배포와 실제 운영 목록 확인까지 마친다. 콘텐츠를 시험 목적으로 수정하지 않는다.
- **Evidence:**
  - 2026-09-16 사용자가 관리자 목록의 글들이9월16일로 보이는 화면을 첨부하고 생성일·수정일 분리와 두 날짜 정렬을 요청했다. 제목 오름·내림차순은 필요 없다고 명시했다.
  - 현재 소스는 수정일만 라벨 없이 표시한다. 이번 운영 표본 조회에서 옛 글의 createdAt은 원래 연도를 유지하고 updatedAt만 이번 수정 시각으로 바뀐 것을 확인했다. 날짜 원본 수정은 필요하지 않다.

- **완료 근거:** [구현·시험·운영 결과](history/관리자목록_날짜표시와정렬_20260917_000558.md). c092833의 양쪽 배포 성공 및 실제 관리자598편의 날짜 분리·네 정렬을 확인했다. 관리자 최초 activate 실패는 기존 파이프라인 재시도로 해소했으며 원인을 추정해 확정하지 않았다. 운영 콘텐츠·저장 날짜는 변경하지 않았다.

### `DWNC-CORE-023` — 편집기 긴 제목 자동 줄바꿈과 높이 조절
- **Status:** `done`
- **Updated-at:** `2026-09-17`
- **Plans:** `PLAN-09`
- **Priority:** `P1`
- **Acceptance:**
  - 긴 제목은 입력칸 폭에 맞춰 자동으로2·3·4줄 이상 표시하고 내용에 맞춰 높이가 늘어난다. 짧아지면 높이가 줄며 가로 잘림·내부 스크롤 없이 읽을 수 있다.
  - 기존 글 열기·편집 재개·입력·붙여넣기·화면 폭 변경 때 높이를 맞춘다. PC와 휴대전화 폭에서 확인한다.
  - 제목의 기존180자 제한·단일행 저장 의미·한글 조합·커서·자동저장과 공개 반영 구분을 유지한다. 시각적 줄바꿈 때문에 실제 제목 개행이나 콘텐츠 변경을 만들지 않는다.
  - 관련 회귀·합성 내장 브라우저·최종 소스 빌드·기존 Git 자동 배포와 운영 읽기 확인을 마친다. 운영 시험 입력·공개·실제 글이나 작업본 수정은 하지 않는다.
- **Evidence:**
  - 사용자가 긴 제목이 한 줄에서 잘리는 편집기 화면을 첨부하고 제목 입력칸이2·3·4줄로 늘어나도록 요청했다.
  - 이번 운영 관리자에서 공개594의 최신 작업본을 열어 INPUT이며 미공개 제목 변경이 있는 상태를 확인했다. 변경 중인 작업본은 보존하고 표시 기능만 수정한다. 원문은 Git 제외 자료에 보관한다.
  - [완료 기록](history/편집기_제목자동높이_20260917_002200.md): 관련 회귀3개·최종 빌드·PC/390px 합성·양쪽 배포와 운영 작업본 보존을 확인했다. 기능 소스는6af7749이며 운영390px과 실제 OS IME 입력의 검증 한계를 구분한다.


## 완료 계획

2026-09-09 현재 원장에서 이관한 완료 계획이다. 이후 상태는 현재 원장을 따른다.

| 계획 ID | 목적과 주요 작업 | 완료 기준 | 당시 상태 |
|---|---|---|---|
| `PLAN-01` | 두 원본 블로그의 글과 자료 범위를 확인하고 원본을 보존한다. | 티스토리 공개 164개, 네이버 직접 작성 432개의 원본과 공개 범위를 확인한다. | `완료` |
| `PLAN-02` | 공개 글과 비공개 글을 분리해 새 사이트용 내용으로 바꾼다. | 공개 349개가 새 사이트에 들어가고 비공개 247개가 공개 영역 밖에 남는다. | `완료` |
| `PLAN-03` | 독립 사이트와 주소 체계를 만든다. | 공개 글 349개, 예전 주소 349개, 검색·분류·RSS·사이트맵과 모바일·데스크톱 화면 검사를 통과한다. | `완료` |
| `PLAN-04` | 공개할 미디어를 정리하고 최종 목록을 확정한다. | 사용자 소유 사진 2,757개와 직접 제작 GIF 1개를 확정하고 제외·대체 결정을 반영한다. | `완료` |
| `PLAN-05` | 시험용 저장소의 실제 파일 내용을 한 번 전수 확인하고 작업용 열쇠를 정리한다. | 올바른 계정 확인, `Account ID` 한 번 복사·전용 보관, 저장소 비공개 확인, 2,758개 실제 내용·전체 용량 비교, 작업용·사용 불가능한 활성 열쇠 정리를 마치며 R2 객체 덮어쓰기·삭제가 없다. | `완료` |
| `PLAN-06` | 실제 도메인과 연결되지 않은 시험용 사이트를 올려 최종 동작을 확인한다. | 사이트 프로그램이 없을 때만 최소 차단용 프로그램을 만들고, 확정된 Git 기록의 빌드·검사 한 묶음과 새 버전만 올려 시험용으로 적용한 뒤 대표 페이지, 예전 주소 GET·HEAD 698회와 사진 응답을 확인하고 정확한 Git SHA와 버전 번호를 기록한다. | `완료` |
| `PLAN-07` | 시험용 확인 뒤 최종 운영에 실제 필요한 Cloudflare 자원만 준비한다. | 시험용에서 통과한 절차로 필요한 저장소와 사이트 버전만 준비하고, 새 보조 도구·모의훈련·반복 검증은 추가하지 않는다. 실제 `dwnc.me` 주소가 새 사이트를 가리키도록 연결하지 않는다. | `완료` |
| `PLAN-08` | 실제 `dwnc.me` 주소를 연결하고 운영 전환을 확인한다. | 사용자 결정 후 실제 `dwnc.me` 주소가 새 사이트를 가리키도록 연결하고 실제 주소의 글·예전 주소·사진·화면을 다시 검사한다. | `완료` |

## 이전·운영 전환 참고 이력

아래는 2026-09-09 정리 전 원장에 남아 있던 과거 기록이다. 당시의 현재·다음·승인 대기 표현은 새 실행 지시가 아니다. 요구사항별 완료 근거와 중복된 진행 요약은 반복하지 않는다.

#### 미디어 정리 결과


플랫폼에서 자동으로 붙인 것으로 보이는 이미지 후보 132개를 모두 살펴보고 다음처럼 정리했다.

| 묶음 | 수량 | 현재 결정 | 다음 확인 |
|---|---:|---|---|
| 네이버·카카오 지도 이미지와 표시 요소 | 99 | 제외·대체 완료 | 영향받은 글 5개에는 장소 카드 16개를 넣었다. 15개는 원래 장소 링크, 주소를 확인할 수 없던 1개는 네이버지도 검색 링크이며 컴퓨터와 휴대전화 화면에서 확인했다. |
| LINE 스티커 | 5 | 제외·빈 공간 정리 완료 | 스티커와 연결 주소를 빼되 본문 글자는 유지했다. 제거 뒤 두 글에 생긴 큰 빈 공간도 정리했다. |
| 화면에 보이지 않는 1×1 크기 빈 이미지 | 27 | 사용자의 B 선택에 따라 제외 완료 | 영상 재생 불가 안내 53개, 재생시간 53개와 작성자 설명 23개는 그대로 남겼다. 이 빈 이미지를 대표 이미지로 쓰던 글 13개는 대표 이미지 없음으로 처리했다. |
| 사용자가 직접 만든 SBS 수영 방송 화면 GIF | 1 | 포함 | 본문과 대표 이미지에서 컴퓨터·휴대전화 모두 정상 표시되는 것을 확인했다. |

사용자가 소유를 확인한 사진 2,757개와 직접 만든 SBS GIF 1개, 총 2,758개가 최종 공개 대상이다. 지도 99개는 장소 카드와 네이버지도 링크로 바꾸었고 LINE 스티커 5개와 화면에 보이지 않는 빈 이미지 27개는 제외했다.

#### 기술 참고


- 이번 계획 개편 시작 기준은 commit `ea751484ff8e6054f2ecab405b00f430c1e8aa3f`·tree `223c41242cfec01018e144d8bd35e9d592e90fe9`이며 시작 당시 파일 상태는 깨끗했다. 미래 커밋 번호는 미리 정하지 않는다.
- commit `fb693f3bbbab0e88b205f9de944646057bdd49ea`·tree `5e7169ca35a61a077265c98f6819fa28ccc5126d`·parent `d0b4a6c68c8a51b3211c97e320c5d7ea0310f437`와 12개 파일 `+1,990/-42`, 변경 파일 집합 확인값 `94fb0e5a8c2e67def5f4b1460431170eaae5f9505f78c7d900bea9446ead8374`는 2026-08-28 전량 예행연습의 역사적 기준점이다. 당시 push는 0회였다.
- 계정 번호 분리 변경 전 로컬 기준은 commit `0653361530dd15e67bd4b467ecff2ea63399a243`, tree `932a086915c12cf123887801594569b22a579ba8`이며 Git push는 하지 않았다.
- 플랫폼 이미지 후보 132개는 현재 목록의 경로·크기·파일 종류·내용 확인값과 일치했고, 같은 내용을 하나로 세면 65개다.
- 최종 미디어 목록은 2,758개·2,346,220,246바이트이고 목록 SHA-256은 `61bb577d609f97cdb014ef3a14681045fbb3bec616f2b04c8d058519b640c532`, 파일별 key·크기·내용 확인값 집합 SHA-256은 `9345d2f06c8bd7cda457a9d4335cdc2213e71dcd30bb9e11e6f3e1f8e11ae467`다.
- SBS GIF 경로는 `/media/naver/221172590451/001-e467d08a3a01.gif`, 크기는 1,299,862바이트, SHA-256은 `e467d08a3a01bf5bcc53c79f2a40e89d0181a8c920e08b62a1a513c3d93656d9`다.
- 일괄 업로드 기록 SHA-256은 `2974384ff720326830f5f3dcd9e2439dc56af4ec96c813bade88a2d0b7815444`, 업로드 뒤 전수 목록 확인 기록 SHA-256은 `f562129e14a65918bfebac26de313ff5e461ad3067774f9084a0e0514def0d84`다. 이 값은 결과 파일이 나중에 바뀌지 않았는지 확인하는 긴 확인 번호다.
- 업로드는 기존 1개를 그대로 두고 빠진 2,757개만 새로 만들었다. 최종 확인은 exact 2,758·missing 0·mismatch 0·orphan 0, overwrite 0·delete 0이다.
- 실제 감사 진입점의 마지막 인터넷 없는 전량 시험은 고정된 프로그램 원본 157개·SHA-256 `b67874a204d71b05da4678847c7bf56acce2a3ee5eb5ce532f6a3ee77cfad9db`에서 2026-08-28 19:14:54.924 KST에 완료됐다. 로컬 원본 2,758개·약 2.35GB로 목록 3회와 각 파일 정보·내용 1회씩, 모두 5,519회 읽기를 확인했다. 파일 추가·변경·삭제·재시도는 0회였고 전량 시험 194개·차단 경계 152개·영향 범위 829개 확인을 통과했다. 실행 전후 프로그램 원본 확인값도 같았다. 이 예행연습은 실제 Cloudflare 파일을 읽은 결과가 아니다.
- 실제 staging `full GET/SHA-256`는 2,758개·2,346,220,246바이트와 전체 object-set SHA-256 일치로 완료했다. 영수증의 실제 HEAD 시도 2,760회에는 bounded retry 2회가 투명하게 포함되고 PUT·DELETE는 0이다.
- 계정 번호 전용 사전검사·보관·복구 시험 610개, 읽기 전용 열쇠 전달 시험 81개와 시험용 Worker 관리 열쇠 시험 378개를 통과했다. 인터넷·외부 프로그램 차단 보강 전 전체 Cloudflare 회귀시험은 27개 묶음·15,076개 확인을 통과했고, 현재 원본으로 R2 전량 예행연습 194개·차단 경계 전용 152개·영향 범위 829개 확인을 통과했다. 금지 시도 24종은 원래 연결·실행 함수 전에 차단됐고, 성공 경로에서는 읽기 전용 Git 15회와 격리된 파일 도우미 5회만 허용됐다. 개발 중 가짜 연결 누락으로 Mac 보관함 읽기 명령이 실제 1회 실행됐지만 두 번째 읽기·저장·변경·클립보드·Cloudflare·R2 접근은 0회였고, 감시 보강 뒤 추가 실제 시스템 프로그램 실행은 0회였다.
- 자체 브라우저에서 받은 계정 번호를 별도 일반 출력이나 프로젝트 파일에 남기지 않고 메모리 통로로 넘기는 변경은 commit `b66798ff3ad7907e3fd43bdcb62328f2319cf5fe`에서 계정 검사 698개를 통과했다. 한 번만 여는 연결은 commit `bb0a250344d3c2f8d991b73bab11e2fd3a281833`·tree `edb439b2bfb33cf9940a07c9883c057f40191f6c`에서 연결 검사 212개와 계정 검사 698개를 통과했다. 60초 변경은 commit `5a49c79fbd1e4d76d22fe736f6d22940aa6c856e`·tree `f246b062473f5544d3ea432dbd7d2864a2d63086`에 기록했고 push는 0회다. 첫 실제 실행의 `BRIDGE_E_BIND`는 일반 격리 환경의 localhost bind 제한이 원인으로 확인됐다. 권한 확장 host 1회는 ready까지 정상 진행했지만 자체 브라우저 client send 1회는 `BRIDGE_E_CLIENT_CONNECT`로 실패했고, host는 accepted connection 0회 후 `BRIDGE_E_TIMEOUT`·`durableState=none`으로 종료됐다. 원문은 메모리 Buffer에서만 처리했고 출력·파일·argv·환경변수로 남기지 않았다. account initialization·Keychain·metadata write·retry·recover·delete는 모두 0회고, 사후 사전검사는 `ready`, primary·recovery·Keychain 모두 없음을 확인했다. 이전 탭 확인 도구 출력에 계정 식별자가 포함된 URL이 1회 표시된 사실은 그대로 유지하되 원문과 URL을 다시 기록하지 않았다.
- 별도 도구에 접근할 수 없는 브라우저·로그인 화면·클립보드 동작만 메인 세션이 최소한으로 직접 처리할 수 있게 한 운영 규칙은 commit `2f821cbbff3b3ddd4e48ea2457319bc5569bd986`에 기록했다. 이 예외는 삭제·구매·공개 전환·권한 변경·외부 전송의 승인 범위를 넓히지 않는다.
