# 대왕날치 — dwnc.me

개인 기록의 원문과 공개 범위, 미디어 무결성을 보존하며 직접 운영하는 Astro 블로그 프로젝트다.

## 현재 상태

사용자가 확인할 현재 목표·진행 상황·바로 다음 단계와 바뀌지 않는 요구사항 번호는 [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md)를 기준으로 한다. 구현 세부사항과 검사 기록은 [`PROJECT_STATE.md`](PROJECT_STATE.md)가 담당한다.

- 티스토리 공개 글 164개와 사진 814개 이전 완료
- 네이버 직접 작성 글 432개 보존 완료: 공개 185개 + 로컬 전용 비공개 247개
- 공개 글 349개의 공식 새 주소와, 그 글로 이어지는 예전 주소 349개의 로컬 빌드·검증 완료
- 최종 공개 미디어 2,758개·2,346,220,246바이트를 로컬 원본과 전부 비교해 통과했다. 전체 목록이 바뀌지 않았는지 확인하는 긴 번호(SHA-256)는 `61bb577d609f97cdb014ef3a14681045fbb3bec616f2b04c8d058519b640c532`다.
- 사용자가 요청할 수 있는 주소 1,409개, 정적 페이지 1,404개와 예전 주소 자동 이동 349개를 확인했다. 주소 목록의 긴 확인 번호(SHA-256)는 `e143cefe01de35de47495e3fbd036773eb550e58f377e07467014d45f944d594`다. `/404.html` 파일은 오류 화면으로만 남고 직접 공개하는 주소 목록에서는 제외했다.
- Cloudflare 로컬 회귀와 사진형 148·장문형 201 분류 통과. 계정 번호 전용 확인 610개와 전체 Cloudflare 확인 26개 묶음·15,024개가 통과했으며, 자세한 근거는 `PROJECT_STATE.md`에 기록한다.
- 시험용 비공개 R2 저장소에 공개 미디어 2,758개를 모두 올렸다. 빠진 파일, 내용이 다른 파일, 목록에 없는 불필요한 파일은 0개였고 기존 파일을 덮어쓰거나 삭제하지 않았다. 다음에는 모든 파일의 실제 내용을 다시 내려받아 원본과 비교한다.
- Cloudflare 계정 번호를 사진 업로드용 열쇠와 분리해 이 Mac의 안전한 보관함에서 불러오는 기능을 만들고 시험했다. 계정 번호를 복사하기 전의 저장 준비 확인은 이미 통과했다. 계정 번호는 그 자체로 로그인하거나 파일을 바꿀 수 있는 열쇠가 아니며, 잘못된 계정에서 작업하는 일을 막는 확인 표지로만 쓴다. 실제 계정 번호 저장과 Cloudflare 조회는 아직 0회다. 다음 사용자 동작은 올바른 Cloudflare 계정 화면에서 **Account ID 옆 Copy를 한 번 누르는 것**이다.
- 시험용 Worker와 사이트 버전은 아직 올리지 않았고 실제 `dwnc.me` 주소와 DNS도 연결하지 않았다.
- 기술 참고: staging R2 전체 업로드에 사용한 당시 기준 source commit은 `ccec8bb855e45ef679a4b99faf0f0633a99e089e`·tree `241a654acc387233d4e2d5e076754b345619e9ac`이며, 해당 실행과 관련한 push는 0이다.

B 선택에 따라 지도 99개, LINE 스티커 5개, 1×1 placeholder 27개를 최종 R2 집합에서 제외했다. 지도는 영향 글 5개의 장소 카드 16개로 바꿔 15개 원 장소 네이버지도 링크와 1개 검색 링크를 제공한다. placeholder video poster를 빼도 재생 불가 안내·재생시간 53개와 작성자 캡션 23개는 남고, placeholder cover 13개의 파생 cover는 `null`이다. 사용자가 직접 제작한 SBS GIF 1개는 본문·cover에서 정확히 유지한다.

