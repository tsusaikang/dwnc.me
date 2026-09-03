# dwnc.me 요구사항과 진행 현황

최종 갱신: 2026-09-03 KST

이 문서는 사용자가 최종 목표, 전체 계획, 현재 위치와 다음 작업을 빠르게 확인하는 공식 기록이다. 자세한 작업 기록은 [`PROJECT_STATE.md`](../PROJECT_STATE.md), 사진을 안전하게 제공하는 기술 규칙은 [`MEDIA_SERVING_CONTRACT.md`](MEDIA_SERVING_CONTRACT.md)에 둔다. 문서끼리 내용이 다르면 실제 파일과 검사 결과, Cloudflare에서 다시 확인한 설정을 기준으로 함께 바로잡는다.

<!-- requirements-policy: recent-complete-limit=12 -->

완료된 요구사항은 최근 12개까지만 이 문서에 둔다. 그보다 오래된 항목은 [`REQUIREMENTS_ARCHIVE.md`](REQUIREMENTS_ARCHIVE.md)로 옮기되 요구사항 번호, 완료 조건, 확인 근거와 날짜를 지우거나 다시 사용하지 않는다.

## 한눈에 보는 진행 상황

### 최종 결과

이 프로젝트의 최종 목표는 티스토리와 네이버에 있던 사용자의 글과 사진을 안전하게 보존하면서, 특정 블로그 서비스에 묶이지 않고 직접 운영할 수 있는 `dwnc.me` 블로그를 완성하는 것이다.

완성된 상태에는 다음 내용이 포함된다.

- 티스토리 공개 글 164개와 네이버 공개 글 185개를 새 사이트에서 제공한다. 네이버 비공개 글 247개는 공개하지 않고 별도 로컬 보존 영역에 둔다.
- 원문과 사진의 출처·크기·내용 확인값을 보존해 이전 과정에서 빠지거나 바뀐 자료가 없는지 확인할 수 있게 한다.
- 공개 글 349개를 독립 사이트의 새 주소로 제공하고, 예전 티스토리·네이버 주소 349개도 올바른 새 글로 이어지게 한다.
- 큰 사진 파일은 Cloudflare의 비공개 저장소(R2)에 두고, 사이트 프로그램(Worker)을 통해서만 안전하게 보여 준다.
- 시험용 주소에서 글, 예전 주소 349개, 사진 표시와 부분 전송을 모두 확인한 뒤 운영용 구성을 준비한다.
- 실제 `dwnc.me` 주소 연결은 사용자의 별도 결정 후 진행한다. 연결을 결정하면 실제 주소에서 글·예전 주소·사진·모바일과 데스크톱 화면을 다시 확인해야 전체 운영 전환이 끝난다.

현재 콘텐츠 보존과 독립 사이트의 로컬 구현은 완료됐지만 Cloudflare의 파일 내용 전수 확인, 시험용 사이트 프로그램, 실제 도메인 연결과 운영 전환 검증은 아직 남아 있다. 따라서 **사이트 전체가 이미 운영 중이라고 표현하지 않는다.** 근거는 [`PROJECT_STATE.md`](../PROJECT_STATE.md), [`MEDIA_SERVING_CONTRACT.md`](MEDIA_SERVING_CONTRACT.md), [`URL_CONTRACT.md`](URL_CONTRACT.md)에 나누어 기록한다.

### 전체 계획

| 계획 ID | 목적과 주요 작업 | 완료 기준 | 현재 상태 |
|---|---|---|---|
| `PLAN-00` | 실행 단계가 아닌 경량 기록 원칙으로 목표와 현재 위치를 관리한다. | 최종 결과·완료조건·범위·순서·승인 범위가 실제로 달라질 때만 요구사항과 상태를 갱신하고, 단순 질문·설명·기존 작업 진행 지시에는 새 번호를 만들지 않는다. | `계속 적용` |
| `PLAN-01` | 두 원본 블로그의 글과 자료 범위를 확인하고 원본을 보존한다. | 티스토리 공개 164개, 네이버 직접 작성 432개의 원본과 공개 범위를 확인한다. | `완료` |
| `PLAN-02` | 공개 글과 비공개 글을 분리해 새 사이트용 내용으로 바꾼다. | 공개 349개가 새 사이트에 들어가고 비공개 247개가 공개 영역 밖에 남는다. | `완료` |
| `PLAN-03` | 독립 사이트와 주소 체계를 만든다. | 공개 글 349개, 예전 주소 349개, 검색·분류·RSS·사이트맵과 모바일·데스크톱 화면 검사를 통과한다. | `완료` |
| `PLAN-04` | 공개할 미디어를 정리하고 최종 목록을 확정한다. | 사용자 소유 사진 2,757개와 직접 제작 GIF 1개를 확정하고 제외·대체 결정을 반영한다. | `완료` |
| `PLAN-05` | 시험용 저장소의 실제 파일 내용을 한 번 전수 확인하고 작업용 열쇠를 정리한다. | 올바른 계정 확인, `Account ID` 한 번 복사·전용 보관, 저장소 비공개 확인, 2,758개 실제 내용·전체 용량 비교, 작업용·사용 불가능한 활성 열쇠 정리를 마치며 덮어쓰기·삭제가 없다. | `진행 중` |
| `PLAN-06` | 실제 도메인과 연결되지 않은 시험용 사이트를 올려 최종 동작을 확인한다. | 사이트 프로그램이 없을 때만 최소 차단용 프로그램을 만들고, 확정된 Git 기록의 빌드·검사 한 묶음과 새 버전만 올려 시험용으로 적용한 뒤 대표 페이지, 예전 주소 GET·HEAD 698회와 사진 응답을 확인하고 정확한 Git SHA와 버전 번호를 기록한다. | `대기` |
| `PLAN-07` | 시험용 확인 뒤 최종 운영에 실제 필요한 Cloudflare 자원만 준비한다. | 시험용에서 통과한 절차로 필요한 저장소와 사이트 버전만 준비하고, 새 보조 도구·모의훈련·반복 검증은 추가하지 않는다. 실제 `dwnc.me` 주소가 새 사이트를 가리키도록 연결하지 않는다. | `대기` |
| `PLAN-08` | 실제 `dwnc.me` 주소를 연결하고 운영 전환을 확인한다. | 사용자 결정 후 실제 `dwnc.me` 주소가 새 사이트를 가리키도록 연결하고 실제 주소의 글·예전 주소·사진·화면을 다시 검사한다. | `사용자 결정 필요` |
| `PLAN-09` | 최종 운영에 필요한 새 글 작성 방식과 비공개 백업 방식을 정한다. | 새 글 작성과 비공개 백업·복구 방식을 정한다. 공유 글 10개, 댓글과 추가 개선은 사용자가 원할 때 진행하는 후속 선택으로 두며 Stage 3를 막지 않는다. | `사용자 결정 필요` |

### 현재 위치

