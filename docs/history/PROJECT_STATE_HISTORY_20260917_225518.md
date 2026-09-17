# 2026-09-17 현재판에서 분리한 운영 이력

이 문서는 2026-09-17 Markdown 정리 때 기존 `PROJECT_STATE.md`와 Git 배포 안내에서 분리한 고유 기록이다. 아래 수치·설정·확인은 각 작업 당시의 결과이며 이번 정리에서 운영을 다시 조회하지 않았다. 현재 목표와 다음 행동은 [공식 상태](../../PROJECT_STATE.md)를 따른다. 기능별 완료 과정은 기존 보고서와 [완료 원장](../REQUIREMENTS_ARCHIVE.md)에 있으므로 복사하지 않는다.

## Git 연결 첫 배포 · 2026-09-10

- 소스 `15cbc3d`에서 공개·관리자 첫 자동 빌드·배포와 공개 홈·글·분류 확인을 마쳤다. 당시 관리자 내부 확인 대기는 후속 `DWNC-OPS-007` 완료로 해소됐다. 현재 실행 계약은 [Git 배포 안내](../GIT_DELIVERY_20260910_142007.md)를 따른다.

## Google 연결 설정 상세 · 2026-09-12

Google 실제 로그인 완료·Microsoft 취소·인증 소스 배포는 [완료 원장](../REQUIREMENTS_ARCHIVE.md)의 `DWNC-OPS-008`에 보존돼 있다. 아래는 원장과 기존 상태 이력에 없는 당시 설정과 연결 처리의 세부사항이다.

- `admin.dwnc.me`: Session Duration 24 hours, 허용 IdP는 One-time PIN과 Google, 두 방식 선택에 따라 instant authentication은 꺼짐, Cloudflare One Client 인증 끔.
- 관리자 이메일 한 개만 허용하는 정책은 두 관리자 앱이 공유한다. 정책 기간은 Same as application session duration, 전역 기간도 Same as application session timeout이다. 다른 앱에 영향을 주지 않으려면 이 앱의 기간만 바꾸면 된다.
- 계정의 등록 IdP는 Cloudflare·One-time PIN·Google이며 대상 앱은 PIN과 Google만 선택했다. Google IdP는 `892fbee1-2a9c-4892-aaaa-bee29009a8f9`다. Microsoft IdP는 없으며 사용자 취소에 따라 추가하지 않는다. 기존 공유 정책을 무분별하게 확장하지 않고 대상 관리자 앱과 지정 계정에 한정한다.
- **Google 완료:** [공식 안내](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/google/)에 따라 개인 소유·조직 없음의 `dwnc-me-admin-login` 프로젝트를 사용했다. 사용자가 2026-09-12 데이터 정책 동의 체크와 Create를 직접 완료했다. Web 클라이언트 `dwnc.me Cloudflare Access`를 생성해 Access에 연결했으며 결제 연결·유료 서비스 활성화는 하지 않았다. 권한은 기본 신원 `openid profile email`만 사용한다. 비밀값은 일회 표시에서 연결 폼으로 직접 전달하고 파일·클립보드에 저장하지 않았다.
- [공식 세션 문서](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/)상 최대 1개월이지만 이번 요청은 로그인 방식 추가이며 기간은 바꾸지 않는다.

- 메인이 사용자 브라우저의 연결·로그인 동작을 담당했다. 공유 이메일 허용 정책과 다른 관리자 앱의 IdP 설정은 변경하지 않았다. 비밀값은 직접 연결에만 사용했으며 파일·클립보드에 보관하지 않았다.
- 연결 origin·callback은 [2026-09-12 상태 이력](PROJECT_STATE_HISTORY_20260912_003022.md)의 로그인 연결 입력에 보존돼 있다. 당시 Microsoft 연결 예정 문장은 후속 사용자 취소로 종료된 이력이다.

## 조회 통계 초기화 · 2026-09-12

- **조회 통계 초기화 완료(2026-09-12 16:05 KST):** 사용자가 개발 확인 접속이 대부분이라고 판단해 기존 조회수 전체 초기화를 명시 승인했다. 하위 에이전트가 집계 전용 테이블과 영향 범위를 확인하고 메인이 일치 확인한 운영 D1의 내장 대시보드에서 `DELETE FROM post_view_daily;`를 한 번 실행했다. 실행 전 154개 일별 집계 행·총205회, 실행 후 행0·합계0이며 관리자 화면의 16:05:26 기준 오늘·최근30일·누적0을 확인했다. 글·작업본·미디어·설정은 변경하지 않았으며 코드 변경·재배포도 없다. 이후 조회는 기존 방식으로 다시 누적된다.

후속 17:00:50~17:18:21 관측에서 증가한 11회의 출처를 특정하지 못한 사실은 [카테고리 탐색 완료 기록](카테고리_탐색_개선_20260912_171354.md)에 보존돼 있다. 그 수치를 개발 접속으로 단정하거나 다시 초기화하지 않았다.

## AI 교육 가이드 전달문

- **AI 교육 가이드 전달문 정리:** `https://ai.amxrank.com/`의1~5권을 읽고 AI가 프로젝트의 오래된 자료를 최신 운영 데이터로 오인할 위험을 다른 콘텐츠 제작 세션에 전달할 설명으로 정리했다. 주 연결점은5권의 프로그램/AI 두 창구가 같은 최신 장부를 사용해야 한다는 전제와3권의 프로젝트 자료가 항상 최신은 아니라는 주의점이다. 가이드 사이트를 수정하거나 다른 세션에 직접 전송하지 않는다.