실제 사이트와 분리된 시험용 주소는 `https://dwnc-me-staging.dwnc.workers.dev`다. 이 주소의 자동 점검에는 허가받은 요청임을 보여 주는 임시 출입 비밀번호를 함께 보낸다. 이 비밀번호는 추측하기 어렵게 만든 43자 값이며, 접근 규칙이 바뀌지 않았는지 확인하는 긴 번호는 `d6c554c1d80c68c08605636f12f26a411f7826bc40eddaee9233a30b6551781a`다. 결과 기록이 진짜인지 확인하는 비밀 서명 열쇠는 Mac 보관함에만 두고 꺼내지 않았다. 짝이 맞는 공개 확인 번호 두 개는 `69cb5866228f1624693b0903e60d52b0c046464040da621b2d144cb8bffb2182`와 `2655be4122fb2238d47ba539b8e86aa9d39899631a7d713106ce711ea2de1ac2`다. R2 전체 업로드는 완료됐다. Worker가 예전 주소 349개를 직접 처리하는 기능과, 각 주소를 두 방식으로 확인해 총 698회 검사하는 기능은 로컬에서 완성했다. 원격 점검 프로그램은 주소 목록과 업로드용 묶음, `/about` 화면의 실제 내용을 먼저 확인하고 그 뒤에만 임시 출입 비밀번호를 읽는다. 모든 인터넷 요청은 자동으로 다른 주소를 따라가지 않으며, 처음 요청한 안전한 시험용 주소에서 온 응답인지 확인한다. 응답이 늦게 도착하거나 너무 크거나 끝나지 않아도 정리하고, 점검 프로그램 전체도 시작부터 종료까지 8분을 넘기지 않도록 시험했다. 전체 파일 내용 감사, 임시 출입 비밀번호 생성, Worker 생성, 새 버전 올리기와 적용은 아직 수행하지 않았다.

계정 번호 보관 기능은 macOS Keychain의 전용 항목만 사용하며 R2 업로드용·검사용 열쇠를 읽지 않는다. `cloudflare:account-target:preflight`가 저장 위치와 기존 보관 상태를 확인했고 현재 준비 완료다. 이 사전검사는 클립보드를 읽거나 지우지 않았으며 사용자의 기존 클립보드 내용을 그대로 뒀다. 이제 사용자가 올바른 Cloudflare 계정의 **Account ID 옆 Copy**를 한 번 누르면 `cloudflare:account-target:init`이 계정 번호를 저장한다. 초기화가 계정 번호 읽기를 시도한 뒤에는 성공 여부와 관계없이 클립보드를 즉시 비운다. 저장 직전에도 상태를 다시 확인하고, 기존 항목이나 파일을 덮어쓰지 않고 새로 만들며, 저장 뒤에는 보관함과 확인 파일이 올바른지 다시 검사한다. 저장된 번호를 실제로 사용할 때는 Mac 보관함의 값을 확인 파일을 다시 읽기 전과 후에 두 번 확인한다. 그 사이 값이 바뀌거나 사라지면 Cloudflare 조회, 새 열쇠 읽기, 하위 작업 시작과 새 파일 쓰기를 모두 하지 않고 멈춘다. Mac 보관함과 클립보드를 다루는 시스템 프로그램은 최대 15초만 기다린다. 끝나지 않으면 먼저 정상 종료를 요청하고, 그래도 멈추지 않으면 강제로 종료한다. 계정 번호 읽기를 시도한 뒤에는 성공하거나 실패해도 클립보드를 즉시 비운다. 시스템 프로그램이 사용한 입력·출력과 임시 바이트는 성공과 모든 실패에서 0으로 덮는다. 저장 내용이 맞는지만 확인하는 기능은 계정 번호를 문자열로 만들지 않는다. 실제로 다음 기능에 넘기는 마지막 순간에만 프로그램 언어의 특성상 계정 번호 문자열을 한 번 만들며, 문자열은 같은 방식으로 지울 수 없다. 이 값은 화면·로그·파일에 남기지 않고 전달 직후 더 이상 사용하지 않는다. 보호된 확인 파일은 기본 위치를 쓰든 별도 위치를 지정하든 프로젝트 밖에 있어야 한다. 실제 위치가 프로젝트 안이거나, 중간 폴더가 다른 위치를 가리키는 연결이면 계정 번호와 열쇠를 읽기 전에 멈춘다. 확인 파일에는 원래 번호 대신 확인값과 용도만 남긴다. 저장 도중 확인 파일이 완성되지 않으면 실패 파일은 지우거나 덮어쓰지 않고 그대로 보존하며, `cloudflare:account-target:recover`가 첫 파일 이름에서 정해지는 단 하나의 두 번째 확인 파일을 새로 만들어 복구한다. 다른 복구 파일 이름은 받지 않는다. 두 확인 파일이 모두 불완전하면 자동으로 더 진행하지 않고, 기존 파일과 보관 항목을 그대로 둔 채 사용자의 판단이 필요한 상태로 멈춘다.