**진행 중인 계획은 `PLAN-05` 하나다.** 현재 실행은 중단 상태다. 공개 미디어 2,758개 업로드와 업로드 뒤 목록·크기·저장정보 확인은 끝났고, Codex 자체 브라우저의 Cloudflare 계정도 이 프로젝트 확인값과 일치한다. 그러나 localhost 전달은 실패했고, 비민감 clipboard probe도 browser write 1·macOS read 1·match false·system clipboard write 0이었다. 설치 구현의 자체 브라우저는 시스템 공유가 보장되지 않는 virtual clipboard를 쓴다. secure non-echo stdin receiver는 commit `4467a7e468a6aa72f3f26c4e12e9ce3b8d5c9779`·tree `9c6505ef46393b139c923ad5a43f0605c4b14611`에 구현했고 stdin 112·account-target 698·diff 검사 PASS, 독립 지적 0, push 0이다. 하지만 비민감 Terminal 시험은 receiver `READY` 뒤 Computer Use가 `com.apple.Terminal`로 값을 넘기기 전에 안전 정책으로 차단됐다. local paste·receiver input은 0, receiverStopped·echoRestored는 true였고 브라우저 시험 clipboard는 비웠으며 재시도·대체 앱 우회는 0이었다. 이번 stdin/Terminal 경로의 Account ID copy·read·paste·initialize는 모두 0회다. 앞선 localhost 경로의 누계는 browser memory 처리·client send 시도 1회, host accepted·success 0회이며 Keychain·metadata 작성은 전체 0회다. Cloudflare·R2·API·full audit도 0회다. 현재 지원되는 자동 전달 경로가 없으며 저장소 비공개 상태와 실제 파일 2,758개 내용 전수 비교는 아직 하지 않았다.

사용자에게 이는 **파일 목록은 맞지만 실제 저장된 내용까지 원본과 같은지는 아직 마지막 확인이 남았다는 뜻**이다. 이미 충분히 확인한 로컬 안전장치는 더 확장하지 않는다. 다음에는 실제 저장소 확인과 시험용 사이트 프로그램 점검으로 진행하고, 실제 실행에서 완료를 막는 문제가 발견될 때만 그 문제를 해결하는 최소 수정과 관련 검사 한 묶음을 수행한다.

### 미디어 정리 결과

플랫폼에서 자동으로 붙인 것으로 보이는 이미지 후보 132개를 모두 살펴보고 다음처럼 정리했다.

| 묶음 | 수량 | 현재 결정 | 다음 확인 |
|---|---:|---|---|
| 네이버·카카오 지도 이미지와 표시 요소 | 99 | 제외·대체 완료 | 영향받은 글 5개에는 장소 카드 16개를 넣었다. 15개는 원래 장소 링크, 주소를 확인할 수 없던 1개는 네이버지도 검색 링크이며 컴퓨터와 휴대전화 화면에서 확인했다. |
| LINE 스티커 | 5 | 제외·빈 공간 정리 완료 | 스티커와 연결 주소를 빼되 본문 글자는 유지했다. 제거 뒤 두 글에 생긴 큰 빈 공간도 정리했다. |
| 화면에 보이지 않는 1×1 크기 빈 이미지 | 27 | 사용자의 B 선택에 따라 제외 완료 | 영상 재생 불가 안내 53개, 재생시간 53개와 작성자 설명 23개는 그대로 남겼다. 이 빈 이미지를 대표 이미지로 쓰던 글 13개는 대표 이미지 없음으로 처리했다. |
| 사용자가 직접 만든 SBS 수영 방송 화면 GIF | 1 | 포함 | 본문과 대표 이미지에서 컴퓨터·휴대전화 모두 정상 표시되는 것을 확인했다. |

사용자가 소유를 확인한 사진 2,757개와 직접 만든 SBS GIF 1개, 총 2,758개가 최종 공개 대상이다. 지도 99개는 장소 카드와 네이버지도 링크로 바꾸었고 LINE 스티커 5개와 화면에 보이지 않는 빈 이미지 27개는 제외했다.

### 아직 결정할 일과 진행을 막는 조건

1. 현재 제품이 허용하는 자체 브라우저→Mac 자동 전달 경로가 없다. localhost 재시도나 대체 앱 우회 없이 중단하며, 안전한 로컬 receiver target이 제품에서 허용되거나 사용자가 원문을 도구 출력 없이 non-echo receiver에 직접 입력하는 명시적 handoff가 있을 때만 재개한다.
2. 계정 번호 보관이 끝나면 저장소가 외부에 공개되지 않았는지 읽기만 해서 확인하고 실제 파일 2,758개를 전수 비교해야 한다.
3. 파일을 방문자에게 보여 줄 시험용 사이트 프로그램은 아직 만들지 않았다. 실제 파일 내용 전수 비교를 마친 뒤, 프로그램이 없을 때만 최소 차단용 프로그램을 한 번 만든다.
4. 새 글 작성 방식과 비공개 자료의 백업·복구 방식은 최종 운영 전에 결정해야 한다. 공유·스크랩 글 10개, 과거 댓글과 추가 개선은 사용자가 원할 때 정하는 후속 선택이며 Stage 3를 막지 않는다.

### 바로 다음 작업

1. 제품이 허용하는 안전한 로컬 receiver target이 생기거나 사용자가 계정 번호 원문을 도구 출력 없이 준비된 non-echo receiver에 직접 입력하겠다는 명시적 handoff를 제공할 때만 `PLAN-05`를 재개한다. 전달이 성공한 경우에만 저장소 비공개 상태를 읽기만 해서 확인하고, 실제 파일 2,758개를 한 번 전수 비교한 뒤 이번 작업에 쓴 짧은 수명 열쇠와 사용 불가능한 기존 활성 열쇠를 정리한다.
2. 전수 비교가 통과하면 시험용 사이트 프로그램이 없는 경우에만 최소 차단용 프로그램을 만들고, 확정된 Git 기록 기준 빌드·검사 한 묶음과 새 버전만 올려 시험용으로 적용한다. 대표 정적 페이지, 예전 주소 GET·HEAD 698회, 사진의 일반 요청·머리정보 요청·변경 없음 응답·부분 전송·범위를 벗어난 요청을 확인하고 정확한 Git SHA와 버전 번호를 기록한다.
3. 시험용 확인이 통과하면 최종 운영에 실제 필요한 Cloudflare 자원만 같은 방식으로 준비한다. 새 보조 도구·복구 체계·서명 체계·영수증 체계·장애주입·모의훈련·반복 독립검토는 추가하지 않으며, 실제 `dwnc.me` 주소가 새 사이트를 가리키도록 연결하지 않는다.

현재는 지원되는 자동 전달 경로가 없어 `PLAN-05`를 중단한 상태다. localhost 재시도와 대체 앱 우회는 하지 않는다. Chrome과 Edge는 사용하지 않고, 실제 `dwnc.me` 주소 연결은 `PLAN-08`에서 사용자가 결정할 때만 진행한다.

### 최근 완료

