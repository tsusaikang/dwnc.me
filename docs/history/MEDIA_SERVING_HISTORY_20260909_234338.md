# 미디어 운영 이력

과거 배포·인증·감사와 정리 전 관측을 보존한 역사 자료다. 아래의 “현재”, “아직”, “다음”은 기록 당시 표현이며 현재 실행 지시가 아니다. 현재는 [공식 상태](../../PROJECT_STATE.md), 정책은 [미디어 계약](../MEDIA_SERVING_CONTRACT.md), 구현 상세는 [운영 참조](../MEDIA_OPERATIONS_REFERENCE_20260909_234338.md)를 따른다.

## 기존 계약의 날짜별 진행 이력

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


## 현재 계약에서 분리한 이전 기준선·실행 기록

credential 값은 저장소·manifest·receipt·로그에 기록하지 않는다. 2026-08-27 당시 uploader `dwnc-me-public-media-staging-uploader-v3-20260827`은 exact staging bucket Object Read & Write, validator `dwnc-me-public-media-staging-validator-v2-20260827`은 같은 exact bucket Object Read only로 제한했고 둘 다 Active·TTL 2026-09-03으로 관측됐다. uploader access-key ID·metadata SHA-256은 각각 `6a6df74afbbc4a47fe050b11997b41b6e5e7ba9d02884eb69bb9ac88d82bb976`·`6d92f8e095050757c407bf31a02e8358c4064e7b9852f44c98037de7f331721e`, validator는 `be4156f1e29c6282568d18e504d11888907e0df9c8f67a551318a839c735ee5a`·`03011557f3ae08f1128c10bd5df0508dc50e0bdbbc5652de08f63f05e142fe0c`다. 이는 현재 상태가 아닌 날짜가 고정된 역사 기록이다.

생성 실패 과정에서 비밀값 노출 가능성이 생긴 uploader v2는 즉시 revoked했다. 현재 확인된 상태는 이번 감사 validator 원격 폐기·목록 부재와 대응 Keychain 항목 부재, 기존 validator의 과거 Inactive 관측이다. uploader와 나머지 기존 원격 token의 정확한 현재 상태는 미확정이며 별도 확인 없이 삭제하지 않는다.

2026-08-28 계정 대상 시험을 보강하던 중 mock `store` 연결 한 곳이 빠져 기본 native spawn 경로가 사용됐다. `/usr/bin/security find-generic-password … -w` 실제 read command 1회가 확정됐고 second read 0, Keychain write/update 0, clipboard/network/Cloudflare 0이었다. 실제 account-target 초기화와 metadata 쓰기도 0이다. 이후 `Symbol.for('dwnc.cloudflare.account-target.native-spawn-guard.v1')` 전역 감시를 시험 시작부터 설치해 예기치 않은 native spawn을 즉시 실패시키도록 했고, account-target 610 assertions와 당시 전체 26 suites·15,024 assertions, 이번 전체 27 suites·15,076 assertions 재실행에서 추가 native spawn 0을 확인했다.

exact Wrangler `4.125.0`은 로컬 dependency와 lock에 설치·고정됐지만, 현재 실제 production receipt·signature·credential·trust fingerprint가 없으므로 위 production gate는 의도적으로 fail closed한다. 합성 Ed25519 fixture만 저장소 안에서 target 결속과 signature를 검증하며 실제 서명을 만들어 내지 않는다.

변경 전 readback은 `Build=None`, `Deploy=npx wrangler deploy`였고, 변경 후 raw live deploy 설정·실행은 0이다. 원격 admission 직전 private staging bucket은 객체 0, `r2.dev` 꺼짐, custom domain 0, jurisdiction `default`, location `APAC`, storage class `Standard`로 재확인했다. exact bucket 한정 uploader·validator는 Active이고 2026-08-25의 사용 불가능한 기존 두 token은 후속 정리 전까지 Active다. staging Worker `dwnc-me-staging`은 아직 없다. 최초 Worker가 부재한 환경에서는 `versions upload`로 bootstrap할 수 없으므로, route·custom domain·trigger·asset·binding 0인 deny-all service를 signed service-existence evidence·one-time authorization 아래 한 번만 만든다. 실제 `dwnc.me` 도메인과 DNS는 Cloudflare Worker에 연결되지 않았다.