이 시스템 프로그램에는 현재 Mac이 직접 알려 준 사용자 폴더·사용자 이름과 macOS 문자 처리값, 고정된 프로그램 검색 경로와 고정 언어 설정 등 꼭 필요한 값 7개만 전달한다. 임시 폴더, 인터넷 우회 설정, 프로그램 주입 설정, Node 설정, Cloudflare·R2·AWS 열쇠처럼 부모 프로그램이 가지고 있던 다른 값은 하나도 전달하지 않는다. 이 7개 묶음은 만든 뒤 내용을 추가·변경하거나 다른 묶음으로 바꿀 수 없게 잠근다.

개발 중 시험용 가짜 연결 한 곳이 빠지는 실수가 있었다. 이 때문에 `/usr/bin/security find-generic-password … -w`라는 Mac 보관함 읽기 명령이 실제로 한 번 실행됐다. 같은 값을 다시 확인하는 두 번째 읽기는 0회였고, 보관함 저장·변경은 0회였다. 클립보드·인터넷·Cloudflare 접근도 모두 0회였다. 이후 모든 시험에서 실제 시스템 프로그램 실행을 즉시 잡는 감시를 가장 바깥에 추가했다. 이 감시 표시는 안의 내용을 확인하거나 함수를 실행하지 않고, 표시가 있기만 하면 Mac 명령을 시작하기 직전에 항상 멈춘다. 부모 프로그램에 일부러 넣은 인터넷 우회·프로그램 주입·Node 시험값도 Mac 명령에 전달되지 않았다. 계정 번호 전용 610개와 전체 Cloudflare 26묶음·15,024개를 다시 통과하는 동안 추가 실제 실행은 0회였다. 실제 계정 번호 초기화도 아직 0회다.

실제 `dwnc.me` 도메인과 DNS는 Cloudflare Worker에 연결되지 않았다. 따라서 Cloudflare에서 production이라는 이름의 Worker·R2·version 작업을 진행해도 현재 방문자에게 영향이 없다. 단, 실제 도메인·DNS 연결, Git push, 보호 절차 없이 직접 실행하는 `wrangler deploy`, 객체 덮어쓰기·삭제는 하지 않는다.

완료 요구사항은 최근 12개까지 현재 원장에 남기고 이후 [`docs/REQUIREMENTS_ARCHIVE.md`](docs/REQUIREMENTS_ARCHIVE.md)로 이동한다.

## 로컬 미리보기

```sh
npm ci
npm run dev
```

## 검증

```sh
npm run inventory:validate
npm run sequence:self-test
npm run sequence:cli-test
npm run sequence:validate
npm run build
npm run build:validate
npm run build:validate:public
npm run media:manifest:check
npm run media:validate:source
npm run media:validate:local
npm run media:r2:hardening:test
npm run requirements:validate
npm run requirements:test
npm run cloudflare:test
npm run cloudflare:build:source
npm run cloudflare:wrangler:types:check
npm run cloudflare:wrangler:startup:check
npm run cloudflare:wrangler:bundle:check
```