- 올바른 Cloudflare 계정에서 파일 저장 기능을 활성화하고 외부에 공개되지 않는 시험용 저장소를 만들었다.
- 시험용 저장소에만 접근할 수 있는 업로드용 열쇠와 읽기 전용 열쇠를 따로 만들었다. 노출될 가능성이 생긴 실패 열쇠는 즉시 폐기했다.
- 검토 대상 132개를 지도 99개, 스티커 5개, 빈 이미지 27개, 사용자가 만든 GIF 1개로 분류했다.
- 지도 99개를 장소 카드 16개로 바꾸고 원래 장소 링크 15개와 검색 링크 1개를 컴퓨터와 휴대전화 화면에서 확인했다.
- 사용자의 B 선택에 따라 빈 이미지 27개를 제외하면서 영상 안내와 작성자 설명은 유지했다.
- 최종 공개 대상 2,758개가 로컬 원본, 사이트 화면과 파일 목록에서 서로 맞는지 확인했다.
- Cloudflare의 자동 작업은 실제 사이트를 바로 바꾸지 않고 새 버전만 올리도록 고쳤다.
- 시험용 배포 결과를 확인하는 전용 서명 열쇠를 안전한 macOS 보관소에 두고 외부 파일로 내보내지 않았다.
- 먼저 대표 파일 1개를 저장하고 실제 내용을 다시 내려받아 원본과 같은지 확인했다.
- 시험용 사이트 프로그램 최초 생성이 중간에 끊겨도 생성 명령을 반복하지 않고 현재 상태만 두 번 읽어 결과를 판정하는 복구 장치를 만들었다.
- 시험용 R2 저장소에 남아 있던 2,757개를 추가해 최종 2,758개 업로드를 마쳤다. 업로드 뒤 목록·크기·저장정보를 확인한 결과 빠진 항목과 불필요한 항목은 0개였고 덮어쓰기와 삭제도 0회였다. 실제 파일 내용 전수 비교는 남아 있다.
- 전달 과정이 안전하지 않았던 읽기 전용 열쇠 두 개를 Cloudflare 정보 조회 전에 폐기했다. 두 시도의 정보 조회와 결과 파일 생성은 모두 0회였다.

### 이번 작업에서 하지 않는 것

- 실제 `dwnc.me` 주소가 가리키는 곳과 주소 연결 설정을 바꾸는 일
- 정해진 안전 확인 절차를 건너뛰고 사이트를 직접 배포하는 일
- 기존 파일이나 Cloudflare 저장소의 파일을 덮어쓰거나 삭제하는 일
- Git push
- 계정 열쇠, 비밀 서명값, Cloudflare 계정 원본 번호, 비공개 콘텐츠나 개인정보를 문서 또는 작업 기록에 남기는 일

### 새 요청 반영 방법

1. 최종 결과, 명시적 완료조건, 범위, 실행 순서 또는 승인 범위가 실제로 달라질 때만 `DWNC-...` 요구사항 번호와 관련 `PLAN-..` 계획 ID, 우선순위, 완료 기준, 상태와 근거를 갱신한다.
2. 단순 질문, 설명 요청, 진행 확인과 이미 기록된 작업을 계속하라는 지시는 새 요구사항 번호를 만들지 않는다.
3. 실제 계획이 달라진 경우에만 `현재 위치`와 `바로 다음 작업`을 같은 변경에서 고친다. 대화 내용만 공식 상태로 삼지 않고 이 문서와 `PROJECT_STATE.md`를 기준으로 한다.
4. 완료 항목은 최근 12개까지만 두고, 오래된 완료 기록은 [`REQUIREMENTS_ARCHIVE.md`](REQUIREMENTS_ARCHIVE.md)로 옮긴다.

### 기술 참고

- 이번 계획 개편 시작 기준은 commit `ea751484ff8e6054f2ecab405b00f430c1e8aa3f`·tree `223c41242cfec01018e144d8bd35e9d592e90fe9`이며 시작 당시 파일 상태는 깨끗했다. 미래 커밋 번호는 미리 정하지 않는다.
- commit `fb693f3bbbab0e88b205f9de944646057bdd49ea`·tree `5e7169ca35a61a077265c98f6819fa28ccc5126d`·parent `d0b4a6c68c8a51b3211c97e320c5d7ea0310f437`와 12개 파일 `+1,990/-42`, 변경 파일 집합 확인값 `94fb0e5a8c2e67def5f4b1460431170eaae5f9505f78c7d900bea9446ead8374`는 2026-08-28 전량 예행연습의 역사적 기준점이다. 당시 push는 0회였다.
- 계정 번호 분리 변경 전 로컬 기준은 commit `0653361530dd15e67bd4b467ecff2ea63399a243`, tree `932a086915c12cf123887801594569b22a579ba8`이며 Git push는 하지 않았다.
- 플랫폼 이미지 후보 132개는 현재 목록의 경로·크기·파일 종류·내용 확인값과 일치했고, 같은 내용을 하나로 세면 65개다.
- 최종 미디어 목록은 2,758개·2,346,220,246바이트이고 목록 SHA-256은 `61bb577d609f97cdb014ef3a14681045fbb3bec616f2b04c8d058519b640c532`, 파일별 key·크기·내용 확인값 집합 SHA-256은 `9345d2f06c8bd7cda457a9d4335cdc2213e71dcd30bb9e11e6f3e1f8e11ae467`다.
- SBS GIF 경로는 `/media/naver/221172590451/001-e467d08a3a01.gif`, 크기는 1,299,862바이트, SHA-256은 `e467d08a3a01bf5bcc53c79f2a40e89d0181a8c920e08b62a1a513c3d93656d9`다.
- 일괄 업로드 기록 SHA-256은 `2974384ff720326830f5f3dcd9e2439dc56af4ec96c813bade88a2d0b7815444`, 업로드 뒤 전수 목록 확인 기록 SHA-256은 `f562129e14a65918bfebac26de313ff5e461ad3067774f9084a0e0514def0d84`다. 이 값은 결과 파일이 나중에 바뀌지 않았는지 확인하는 긴 확인 번호다.
- 업로드는 기존 1개를 그대로 두고 빠진 2,757개만 새로 만들었다. 최종 확인은 exact 2,758·missing 0·mismatch 0·orphan 0, overwrite 0·delete 0이다.
- 실제 감사 진입점의 마지막 인터넷 없는 전량 시험은 고정된 프로그램 원본 157개·SHA-256 `b67874a204d71b05da4678847c7bf56acce2a3ee5eb5ce532f6a3ee77cfad9db`에서 2026-08-28 19:14:54.924 KST에 완료됐다. 로컬 원본 2,758개·약 2.35GB로 목록 3회와 각 파일 정보·내용 1회씩, 모두 5,519회 읽기를 확인했다. 파일 추가·변경·삭제·재시도는 0회였고 전량 시험 194개·차단 경계 152개·영향 범위 829개 확인을 통과했다. 실행 전후 프로그램 원본 확인값도 같았다. 이 예행연습은 실제 Cloudflare 파일을 읽은 결과가 아니다.
- 아직 남은 `full GET/SHA-256` 검사는 실제 저장소의 파일 내용을 모두 다시 내려받아 로컬 원본과 한 개씩 비교하는 절차다.
- 계정 번호 전용 사전검사·보관·복구 시험 610개, 읽기 전용 열쇠 전달 시험 81개와 시험용 Worker 관리 열쇠 시험 378개를 통과했다. 인터넷·외부 프로그램 차단 보강 전 전체 Cloudflare 회귀시험은 27개 묶음·15,076개 확인을 통과했고, 현재 원본으로 R2 전량 예행연습 194개·차단 경계 전용 152개·영향 범위 829개 확인을 통과했다. 금지 시도 24종은 원래 연결·실행 함수 전에 차단됐고, 성공 경로에서는 읽기 전용 Git 15회와 격리된 파일 도우미 5회만 허용됐다. 개발 중 가짜 연결 누락으로 Mac 보관함 읽기 명령이 실제 1회 실행됐지만 두 번째 읽기·저장·변경·클립보드·Cloudflare·R2 접근은 0회였고, 감시 보강 뒤 추가 실제 시스템 프로그램 실행은 0회였다.
- 자체 브라우저에서 받은 계정 번호를 별도 일반 출력이나 프로젝트 파일에 남기지 않고 메모리 통로로 넘기는 변경은 commit `b66798ff3ad7907e3fd43bdcb62328f2319cf5fe`에서 계정 검사 698개를 통과했다. 한 번만 여는 연결은 commit `bb0a250344d3c2f8d991b73bab11e2fd3a281833`·tree `edb439b2bfb33cf9940a07c9883c057f40191f6c`에서 연결 검사 212개와 계정 검사 698개를 통과했다. 60초 변경은 commit `5a49c79fbd1e4d76d22fe736f6d22940aa6c856e`·tree `f246b062473f5544d3ea432dbd7d2864a2d63086`에 기록했고 push는 0회다. 첫 실제 실행의 `BRIDGE_E_BIND`는 일반 격리 환경의 localhost bind 제한이 원인으로 확인됐다. 권한 확장 host 1회는 ready까지 정상 진행했지만 자체 브라우저 client send 1회는 `BRIDGE_E_CLIENT_CONNECT`로 실패했고, host는 accepted connection 0회 후 `BRIDGE_E_TIMEOUT`·`durableState=none`으로 종료됐다. 원문은 메모리 Buffer에서만 처리했고 출력·파일·argv·환경변수로 남기지 않았다. account initialization·Keychain·metadata write·retry·recover·delete는 모두 0회고, 사후 사전검사는 `ready`, primary·recovery·Keychain 모두 없음을 확인했다. 이전 탭 확인 도구 출력에 계정 식별자가 포함된 URL이 1회 표시된 사실은 그대로 유지하되 원문과 URL을 다시 기록하지 않았다.
- 별도 도구에 접근할 수 없는 브라우저·로그인 화면·클립보드 동작만 메인 세션이 최소한으로 직접 처리할 수 있게 한 운영 규칙은 commit `2f821cbbff3b3ddd4e48ea2457319bc5569bd986`에 기록했다. 이 예외는 삭제·구매·공개 전환·권한 변경·외부 전송의 승인 범위를 넓히지 않는다.