- 가짜 API·가짜 Wrangler와 프로젝트 밖 임시 보호 폴더로 정상 완료, 비밀값 유입, 생성 도구 실패, 1MiB 초과 출력, 생성 뒤 설정 불일치, entrypoint 불일치, 모든 고정 출력 충돌, Git dirty·중간 변경·허가 만료, 임시 파일 닫기·삭제 실패를 끝까지 시험했다. 이 절차를 처음 완성했을 당시의 중간 점검에서는 로컬 모의 전체 Cloudflare 시험 23개·5,689개 확인이 통과했고, 이 중 최초 생성 검증·실행 코어 시험은 4,126개였다. 실행 코어 시험은 가짜 API 85회·가짜 Wrangler 8회를 사용했으며 실제 network·Cloudflare 변경·배포는 0회였다. 이후 인증 전달 기반까지 포함한 현재 전체 수치는 아래 기록과 프로젝트 상태 문서의 최신 점검 결과를 따른다.
- 생성 명령이 성공한 뒤 결과 기록 전에 작업이 끊기는 상황의 status-only 복구를 로컬에 완성했다. `cloudflare:staging:service:bootstrap:recover`는 같은 생성 명령·Wrangler·whoami를 다시 실행하지 않는다. 인증은 정확한 계정의 `/tokens/verify`와 `/workers/subdomain` GET 각 1회로만 하고, 이 2회를 현재 Worker 상태 A/B GET과 분리해 최종 기록에 계수한다. 부모의 로컬 확인 뒤 다른 실행이 상태 기록을 먼저 완성한 경우에도, 이번 부모의 인증 GET 2회·이번 자식의 상태 GET 0회·기록에 남은 과거 총 요청 수를 서로 섞지 않는다. 자식은 `기존 기록인지·기록된 총 요청 수·이번 자식의 상태 요청 수`만 4KiB 이하 한 줄 canonical JSON으로 반환하고 부모가 형식과 상태 기록 일치를 다시 확인한다. 준비 기록은 있으나 시작 기록이 없고 두 번 모두 Worker가 없으면 `never-started`, 시작 기록 뒤 두 번 모두 없으면 `absent-after-start`, 시작 기록 뒤 exact deny code·설정·subdomain·workers.dev 비활성·단일 version·단일 deployment 100%가 두 번 같으면 `exact-recovered`다. 원래 결과 기록에 version ID가 있으면 두 조회의 version과도 같아야 한다. 여러 version/deployment, 분할 적용, 조회 변화, 기록·시각 손상, 시작 기록 없이 Worker가 존재하는 경우는 `ambiguous`로 기존 자료를 보존하고 중단한다. deploy 가능한 version 목록은 `page=1..10`, `per_page=50`의 고정 범위에서 모든 쪽의 `result_info`와 전체 수·중복·변화를 검사해 전체가 정확히 하나임을 증명한다. 500개는 10쪽을 모두 읽고 단일 version 조건 위반으로 처리하며, 501개·11쪽·중복·쪽 사이 전체 수 변화는 경계에서 거부한다. 첫 상태 기록이 미완성일 때만 고정 recovery 파일 한 곳을 쓰며, 그 위치는 운영체제가 알려 주는 현재 사용자의 홈 폴더로만 계산하고 인수·환경변수·일반 호출 옵션으로 바꾸지 못한다. 완성된 primary 또는 `부분 primary + 완성 recovery` 기록은 서명 자료·단계 hash chain·시간 순서·현재 Git·분류를 다시 계산한 뒤 Keychain·token 검증·whoami·작업 자식·API를 모두 0회로 유지한다. 원래 생성 runner의 metadata/preflight/permission 확인값은 준비 기록에 고정하고, 지금 복구 runner의 세 확인값은 상태 기록에 별도로 고정하므로 같은 최소 권한의 새 짧은 수명 token으로 복구할 수 있다. 정확한 대상 계정 한 곳에만 유효한 짧은 수명 Account API token 전달 도구의 로컬 바탕도 완성했다. Cloudflare 화면에서 공식 API 권한명 [`Workers Scripts Write`](https://developers.cloudflare.com/fundamentals/api/reference/permissions/), 사용자 화면에서는 `계정 > Workers Scripts > Edit` 한 가지만 선택해야 한다. Cloudflare API는 이 최소 권한 밖의 권한이 없는지 token 확인 응답으로 알려 주지 않으므로, 생성 직전 화면의 권한 요약을 확인하는 것이 실제 최소 권한 확인 근거다. User Details 권한은 추가하지 않는다.

이 구현은 commit `4467a7e468a6aa72f3f26c4e12e9ce3b8d5c9779`·tree `9c6505ef46393b139c923ad5a43f0605c4b14611`에 기록됐고 stdin 112·account-target 698·diff 검사 PASS, 독립 지적 0, push 0이다. 다만 자체 브라우저 virtual clipboard는 Mac 시스템 clipboard와 공유가 보장되지 않으며 비민감 1회 probe도 browser write 1·macOS read 1·match false·system clipboard write 0이었다. 비민감 Terminal 시험은 receiver `READY` 뒤 Computer Use가 `com.apple.Terminal`로 값을 전달하기 전에 정책으로 차단해 local paste·receiver input 0, receiverStopped·echoRestored true였고 브라우저 시험 clipboard를 비웠다. 재시도·대체 앱 우회는 하지 않는다.

전용 staging 시험 179 assertions와 인터넷·외부 프로그램 차단 보강 전 전체 Cloudflare 27 suites·15,076 assertions가 통과했다. 고정된 프로그램 원본 157개·SHA-256 `b67874a204d71b05da4678847c7bf56acce2a3ee5eb5ce532f6a3ee77cfad9db`에서 마지막 R2 전량 예행연습을 2026-08-28 19:14:54.924 KST에 완료했고, 전량 194 assertions·차단 경계 152 assertions·영향 범위 829 assertions를 통과했다. 실행 전후 source SHA-256은 같았다. 금지 경로는 원래 호출 전에 차단됐고 외부 Cloudflare·R2·보관함·클립보드 작업은 수행하지 않았다. 이번 변경은 로컬 파일 12개의 commit 전 상태이고 push는 0이다.

version upload·상세 확인·deployment 상태·activation·workers.dev enable은 허용된 이름으로만 등록했으나 기존 로컬 검증을 새 credential helper에 안전하게 연결하기 전에는 token 읽기·API·Wrangler 0회로 중단한다. 실제 token 생성·Keychain·clipboard·Cloudflare 검증은 아직 0회이며,

최초 생성 절차의 로컬 안전장치는 다음과 같이 보강했다. 이는 아직 Cloudflare에 Worker를 만든 것이 아니라, 실제 실행 전에 잘못된 대상을 걸러 내는 검사 규칙을 완성한 것이다.

현재 Git working tree의 결정적 manifest는 `src/data/public-media-r2-v1.json`이다. 아래 첫 표는 2026-08-25의 **정리 전 역사 기준선**이고, 둘째 표는 2026-08-27 전수 검증을 통과한 **현재 최종 기준선**이다. 역사 수치 2,889개를 현재 업로드 대상으로 사용하지 않는다.

| 항목 | tracked pre-curation 기준선 |
|---|---:|
| 객체 | 2,889 |
| 총 바이트 | 2,350,053,092 |
| manifest SHA-256 | `5b9eb93474c0e96b3b371d233b4ea64cc24918a31d0fb754410c968544c2b165` |



사용자는 B를 선택했다. 지도 공급자 자산 99개는 자산 집합에서 빼고 영향 글 5개의 장소 카드 16개(원 장소 네이버지도 링크 15, 네이버지도 검색 링크 1)로 대체했다. LINE 스티커 5개와 1×1 placeholder 27개는 제외했다. placeholder를 빼도 재생 불가 안내·재생시간 53개와 작성자 캡션 23개는 남고, placeholder를 cover로 쓰던 13개 글의 파생 cover는 `null`이다. 사용자가 직접 제작한 SBS GIF `/media/naver/221172590451/001-e467d08a3a01.gif`는 1,299,862바이트·SHA-256 `e467d08a3a01bf5bcc53c79f2a40e89d0181a8c920e08b62a1a513c3d93656d9`를 그대로 포함했다.

- DWNC-CORE-011에서 사용자가 기존 비공개247편의 본문·사진을 관리자 전용 운영 저장소로 신규 이전하도록 승인했다. 원본은 로컬 보존하고 본문에서 참조하는 CSS 배경을 포함한 사진2726개와 로컬영상5개만 새 opaque UUID key로 저장한다. 기존 공개 manifest/객체/글/작업본은 바꾸지 않는다. 글·private정책·미디어소유 행은 한 원자적 신규삽입 묶음으로 넣는다. 제목·본문·ID목록·개별원본경로는 로그/Git/공개빌드에 기록하지 않는다.
- 비공개 원본 SVG/ICO/MP4는 기존 이미지 업로드 규칙과 별도의 imported 허용경로로 제공한다. 인증된 관리자만 비공개 소유파일을 읽으며 일반 방문자 요청은 사진·본문 모두 차단한다. SVG 응답에는 실행/외부요청을 막는 CSP sandbox를 적용하고 MP4는 단일 byte Range 재생을 지원한다. 기존 R2 key를 덮어쓰거나 삭제하지 않으며 신규 저장은 조건부 PUT과 SHA/크기/MIME 일치로 확인한다. CORE-011은247편/2731미디어의 운영 이전과 관리자 목록·본문·사진 표시 및 공개 접근 차단 확인을 완료했다. 실제 결과는 PROJECT_STATE.md 최신 기록을 따른다. 향후 CSS 배경전용 미디어를 공개 전환하는 범위에는 공개전환 참조 수집 보완이 필요하며 이번 이전에서는 공개 전환을 실행하지 않는다.

- DWNC-CORE-010 클립보드 이미지 붙여넣기는 기존 사진 첨부와 동일한 업로드·소유 기록·새 key 생성·공개 참조 규칙을 사용한다. HTML 소스 변환 자체는 이미지를 가져오거나 업로드하지 않으며, 변환에 포함된 이미지 태그는 제외한다.

- 2026-09-08 DWNC-CORE-006 운영 보완: 공개 정책을 본문과 같은 snapshot으로 확인하며 비공개·예약 전·미인증 보호 글은 canonical/alias/목록/검색/피드와 사진 모두 공개하지 않는다. 기존 imported media 소유 및 공유 참조와 native 소유를 각각 검사하고 정적 fallback보다 먼저 제한한다. 응답은 no-store로 전환하되 과거 브라우저 사본 회수는 약속하지 않는다. 페이지도 같은 글별 사진 소유 규칙을 따른다. 새 아이콘은 `media/site/{UUID}`의 별도 소유 기록과 설정 참조가 확인된 경우에만 공개하며 기존 R2 객체를 덮어쓰거나 삭제하지 않는다. 이 보완은 최종 소스의 새 빌드로 운영 반영을 완료했다.



- 2026-09-07 작업본 CMS는 `editor_working_copies`에만 자동저장하고 기존 공개 테이블을 명시적 공개 반영 때만 갱신한다. 따라서 작업본에 새로 참조한 이미지는 아직 공개하지 않고, 작업본에서 참조를 지운 기존 공개 이미지도 공개 반영 전까지 유지한다. 공개 Worker의 기존 참조 검사는 변경하지 않는다. 사용자 승인 후 빈 작업본 테이블과 관리자 버전을 운영에 적용했으며 공개 Worker·기존 글·R2 객체는 바꾸지 않았다.

## README의 이전 공개 이전 기준선

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


## 2026-08-24 초기 블로그 이전 계획 원문

# 블로그 이전 계획

## 핵심 원칙

이 프로젝트의 목표는 화면을 복제하는 것이 아니라 기록의 소유권과 수명을 되찾는 것이다. 플랫폼별 HTML은 표시용으로 정리하되, 원문과 출처는 별도로 보존한다.

```text
플랫폼 원문 → 변경 불가 원본 스냅샷 → 정규화 본문 → 새 사이트
            ↘ 주소·공개범위·미디어 해시 대응표 ↗
```

## 주소 정책

| 출처 | 기존 주소 | 새 주소 | 정책 |
|---|---|---|---|
| 티스토리 | `https://dwnc.me/{sourceId}` | `/posts/{globalSequence}` | 기존 숫자 주소는 exact alias |
| 네이버 | 소유자 글 주소 | `/posts/{globalSequence}` | 기존 `/naver/{sourceId}`는 exact alias |
| 새 글 | 없음 | `/posts/{globalSequence}` | append-only 최대값 + 1 |

최초 공개·비공개 596건이 같은 전역 순번 공간을 사용한다. 비공개가 예약한 순번은 공개 route로 만들지 않고, 삭제·취소 gap도 재사용하지 않는다. 전체 보안 원장과 공개 projection의 상세 계약은 `docs/URL_CONTRACT.md`를 따른다.

## 공개 범위 정책

- `전체공개`만 공개 빌드 후보가 된다.
- `비공개`, `이웃공개`, `서로이웃공개`는 로컬 보존 영역에만 둔다.
- 공개 전환은 글 단위의 명시적 승인 기록이 있을 때만 가능하다.
- 공유·스크랩 글은 본문 복제를 기본값으로 하지 않고 출처 링크형 기록을 우선한다.

## 데이터 계층

1. `migration/raw/`: 내려받은 원문 HTML과 응답 메타데이터. Git 비추적.
2. `migration/source-inventory/`: 글·미디어·주소·해시 목록. 검증 가능한 기준표.
3. `src/data/posts/`: 새 사이트에서 표시할 정규화 콘텐츠.
4. `public/media/`: 표시용으로 복사한 자체 보관 미디어.

대용량 미디어는 로컬 빌드에는 포함하되 Git에는 넣지 않는다. 운영 환경에서는 정적 호스팅 한도와 비용을 비교한 뒤 객체 저장소 분리 여부를 결정한다.

## 외부 콘텐츠 정책

- 작성자가 직접 올린 사진은 로컬로 보존하고 원주소와 해시를 기록한다.
- `dwnc.me` 내부 글 링크 카드의 썸네일은 선택적 자산으로 취급한다. 원본 서버에서 사라졌다면 실패를 숨기지 않고 `미리보기 없음`으로 표시한다.
- 외부 기사·상품·서비스 링크 카드의 썸네일은 복제하지 않고 링크·제목·설명·호스트만 보존한다.
- 티스토리 지도 프록시는 새 도메인에서 유지할 수 없으므로 정적 지도 이미지와 장소 설명으로 변환한다.
- YouTube 등 외부 영상은 출처 URL과 화면 비율을 유지한 임베드로 남긴다.

## 검증

- 글 수와 고유 원본 ID가 원본 목록과 일치해야 한다.
- 제목, 게시일, 공개 범위, 카테고리, 원주소가 누락되면 빌드를 실패시킨다.
- 이미지 원주소별로 내려받기 성공 여부와 SHA-256을 기록한다.
- 외부 임베드, 지도, 동영상, 첨부파일은 별도 QA 목록을 만든다.
- canonical `/posts/{globalSequence}` 공개 349개와 legacy alias 349개를 전수 검증하고 alias는 검색·RSS·sitemap에서 제외한다.
- 모바일과 데스크톱에서 대표 글을 시각 검증한다.

## 진행 현황 — 2026-08-24

| 단계 | 상태 | 결과 |
|---|---|---|
| 티스토리 글 인벤토리 | 완료 | 164/164 |
| 티스토리 본문 이전 | 완료 | 164/164 |
| 티스토리 미디어 이전 | 완료 | 814개, 164/164 글 검증 |
| 전역 순번·통합 정적 빌드 | 완료 | 원장 596, 공개 349, alias 349, HTML 1,404 |
| 네이버 소유 글 인벤토리 | 완료 | 432개: 전체공개 185, 비공개 247 |
| 네이버 본문·미디어 이전 | 완료 | 공개 185 + 비공개 로컬 247, 전수 검증 |
| 배포·DNS 전환 | 미승인 | 수행하지 않음 |