`inventory:validate`와 authoritative sequence 변경은 로컬 원장·원본 인벤토리를 갖춘 보존 작업공간에서 실행한다. `build:validate:public`은 private root가 없는 상태를 주입해 hydrated 공개 결과를 검증한다. `cloudflare:build:source`는 Git 비추적 media를 읽거나 내려받지 않고 tracked manifest와 공개 content reference만으로 정적 결과를 만들며 `dist/media`가 0인지 확인한다. `cloudflare:isolated:source`는 fresh Git-style tree에서 private/raw/local media가 없는 같은 조건을 재현하고, `cloudflare:isolated:lock`은 외부 통신 없이 lock과 exact Wrangler 해석을 검사한다. 네트워크가 허용된 깨끗한 CI에서는 `cloudflare:isolated:clean`으로 실제 `npm ci`부터 다시 검증한다. 실제 production 이름의 자원에서도 올바른 계정인지 보여 주는 확인값, 공개 서명 열쇠가 맞는지 보여 주는 긴 확인 번호, 전체 파일 검사에 서명한 결과 기록, R2 읽기 전용 자격증명과 정확한 Wrangler 실행 묶음이 없으면 안전하게 중단한다.

`migration/raw/`, 전체 `public/media/`, 네이버 비공개 메타데이터는 Git에 포함되지 않는다. 새 컴퓨터로 옮기기 전에는 이 로컬 자산을 별도로 백업해야 한다.

공개 미디어와 글·예전 주소·집계 주소를 안전하게 제공하는 Worker, 기존 파일을 바꾸지 않는 R2 업로드, 단계별 사이트 공개, 원격 확인 기록, 철회·되돌리기 절차는 `docs/MEDIA_SERVING_CONTRACT.md`를 기준으로 한다. 실제 적용할 버전은 업로드 허가, 업로드 결과 재확인과 별도 적용 절차를 차례로 통과해야 한다. 적용 결과가 불명확하면 자동으로 다시 실행하지 않는다. 시험용 R2 업로드 당시 기준 source commit은 `ccec8bb855e45ef679a4b99faf0f0633a99e089e`·tree `241a654acc387233d4e2d5e076754b345619e9ac`이며 push는 0이다. 시험용 비공개 R2의 2,758개 업로드와 목록 확인은 완료됐고, Cloudflare API 원본으로 만든 표준 비공개 설정 확인 기록·모든 파일 내용을 다시 내려받는 검사·시험용 Worker는 아직 없다. 일괄 업로드 기록은 업로드 운영 기록일 뿐 최종 공개 허가에 쓰지 않는다. 시험용 전체 내용 검사 결과만 별도로 서명하며, 향후 운영용 저장소는 운영용 전체 검사 결과와 별도의 신뢰값이 필요하다.

업로드 전 bucket 설정 확인용 capture는 만들지 못했지만 bulk와 exact post-inspection은 별도 자격증명으로 완료했다. 다음에는 새 900초 capture를 수집하고 즉시 full audit를 시작해야 하며, 감사 시작과 receipt 후보 생성이 모두 `expiresAt` 전이어야 한다. 만료되면 새 capture와 아직 쓰지 않은 새 receipt 경로로 2,758개 감사를 처음부터 다시 실행한다. 전체 감사 전에 보호된 영수증 경로와 exact Git commit/tree/clean 상태도 먼저 확인한다.

Cloudflare의 비공개 설정을 읽기 위한 사전검사는 이미 준비 완료다. 다음 순서는 **올바른 계정의 Account ID 옆 Copy 한 번 → 초기화**다. 초기화로 한 번 보관한 계정 번호를 사용하며, 이후 `cloudflare:account-target:inspect`는 원래 번호를 보여 주지 않고 올바른 계정인지 여부만 확인한다. 짧게 사용하는 읽기 전용 열쇠는 시스템 클립보드에서 한 번 읽어 자식 작업에만 전달하며, 계정 번호와 열쇠를 명령어나 화면 출력에 넣지 않는다. Cloudflare 원본 응답만 저장되고 표준 확인 기록을 만드는 데 실패한 경우에는 `cloudflare:r2:exposure:recover`가 새 열쇠나 새 API 요청 없이 원본 응답·Git 상태·정책·유효시간을 다시 확인하고 빠진 기록만 새 파일로 만든다.