## 요구사항 원장

### `DWNC-S3-008` — staging R2 create-only bulk upload와 full audit
- **Status:** `in-progress`
- **Updated-at:** `2026-08-28`
- **Plans:** `PLAN-05`
- **Priority:** `P0`
- **Acceptance:**
  - 단일 객체 admission이 exact인 final manifest만 create-only로 업로드한다.
  - 올바른 계정을 한 번 확인하고 저장소의 비공개 상태를 한 번 확인한 뒤, overwrite·delete 없이 manifest 전체를 실제 GET해 개별 SHA-256과 총 bytes를 한 번 전수 검증한다.
  - missing, mismatch, orphan을 각각 0 또는 명시적으로 보고한다. bulk `dwnc-public-media-r2-bulk-sync-v1` receipt는 운영 증거로만 남기고 signer·release 입력으로 쓰지 않으며, 전체 GET/SHA-256 감사가 만든 `dwnc-public-media-r2-receipt-v1`만 별도 서명 입력 후보로 만든다.
  - 이미 통과한 로컬 예행연습은 반복하지 않는다. 실제 실행에서 이 완료조건을 막는 문제가 발견될 때만 최소 수정과 관련 검사 한 묶음을 수행한다.
- **Evidence:**
  - 파일 2,758개 업로드를 마쳤다. 업로드 뒤 목록·크기·저장정보를 다시 확인해 빠진 항목과 불필요한 항목이 0개이며, 기존 파일 덮어쓰기와 삭제도 0회임을 확인했다. 실제 파일 내용 전수 비교는 아직 남아 있다.
  - 기존 1개는 그대로 두고 빠진 2,757개만 새로 만들었다. 다음에는 2,758개 전체의 실제 내용을 다시 내려받아 원본과 비교해야 하므로 이 요구사항은 아직 진행 중이다.
  - 실제 감사 진입점·client와 최종 manifest를 결속한 마지막 인터넷 없는 성공 시험은 2026-08-28 19:14:54.924 KST에 고정 원본 SHA-256 `b67874a204d71b05da4678847c7bf56acce2a3ee5eb5ce532f6a3ee77cfad9db`로 수행했다. 로컬 원본 2,758개·약 2.35GB를 사용해 목록 3회와 각 파일 정보 2,758회, 각 파일 내용 2,758회로 모두 5,519회 읽고 추가·변경·삭제·재시도는 0회였다. full object-set SHA-256은 `9345d2f06c8bd7cda457a9d4335cdc2213e71dcd30bb9e11e6f3e1f8e11ae467`이고, 같은 결과 경로 재실행은 원격 요청 0에서 create-only로 중단했다. 인터넷·socket·DNS와 임의 외부 프로그램은 호출 전에 차단하고 읽기 전용 Git 15회와 격리된 파일 도우미 5회만 정해진 순서로 허용했다. 임시 결과는 시험 종료 때 모두 제거했고 실제 network·Cloudflare·Keychain·clipboard는 0회였다. 이는 실행 경로의 예행연습이며 실제 staging R2 full audit 완료 근거로 쓰지 않는다. 이 12개 파일 변경은 commit `fb693f3bbbab0e88b205f9de944646057bdd49ea`에 기록했고 저장 직후 파일 상태는 깨끗했으며 push는 0회다.
  - 기술 증거: source commit `ccec8bb855e45ef679a4b99faf0f0633a99e089e`·tree `241a654acc387233d4e2d5e076754b345619e9ac`, bulk receipt SHA-256 `2974384ff720326830f5f3dcd9e2439dc56af4ec96c813bade88a2d0b7815444`, post-inspection receipt SHA-256 `f562129e14a65918bfebac26de313ff5e461ad3067774f9084a0e0514def0d84`다.

