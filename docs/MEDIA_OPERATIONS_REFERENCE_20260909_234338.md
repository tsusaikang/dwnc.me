# 미디어 운영 상세 참조

[현재 미디어 계약](MEDIA_SERVING_CONTRACT.md)의 업로드·인증·원격 감사·빌드·승격 구현 규칙이다. 해당 운영 작업을 수행하거나 변경할 때만 필요한 절을 읽는다. 정책을 바꾸지 않고 기존 상세 규격을 분리했다.

이 문서의 staging 전용 명령·최초 생성 절차는 해당 경로의 계약이며 모든 후속 CMS 배포에 일괄 적용하는 새 승인 절차가 아니다. 실제 배포 상태·현재 승인 범위는 [공식 상태](../PROJECT_STATE.md)를 따른다. 날짜가 고정된 실행 결과와 이전 실패·미실행 관측은 [이력](history/MEDIA_SERVING_HISTORY_20260909_234338.md)에서만 확인한다.

## 3. upload-once sync

`scripts/inspect-public-media-r2.mjs`는 validator 자격증명으로 remote `LIST` pagination과 manifest key 전수 `HEAD`만 수행한다. `scripts/sync-public-media-r2.mjs`는 uploader 자격증명의 기본 dry-run과 create-only 적용을 담당한다. 두 명령 모두 S3-compatible API를 SigV4로 서명하되 URL·credential을 출력하지 않는다.

운영 명령은 네 개의 legacy R2 환경변수를 사용자가 직접 넘기지 않는다. 자격증명은 macOS Keychain에 보관하고, repository 밖의 create-only metadata 파일 절대경로만 `R2_CREDENTIAL_METADATA_PATH`에 지정해 `scripts/run-with-r2-credentials.mjs` wrapper를 실행한다. wrapper는 package command에 고정된 환경과 역할을 선택하고 metadata와 Keychain 값을 대조한 뒤, 자격증명 bytes를 익명 pipe FD 3으로 한 번만 child에 전달하고 메모리 buffer를 지운다. 사용자가 `--environment`, `--role`, credential metadata 인자를 덧붙이거나 legacy 자격증명 환경변수·FD를 함께 지정하면 실행 전에 거부한다.

credential 값은 저장소·manifest·receipt·로그에 기록하지 않는다.

기존 원격 token의 정리 여부는 해당 실행의 공식 상태를 확인하며, exact identity와 승인 없이 삭제하지 않는다.

아래는 과거 2,758개 공개 집합의 명령 형식 예시다. `expected` 수치와 출력 경로는 당시 값이며 현재 원격 상태를 주장하지 않는다. 실제 실행은 승인된 현행 기대값·새 출력 경로를 사용한다.

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

localhost를 쓰지 않는 보조 경로는 `cloudflare:account-target:stdin:init`의 secure non-echo TTY stdin receiver다. 고정 Git commit·tree·clean을 시작 때와 입력 직후 두 번 확인하고, `READY` 뒤 한 줄 최대 33바이트에서 exact 32-byte lowerhex만 받아 `InAppBrowserAccountIdBufferSource`와 기존 initializer에 넘긴다. bounded input timeout, `SIGTERM`·`SIGHUP`·종료의 모든 경로에서 echo를 복구하고 입력·source·buffer를 정리하며 고정된 안전 상태만 출력한다.  따라서 이 receiver는 제품이 안전한 로컬 target을 허용하거나 사용자가 원문을 도구 출력 없이 직접 입력하는 명시적 handoff가 있을 때만 사용한다.

account-target native child environment는 exact 7 keys다. `HOME`·`USER`·`LOGNAME`은 `os.userInfo()`에서, `PATH`는 `/usr/bin:/bin:/usr/sbin:/sbin`, `LANG`·`LC_ALL`은 `C`, `__CF_USER_TEXT_ENCODING`은 uid에서 계산한다. parent `process.env`의 `TMPDIR`, 모든 proxy, `DYLD_*`, `NODE_*`, Cloudflare·R2·AWS 값은 전달 0이며 proxy·DYLD·Node poison 값도 전달 0이다. 객체는 `Object.create(null)`로 만들고 `Object.freeze`하며, clipboard/Keychain instance의 `environment` property도 writable false·configurable false여서 항목 추가·변경·교체를 모두 거부한다. 시험용 `NATIVE_SPAWN_GUARD`는 `in globalThis`로 존재만 검사하고 값을 읽거나 함수로 호출하지 않으며, 존재하면 실제 `spawn` 전에 고정 오류로 중단한다.



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