시험용 Worker 관리 열쇠는 `cloudflare:staging:control-token:init|inspect|recover`로만 보관·확인·복구한다. 새 Account API token의 정확한 53자 형식(`cfat_` + 영문·숫자 40자 + 소문자 16진수 확인부 8자)만 받으며, 접두사 없는 예전 형식은 받지 않는다. 열쇠는 staging 계정의 `Workers Scripts Edit` 한 권한, 총 48시간 이하와 실행 시 남은 시간 60분 이상을 요구한다. 원문은 Keychain에만 두고 프로젝트 밖 확인 파일에는 계정·열쇠·token ID의 확인값만 남긴다. 허용된 작업은 `run-cloudflare-staging-control.mjs`가 고정한다. Wrangler 4.125의 실제 본체와 실행에 필요한 최소 660개 파일을 전체 내용 확인값으로 검증하고, 실행할 때마다 격리 폴더에 새 읽기 전용 사본을 만들어 현재 Node의 절대경로로 직접 실행한다. PATH, 3KB 실행 안내 파일이나 저장된 로그인 정보로 다른 실행 파일을 대신 쓰지 않는다. 최초 생성은 실행 전 준비 기록, 직전 service/주소 확인, 1회용 허가, 실행 시작 기록, Wrangler 1회, 결과 기록 순서로만 진행한다. 중단되면 `cloudflare:staging:service:bootstrap:recover`가 생성 명령·Wrangler·whoami를 다시 실행하지 않고, 계정에 한정된 token 확인과 계정 주소 GET 2회 후 Cloudflare 상태 A/B를 읽어 대조한다. 두 번 모두 Worker가 없으면 시작 기록에 따라 생성 전 중단 또는 시작 후 미생성으로 기록하며, 정확히 같은 차단 Worker 하나가 보일 때만 복구 완료로 기록한다. 결과 version 불일치, 서로 다른 조회, 여러 version·deployment, 잘못된 기록·시각·출력 경로는 자동 진행하지 않는다. 아직 연결하지 않은 version upload·상세 확인·적용·workers.dev 활성화는 token을 읽기 전에 중단한다. 내부 FD 전용 명령은 공개 npm 명령에서 제거했다. 관리 열쇠·클립보드·Cloudflare 접근은 0회였고, 계정 번호 보관함 읽기 명령 1회 사고는 위에 별도로 기록했다.

복구 명령은 서명된 확인 자료, 준비·허가·시작·결과·상태 기록과 현재 Git을 관리 열쇠보다 먼저 검사한다. 이미 완성된 상태 기록은 그 의미를 다시 계산해 같은 결과를 돌려주며 Keychain·token 확인·Wrangler·작업 자식·Cloudflare 요청을 모두 0회로 유지한다. 첫 상태 파일이 일부만 남았을 때 만든 고정 두 번째 파일도 같은 방식으로 재사용한다. 복구 저장 위치는 macOS가 알려 주는 현재 사용자의 홈 폴더로만 정하고 명령 인수·환경변수로 바꾸지 않는다. 부모 확인 직후 다른 실행이 상태 기록을 먼저 완성해도 이번 인증 조회, 이번 자식의 상태 조회, 기록에 남은 과거 요청 수를 분리한다. 원래 생성 때의 열쇠 확인값과 현재 복구 열쇠 확인값은 분리하며, version 목록은 최대 10쪽·500개 범위에서 전체 수·중복·변화를 확인한다. production 최초 생성 입력은 자격증명을 읽기 전에 거부한다.