### `DWNC-S3-009` — deny-only staging Worker 최초 생성과 신뢰 정책
- **Status:** `in-progress`
- **Updated-at:** `2026-08-28`
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
  - 정확한 staging 계정에서만 쓸 짧은 수명 관리 열쇠의 로컬 전달 도구는 완성했다. 새 Account API token의 정확한 53자 형식(`cfat_` + 영문·숫자 40자 + 소문자 16진수 8자)만 받고 접두사 없는 예전 token은 거부한다. Cloudflare 화면에서 권한을 `계정 > Workers Scripts > Edit` 한 가지로 만들고, 사용 시작부터 만료까지 48시간 이하·실행 시 남은 시간이 60분 이상이어야 한다. 열쇠는 새 Keychain 항목에만 저장하고 프로젝트 밖의 기본 확인 파일과 고정 예비 파일에는 계정·열쇠·token ID 원문 대신 확인값만 기록한다. 두 경로의 안전성과 현재 상태를 열쇠나 API보다 먼저 확인하고 실제 기록 직전에 다시 확인한다. 현재 고정 payload는 원문 402바이트·Keychain 문자열 536자이며, 공용 Keychain 운반 상한 1,024자 안에서만 허용한다. 실행 때는 성공 응답이면서 오류 목록이 비어 있는 열쇠 상태, 계정의 `workers.dev=dwnc`, Wrangler의 `Account API Token` 및 계정 1개 일치를 먼저 확인한다. 그 뒤 익명 FD 3으로 허용된 자식에만 넘기고, 실제 Wrangler 자식만 token 환경변수를 받는다. Wrangler 4.125의 실제 본체와 필요한 최소 660개 파일의 전체 내용 확인값을 검증해 격리 폴더에 새 읽기 전용 사본을 만든 뒤, 이 사본을 현재 Node 절대경로로 직접 실행한다. 변조·symlink·확인 직후 교체가 있으면 열쇠를 읽거나 자식을 시작하기 전에 중단한다. 빈 HOME·XDG·임시 폴더·빈 환경 파일과 고정 PATH를 사용하고 로그인 정보 자동 대체, 외부 환경 덮어쓰기, 로그와 사용량 전송을 끈다. FD 쓰기·실행 시작·종료 오류가 나면 자식 실행을 종료하고 출력 통로가 닫힌 것을 확인한 뒤 임시 폴더를 정리한다. R2·DNS·Zone·route·삭제·production 명령은 허용 목록에 없다.
  - 실제 관리 열쇠·smoke token·Worker는 아직 만들지 않았다. 중단 복구는 `cloudflare:staging:service:bootstrap:recover` 한 명령으로만 실행하며 Cloudflare에는 GET만 보낸다. 준비 기록 뒤 아직 실행하지 않은 상태는 `never-started`, 실행을 시작했지만 Worker가 없는 상태는 `absent-after-start`, 정확한 차단 Worker 한 개를 연속 두 번 확인한 상태는 `exact-recovered`, 기록 손상·여러 version/deployment·분할 적용·두 조회 차이는 `ambiguous`로 기록한다. 마지막 경우에는 기존 자료를 보존하고 자동 진행하지 않는다. 이미 완성된 상태 기록이 있으면 서명 자료·단계 기록·현재 Git을 다시 확인한 뒤 Keychain·token 확인·Wrangler 확인·작업 자식·API를 모두 0회로 유지한다. 첫 상태 파일 쓰기가 중간에 끊긴 경우에만 고정된 두 번째 파일 한 곳을 사용하며, 그 두 번째 파일이 완성되면 재실행도 같은 결과를 0회 조회로 돌려준다. 원래 생성 시 확인값과 현재 복구 열쇠 확인값은 분리해 같은 최소 권한의 새 열쇠를 허용한다. production 최초 생성 입력은 자격증명을 읽기 전에 거부한다. version upload·상세 확인·적용·workers.dev 활성화 명령은 새 전달 방식에 연결되기 전에는 열쇠를 읽지 않고 중단한다. 과거 읽기 전용 runner의 workers.dev 경로와 내부 FD 전용 npm 명령은 제거해 새 runner를 우회할 수 없게 했다. production account/media/release fingerprint는 `null`을 유지한다.

### `DWNC-S3-010` — staging version-only upload·activation·synthetic smoke
- **Status:** `blocked`
- **Updated-at:** `2026-08-28`
- **Plans:** `PLAN-06`
- **Priority:** `P0`
- **Acceptance:**
  - 확정된 Git 기록을 기준으로 관련 빌드와 검사를 한 묶음만 실행하고, full audit 결과에 묶인 staging version만 version-only로 업로드한다.
  - 해당 version ID를 staging에 100% 적용하고 모호한 결과는 자동 재시도하지 않는다.
  - 일반 페이지 GET·HEAD, 예전 주소 349개의 GET·HEAD 총 698건, `/404.html`의 404, media GET·HEAD·304·206·416·ETag·Range를 `workers.dev`에서 검증한다.
  - 통과한 정확한 Git SHA와 Cloudflare version ID를 기록하고, 새 로컬 모의시험이나 독립검토를 추가하지 않는다.
  - 실제 `dwnc.me` 도메인·DNS는 변경하지 않는다.
- **Evidence:**
  - 선행 요구사항 `DWNC-S3-008`과 `DWNC-S3-009`가 아직 완료되지 않았다.
  - `docs/EDGE_REDIRECTS_V1.json`을 Worker가 직접 읽도록 연결했다. 시작할 때 기준 주소·349개·308·출발/도착 주소 중복·안전하지 않은 경로·미디어 경로 충돌을 모두 검사한다.
  - 로컬에서 349개를 GET·HEAD로 한 번씩, 총 698건 모두 확인했다. 응답은 정확한 상대 새 주소와 빈 본문을 반환하고, 들어온 query는 새 주소에 붙이지 않는다. 이 698건에서 정적 파일·R2·미디어 캐시는 한 번도 조회하지 않았다.
  - `/404.html`은 공개 요청 목록에서 뺐지만 빌드된 오류 화면 파일과 Cloudflare의 오류 화면 설정은 유지했다. 직접 GET·HEAD 요청은 `404 no-store`이고 정적 파일 조회는 0회다.
  - 원격 점검 프로그램은 기준 주소 목록 349개와 저장소의 현재 파일, 업로드용으로 묶어 둔 파일, 그 묶음의 확인 기록이 모두 정확히 같음을 먼저 확인한다. 그 뒤에만 임시 출입 비밀번호를 읽고 점검을 시작한다. 외부 주소·주소 뒤 물음표·역슬래시·중복·불필요한 단어를 섞은 시험에서는 비밀번호 읽기·하위 프로그램 시작·인터넷 요청이 모두 0회였다.
  - 각 요청은 10초 안에 끝나야 하며, 전체 점검 프로그램은 준비 확인과 비밀번호 전달부터 자식 프로그램 정리까지 시작 후 8분 안에 끝나야 한다. 응답 본문은 필요한 크기까지만 읽고, 쓰지 않는 본문은 즉시 닫는다. 응답이 끝나지 않거나 너무 크거나 늦게 도착하거나 중단 신호가 와도 정해진 시간 안에 닫히는 로컬 시험을 통과했다. 모든 요청은 자동 주소 이동을 끄고 처음 요청한 시험용 주소와 실제 응답 주소가 정확히 같은지도 확인한다.
  - `/about`의 경로·크기·내용 확인값·파일 종류를 업로드 묶음의 확인 기록에 직접 넣었다. 파일 확인과 점검 사이에 `/about`을 바꾸는 시험에서는 임시 출입 비밀번호 읽기·하위 프로그램 시작·인터넷 요청이 모두 0회였다.
  - 실제 npm 명령에서 점검 프로그램까지 이어지는 경로로 변조된 이전주소 목록 6종을 모두 시험했다. 여섯 경우 모두 임시 출입 비밀번호 읽기·하위 프로그램 시작·인터넷 요청이 0회였고, 정상 목록은 실제 자식 실행을 막는 시험용 감시선에서 정확히 멈췄다.
  - 원격 점검 계약은 예전 주소 698건, `/about` GET·HEAD 2건, `/404.html` GET·HEAD 2건, 미디어 5건, cache 확인 1~3건, 로그인하지 않은 요청 1건을 모두 세고 기록한다. 첫 cache 확인이 성공하면 총 709건이다. `/about` 화면과 cache 사진은 실제 내용·크기·파일 종류·ETag가 기준과 같아야 한다. 304는 정확한 ETag와 빈 본문, 416은 정확한 전체 크기 표시·ETag·빈 본문이어야 한다. 어느 항목이든 다르면 결과를 만들지 않는다.
  - 큰 점검 결과도 화면에 모두 전달된 뒤에만 임시 바이트를 지운다. 큰 결과를 천천히 받는 통로, 출력 오류, 끝나지 않는 출력 통로를 실제 실행 경로로 시험해 내용 손상 0, 시간 초과 뒤 남은 출력 작업 0을 확인했다.
  - 실제 npm 명령의 변조 목록 6종은 별도 계측 파일로 임시 출입 비밀번호 읽기 시도, 하위 프로그램 시작, 인터넷 요청이 각각 0회였음을 직접 확인했다. 정상 목록에서는 앞의 두 시도가 각각 정확히 1회여서 계측이 실제 경로에 연결됐음도 확인했다. 시험용 비밀번호 내용은 출력하지 않았다.
  - 위 로컬 점검 전용 시험 179개와 인터넷·외부 프로그램 차단 보강 전 전체 Cloudflare 시험 27개 묶음·15,076개가 통과했다. 현재 원본으로 R2 전량 예행연습 194개·차단 경계 전용 152개·영향 범위 829개를 따로 재확인했다. 실제 시험용 주소 점검과 Cloudflare 요청은 아직 0회다.
  - [`MEDIA_SERVING_CONTRACT.md`](MEDIA_SERVING_CONTRACT.md)의 version-only와 staging smoke 계약.