staging bulk receipt와 staging full-audit receipt, production full-audit receipt를 구분한다. staging의 `dwnc-public-media-r2-bulk-sync-v1`은 운영 기록이며 서명하지 않는다. staging 전체 감사가 만드는 `dwnc-public-media-r2-receipt-v1`만 staging `media-receipt` key로 별도 서명할 수 있고, 그 서명은 staging artifact에만 유효하다. production은 production account·bucket을 대상으로 새 exposure capture와 전수 GET/SHA-256 감사를 수행해 별도의 production receipt를 만들고 production 전용 `media-receipt` 신뢰값으로 서명해야 한다. staging receipt나 서명을 production으로 승격하거나 재사용하지 않는다.

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

고정 Wrangler 버전과 필요한 production receipt·signature·credential·trust fingerprint를 검사하며, 증거가 없거나 맞지 않으면 gate는 fail closed한다. 합성 fixture를 실제 서명·운영 확인의 대체물로 사용하지 않는다.

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

각 smoke HTTP 요청은 기본 10초, 전체 실행은 8분, body cancel은 100ms로 제한한다. 응답은 `Accept-Encoding: identity`로 받고 필요한 body만 streaming reader로 읽으며 GET media/cache는 manifest size, `/about`은 sealed static size, Range는 1 byte, HEAD·304·416·redirect body는 0 byte를 상한으로 한다. 필요 없는 404·cache miss·unauthenticated body와 완료되지 않은 reader는 즉시 cancel하고 모든 timer를 정리한다. `/about`은 sealed SHA-256·size·MIME, cache HIT media는 manifest SHA-256·size·ETag·MIME를 확인한다. 304는 GET과 같은 ETag·empty body, 416은 GET과 같은 ETag·`Content-Range: bytes */{size}`·empty body를 요구한다. wrong body/digest/size/etag/mime/header, nonempty 304/416, never-ending·oversize·abort·cancel fixture를 거부한다. child stdout/stderr는 write callback과 backpressure drain을 absolute deadline 안에서 모두 기다리고, error/close/never-drain이면 output을 닫은 뒤 관련 promise가 모두 settle한 다음 buffer를 0으로 덮는다.
5. `cloudflare:promotion:verify`는 version attestation, 최신 full-media/private-exposure receipt, staging 동일-payload 증거, 보호된 signed active head, signed pre-status와 시한부 signed promotion authorization을 검증한다. source Git ancestry, 단조 generation, 누적 withdrawn surface와 retired artifact/payload/version을 통과한 exact `versions deploy <ID>@100%` argv 배열과 그 SHA만 승인 범위로 만든다.
6. 앞 단계의 서명·상태 조건이 통과하면 `cloudflare:promotion:execute`는 authorization을 영구 one-time claim하고 권위 store lock을 잡은 뒤 status를 다시 읽어 active version 100%를 fresh CAS한다. 기술적 선행 조건이 모두 맞는데도 단순히 추가 승인을 받기 위해 임의로 중단하지 않는다. `execFile`로 exact argv를 한 번만 수행하고 raw command/status와 구조화 outcome을 no-replace로 보존한다. target 100%일 때만 signed active head를 원자 교체한다. 이전 version 100%, split, timeout 또는 unknown은 모두 ambiguous로 lock·pending·증거를 유지하며 자동 재시도하지 않는다. owner가 죽고 5분이 지난 뒤에만 `cloudflare:promotion:lock-status -- --include-recovery-token`으로 얻은 exact token을 같은 executor에 전달해 deployment를 다시 실행하지 않는 명시적 status-only recovery를 수행한다.