### `DWNC-S3-011` — production 이름 Cloudflare 자원·버전 준비
- **Status:** `planned`
- **Updated-at:** `2026-08-27`
- **Plans:** `PLAN-07`
- **Priority:** `P1`
- **Acceptance:**
  - staging 결과, full Git SHA와 Cloudflare version ID를 기록한다.
  - staging이 통과한 뒤 최종 운영에 실제 필요한 production 이름의 R2·Worker version만 같은 절차로 준비한다. 새 보조 도구·모의훈련·반복 검증은 추가하지 않고 각 단계별 새 승인 대기 때문에 멈추지 않는다.
  - production이라는 이름은 현재 실제 도메인 트래픽을 뜻하지 않으며, `dwnc.me` 도메인·DNS·route는 연결하지 않는다.
- **Evidence:**
  - 현재 production R2·자격증명·새 Worker version 변경은 0이고 `dwnc.me` 도메인과 DNS는 Cloudflare Worker에 미연결 상태다.
  - [`MEDIA_SERVING_CONTRACT.md`](MEDIA_SERVING_CONTRACT.md)의 two-phase production 안전 절차.

### `DWNC-S3-012` — 사용 불가능한 기존 staging R2 token 정리
- **Status:** `planned`
- **Updated-at:** `2026-08-27`
- **Plans:** `PLAN-05`
- **Priority:** `P1`
- **Acceptance:**
  - `PLAN-05`의 실제 전수 비교가 통과해 현재 작업용 열쇠가 정상임을 확인한다.
  - 이번 작업에 사용한 짧은 수명 열쇠와 2026-08-25에 만든 사용 불가능한 기존 uploader·validator token 두 개만 정확히 식별해 정리한다.
  - 새 자격증명, bucket, 객체, Worker, domain·DNS에는 다른 변경을 하지 않는다.
- **Evidence:**
  - 기존 두 token은 비밀값을 잃어 사용할 수 없지만 Cloudflare에서 아직 Active다.
  - 새 validator는 대표 객체를 HEAD 1·full GET 1·PUT 0·DELETE 0으로 검증했고 receipt SHA-256은 `fa72b1849496a9b6e4697721cfef9d4fcd17b8f463b41dcacd714c5f9bb2352a`다.

### `DWNC-S3-013` — Cloudflare 계정 번호를 열쇠와 분리해 안전하게 보관
- **Status:** `blocked`
- **Updated-at:** `2026-09-03`
- **Plans:** `PLAN-05`, `PLAN-06`, `PLAN-07`
- **Priority:** `P0`
- **Acceptance:**
  - 현재 열린 자체 브라우저에서 이 프로젝트의 올바른 Cloudflare 계정인지 한 번 확인하고, 계정 번호는 업로드용·검사용 열쇠와 다른 macOS 보관 항목에 둔다.
  - 원래 계정 번호는 프로젝트·로그·일반 출력에 남기지 않고 기존 항목이나 파일을 덮어쓰거나 삭제하지 않는다.
  - 같은 세션과 탭에서 작업을 이어 가는 동안 반복 확인하지 않는다. 브라우저 세션·탭·프로젝트가 바뀌거나 계정 상태가 달라졌을 때만 다시 확인한다.
  - 계정 확인과 안전한 보관이 끝나면 이 요구사항을 완료 처리하며 계정 보관을 위한 추가 로컬 체계를 만들지 않는다.
- **Evidence:**
  - 전용 저장·검사·확인 파일 복구 명령과 Cloudflare 비공개 설정 조회 연결을 로컬에 구현했다.
  - 사전검사의 클립보드 읽기 0·비우기 0, 읽기 전 실패 때 기존 클립보드 보존, 계정 번호 읽기 시도 뒤 즉시 비우기, 저장 직전 상태 재검사, 새 항목으로만 저장, 성공 뒤 보관함·확인 파일 재검증과 보관함 값의 중간 변경·삭제 차단을 포함한 전용 시험 610개를 통과했다. Mac 보관함과 클립보드를 다루는 시스템 프로그램은 15초 안에 끝나지 않으면 먼저 정상 종료를 요청하고, 그래도 끝나지 않으면 강제로 종료한다. 입력·출력과 그 값을 담았던 프로그램 안 임시 바이트는 성공과 모든 실패에서 0으로 덮는다. 클립보드는 계정 번호 읽기를 시도한 뒤 성공하거나 실패할 때 즉시 비운다. 저장 내용이 맞는지만 확인할 때는 계정 번호 문자열을 만들지 않는다. 다음 기능에 넘기는 마지막 순간에만 문자열을 한 번 만드는데, 프로그램 언어의 특성상 이 문자열은 같은 방식으로 지울 수 없다. 화면·로그·파일에는 남기지 않고 전달 직후 더 이상 사용하지 않는다. 이 변경은 명령 등록과 계정 번호 처리·검사에 관련된 로컬 파일 4개에만 한정됐다.
  - 이 시스템 프로그램에는 Mac이 직접 알려 준 사용자 폴더와 사용자 이름, 고정 프로그램 검색 경로와 언어 설정, 숫자로 된 사용자 ID에서 만든 macOS 문자 처리값 등 정확히 7개만 전달한다. 부모 프로그램의 임시 폴더·인터넷 우회·프로그램 주입·Node·Cloudflare·R2·AWS 설정은 전달하지 않는다. 이 7개 묶음은 빈 바탕에서 새로 만들고 잠근 뒤, 항목을 추가·변경하거나 다른 묶음으로 교체할 수 없게 했다.
  - 개발 중 시험용 가짜 연결 한 곳을 빠뜨려 `/usr/bin/security find-generic-password … -w` 읽기 명령이 실제로 한 번 실행됐다. 같은 값을 확인하는 두 번째 읽기 0회, Mac 보관함 저장·변경 0회, 클립보드·인터넷·Cloudflare·R2 접근 0회였다. 이후 모든 시험의 가장 바깥에 실제 시스템 프로그램 실행 감시를 추가했다. 감시 값은 내용이나 함수를 읽거나 실행하지 않고, 존재하기만 하면 Mac 명령 직전에 정해진 오류로 멈춘다. 부모 프로그램에 일부러 넣은 인터넷 우회·프로그램 주입·Node 시험값도 전달되지 않았다. 계정 번호 전용 610개와 당시 전체 26묶음·15,024개, 이번 전체 27묶음·15,076개를 다시 통과하는 동안 추가 실행은 0회였다.
  - 읽기 전용 열쇠와 계정 번호를 분리하고 조회 명령도 프로젝트 안 확인 파일을 열지 못하게 하는 81개 시험을 통과했다. 이 81개 시험 자체의 실제 Keychain·클립보드·Cloudflare·R2 접근과 사진 업로드용 열쇠 읽기는 모두 0회였다.
  - 자체 브라우저에서 현재 Cloudflare 화면의 계정 번호 항목이 하나뿐이고 이 프로젝트의 시험용 계정 확인값과 정확히 일치함을 확인했다. 이것은 이번 새 브라우저 탭 확인 전의 역사적 전용 경로 증거이며, 당시 계정 번호 원문을 별도 일반 출력이나 프로젝트 파일에 남기지 않았다.
  - 일반 실행 경로의 보관 시도는 Mac 보관함 단계에서 정해진 오류로 중단됐다. 그 뒤 자체 브라우저에서 Mac 보관함 저장 절차를 시작하려 한 두 차례는 각각 15초 안에 연결되지 않아 저장 프로그램 시작 전에 중단됐다. 매번 임시 내용은 지워졌고 Mac 보관함·확인 파일은 만들어지지 않았다. 이후 연결 대기를 60초로 늘린 최소 변경은 commit `5a49c79fbd1e4d76d22fe736f6d22940aa6c856e`·tree `f246b062473f5544d3ea432dbd7d2864a2d63086`에 저장했고, 전용 시험·기존 회귀시험·독립 검토를 통과했으며 push는 0회다.
  - 위 commit의 첫 실제 실행은 ready 전 `BRIDGE_E_BIND`로 종료됐다. 후속 진단에서 일반 격리 환경의 localhost bind 제한이 원인임을 확인했고, 권한 확장 host 1회는 ready까지 정상 진행했다. 이번 자체 브라우저 client send 1회는 `BRIDGE_E_CLIENT_CONNECT`로 실패했고, host는 accepted connection 0회 후 60초 만료로 `BRIDGE_E_TIMEOUT`·`durableState=none`을 반환했다. 원문은 브라우저 메모리 Buffer에서만 처리했고 출력·파일·argv·환경변수에 남기지 않았다. clipboard read·clear false, raw printed false였으며 account initialization·Keychain·metadata write·retry·recover·delete는 모두 0회다. 사후 읽기 전용 사전검사는 `ready`, primary·recovery·Keychain 모두 없음을 확인했다. R2 private exposure/API/full audit와 Cloudflare 원격 변경은 0회다. 이전 브라우저 탭 확인 도구 출력에 계정 식별자가 포함된 URL이 1회 표시된 사실은 그대로 유지하되 원문과 URL을 다시 기록하지 않았다.
  - 후속 비민감 clipboard probe는 자체 브라우저 write 1회와 macOS `pbpaste` read 1회의 값이 일치하지 않았고 system clipboard write는 0회였다. 설치 구현의 자체 브라우저는 virtual clipboard를 쓰며 시스템 클립보드 공유가 공식 보장되지 않는다.
  - secure non-echo stdin receiver는 관련 4파일만 바꾼 commit `4467a7e468a6aa72f3f26c4e12e9ce3b8d5c9779`·tree `9c6505ef46393b139c923ad5a43f0605c4b14611`에 구현했다. stdin 112·account-target 698·diff 검사가 통과했고 독립 검토 지적 0건, push 0회다.
  - 비민감 자체 브라우저→Terminal 시험은 receiver `READY` 뒤 Computer Use가 `com.apple.Terminal`로 값을 전달하기 전에 안전 정책으로 차단했다. local paste 0·receiver input 0, receiverStopped·echoRestored true였고 브라우저 시험 clipboard를 비웠다. 재시도·대체 앱 우회는 0회다. 이번 stdin/Terminal 경로의 Account ID copy·read·paste·initialize는 모두 0회다. 앞선 localhost 경로의 누계는 browser memory 처리·client send 시도 1회, host accepted·success 0회이며 Keychain·metadata 작성은 전체 0회다. Cloudflare·R2·API·full audit도 0회다.
  - 별도 진단 실수로 loopback 회귀시험을 한 번 잘못 호출해 sandbox bind 1회 뒤 `BRIDGE_E_BIND`로 즉시 종료됐다. accepted connection·payload·initialize·Keychain·Cloudflare는 모두 0회였고 재시도하지 않았다.
  - 현재 지원되는 자동 전달 경로가 없어 중단한다. 제품이 허용하는 안전한 로컬 receiver target이 생기거나 사용자가 원문을 도구 출력 없이 non-echo receiver에 직접 입력하는 명시적 handoff가 있을 때만 재개한다.

### `DWNC-OPS-001` — 공유·스크랩 추정 10개 처리 결정
- **Status:** `decision-needed`
- **Updated-at:** `2026-08-26`
- **Plans:** `PLAN-09`
- **Priority:** `P2`
- **Acceptance:**
  - 10개 각각을 링크형 기록 또는 제외로 결정한다.
  - 원문 복제나 공개 registry·검색·RSS·sitemap 편입은 권리와 공개 범위를 증명한 경우에만 허용한다.
  - 사용자가 이 후속 선택을 요청하기 전에는 진행하지 않으며 Stage 3 완료를 막지 않는다.
- **Evidence:**
  - [`PROJECT_STATE.md`](../PROJECT_STATE.md)에 공개 목록과 직접 작성 목록 차이 10개가 미해결로 기록돼 있다.

### `DWNC-OPS-002` — 지속적인 새 글 작성 방식 결정
- **Status:** `decision-needed`
- **Updated-at:** `2026-08-26`
- **Plans:** `PLAN-09`
- **Priority:** `P1`
- **Acceptance:**
  - 저장소 기반 편집 또는 로그인형 편집기의 운영·보안·백업 방식을 선택한다.
  - 새 글도 append-only global sequence와 public asset receipt 계약을 따른다.
  - 이 결정은 최종 운영 준비에 필요하지만 Stage 3의 실제 저장소·시험용 사이트 확인을 막지 않는다.
- **Evidence:**
  - [`URL_CONTRACT.md`](URL_CONTRACT.md)의 native-only allocation 계약.

### `DWNC-OPS-003` — 댓글과 private backup 정책 결정
- **Status:** `decision-needed`
- **Updated-at:** `2026-08-26`
- **Plans:** `PLAN-09`
- **Priority:** `P1`
- **Acceptance:**
  - 최종 운영에 필요한 private raw·본문·미디어의 암호화 백업과 복구 검증 절차를 정한다.
  - 과거 댓글의 이식·읽기 전용 보존·제외는 사용자가 원할 때 결정하는 후속 선택으로 두며 Stage 3를 막지 않는다.
  - private 콘텐츠나 identity를 공개 저장소·로그에 노출하지 않는다.