artifact upload config는 `find_additional_modules=false`를 강제한다. promotion config에는 assets·bindings·vars·routes·triggers·observability가 없어 traffic 변경 뒤 비버전 설정 PATCH가 섞이지 않는다. 현재 top-level 이름은 안전장치가 아니다. Workers Builds가 이름을 override할 수 있으므로 raw `wrangler deploy`는 production overwrite 위험이 있는 P0 blocker다.

Stage 3에서 확인한 Builds guard 계약은 다음과 같다. 실제 운영 시 현재 설정과 대상은 다시 대조하며, 이 목록을 새 배포 승인으로 해석하지 않는다.

- `SKIP_DEPENDENCY_INSTALL=1`
- Build: `npm ci && npm run cloudflare:prepare:production`
- Deploy: `npm run cloudflare:upload:production-version`
- Version: `npx wrangler versions upload`
- traffic promotion은 Git trigger 밖의 별도 승인 job

최초 Worker가 부재한 환경에서는 `versions upload`로 bootstrap할 수 없으므로, route·custom domain·trigger·asset·binding 0인 deny-all service를 signed service-existence evidence·one-time authorization 아래 한 번만 만든다.

최초 생성 절차의 검사 규칙은 다음과 같다.

- 생성 전 계정의 `workers.dev` 하위 이름을 별도 API로 읽어 정확히 `dwnc`인지 확인하고, 원래 계정 번호 대신 계정 확인값과 함께 서명 자료·1회용 허가에 묶는다. 실행 직전 15초 이내에 다시 읽고, 생성 뒤에도 값이 바뀌지 않았는지 확인한다.
- deny-only 설정은 `workers_dev=false`, `preview_urls=false`, 추가 module 탐색 금지, `logpush=false`, tail consumer·tag 없음으로 고정한다. observability는 전체·logs sampling `1`, logs enabled, invocation logs disabled, persist enabled, 외부 log destination 없음이고 traces는 disabled·destination 없음·propagation policy 없음이어야 한다. 공식 API에서 `logs.persist`가 생략되면 문서화된 기본값 `true`로만 해석하고, 명시적인 `false`나 `null`은 거부한다. 그 밖에 공식 API가 생략할 수 있는 기본값도 같은 의미로만 정규화하며, 문서에 없는 새 설정 key나 값 변화는 성공으로 넘기지 않는다. 생성 뒤 [`/script-settings` 공식 API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/settings/methods/get/) 원본 응답과 SHA-256을 보존한다.
- 생성 결과의 version 상세에서 binding 0·asset 없음·fetch handler를 확인한다. 이어 [`/content/v2` 공식 API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/content/methods/get/)의 multipart 응답에서 module 정확히 1개만 인정하고, 내려받은 바이트와 SHA-256이 로컬 `DENY_ALL_WORKER_SOURCE`와 완전히 같아야 한다. `cf-entrypoint`가 있으면 exact `deny-all-worker.js`만 허용하고, 없으면 exact 단일 module이 증명될 때만 그 이름으로 추론해 근거 종류를 따로 기록한다. quoted boundary, header·parameter 순서와 대소문자, 허용 preamble·epilogue·boundary 공백, filename·part MIME 생략 같은 표준 표현 차이는 허용하되 part 본문 바이트는 바꾸지 않는다. 단순한 `verified=true` 표시는 성공 근거로 사용하지 않는다.
- 생성 뒤 [현재 deployment 목록](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/deployments/methods/list/)을 먼저 읽고, deploy 가능한 version 목록·account subdomain·script 공개/미리보기 상태·전체 script settings·content·version detail 여섯 응답을 읽은 뒤 deployment를 다시 읽는다. 이 8개짜리 묶음을 연속 두 번 확인한다. deploy 가능한 version과 deployment는 각각 정확히 하나여야 하고, 각 묶음 안에서 앞뒤 deployment 원문과 ID·설명·strategy·전체 version 배분이 같아야 한다. 두 묶음의 의미 상태도 같고 승인된 하나의 version ID가 100%일 때만 기록을 만든다. 같은 version 100%여도 deployment ID가 바뀌거나 중간 목록이 잠깐 달라졌다 돌아오면 실패한다.
- 모든 GET은 `Accept-Encoding: identity`로 압축하지 않은 응답을 요구한다. 서버가 gzip·br 등 다른 압축 형식을 보내면 본문을 읽기 전에 취소한다. 정상 응답뿐 아니라 오류 응답도 공통 streaming reader로 최대 1MiB까지만 읽는다. `Content-Length`가 더 크면 읽기 전에, 길이를 알 수 없는 응답은 1MiB를 한 바이트라도 넘는 즉시 body를 취소한다. JSON은 `application/json`과 UTF-8만 허용한다. 생성 직전 Worker 부재·계정 하위 이름, Wrangler 생성 결과, 생성 뒤 상태 A·B의 총 5종 원본 자료는 사용자 홈 아래 정해진 프로젝트 전용 보호 폴더에 primary와 고정 recovery 한 자리만 사용해 새 파일로 기록하고 덮어쓰지 않는다. recovery는 primary가 미완성일 때만 허용하며, 완성됐지만 대상·내용이 다른 primary나 안전한 파일 읽기 실패를 우회하지 않는다. 후보에는 실제 경로 대신 응답 역할·요청 확인값·status·시작/완료 시각·byte 수·SHA-256과 deployment/version 결속값만 넣는다. 계정 원본 번호·token·Authorization·전체 API URL·절대 경로는 출력·증거 파일에 넣지 않는다. 절대 경로 검사는 쉼표·세미콜론·괄호·대괄호·따옴표·제어문자 뒤의 macOS/POSIX·Windows·UNC 경로까지 거부하지만, 저장소 안의 안전한 상대경로와 정상 HTTPS·Workers 주소는 허용한다.
- 실제 생성 이후의 전체 흐름은 별도 실행 코어로 분리했다. 코어는 network·명령 실행·시각·Git 검사·보호 파일 검사와 읽기/쓰기·임시 파일 기능을 모두 호출자가 빠짐없이 전달해야 하며, 실제 기능으로 자동 대체하거나 OAuth·일반 `HOME` 로그인 정보에 기대지 않는다. 빈 값·일부만 전달한 경우 첫 API와 Wrangler 실행 전에 거부한다. 정상 흐름은 생성 직전 GET 2회, `prepared → one-time claim → started → 봉인 Wrangler 1회 → result → 현재 상태 A/B → status receipt` 순서로 고정한다. 1회용 허가 파일, 단계 기록 3개, 상태 primary/recovery, 원본 5종의 primary/recovery와 최종 후보까지 고정 출력 18개는 첫 API 전에 모두 안전성과 부재를 확인한다. 생성 직전 두 원본을 쓴 뒤에도 아직 만들지 않은 출력과 recovery 자리를 다시 확인한다. 기존 후보·부분 파일·recovery·허가 파일이나 안전하지 않은 상위 폴더가 있으면 API·Wrangler를 0회로 유지한다.
- 1회용 허가 creator는 기존 21-field `dwnc-cloudflare-bootstrap-authorization-v1`만 만든다. staging 고정 CLI `cloudflare:staging:bootstrap-authorization:create`는 service 부재와 account subdomain에 대한 receipt/signature/public-key 절대경로 6개와 저장소 밖 output 절대경로만 받는다. 두 증거는 tracked release key 서명, `exists=false`, exact account fingerprint·environment·Worker·`dwnc` subdomain·request hash·만료가 모두 맞아야 한다. 현재 clean HEAD와 tree를 생성 전·저장 전·저장 뒤 대조하지만 기존 허가에는 `sourceGitSha`만 기록하고 schema·consumer·executor·recovery나 approval/tree field는 추가하지 않는다. creator는 기존 export의 deny source/config SHA와 fresh request hash·최대 15초, crypto UUIDv4와 32바이트 nonce hash, 현재 시각부터 정확히 5분인 TTL을 사용한다. 기존 validator가 승인한 canonical 후보만 mode 600 create-only로 쓰고 exact 재읽기하며, 후보 서명은 기존 signer만 사용한다. account ID·token 원문은 입력·출력·파일·argv·환경변수에 두지 않는다.
- 승인 만료와 Git 상태는 첫 GET 직전, 1회용 허가를 기록하기 직전, 허가 기록 뒤 생성 명령을 실행하기 직전까지 세 번 확인한다. 세 번 모두 현재 HEAD가 허가의 `sourceGitSha`와 같고 tracked 변경과 일반 untracked 파일이 없어야 하며, 확인 중이나 허가 기록 뒤의 HEAD/tree 이동과 승인 만료도 거부한다. `dist/`, `.astro/`, `public/media/`, 비공개 원본처럼 `.gitignore`에 명시된 생성물·로컬 자료는 이 Git 상태에 포함하지 않지만, bootstrap payload는 repository가 아니라 새 임시 폴더의 exact 차단 코드·설정·빈 env 파일만 사용하고 추가 module 탐색을 꺼 두었으므로 이 파일들이 업로드 입력에 들어갈 경로가 없다. 임시 출력 닫기나 임시 폴더 삭제가 실패하면 원래 오류가 있었는지와 무관하게 경로·비밀값 없는 고정 cleanup 오류로 중단한다.


  token은 새 Account API token의 정확한 53자 형식(`cfat_` + 영문·숫자 40자 + 소문자 16진수 확인부 8자)만 허용한다. 접두사 없는 예전 token, 길이가 다른 값, 밑줄이 섞인 값, 16진수가 아닌 확인부는 첫 API 전에 거부한다. 다음 날 만료를 기본으로 하되 시작부터 만료까지 48시간 이하, 실행 시 남은 시간 60분 이상이어야 한다. R2·DNS·Zone·KV·route·삭제·production 명령은 허용 목록에 없다. 전용 Keychain 항목과 프로젝트 밖의 고정 기본/예비 metadata는 create-only이고 덮어쓰기·삭제하지 않는다. 현재 canonical payload의 정확한 최대치는 원문 402바이트·base64url 536자이며, 실제 Keychain과 시험용 MemoryStore 모두 1,024자 상한을 적용하고 1,025자는 거부한다. 기존 서명 private key의 512자 형식 검증은 넓히지 않았다. metadata에는 계정·token·token ID 원문과 계정 이름 대신 domain-separated SHA-256 확인값, 활성 상태, 시작·만료·확인 시각, 권한 계약 확인값만 기록한다. 초기화는 두 metadata 위치의 안전성과 부재를 Keychain·clipboard·API보다 먼저 확인하고 기록 직전에 대상 위치를 다시 확인한다. 복구도 primary와 거기서 정해지는 recovery 한 곳의 안전성·부재·완성·부분 상태를 먼저 분류한다. 안전하지 않거나 이미 완성된 출력과 충돌하면 Keychain·API·쓰기 0회로 멈추며, primary가 일부만 기록되고 recovery가 비어 있을 때만 recovery를 새로 쓴다. Keychain 저장 뒤 metadata 기록이 중단되면 기존 항목을 바꾸지 않고 고정 예비 파일 한 곳으로만 복구하며, 두 파일이 모두 불완전하면 자동 진행하지 않는다.

  실행 runner는 token 확인 API의 `success=true`와 빈 `errors`를 함께 요구하되 `messages` 배열의 안내는 허용하고, 잘못된 HTTP 상태나 압축 응답은 본문을 취소한다. 이어 exact account의 `/workers/subdomain`이 `dwnc`인지 읽고, 고정 Wrangler 4.125의 `whoami --json`이 `Account API Token`·계정 정확히 1개·exact ID인지 확인한다. User Details를 추가하지 않아 email은 요구하지 않는다. runner는 3KB 안내 launcher가 아니라 실제 `wrangler-dist/cli.js` 20,524,522바이트의 SHA-256과 실행에 필요한 최소 묶음 660파일·207,434,085바이트의 경로·실행권한 분류·개별 내용 확인값을 고정 tree SHA-256으로 검증한다. 검증 직후 이 전체 묶음을 격리 인증 폴더에 create-only로 복제하고, 일반 파일은 mode 400·실행 파일은 mode 500으로 바꾼 뒤 파일 목록·바이트·tree SHA를 다시 확인한다. `.bin` shebang, 원본 launcher와 PATH의 `node`는 실행하지 않고 현재 `process.execPath`로 격리된 실제 CLI 사본을 직접 실행한다. 그보다 먼저 별도 SHA-256으로 고정한 탐색 차단기를 Node의 `--require`로 불러, Node 기본 모듈과 격리 사본 안의 파일만 허용하고 상위 `/private/tmp/node_modules` 같은 외부 package 경로는 실행 전에 막는다. Node 자체도 permission mode에서 읽기·쓰기를 격리 인증 폴더 하나로 제한하고 child process 권한을 주지 않는다. WebSocket 선택 보조 package도 `WS_NO_BUFFER_UTIL=1`과 `WS_NO_UTF_8_VALIDATE=1`로 고정한다. HOME·XDG·임시 폴더와 0바이트 env file은 새 빈 폴더에 만들고 PATH는 `/usr/bin:/bin`으로 고정한다. `.env`·부모 환경·`NODE_OPTIONS`·저장된 OAuth·외부 extra·로그·사용량·오류 보고를 사용하지 않는다. token은 부모 env·argv·regular file에 넣지 않고 framed anonymous FD 3으로 허용된 작업 자식에만 전달한다. Wrangler를 실제 실행하는 최종 자식에서만 `CLOUDFLARE_API_TOKEN` 환경변수를 만든다. FD가 없거나 쓰기가 일부에서 실패하거나 자식 실행·종료가 실패하면 write FD를 닫고 `SIGTERM`, 필요하면 `SIGKILL`로 종료한 뒤 bounded `close` 확인을 마쳐야 격리 폴더를 정리한다. byte buffer는 0으로 덮는다. JavaScript 문자열은 언어 특성상 같은 방식으로 덮을 수 없으므로 열쇠를 담았던 반환 객체와 Wrangler 자식 환경 객체의 필드를 사용 직후 빈 문자열로 바꾸고 남은 참조를 즉시 버린다. service 존재 확인과 workers.dev 상태 확인은 token을 읽은 뒤 정책·계정 확인이 실패해도 `finally`에서 열쇠를 비운다. service 존재 확인, workers.dev 상태 확인, bootstrap, status-only bootstrap recovery는 새 runner에만 연결하고, 과거 읽기 전용 runner의 workers.dev 분기와 공개 `:fd` npm 명령은 제거했다. 복구 명령은 sealed Wrangler를 호출하지 않고 GET만 허용하며, bootstrap 생성 명령만 sealed Wrangler 자식을 정확히 한 번 호출한다. 사용을 마치면 사용자가 Cloudflare 화면에서 token을 폐기해야 한다.

  terminal local cleanup에는 새 코드를 만들지 않고 기존 PLAN-05 절차를 쓴다. Cloudflare UI에서 exact token 행을 한 번 삭제하고 새로고침 뒤 부재가 확인된 경우에만 고정 service `me.dwnc.cloudflare-staging-worker-control.v1`·account `dwnc:staging:workers-scripts-edit`의 `security delete-generic-password`를 정확히 한 번 실행한다. 이어 같은 identity를 `-w` 없이 presence-only로 조회해 exit 44를 확인하고 primary/recovery metadata와 immutable evidence는 보존한다. 원격 대상이나 삭제·부재가 모호하면 local delete는 0회다.

  deny-only 최초 생성 공개 진입점은 현재 staging만 허용한다. production 입력은 계정 번호·token·FD를 읽기 전에 `CLOUDFLARE_E_BOOTSTRAP_ENVIRONMENT`로 거부한다. production 최초 생성은 별도 최소 권한 runner·복구 계약·승인이 준비되기 전에는 사용할 수 없다.