- **Evidence:**
  - [`PROJECT_STATE.md`](../PROJECT_STATE.md)의 댓글·암호화 백업 미해결 항목.

### `DWNC-OPS-004` — 비개발자도 이해하기 쉬운 진행 설명
- **Status:** `in-progress`
- **Updated-at:** `2026-08-27`
- **Plans:** `PLAN-00`
- **Priority:** `P0`
- **Acceptance:**
  - 모든 진행 상황, 질문과 결과 보고를 비개발자도 한 번에 이해할 수 있는 일상적인 한국어로 먼저 설명한다.
  - 먼저 무엇을 확인하거나 완료했는지, 사용자에게 어떤 의미인지, 다음에 무엇을 하는지를 차례로 말한다.
  - 명령어, 내부 함수·파일 형식, 긴 확인 번호와 요청 횟수 같은 기술 정보는 사용자가 요청했거나 검증에 꼭 필요한 경우에만 뒤쪽 `기술 참고`로 분리하고, 필요한 경우에도 바로 쉬운 뜻을 함께 설명한다.
  - `gate`, `NO-GO`, `별도 금지선`, `fail-closed`, `exact tree`처럼 번역투이거나 조직 내부에서만 통하는 표현을 사용자에게 그대로 쓰지 않는다.
  - 사용자가 직접 해야 할 일이 있으면 버튼 이름과 누르는 순서를 짧고 구체적으로 안내한다.
- **Evidence:**
  - 사용자가 2026-08-27에 이 기준을 요구사항 문서와 앞으로의 모든 대화에 계속 적용하도록 명시했다.
  - 이 문서의 첫 화면은 결과, 사용자에게 미치는 의미, 다음 작업을 쉬운 한국어로 먼저 보여 주고 긴 확인 번호는 `기술 참고`로 분리한다.
  - `npm run requirements:validate`는 이 상시 요구사항과 사용자용 설명 순서가 빠지거나, 쉬운 설명 없이 금지한 기술 표현만 쓰인 경우를 거부한다.

### `DWNC-OPS-005` — 중요한 변경만 전체 계획과 연결
- **Status:** `in-progress`
- **Updated-at:** `2026-08-27`
- **Plans:** `PLAN-00`
- **Priority:** `P0`
- **Acceptance:**
  - 최종 결과·명시적 완료조건·범위·순서·승인 범위가 실제로 바뀔 때만 요구사항 번호와 계획 ID를 연결하고 우선순위, 완료 기준, 상태와 근거를 기록한다.
  - 단순 질문·설명·진행 확인·이미 기록된 작업의 계속 지시는 새 번호를 만들지 않는다.
  - 실제 계획이 바뀔 때만 `현재 위치`와 `바로 다음 작업`을 같은 변경에서 고친다.
  - 대화 내용만 공식 상태로 삼지 않고 `REQUIREMENTS.md`와 `PROJECT_STATE.md`를 함께 갱신한다.
  - 최근 완료는 12개까지만 두고 오래된 완료 기록은 보관 문서로 옮긴다.
- **Evidence:**
  - 사용자용 요약에 `PLAN-00`부터 `PLAN-09`까지 목적·완료 기준·현재 상태를 기록했고 진행 중인 실행 계획을 `PLAN-05` 하나로 표시했다.
  - 지속해서 관리할 현재 요구사항의 `Plans` 항목을 계획표와 연결했다. 사소한 대화는 새 요구사항으로 늘리지 않는다.
  - `npm run requirements:validate`는 이 상시 요구사항, 계획표, 현재 위치 한 개와 요구사항별 계획 연결이 빠지거나 잘못되면 거부한다.

### `DWNC-OPS-006` — 브라우저 작업은 Codex 자체 브라우저만 사용
- **Status:** `in-progress`
- **Updated-at:** `2026-08-28`
- **Plans:** `PLAN-00`, `PLAN-05`, `PLAN-06`
- **Priority:** `P0`
- **Acceptance:**
  - 이 프로젝트의 앞으로 모든 브라우저 작업은 Codex 자체 브라우저에서만 하고 Chrome과 Edge를 사용하지 않는다.
  - 자체 브라우저의 로그인 상태가 프로젝트·작업마다 분리된다고 가정하지 않는다. 같은 사이트에서 서로 다른 계정을 쓰는 프로젝트의 브라우저 작업은 동시에 하지 않고 하나씩 진행한다.
  - 브라우저에 로그인돼 있다는 사실은 올바른 계정의 증거로 사용하지 않는다. Cloudflare 작업을 시작할 때 화면의 `Account ID` 또는 그 확인값이 이 프로젝트에 안전하게 저장된 계정 확인값과 일치하고, 일치하는 대상 계정이 정확히 한 개뿐인지 한 번 확인한다. 같은 세션과 탭에서는 반복하지 않고, 브라우저 세션·탭·프로젝트가 바뀌거나 계정 상태가 달라졌을 때만 다시 확인한다. 다르거나 확인할 수 없으면 설정 조회·변경과 열쇠 생성 전에 멈추고 사용자가 직접 로그아웃·로그인한다.
  - 로그인이 필요하면 Cloudflare 공식 로그인 페이지를 열고 사용자가 로그인 정보와 비밀번호를 직접 입력한다.
  - 로그인 정보와 비밀번호를 문서·로그·화면 출력·프로젝트 파일에 저장하지 않는다.
  - 다음 계정 확인은 자체 브라우저에서 올바른 Cloudflare 계정인지 먼저 확인하고 `Account ID` 옆 `Copy`를 한 번만 누른다.
- **Evidence:**
  - 사용자가 2026-08-28에 앞으로의 브라우저 사용 경로와 로그인 정보 보존 금지를 명시했다.
  - 같은 날 사용자가 서로 다른 프로젝트에서 같은 사이트의 다른 계정을 쓸 때 이전 로그인 상태가 이어질 가능성을 확인해 달라고 요청했다. 프로젝트별 로그인 분리를 보장하는 근거가 없고, 이 프로젝트 안에서도 서로 다른 자체 브라우저 작업에서 Cloudflare 로그인 상태가 같지 않았으므로 로그인 상태 자체는 계정 확인 근거로 쓰지 않는다.
  - 자체 브라우저 화면의 계정을 이 프로젝트 확인값과 한 번 대조해 정확히 일치함을 확인했다. 같은 세션과 탭에서는 반복 확인하지 않는다.
  - 이전 Chrome 관측 기록은 과거 증거로만 보존하고 이후 작업 경로로 재사용하지 않는다.

### `DWNC-P2-001` — 후속 접근성·탐색 개선
- **Status:** `planned`
- **Updated-at:** `2026-08-26`
- **Plans:** `PLAN-09`
- **Priority:** `P2`
- **Acceptance:**
  - 공개 이미지 대체텍스트를 원본 불변 범위의 파생 정책으로 개선한다.
  - tag 660개의 추가 탐색과 검증된 fragment map을 별도 설계한다.
  - 종료된 티스토리 영상 fallback의 표시 문제를 파생 표현에서 보완한다.
  - 이 항목들은 현재 프로젝트 완료조건과 Stage 3에서 제외하며 사용자가 요청할 때만 진행한다.
- **Evidence:**
  - [`PROJECT_STATE.md`](../PROJECT_STATE.md)의 P2 접근성·tag·fragment·fallback 항목.

## 최근 완료된 요구사항

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
