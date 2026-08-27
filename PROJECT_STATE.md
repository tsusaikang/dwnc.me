# dwnc.me 프로젝트 공식 상태

최종 갱신: 2026-08-27 KST — 시험용 R2에 공개 미디어 2,758개 업로드 완료, 전체 파일 내용 재확인 대기

사용자가 확인할 현재 목표·결정·진행을 막는 조건·다음 단계와 stable requirement ID는 [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md)를 기준으로 한다. 이 문서는 구현 세부사항, 검증 수치, Git·Cloudflare 상태 재확인 결과와 인수인계를 보존하는 기술 기준점이다. 완료 이력은 요구사항 원장의 보관 정책에 따라 [`docs/REQUIREMENTS_ARCHIVE.md`](docs/REQUIREMENTS_ARCHIVE.md)로 이동하되 이 기술 증거를 삭제하지 않는다.

## 현재 목표와 완료 조건

네이버 블로그 `blog.naver.com/tsusai`와 티스토리 기반 `dwnc.me`의 직접 작성 콘텐츠를 소유자가 통제하는 새 블로그로 이전한다. 원문, 이미지, 게시일, 카테고리, 태그, 기존 주소, 공개 범위를 보존하며 이후 새 글도 지속해서 작성할 수 있어야 한다.

비개발자용 현재 요약: 공개할 사진과 GIF 2,758개를 시험용 비공개 저장소에 모두 올렸고, 빠짐·내용 차이·불필요한 파일은 0개였다. 기존 파일을 덮어쓰거나 삭제하지 않았다. 다음에는 저장소의 파일을 하나씩 다시 내려받아 로컬 원본과 같은지 확인한다. 아직 시험용 사이트 프로그램을 올리지 않았고 실제 `dwnc.me` 주소나 DNS도 연결하지 않았다.

전체 프로젝트 완료 조건은 다음과 같다.

- 티스토리 공개 164개와 네이버 공개 185개의 canonical을 전역 순번 `/posts/{globalSequence}`로 제공하고, 기존 `/{id}`·`/naver/{logNo}`는 정확한 alias로 유지한다.
- 네이버 전체공개 직접 작성 글 185개의 본문과 미디어를 새 공개 경로로 이전한다.
- 네이버 비공개 글 247개는 별도 로컬 영역에 보존하며 명시적 승인 전 공개 빌드에 포함하지 않는다.
- 네이버 공개 목록과 직접 작성 글 목록의 차이 10개(공유·스크랩 추정)는 저작권과 출처를 검토해 링크형 기록 또는 제외로 개별 결정한다.
- 원문 HTML과 정규화 본문을 분리하고, 미디어마다 원주소·SHA-256·크기·MIME·로컬 경로를 기록한다.
- 글 목록, 상세, 카테고리, 연도별 아카이브, 검색, RSS, 사이트맵, 데스크톱·모바일 화면을 검증한다.
- 기존 블로그를 수정·삭제하지 않는다. 현재 승인된 준비 단계에서는 실제 `dwnc.me` 도메인·DNS와 Git 원격 저장소를 변경하지 않는다. 나중에 사용자가 운영 전환을 결정하면 실제 도메인을 연결하고 글·예전 주소 349개·미디어·모바일과 데스크톱 화면을 실제 주소에서 다시 검증해야 전체 운영 전환이 완료된다.

## 현재 단계

- 티스토리 공개 콘텐츠 이전: **완료 및 전수 검증 통과**
- 네이버 소유 글 인벤토리: **완료**
- 네이버 편집기 세대·공개 범위 표본 조사: **완료**
- 네이버 canonical raw HTML v2 보존: **432/432 완료 및 전수 무결성 검증 통과**
- 네이버 importer schema 2·normalization 3 정규화·미디어 전수 실행: **432/432 verified, partial 0, failure 0**
- 네이버·티스토리 통합 inventory/check/build/build-validator: **모두 PASS**
- 공개 SmartEditor3 파생 메타 chrome 정제: **144/144 PASS, 노출 0**
- 공개 Naver 비디오 표시 정책: **81/81 분류·표시 검증 PASS**
- 공개 글 구조 분류: **사진형 148 + 장문형 201, 실제 렌더 구조 불일치 0**
- 공개 파생 텍스트 zero-width 정제: **meta·OG·검색·RSS 잔류 0**
- source 없는 Naver 비디오 fallback: **재생 불가 안내·재생시간 53/53, 작성자 캡션 23/23, 이름·고유 ID·AA 대비 PASS / placeholder cover 13개의 파생 cover `null`**
- 중앙 taxonomy와 공개 탐색: **18노드(8 root + 10 child), 공개 349글 단일 leaf 해석 PASS**
- 카테고리·태그 정적 경로: **category 40 + tag 660, 15편 pagination 전수 PASS**
- 글 연결: **same-leaf 관련 글 1,698링크, 전역 이전 348·다음 348링크 PASS**
- 모바일 갈래 서랍: **390px overflow 0, Escape·focus trap/return·scroll lock PASS**
- 공개 URL registry: **imported 349 + native 증분 계약, 현재 collision 0**
- 공개 본문 legacy 링크 호환: **75개 canonical 변환, unavailable 2개 중립화, Naver platform anchor 0, broken local 0**
- 전역 순번 bootstrap: **596건(공개 349 + 비공개 예약 247), 1–596, next 597, 감사 digest 2종 PASS**
- 전역 순번 운영 내구성: **metadata-only sidecar·bootstrap seal·append journal·generation CAS·초기화/교차 파일 transaction·linked stale-transfer recovery, 순수 117 + 실제 CLI 5 fixture PASS**
- 공개 canonical 전환: **`/posts/{globalSequence}` 349개, legacy alias 349개, private reserved route 0**
- alias 표현·발견성: **noindex/canonical/refresh/JS/fallback 349/349, 검색·RSS·sitemap 포함 0**
- 공개 미디어 전달 manifest: **현재 최종 2,758개·2,346,220,246바이트·SHA-256 `61bb577d609f97cdb014ef3a14681045fbb3bec616f2b04c8d058519b640c532`, local/source-only 전수 검증 PASS. 2026-08-25의 2,889개·SHA-256 `5b9eb93474c0e96b3b371d233b4ea64cc24918a31d0fb754410c968544c2b165`는 정리 전 역사 기준선**
- same-origin forward-deny Worker: **공개 요청 1,410경로·SHA-256 `1666d8dd85ac05c2274513cfbe438f24ead06a190f873af3b67f7e3aa373307c`와 media 2,758개를 asset/cache보다 먼저 exact allowlist, `/media/*` GET·HEAD·ETag·304·If-Range·단일 Range·full-200 edge cache·404/405/416/502 fixture PASS**
- Cloudflare source-only build: **fresh Git-style checkout에서 private/raw/local media 0, local media read/download 0, `dist/media` 0, HTML 1,404·sitemap 1,054·canonical/alias 349/349와 기존 검증 PASS**
- Cloudflare Stage 3 preflight·Builds guard: **account·Worker·repo 식별과 raw deploy 제거·exact version-only wrapper readback 완료**
- Cloudflare Stage 3 로컬 안전장치: **commit `ccec8bb855e45ef679a4b99faf0f0633a99e089e`·tree `241a654acc387233d4e2d5e076754b345619e9ac`로 업로드·사후 확인·전체 내용 감사의 보호 절차를 기록했고 push는 0**
- Cloudflare Stage 3 staging R2 상태: **최종 2,758개 업로드 완료. 기존 exact 1개를 건너뛰고 missing 2,757개만 조건부 생성했으며 사후 확인 exact 2,758·missing 0·mismatch 0·orphan 0·overwrite 0·delete 0. 전체 2,758개 full GET/SHA-256 감사와 그 직전 비공개 설정 재확인은 대기. Worker·version·activation 0**
- Cloudflare Stage 3 staging signing trust: **media public fingerprint `69cb5866228f1624693b0903e60d52b0c046464040da621b2d144cb8bffb2182`, release public fingerprint `2655be4122fb2238d47ba539b8e86aa9d39899631a7d713106ce711ea2de1ac2` policy 고정 / private key는 macOS Keychain에만 보관·export 0 / production fingerprint `null` 유지**
- 공개 미디어 최종 범위: **B 선택 반영. 사용자 소유 사진 2,757개 + 직접 제작 SBS GIF 1개 = 2,758개. 지도 99개는 장소 카드 16개(원 장소 네이버지도 15+네이버지도 검색 1)로 대체, LINE 스티커 5개·placeholder 27개 제외 / final 검증 PASS**
- 네이버 세 편집기 세대 대표·비디오 대표 데스크톱·모바일 브라우저 QA: **모두 PASS**
- 이전 기술 완료 조건: **달성**
- 운영 방식·호스팅·도메인 전환: **private R2+same-origin Worker 구조 확정 / 전체 업로드 완료, 전체 파일 내용 감사·Worker·version·activation 미실행 / 실제 `dwnc.me` 도메인·DNS 미연결**

## 전체 계획과 현재 위치

- `PLAN-00` 요구사항·진행 안내 관리: 계속 적용
- `PLAN-01` 원본 범위 확인과 보존: 완료
- `PLAN-02` 공개·비공개 분리와 변환: 완료
- `PLAN-03` 독립 사이트와 주소 체계: 완료
- `PLAN-04` 공개 미디어 정리: 완료
- `PLAN-05` 시험용 R2 업로드와 전체 내용 확인: **진행 중인 실행 계획 하나**. 업로드와 목록 확인은 완료했고 전체 2,758개 내용 비교를 준비 중이다.
- `PLAN-06` 시험용 Worker·버전·사이트 점검: 대기
- `PLAN-07` 운영용 이름의 Cloudflare 자원·버전 준비: 대기
- `PLAN-08` 실제 도메인 연결과 운영 전환 검증: 사용자 결정 필요
- `PLAN-09` 새 글·공유 글·댓글·비공개 백업 운영 결정: 사용자 결정 필요

요구사항과 계획의 자세한 연결은 [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md)를 기준으로 한다. 새로운 요청이 들어오면 요구사항 번호, 관련 계획, 우선순위, 완료 기준, 상태와 근거를 같은 변경에서 기록하고 현재 위치와 다음 순서도 함께 고친다.

## 작업 운영 원칙

- 부모 세션은 범위·승인 경계·검증·인수인계를 관리하는 오케스트레이션에 집중하고, 대량·장기 실작업은 내용에 맞춰 하위 에이전트에 위임한다.
- 사용자에게 진행 상황·질문·결과를 알릴 때는 비개발자가 한 번에 이해할 수 있는 일상적인 한국어로 결과, 사용자에게 미치는 의미, 다음 작업을 먼저 설명한다. 명령어·내부 파일 형식·긴 확인 번호는 꼭 필요할 때만 뒤쪽 `기술 참고`로 분리하고 쉬운 뜻을 함께 적는다. 사용자가 직접 할 일은 버튼 이름과 순서를 짧고 구체적으로 안내한다.
- 새 요청이나 조건에는 변하지 않는 요구사항 번호와 관련 계획 ID를 붙이고 우선순위·완료 기준·상태·근거를 갱신한다. 계획 밖의 요청은 하위 작업으로 추가하거나 범위가 달라진 이유를 기록한다. 대화만 공식 상태로 삼지 않으며, 진행 중 새 요청이 들어오면 현재 위치와 다음 순서도 동기화한다.
- 새로운 작업 단계로 넘어갈 때마다 남은 컨텍스트 상태를 점검한다. 자동 압축이나 컨텍스트 한계가 예상되면 새 단계를 시작하지 않고 먼저 작업을 중단해 인수인계를 준비한다.
- 중단 전에는 이 `PROJECT_STATE.md`에 현재 목표와 완료 조건, 확정된 결정과 이유, 완료 작업, 주요 산출물과 위치, 검증 결과, 미해결 문제, 다음 단계, 중요한 제약과 주의사항을 갱신한다. 대화 내용만을 공식 상태로 간주하지 않는다.
- 깨끗한 새 컨텍스트에서 계속하는 편이 더 안전하거나 효율적이면 사용자에게 `새 작업 권장`이라고 명시하고, 같은 프로젝트를 바로 이어갈 수 있는 복사 가능한 인수인계 프롬프트를 함께 제공한다.
- 이 원칙은 프로젝트의 `AGENTS.md`와 Codex 장기 기억에도 동일하게 기록되어 있으며, 이후 세션에서도 함께 적용한다.

## 확정된 결정과 이유

1. 새 사이트는 정적 우선 Astro 구조로 시작한다. 글 중심 사이트에 적합하고 원문을 평문 파일로 보관해 특정 호스팅이나 데이터베이스에 종속되지 않기 때문이다.
2. 모든 imported·future 글의 유일한 canonical은 `/posts/{globalSequence}`다. 최초 596건은 게시시각 UTC 오름차순과 exact tie의 `source:sourceId` ASCII byte 순서로 한 번만 배정하고, 이후에는 append-only로 최대값 + 1만 사용한다.
3. 기존 티스토리 `/{id}` 164개와 네이버 `/naver/{logNo}` 185개는 canonical이 아니라 정확한 identity→sequence alias로 유지한다. 옛 숫자를 새 순번으로 복사하거나 비슷한 글로 추정 연결하지 않는다.
4. 공개 범위는 가장 보수적으로 보존한다. 원본이 비공개이면 새 사이트에서도 기본 비공개다.
5. 원문 스냅샷과 표시용 본문을 분리한다. 정리 과정에서 손실이 생겨도 원본과 대조할 수 있게 하기 위해서다.
6. 작성자가 올린 티스토리 사진은 로컬로 내려받아 해시를 기록한다. 외부 기사·상품 링크의 미리보기 이미지는 소유 미디어와 섞지 않고 외부 링크 카드로만 남긴다.
7. 지도 원본·raw는 로컬 보존 증거로 남기되, 공개 표현과 R2 집합에서는 지도 공급자 자산 99개를 제외하고 장소 카드 16개·네이버지도 링크로 대체한다. YouTube 영상은 원본 외부 임베드를 유지한다.
8. 약 1.2GB의 티스토리 미디어는 현재 로컬 공개 폴더에 있으나 Git 추적 대상에서 제외한다. 실제 운영 전에는 대용량 정적 호스팅 또는 객체 저장소 정책을 확정한다.
9. 네이버 공개 글과 비공개 글은 캡처 시점부터 물리적으로 분리한다. 공개 raw·본문·미디어는 각각 `migration/raw/naver/`, `src/data/posts/naver/`, `public/media/naver/`에 두고, 비공개 raw·본문·미디어는 모두 `migration/private/naver/` 아래에만 둔다.
10. 네이버 편집기 세대는 게시연도만으로 추정하지 않고 실제 DOM 표식으로 `legacy-smarteditor`, `smarteditor-3`, `smarteditor-one`을 판정한다. 같은 연도에도 편집기 세대가 섞이기 때문이다.
11. 네이버 canonical raw는 작성 본문 루트 `content.html`과 출처 래퍼 `wrapper.html`로 정의한다. 기존 `page.html`은 브라우저 반환 길이 제한으로 432건 전부 잘렸고 플랫폼 UI·스크립트를 중복 포함하므로 비정본 진단 자료로만 유지한다.
12. 완전했던 legacy 본문 421건은 바이트·SHA-256·닫힌 루트·캡처 당시 브라우저 관측 길이가 모두 맞을 때만 v2 canonical로 승격하고, 잘린 11건은 인증 브라우저에서 청크 방식으로 별도 `recapture-v2`에 재캡처한다. 기존 immutable raw는 덮어쓰지 않는다.
13. 네이버 미디어는 일반 이미지뿐 아니라 인라인 배경, 비디오 poster, 직접 재생 가능한 비디오, 첨부파일을 각각 매니페스트에 기록한다. 직접 바이너리는 내려받아 해시·로컬 경로를 보존하고 스트리밍·외부 플레이어는 외부 참조 정책을 명시한다.
14. 고해상도 선호 URL이 HTTP 404인 경우에만 raw DOM에 실제 기록된 관측 URL을 제한적 fallback으로 사용한다. 선호 URL 실패와 fallback URL·HTTP 상태·MIME·크기·SHA-256을 함께 기록한다.
15. 티스토리 이전은 완료 기준선이므로 다시 실행하지 않는다. 이후 작업은 네이버와 통합 검증에 한정하며 기존 티스토리 산출물을 회귀 검증 대상으로만 다룬다.
16. 새 raw 저장은 같은 디렉터리의 0600 임시 파일에 완전히 쓰고 fsync한 뒤 hard-link no-replace로 commit한다. 기존 immutable 파일은 동일 바이트일 때만 재사용하고 절대 덮어쓰거나 삭제하지 않으며, 중단된 임시 파일은 정본과 구별해 전용 quarantine으로 격리한다.
17. importer는 schema 2 매니페스트의 canonical 경로를 따르고 normalization 3만 최종 파생 결과로 인정한다. 경로 탐색·symlink, 허용되지 않은 raw 방식·불완전 증거, 비공개 대상 링크, 외부 이미지 잔류를 거부하고 정규화 본문 SHA-256을 매니페스트와 재확인한다.
18. 공개 분류는 `source + categories.at(-1)`의 NFC 정규화·완전일치로만 중앙 taxonomy에 연결한다. 비슷한 이름을 자동 병합하지 않으며 `일상`과 `일상 이야기`도 서로 다른 root로 유지한다.
19. 기존 카테고리 18개의 첫 페이지 URL은 그대로 canonical로 유지한다. 부모 페이지는 직접 글과 모든 자손 글의 합집합, 자식 페이지는 해당 leaf의 글만 보여 주고 목록은 15편씩 정적 pagination한다.
20. 태그 identity는 NFC 정규화한 정확한 label로 유지하고 Unicode 문자·숫자를 보존하는 결정적 slug를 쓴다. 충돌 시 원 label의 base64url suffix를 붙여 자동 덮어쓰기 없이 경로를 유일하게 만든다.
21. 상세 하단은 같은 deepest leaf의 가까운 글을 최대 5편 연결하고, 전체 공개 글의 결정적 날짜·globalSequence 정렬에서 더 오래된 글과 더 새로운 글을 각각 이전·다음으로 연결한다. 비공개 데이터는 후보 집합에 들어오지 않는다.
22. 전역 순번은 날짜 수정·backfill로 재정렬하지 않고 tombstone·비공개가 만든 gap도 재사용하지 않는다. 비공개에서 공개로 전환할 때는 기존 순번을 유지한다.
23. 과거 본문 링크는 공개 글만으로 만든 중앙 registry가 대상을 증명할 때만 빌드 표현 계층에서 canonical 상대경로로 바꾼다. raw·normalized·frontmatter·importer는 변경하지 않으며 다른 네이버 사용자와 불명확한 주소는 자동 병합하지 않는다.
24. 공개 registry에 없는 소유 도메인 글은 다른 글로 추정 연결하지 않는다. 현재 확인된 2회는 공개 출발 경로와 발생 횟수만 allowlist하고, 대상 URL·ID 없는 중립 note로 표시하되 보존 media와 순서는 유지한다.
25. 네이버 편집기의 제목·이미지·지도·영상·프로필·URL 복사·player control 링크는 authored 링크와 DOM 구조로 구분해 비활성화한다. 외부 authored 링크는 href multiset을 그대로 보존한다.
26. 공개 URL registry는 canonical 경로뿐 아니라 `source:sourceId` identity도 별도로 유일해야 한다. 같은 source identity가 다른 canonical을 가리키면 빌드를 거부하되 서로 다른 source의 같은 raw ID는 충돌로 보지 않는다.
27. RSS 글 `link`와 `guid`는 trailing slash 없는 exact canonical URL과 완전히 같아야 하고 `guid`는 permalink여야 한다. 검증에서 slash를 제거해 차이를 숨기지 않는다.
28. 내부화한 링크의 표시문자 전체가 같은 registry 대상 URL인 경우에만 상대 canonical 표시로 바꾸고, link card 탐색용 URL metadata도 registry hit만 canonical로 바꾼다. 임의 제목·설명·외부 card metadata는 변경하지 않는다.
29. 전체 596건 원장은 `migration/private/sequence/`의 mode 700 디렉터리와 mode 600 단일 파일에만 두며 제목·본문·HTML을 금지한다. 공개 빌드는 전체 원장을 import하지 않고 공개 349건·허용 필드 5개만 담은 `src/data/public-sequence-v1.json`을 읽는다.
30. 비공개 247건이 예약한 sequence는 공개 projection에 identity·날짜·sequence 대응이나 `nextSequence`로 노출하지 않고, 해당 `/posts/{sequence}`도 만들지 않는다. 전체 원장이 없는 CI·clone에서 새 번호 배정은 fail closed한다.
31. legacy alias 349개는 본문을 복제하지 않고 `noindex, nofollow`, 최종 absolute canonical, 즉시 meta refresh·JavaScript와 일반 fallback 링크만 제공한다. alias는 검색·RSS·sitemap에 포함하지 않는다.
32. provider-neutral 308 대응표는 `docs/EDGE_REDIRECTS_V1.json`으로만 기록하며, 실제 edge 설정·배포·DNS는 사용자 승인 전 변경하지 않는다.
33. 최초 allocation digest와 최초 공개 projection digest는 genesis 증거로 고정하되 현재 visibility·status·projection은 합법적인 공개 전환·tombstone·append에 따라 변할 수 있다. validator는 둘을 혼동해 현재 상태를 영구 349건으로 고정하지 않는다.
34. 공개 route의 기준 집합은 frontmatter의 visibility만이 아니라 공개 projection membership이다. private→public은 안전한 공개 content와 local asset이 먼저 준비된 경우에만 기존 sequence로 추가하고, tombstone은 원장 예약을 유지한 채 route·alias·검색·RSS·sitemap에서 제거한다.
35. 최초 비공개 metadata는 제목·본문·HTML이 없는 mode 600 sidecar로 분리한다. 초기 채택 이후 allocator·validator는 글별 private migration manifest를 다시 읽지 않고 sidecar·전체 원장·seal·journal만 사용한다.
36. sequence writer는 no-replace bootstrap seal, hash-chain append journal, generation CAS lock과 privacy-safe ledger/projection transaction을 사용한다. verify는 파일·권한을 바꾸지 않으며, seal 뒤 원장 유실은 재-bootstrap하지 않고 검증된 journal replay로만 복구한다.
37. bootstrap 뒤 새 sequence 배정은 `source=native`만 허용한다. imported `tistory`·`naver` namespace는 동결하며, 최초 원장에 이미 예약된 비공개 Naver 글은 안전한 공개 산출물이 준비된 뒤 `set-visibility`로 기존 번호를 유지한다.
38. 모든 공개 소비자는 공개 projection과 준비된 public content의 exact identity join을 같은 기준 집합으로 사용한다. promotion·tombstone 뒤 route·alias·검색·RSS·sitemap·validator가 서로 다른 고정 349 목록을 사용하지 않는다.
39. 최초 imported 공개 349 identity의 asset evidence 면제는 mutable inventory membership이 아니라 고정 SHA-256 `2190984504722fd7b8f4b5a0ac38ecf29948e4e18b9c890ad0a76f54f059ea69`로 증명한다. 공개 전환·native 글은 `src/data/public-asset-receipts-v1.json`의 content SHA와 exact asset set을 필수로 하며 orphan·duplicate receipt를 거부한다. receipt에는 공개 identity와 asset 검증 필드 외 제목·본문·HTML·비공개 경로를 넣지 않는다.
40. 초기 bootstrap·기존 원장 채택은 projection을 마지막에 쓰는 no-replace initialization marker로 복구하며, stale lock은 자동 삭제하지 않는다. transfer receipt v2는 원 lock의 exact token·device/inode·observed generation·raw SHA·최소 age·owner process 부재와 prebound recovery token을 receipt 자체 SHA로 묶는다. linked recovery lock은 `kind/transferId/receiptSha/generation/recoveryToken` exact schema를 쓰며, 취득 직후 또는 reconcile 직후 hard exit가 나도 owner-dead·최소-age·raw/inode 재검증 뒤 같은 recovery token으로만 재획득한다. 성공 시 recovery lock을 먼저 제거·sync하고 receipt를 마지막에 제거해 완료 전까지 일반 writer를 열지 않는다.
41. 공개 미디어 canonical URL은 기존 same-origin `/media/*`를 유지하고 R2 object key는 선행 `/`만 제거한 exact 값으로 고정한다. 같은 SHA라도 서로 다른 공개 경로는 합치지 않고, key별 SHA-256·크기·MIME를 upload-once 불변 계약으로 보호한다.
42. 운영 미디어는 private R2 bucket을 same-origin Worker binding 뒤에서만 제공한다. `r2.dev`와 bucket 직접 public domain은 allowlist·tombstone 철회를 우회하므로 끄며, Worker는 모든 요청에서 static/media allowlist를 먼저 검사하고 `/media/*`에는 GET·HEAD만 구현하며 LIST·PUT·DELETE를 노출하지 않는다.
43. 기존 `npm run build`의 hydrated full-local 미디어 복사·전수 hash 검증은 유지한다. Cloudflare source-only build는 별도 임시 public directory를 사용해 local media를 읽거나 내려받지 않고 tracked manifest↔renderable reference exact set과 `dist/media=0`을 검증한다. fresh Git-style isolated fixture도 private/raw/public media 없이 같은 build를 통과해야 한다.
44. R2 sync는 기본 dry-run, create-only conditional PUT, mismatch no-overwrite, orphan report/no-delete, bounded retry와 HEAD 기반 resume만 허용한다. apply는 현재 manifest digest exact 인자와 별도 credential 환경변수가 모두 있어야 한다.
45. production 배포 gate는 Ed25519 signed remote receipt와 승인·봉인된 final manifest 전체의 HEAD exact 검증, exact Wrangler `4.125.0`, source-only build·Worker·redirect fixture를 모두 요구한다. Wrangler는 로컬 dependency와 lock에 설치됐지만 실제 receipt·signature·credential·trust anchor가 없으면 의도적으로 fail closed한다.
46. `public/_redirects`는 provider-neutral `docs/EDGE_REDIRECTS_V1.json`에서 결정적으로 만든 exact 349개 308 rule이다. `/media/*`와 wildcard는 포함하지 않고 Static Assets의 `drop-trailing-slash`를 Astro의 no-trailing-slash 계약과 맞춘다.
47. R2 객체 metadata는 객체별 SHA·MIME·cache 계약만 고정한다. 전체 manifest digest는 signed release receipt에 결속해 공개 파일 append·철회가 기존 immutable 객체 전체의 재업로드를 요구하지 않게 한다.
48. production receipt는 target environment·bucket·Cloudflare account fingerprint·검증 수준과 `r2.dev 비활성·custom domain 0` control-plane 감사 증거를 서명 범위에 포함하고, tracked release policy의 account/public-key fingerprint와 exact 일치해야 한다. exposure 증거는 gate 기준 최대 900초·미래 편차 120초만 유효하다. 현재 trust 값은 미승인 `null`이므로 production gate는 fail closed한다.
49. top-level Wrangler target의 다른 이름은 안전장치가 아니다. Workers Builds가 Worker 이름을 override할 수 있으므로 raw `wrangler deploy`는 production overwrite P0로 금지한다. production은 exact `--env production` wrapper와 version-only upload만 허용한다.
50. Cloudflare source build는 R2 credential·receipt path를 child에 상속하지 않는 strict env allowlist를 사용한다. full `200`만 객체-SHA cache key로 Cache API에 저장하고 Range·오류 응답은 edge cache에 저장하지 않는다.
51. Worker는 manifest entry SHA와 R2 platform checksum·version ID·HTTP ETag를 HEAD와 GET에서 상호 결속하며, GET 사이 race나 checksum drift는 bytes를 내보내지 않고 구조화된 `502 no-store`로 닫는다.
52. 글·alias·집계 경로와 미디어 철회는 URL exact purge를 전제하지 않는다. 최신 static/media allowlist가 Cache API·Static Assets 조회보다 먼저 deny하는 release를 forward 적용하고, 과거 allowlist Worker로 rollback하지 않는 것이 보안 경계다. provider purge는 선택적 방어 심화다.
53. production release는 결정적 core artifact와 시한부 승인/attestation을 분리한다. core는 clean Git/CI SHA, stable `worker.js`, static tree, upload/promotion 전용 config, media·redirect receipt만 담고 시각·build UUID·version ID를 금지한다. 별도 signed upload authorization 뒤 no-bundle version-only upload를 수행하고, Cloudflare version-detail attestation과 staging 동일-payload smoke를 거쳐 exact version ID traffic activation을 다시 승인받는다.
54. promotion은 signed active head의 단조 generation과 전체 artifact request-surface·누적 withdrawn path hash를 대조한다. 철회된 media/article/alias/static을 포함한 과거 version 직접 재승격과 raw rollback은 금지하며, 되돌리기도 최신 deny floor를 합성한 새 version으로 forward 적용한다.
55. 사용자는 플레이스홀더 정리에 B를 선택했다. 1×1 placeholder 27개는 공개 manifest에서 제외하되 재생 불가 안내·재생시간 53개와 작성자 캡션 23개는 유지하고, placeholder cover 13개의 파생 cover는 `null`로 둔다.
56. 실제 `dwnc.me` 도메인·DNS·route가 Cloudflare Worker에 연결되지 않았으므로 `production`이라는 이름의 Worker·R2·version 작업도 현재 방문자 트래픽에 영향을 주지 않는다. 다만 실제 도메인·DNS 변경은 하지 않는다.
57. 이미 승인된 작업 순서는 앞 단계의 기술적 조건이 통과하면 직전 사전점검 후 계속하며, 단순히 추가 승인을 받기 위해 임의로 중단하지 않는다. Git push·실제 도메인/DNS 변경·보호 절차 없는 `wrangler deploy`·덮어쓰기·삭제·비밀값 기록은 여전히 하지 않는다.
58. Cloudflare R2의 S3 `x-amz-version-id`는 Workers binding의 `R2Object.version`과 같은 필수값으로 간주하지 않는다. 현재 공식 호환표에서 bucket versioning API는 미지원이므로 S3 HEAD/GET에서 없으면 canonical `null`로 기록한다. 양쪽 모두 있으면 exact 일치, 양쪽 모두 없으면 ETag·Last-Modified와 전체 integrity metadata exact 일치, 한쪽에만 있거나 값이 다르면 generation mismatch로 거부한다.
59. bulk `dwnc-public-media-r2-bulk-sync-v1` receipt는 업로드·재시도·post-HEAD 운영 증거일 뿐 `media-receipt` signer나 release artifact 입력이 아니다. `dwnc-public-media-r2-receipt-v1`의 `full-get-sha256` 결과만 별도 서명할 수 있다. staging receipt·서명은 staging에만 유효하며 향후 production은 별도 bucket/account 전수 감사와 production 전용 신뢰값이 필요하다.
60. 업로드 전 bucket 설정 확인 capture와 full audit capture를 분리한다. bulk와 strict post-inspection 뒤 새 900초 capture를 수집해 곧바로 전수 감사를 시작하고, 감사 `startedAt`과 receipt `verifiedAt`을 모두 `expiresAt` 전으로 강제한다. 만료되면 새 capture와 아직 쓰지 않은 새 receipt 경로로 2,758개 GET/SHA-256 감사를 처음부터 다시 실행한다.
61. 사용자용 진행 설명은 비개발자가 이해할 수 있는 일상적인 한국어를 우선한다. 먼저 무엇을 확인하거나 완료했는지, 사용자에게 어떤 의미인지, 다음에 무엇을 하는지 설명한다. 기술 정보는 요청받았거나 검증에 꼭 필요한 경우에만 `기술 참고`로 분리하고 쉬운 뜻을 함께 적으며, 번역투와 조직 내부 용어를 그대로 사용하지 않는다. 이 결정은 상시 요구사항 `DWNC-OPS-004`로 관리한다.
62. 프로젝트의 전체 흐름은 `PLAN-00`부터 `PLAN-09`까지의 안정적인 계획 ID로 관리한다. 모든 요구사항은 하나 이상의 계획 ID와 우선순위를 가져야 하며, 새 요청으로 범위나 순서가 바뀌면 요구사항 원장·현재 위치·다음 작업을 같은 변경에서 갱신한다. 대화만 공식 상태로 삼지 않고 이 규칙을 상시 요구사항 `DWNC-OPS-005`로 관리한다.

## 완료한 작업

### 원본 범위 확인

- 티스토리 사이트맵 숫자형 공개 글 164개를 확인했다.
- 네이버 공개 블로그 화면의 글 수 195개(일상 68, 수영 계열 127)를 확인했다.
- 로그인된 네이버 소유자 글 저장 화면에서 직접 작성 글 432개를 전수 목록화했다.
- 네이버 직접 작성 글은 전체공개 185개, 비공개 247개다.

### 새 사이트 구현

- 사진 일기형 홈과 책면형 글 상세를 잇는 반응형 편집 디자인을 구현했다.
- 홈, 모든 글, 연도별 아카이브, 카테고리, 소개, 글 상세, 검색, RSS, 사이트맵, robots.txt, 404 페이지를 구현했다.
- 공개 글은 전역 순번 canonical로 생성하고, 기존 티스토리·네이버 주소는 최소 alias 문서로 생성한다.
- 콘텐츠 스키마에서 `visibility: public`만 공개 콘텐츠 트리에 들어가도록 제한했다.

### 공개 미디어 R2 전달 Stage 2

- 공개 projection·public content·기존 공개 inventory/receipt만으로 `src/data/public-media-r2-v1.json`을 결정적으로 생성했다. 2026-08-25의 2,889개·2,350,053,092바이트는 정리 전 역사 기준선으로 보존한다. 현재 최종 기준선은 2,758개·2,346,220,246바이트·SHA-256 `61bb577d609f97cdb014ef3a14681045fbb3bec616f2b04c8d058519b640c532`이다. 제목·본문·HTML·비공개 identity·credential 필드를 허용하지 않는다.
- `scripts/lib/public-content-preflight.mjs`에 명시적 `local`·`manifest` 자산 모드를 추가했다. 기존 local mode는 바이트·SHA 검증을 그대로 유지하고 source-only mode는 로컬 미디어를 읽지 않으면서 manifest↔렌더 참조 exact set을 검증한다.
- dependency-free SigV4 S3 client와 R2 sync·remote HEAD validator를 추가했다. pagination, retry/resume, create-only precondition, mismatch no-overwrite, orphan no-delete와 detached Ed25519 receipt 검증을 mock fixture로 고정했다. S3 version ID 부재는 `null`로 보존하되 HEAD↔GET의 ETag·Last-Modified·length·MIME·cache·SHA metadata·platform checksum·manifest-entry digest를 exact 결속한다. 객체별 metadata는 SHA·MIME·cache 계약만 결속하고 전체 manifest digest는 signed release receipt에서 결속해 append·철회가 기존 immutable 객체의 재업로드를 요구하지 않는다.
- validator 역할에 고정된 `media:r2:staging:inspect:secure` 명령을 추가했다. 이 명령은 exact staging bucket에서 LIST와 manifest 2,758개 HEAD만 수행하며 `--apply`, uploader metadata, production target, overwrite·delete 인자를 거부한다. 모든 R2 entrypoint가 익명 pipe FD 3의 자격증명을 정확히 한 번만 읽도록 client와 target context를 함께 만들게 고쳐 이중 읽기 차단 문제를 해소했다. mock 검사는 exact 0·missing 2,758·mismatch 0·orphan 0, PUT 0·DELETE 0을 통과했으며 실제 R2 객체는 변경하지 않았다.
- validator 역할에 고정된 `media:r2:staging:validate-one:secure` 명령을 추가했다. clean exact Git SHA·tracked manifest의 한 key·staging account fingerprint/private bucket을 첫 요청 전에 결속하고 `maxAttempts=1`로 자동 재시도 없이 HEAD 1회와 status 200 full GET 1회만 수행한다. `HEAD→status→HEAD` Git 검사를 요청 전·요청 후·create-only receipt 기록 직전에 반복한다. HEAD↔GET의 size·MIME·cache·custom SHA·platform checksum·manifest-entry SHA·ETag·Last-Modified·nullable version이 같은 세대여야 한다. 외부 mode 700 parent에 create-only mode 600 receipt를 쓰며 `--apply`, production/uploader 주입, legacy credential, partial/range body, 기존 output과 drift를 거부한다. anonymous-FD child mock 178 assertions는 첫 HEAD/GET 500·network 오류의 재시도 0, tracked file·HEAD 이동 경합 거부와 안전 복구, HEAD 1·GET 1·PUT 0·DELETE 0을 통과했고 실제 R2 요청은 0이다.
- `cloudflare:r2:exposure:fetch`를 exact staging account fingerprint·bucket·read-only purpose 전용으로 보강했다. 짧은 수명의 Cloudflare API token은 clipboard에서 framed anonymous FD 3으로 전달한다. credential decoder는 1회만 호출하고 FD 내부에서는 max+1 고정 buffer로 EOF까지 반복 read해 delayed multi-chunk는 허용하되 EOF 전 조기 성공, trailing·length·digest·oversize를 거부한다. 환경변수·argv·디스크·Keychain 저장과 legacy token 주입도 거부한다. exact source commit/tree/clean 상태를 요청 전·세 GET 뒤·receipt 직전에 확인하고, bucket→managed domain→custom domains의 재시도 없는 GET 3회 외 모든 method/path를 거부한다. 응답은 `response.text()` 없이 최대 1MiB+1 경계까지만 streaming read하며 초과 즉시 cancel하고 200/non-200 모두 fatal UTF-8을 적용한다. bucket 응답의 jurisdiction `default`를 세 요청 header에 결속하고 location `apac`·storage class `Standard`·managed domain 비활성·custom domain 0을 canonical evidence로 만든다. raw body는 저장소 밖 mode 700 parent에 create-only mode 600으로만 기록하며 stdout에는 account fingerprint·response SHA·canonical 필드만 허용한다. capture만 남은 partial output은 `cloudflare:r2:exposure:recover`가 credential/API 0으로 secure canonical capture·freshness·policy·Git·fingerprint·bucket을 재검증해 누락 evidence만 create-only 생성한다. mock auth 66·exposure 145 assertions를 통과했고 실제 browser/API/Keychain/network 접근과 원격 변경은 0이다.
- `src/worker.ts`와 `src/lib/media-worker.ts`에 all-request same-origin Worker를 추가했다. non-media는 tracked 1,410경로 exact allowlist를 통과한 GET·HEAD만 `ASSETS`로 전달하고, miss·encoded traversal·철회 경로는 asset/cache 호출 전 `404 no-store`로 닫는다. `/media/*`는 strict manifest allowlist, GET·HEAD, ETag/304, If-Range validator, single Range 206, invalid/multiple Range 416, HEAD Range 무시, 405, indistinguishable 404, upstream 502, MIME·Length·Last-Modified·nosniff·cache header를 구현했다. HEAD·GET·Range는 tracked manifest entry SHA, R2 platform SHA-256 checksum, version ID와 HTTP ETag를 함께 검증하며 race나 checksum drift는 bytes를 내보내지 않고 `502 no-store`로 닫는다.
- `wrangler.jsonc`는 Static Assets `run_worker_first=true`, staging·production 별도 `MEDIA_BUCKET` binding을 가진 미배포 draft다. top-level name은 안전장치로 간주하지 않는다. staging smoke origin은 `https://dwnc-me-staging.dwnc.workers.dev`이고 Bearer token 정책 digest는 `d6c554c1d80c68c08605636f12f26a411f7826bc40eddaee9233a30b6551781a`다. private staging bucket은 존재하지만 Worker·route·binding·token은 아직 없다.
- `public/_redirects`는 provider-neutral manifest의 exact 349개 308 rule로 생성하고 `/media/*`·wildcard·중복을 validator와 fixture로 거부한다.
- Node `24.18.0`, package manager 기준 npm `10.9.2`(허용 범위 `>=10.9.2 <12`), exact Wrangler `4.125.0`을 package/lock에 고정하고 로컬 설치했다. 현재 호스트 npm `11.16.0`과 Cloudflare 기본 npm `10.9.2`를 모두 허용한다. 이 로컬 구현 단계에서는 Cloudflare resource·credential·배포를 만들거나 실행하지 않았다.
- 순환하던 pre-version release receipt를 결정적 core artifact→signed upload authorization→no-bundle version-only upload→live version-detail attestation→signed promotion의 two-phase 계약으로 교체했다. Wrangler session/version-upload NDJSON은 exact argv와 단일 version event를 검사하고 traffic event를 거부하며 `worker_tag`는 opaque로 취급하고 실제 artifact annotation은 `versions view`의 `workers/tag`로 증명한다. core artifact는 build UUID·시각·version ID 없이 static tree와 `worker.js`를 각각 두 번 생성해 byte equality를 확인한다.
- production promotion executor는 보호된 signed active head, source Git ancestry, 단조 generation, 누적 withdrawn request surface와 retired artifact/payload/version을 대조한다. authorization one-time claim과 lock-held fresh deployment status CAS 뒤 exact argv를 `execFile`로 한 번만 실행하고, raw status·command result·outcome을 no-replace로 보존한다. target 100%일 때만 signed head를 원자 교체하며 이전 version 100%·split·timeout·unknown은 lock과 pending을 유지한다. owner-dead·5분 경과 후 exact recovery token으로만 status-only 복구하며 deploy를 재실행하지 않는다.
- production·staging 최초 service는 signed 존재 증거와 one-time authorization을 요구하는 외부 surface 0 deny-only bootstrap으로 분리했다. 최초 read-only 확인은 raw Cloudflare JSON과 5분 evidence 후보를 함께 보존하고, executor는 deploy 직전 15초 이내의 exact service-not-found 404(code 10007/10090)만 다시 인정한다. staging smoke token은 암호학적 난수 32바이트를 padding 없는 base64url 43문자로 만들고, 평문을 argv·env·receipt에 노출하지 않는다. staging media·release signing key는 macOS Keychain에 생성했지만 token·endpoint·version·receipt는 아직 없다. staging은 production과 다른 exact version ID를 fresh status CAS·pending/invoking/outcome lock 아래 100% 활성화하며 ambiguous 결과는 owner-dead·5분 뒤 status-only recovery에서만 확정한다. Bearer로 보호한 `workers.dev` endpoint에서 GET·HEAD·304·206·416·MIME·ETag·static·349 redirects·cache·미인증 deny를 증명한다.
- 세부 운영·철회·rollback·승인 계약은 `docs/MEDIA_SERVING_CONTRACT.md`에 기록했다.

### Cloudflare Stage 3 사전점검·Builds guard

- 2026-08-25 로그인된 Chrome에서 production Worker `dwnc-me`와 연결 repository `tsusaikang/dwnc.me`를 다시 확인했다. 로그인 대상에서 domain-separated 방식으로 계산한 account fingerprint는 tracked policy의 `6ef9d1a2e2a398e755e1d4108acabacde0f5218f9f455abf79f1af56a154ea0f`와 exact 일치했고 raw account ID·계정 표시명·credential 값은 저장소와 이 문서에 기록하지 않았다.
- 2026-08-25 관측한 Builds 서버 readback은 `SKIP_DEPENDENCY_INSTALL=1`, Build `npm ci && npm run cloudflare:prepare:production`, Deploy `npm run cloudflare:upload:production-version`, Version `npx wrangler versions upload`, root `/`, production branch `main`, included paths `*`였다. 그 관측에서 raw live `wrangler deploy` 설정은 0이었다. 다음 외부 변경 전에는 다시 읽는다.
- 2026-08-25 관측 당시 설정이 승인된 안전 상태와 exact 일치해 Chrome 재확인에서는 retry 0·설정 mutation 0이었다. traffic·DNS·route·custom domain·binding·R2 bucket/object·token·Worker version·Git 원격 상태를 포함한 unrelated external change도 0이었다.
- 과거 실패 Build ID `7c26b9ab-0105-4c7a-9be1-9c825b8804c8`는 source commit `18b214d9dd1a894ebf33f5f5c82d40c370535fe3`에서 Build `None`, Deploy `npx wrangler deploy`, environment variable 0이던 이전 설정으로 실행됐다. dependency install 뒤 raw deploy가 시작되고 Astro 자동 구성을 거친 다음 `public/.assetsignore` 누락으로 실패했으며, npm build 완료나 Worker upload가 일어났다는 증거는 없었다.
- 2026-08-25 관측에서 실패 Build의 retry는 0이고 당시 UI의 같은 `19h` 상대시간 구간에 새 version/deployment가 생겼다는 증거도 0이었다. 그 시점 Dashboard의 active deployment 표시는 prefix-only `f0a8bec2`(traffic 100%, UI `20h`), 별도 version 표시는 prefix-only `1ad98585`(UI `20h`)였다. 이 값과 상대시간은 historical observation일 뿐 현재 상태나 full deployment/version ID로 추정·확장하지 않는다.
- 최초 guard 변경 전 readback은 Build `None`, Deploy `npx wrangler deploy`였다. 이를 현재 safe Build와 version-only Deploy wrapper로 교체했으며, traffic promotion은 Git trigger에 포함하지 않는다.
- 같은 account fingerprint를 다시 확인한 뒤 R2 subscription을 활성화하고 exact private bucket `dwnc-me-public-media-staging`을 만들었다. 첫 admission 직전 재확인에서 bucket은 object 0, private, `r2.dev` 꺼짐, custom domain 0, jurisdiction `default`, location `APAC`, storage class `Standard`였다.
- 현재 uploader는 `dwnc-me-public-media-staging-uploader-v3-20260827`, scope는 exact bucket Object Read & Write, 상태는 Active, TTL은 2026-09-03이다. access-key ID SHA-256은 `6a6df74afbbc4a47fe050b11997b41b6e5e7ba9d02884eb69bb9ac88d82bb976`, repository 밖 metadata SHA-256은 `6d92f8e095050757c407bf31a02e8358c4064e7b9852f44c98037de7f331721e`, Dashboard scope 증거 SHA-256은 `de8c69f1cfa1c26e9ba05cae05f7034f2129494c174ab43d6b2cac44daf85e69`이다.
- 현재 validator는 `dwnc-me-public-media-staging-validator-v2-20260827`, scope는 exact bucket Object Read only, 상태는 Active, TTL은 2026-09-03이다. access-key ID SHA-256은 `be4156f1e29c6282568d18e504d11888907e0df9c8f67a551318a839c735ee5a`, repository 밖 metadata SHA-256은 `03011557f3ae08f1128c10bd5df0508dc50e0bdbbc5652de08f63f05e142fe0c`, Dashboard scope 증거 SHA-256은 `6abc799040f8604af78eaa9d96e8745501b3a4a84054944bdab40918be4dde94`다.
- 생성 실패 과정에서 비밀값 노출 가능성이 생긴 `dwnc-me-public-media-staging-uploader-v2-20260827`은 즉시 revoked했다. 정상 생성된 두 자격증명은 일반 출력·로그 비밀값 노출 0, clipboard 사용 0이며 비밀값은 문서에 기록하지 않는다. 2026-08-25의 기존 uploader·validator token 두 개는 비밀값을 잃어 사용할 수 없지만 Cloudflare에서는 아직 Active여서 후속 정리가 필요하다.
- staging media·release Ed25519 private key를 macOS Keychain에 생성했고 private export는 0이다. public fingerprint는 각각 `69cb5866228f1624693b0903e60d52b0c046464040da621b2d144cb8bffb2182`·`2655be4122fb2238d47ba539b8e86aa9d39899631a7d713106ce711ea2de1ac2`로 policy에 고정했다. staging Worker `dwnc-me-staging`, Bearer smoke token, Worker version, activation, receipt는 0이다. staging origin은 `https://dwnc-me-staging.dwnc.workers.dev`, 접근 정책 digest는 `d6c554c1d80c68c08605636f12f26a411f7826bc40eddaee9233a30b6551781a`다. 실제 `dwnc.me` 도메인·DNS·route는 Cloudflare Worker에 연결되지 않았다.

### 공개 미디어 소유·플랫폼 후보 감사와 현재 결정

- tracked pre-curation manifest 2,889개를 source inventory와 다시 결합해 Naver `platform-asset` 104, `embedded-data` 26, Tistory static map 2의 exact 후보 132개를 재구성했다. manifest join, 실제 disk size·SHA-256 mismatch는 0이고 고유 SHA-256은 65개다.
- 시각 감사 결과는 지도 공급자 자산 99(Naver tile 68 + Naver static map 14 + Naver pin/scale/cursor 15 + Kakao static map 2), LINE store 스티커 5, 무내용 1×1 placeholder 27(SVG 26 + blank GIF 1), SBS 수영 방송 화면 GIF 1이다. 사용자 촬영 사진처럼 보이는 후보 오분류는 0이었다.
- 사용자는 후보 밖 2,757개가 본인 소유 사진임을 확인했고 B를 선택했다. 지도 99개는 R2 집합에서 제외하고 위치 문맥을 장소 카드·네이버지도 링크로 대체했다. LINE 스티커 5개와 blank placeholder 27개는 제외했고 SBS GIF 1개는 포함했다.
- 최종 집합은 2,758개·2,346,220,246바이트·manifest SHA-256 `61bb577d609f97cdb014ef3a14681045fbb3bec616f2b04c8d058519b640c532`이다. local·source-only·build·Worker 회귀를 통과했다. 당시 첫 create-only PUT 뒤 parser가 중단돼 객체 1개 생성 여부를 읽기 전용으로 재확인해야 했고, 이후 exact 1임을 확인한 다음 bulk로 나머지 2,757개를 올려 현재 exact 2,758이 됐다. 2,889개는 정리 전 역사 기준선이며 2,785개는 B 결정 전 중간 검토 수치다.
- 지도 대체는 영향 canonical 글 5개의 장소 카드 16개로 구현했다. 15개는 원 장소 링크이고 원 주소가 없는 `/posts/439`의 1개만 Naver 검색 fallback이다. 1440×1000·390×844의 light/dark 4조합에서 제목·주소·링크 overflow 0, 과거 공급자 이미지 0, 키보드 focus와 accessible name을 확인했다.
- LINE 스티커 5개는 링크·이미지·빈 wrapper 없이 제외됐고 본문 문자는 보존됐다. 최초 시각 QA에서 `/posts/37`과 `/posts/63`의 제거 경계에 큰 세로 공백 P2를 발견했지만, 파생 표현 계층이 스티커 제거로 맞닿은 exact boundary의 whitespace만 collapse하도록 보완해 구조·build validation을 통과했다. SBS GIF는 `/posts/386`의 cover·본문에서 정상 렌더됐다.
- unavailable-video fallback은 26개 페이지·53개 표시에서 `role=note`와 label, 재생시간, 가로 overflow 0, desktop/mobile 가독성을 확인했다. 작성자 캡션 23개는 그대로 남고 placeholder cover 13개의 파생 cover는 `null`이다. 사이트는 `color-scheme: light`로 고정돼 dark emulation에서도 light palette를 유지하는 P3 informational 상태다.
- SBS GIF `/media/naver/221172590451/001-e467d08a3a01.gif`는 1,299,862바이트·SHA-256 `e467d08a3a01bf5bcc53c79f2a40e89d0181a8c920e08b62a1a513c3d93656d9`로 본문·cover에서 그대로 유지했다.

### Cloudflare Stage 3 로컬 staging admission 준비

- 승인된 로컬 변경은 정확히 20경로다: `package.json`, `src/data/public-media-release-policy-v1.json`, `scripts/lib/public-media-remote.mjs`, `scripts/lib/cloudflare-staging.mjs`, `scripts/lib/public-media-manifest.mjs`, `scripts/lib/cloudflare-release.mjs`, `scripts/lib/cloudflare-artifact.mjs`, `scripts/admit-public-media-r2-staging-object.mjs`, `scripts/prepare-cloudflare-staging.mjs`, `scripts/collect-cloudflare-staging-admission-smoke.mjs`, `scripts/upload-cloudflare-staging-version.mjs`, `scripts/fetch-cloudflare-staging-version-detail.mjs`, `scripts/attest-cloudflare-staging-version.mjs`, `scripts/fetch-cloudflare-staging-deployment-status.mjs`, `scripts/activate-cloudflare-staging-version.mjs`, `scripts/probe-cloudflare-staging-media.mjs`, `scripts/test-public-media-r2.mjs`, `scripts/test-public-media-contract.mjs`, `scripts/test-cloudflare-artifact.mjs`, `scripts/test-cloudflare-staging.mjs`.
- 새 package command는 `npm run media:r2:staging:admit-one`, `npm run cloudflare:prepare:staging`, `npm run cloudflare:staging:admission-smoke`다. single-object admission은 exact staging account/bucket/policy/manifest와 한 key를 결속하고 pre-HEAD→`If-None-Match:*` PUT→post-HEAD→full GET SHA/size/MIME/cache/custom SHA를 검증한다. 412는 post-HEAD exact일 때만 성공하며 mismatch는 overwrite하지 않는다. receipt는 repository 밖 mode 700 parent에 `wx`·mode 600으로 쓰고 realpath·device/inode를 write 전후 재검증한다.
- staging probe는 실제 `R2S3Client.head()`를 사용하고 Worker full GET·206의 ETag, 첫 byte, exact `Content-Range`, `Content-Length: 1`을 결속한다. staging-only deterministic artifact는 clean Git·`WORKERS_CI_COMMIT_SHA` gate를 유지하되 production receipt/attestation을 요구하지 않으며, worker/static payload digest와 환경별 control-plane metadata를 분리한다. staging admission smoke는 staging version attestation/status/probe만 요구하면서 static·349 redirects·media GET/HEAD/304/206/416 계약을 재사용한다. 기존 production preparer·validator·promotion smoke는 약화하지 않았다.
- staging artifact validator는 tracked current manifest와 policy, non-null staging media public-key fingerprint, signed `full-get-sha256` receipt, exact private staging bucket, `r2.dev=false`, custom domain 0, orphan 0을 다시 강제한다. legacy production artifact에서는 이 staging authority loader를 호출하지 않아 기존 production promotion 경로를 보존한다.
- 독립 리뷰에서 P1 2건과 P2 1건을 발견해 모두 해소했고 재검토의 새 finding은 0이다. 변경 범위 syntax 13/13, targeted 151 assertions, 최종 `npm run cloudflare:test` 12 suites·463 assertions, `git diff --check` PASS, live network 0, deployment attempt 0이다.
- 당시 local commit preflight 시작 직전 HEAD는 `18b214d9dd1a894ebf33f5f5c82d40c370535fe3`, candidate는 94경로, staged 0이었고 그 시점의 staging single-object receipt/upload, final-set bulk upload/audit, Worker version upload와 version ID는 모두 0이었다.
- commit preflight에서 Git 비추적 generated `worker-configuration.d.ts`의 Wrangler canonical trailing whitespace와 기본 `git diff --check`가 충돌함을 발견했다. generated 파일 한 경로에만 `whitespace=-blank-at-eol`을 적용하고 pinned Wrangler로 canonical output을 재생성하며, `src/data/genesis-public-identities-v1.json`의 EOF extra blank line은 JSON 의미 불변으로 제거했다.
- 검증된 95경로 candidate는 `+54,315/-1,664`, content manifest SHA-256 `35bca34d5a0dc4a679584de5dc3325d144ad2ecc9f40ec26664f4383b604a799`였고 `feat: add guarded Cloudflare media release pipeline` source commit으로 기록했다. commit은 `a541803bcf35fe95f761f0964e21ceff405c048b`, parent는 `18b214d9dd1a894ebf33f5f5c82d40c370535fe3`, tree는 `2a874c3a9b450c531cff58f954ab3d3f15abdd2c`다.
- source commit 뒤 공식 상태를 기록한 checkpoint commit은 `697629007bcc3e30c30083fb402b28db20d5505f`, parent `a541803bcf35fe95f761f0964e21ceff405c048b`, tree `3607ac3e6214dca881ede51147a4d4df946c131e`다. commit 직후 clean이었고 당시 local `main`은 `origin/main`의 ref `18b214d9dd1a894ebf33f5f5c82d40c370535fe3`보다 2 commits 앞서며 push는 0이었다. 그 뒤 검토한 요구사항·release-source 변경은 아래 `1f726f63381a903afdd04ec80c90407c742c82cd` commit에 포함했다.
- 최종 미디어·Stage 3 release-source 준비는 commit `1f726f63381a903afdd04ec80c90407c742c82cd`, parent `697629007bcc3e30c30083fb402b28db20d5505f`, tree `46ec12f98c74a4fdbbc92e3749574bf085ad21ee`로 기록했다.
- signing identity와 안전장치는 commit `9da8e87525f3e8ff6bd593d7047bd10fb6d1d57d`, validator 전용 inspection·FD 단일 읽기 보강은 commit `7d09f11ad5f0339be1563cc515192ed8da6726db`, S3 version-id 호환 보강은 commit `159550239419ecdb7fad22910d1da3bba4518e38`로 기록했다. 단일 객체 validator는 source commit `df3c678456f6af3471d846a32e28faa5751b9a2e`·tree `bbe8306cbf6577cd556533079593872020ddc8b5`, private-exposure read-only 수집은 commit `9d0b3c80b896f14bfce8182fd4f3fec927286a57`·tree `cf9f8756f3b78b26d26dc7de3f0de3fac3d54394`, bulk upload·strict inspection·full audit 안전장치는 commit `ccec8bb855e45ef679a4b99faf0f0633a99e089e`·tree `241a654acc387233d4e2d5e076754b345619e9ac`로 기록했다. push는 0이고 local `main`은 저장된 `origin/main` ref보다 9 commits 앞서 있다.

### 공개 디자인·파생 표현 계층 보완

- 홈은 사진 중심 3영역, 글 상세는 사진형·장문형 책면 읽기 구조로 정리했다. 큰 필명 워드마크와 물고기·한자 장식, 이전 출처를 전면에 내세우는 공개 문구는 제거하고 작은 `dwnc.me` 홈 링크만 유지했다.
- 글 유형은 원본 문자열의 태그 수가 아니라 실제 공개 표현에서 보이는 본문과 이미지 수로 판정한다. 기준은 `imageCount >= 8 || (imageCount >= 4 && textLength / imageCount < 400) || (1 <= imageCount <= 3 && textLength < 120)`이며, 이미지가 4개여도 본문이 긴 분석글은 장문형으로 남고 짧은 사진 기록 12건은 사진형이 된다.
- 티스토리 본문은 Astro와 같은 Markdown 렌더 의미를 먼저 적용한 뒤 공개 본문 길이·이미지 수를 구한다. 들여쓴 HTML이 실제 화면에서 code block이 되는 경우까지 구조 판정에 반영하며 특정 글 ID 예외는 두지 않는다.
- 한글 카테고리 경로는 URL pathname을 decode하고 NFC 정규화한 뒤 비교해 현재 메뉴의 `aria-current="page"`를 생성한다.
- 보존용 frontmatter·정규화 본문을 다시 쓰지 않고 `src/lib/public-post.ts`의 공개 파생 표현 계층을 추가했다. SmartEditor3 구조에서 `.se_documentTitle`이 든 헤더 wrapper와 플랫폼 player UI·placeholder만 제외하고 실제 본문·장소 컴포넌트·작성자 영상 캡션은 유지한다.
- 같은 공통 파생 메타 함수를 글 상세 description·Open Graph, 검색 description/searchText, RSS description과 글 유형 판정에 재사용한다. 공개 SmartEditor3 144건은 구조적으로 파생한 description과 모두 일치하며 chrome 문구 노출은 0이다. 이 함수는 `U+200B`–`U+200D`와 `U+FEFF`도 공개 파생 텍스트에서 제거한다.
- 공개 Naver `<video>` 81개를 전수 분류했다. 로컬 MP4 28개는 모두 GIF형이라 `autoplay muted loop playsinline` 정책을 적용했고, source 없는 53개는 연결 가능한 로컬 video manifest가 없음을 확인한 뒤 원래 위치에 영상 길이를 포함한 명시적 재생 불가 fallback을 제공한다.
- source 없는 영상의 죽은 플랫폼 player UI는 공개 파생 HTML에서만 걷어내며 video 요소 81개와 미디어 순서를 유지한다. 작성자가 쓴 영상 캡션 23개도 전부 유지한다. fallback 53개는 절대 video 순번으로 만든 결정적 고유 ID를 `<strong>`과 `role="note" aria-labelledby`로 연결하며, 제목·설명 대비는 각각 14.1480:1·4.8499:1이다.

### 중앙 taxonomy·카테고리·태그 탐색

- `src/lib/taxonomy.ts`를 공개 분류·태그·pagination·관련 글·시간순 이동의 단일 규칙원으로 추가했다. 현재 taxonomy는 18노드(8 root + 10 child)이며 공개 349글은 모두 정확히 한 deepest leaf로 해석되고 미해석·복수 해석은 0이다.
- 수영은 직접 57편·하위 포함 117편, 자동차는 직접 1편·하위 포함 33편이며 8개 root 합집합은 공개 349편과 정확히 일치한다. 홈은 root 8개와 하위 포함 수만 보여 준다.
- 기존 `/category/{slug}` 18개를 첫 페이지 canonical로 유지하고, 부모는 모든 자손을 포함하며 15편 단위 후속 `/page/{n}`를 생성한다. 현재 category 상세 경로는 총 40개이고 `/page/1`은 만들지 않는다. `/category`에는 8 root와 10 child를 한눈에 보는 인덱스를 추가했다.
- 카드·아카이브·상세·검색·RSS는 모두 deepest leaf label을 사용한다. 상세와 카테고리에는 계층 breadcrumb를 추가하고 검색 text에는 조상 label·legacy alias·태그 label을 함께 넣었다.
- 태그 660개·글-태그 연결 740개를 유일한 결정적 경로로 만들었다. `/tags`는 검색 가능한 인덱스이며 각 `/tag/{slug}` 목록과 15편 pagination을 제공하고, 상세의 태그는 실제 링크다.
- 상세 하단에 같은 leaf 관련 글을 최대 5편, 전체 날짜순 이전·다음 글을 추가했다. 현재 관련 글 1,698개, 이전 348개, 다음 348개 링크이며 자기 자신·중복·비공개 대상은 0이다.
- 데스크톱 레일과 모바일 상단에 `갈래` 링크와 별도 열기 버튼을 두고 native dialog 기반 taxonomy 서랍을 추가했다. 현재 leaf는 `aria-current="page"`, 조상은 active·expanded이며 Escape, 첫·끝 요소를 명시적으로 순환하는 focus trap, opener focus return, background scroll lock을 지원한다. 기존 검색 dialog의 Escape·focus return·결과 동작도 유지했다.

### 공개 URL registry·본문 링크 호환

- `src/lib/public-links.ts`에 strict legacy URL parser, 공개 URL registry, 공통 HTML presentation transformer를 추가했다. parser는 host·owner·path/query 구조를 검증하고 one-decode·NFC 규칙을 적용하며 encoded slash·backslash·dot segment·double encoding을 거부한다. path·query·fragment의 `%`는 완전한 hex pair와 유효한 UTF-8 sequence여야 하며 Tistory `/m/{id}`와 `dwnc.tistory.com/m/{id}`도 registry hit에 한해 인식한다.
- 공개 registry는 티스토리 164 + 네이버 185의 imported baseline과 향후 native 전역 순번 증분만 받는다. canonical 경로와 source-qualified identity를 서로 다른 map에서 모두 유일하게 검증하며 비공개·공유·스크랩 미결정 자료는 registry 입력에 들어오지 않는다.
- Tistory Markdown, Naver legacy HTML, 향후 native Markdown이 모두 같은 transformer를 거친다. Naver 영상 보존 정책은 먼저 적용하고 링크 transformer는 그 결과에만 작동한다.
- authored legacy 링크 75개(Tistory 39 + Naver 36)를 registry가 증명한 local canonical로 변환했다. query·플랫폼 fragment와 내부 링크의 외부용 `target`·`rel` token은 제거했으며 최종 target 누락은 0이다.
- 같은 대상을 가리키는 URL만으로 된 표시문자 21개는 상대 canonical 표시로 바꿨고, link card의 과거 탐색 URL metadata 57개도 canonical로 바꿨다. 임의 제목·설명과 외부 card metadata·media는 그대로 유지한다.
- Naver 플랫폼 current-post action은 정규화 source 1,396개를 구조적으로 식별했고 최종 공개 DOM의 platform anchor는 0이다. href 전역 치환 없이 authored 외부 링크 352개(Tistory 266 + Naver 86)의 exact multiset을 유지했다.
- 공개 registry에 없는 legacy 대상 2회는 대상 URL·ID·미리보기 텍스트 없는 `role="note"`로 표시한다. OG 카드 안의 로컬 이미지는 그대로 보존해 Tistory 이미지 814개와 media 순서를 바꾸지 않았다. 기존 민감 중립 placeholder도 3회·2글 그대로 유지한다.
- `scripts/test-public-links.mjs`에 parser/transformer 양성·음성 fixture 44개를, `scripts/validate-public-links-build.mjs`에 registry·source identity·rewrite·표시문자·탐색 metadata·RSS exact canonical·fallback·external multiset·platform control·broken local·Tistory Markdown/media 의미 전수 검증을 추가했다.
- `docs/URL_CONTRACT.md`에 canonical, rewrite, unknown/private/shared 처리, 향후 native 증분, 호스팅 승인 뒤 edge redirect 체크리스트를 기록했다. 실제 redirect·배포·DNS 설정은 하지 않았다.

### 전역 순번 주소·보안 원장

- 허용된 metadata만으로 공개 Tistory 164, 공개 Naver 185, 비공개 Naver 247을 결합해 최초 596건을 배정했다. UTC instant 오름차순·동률 `source:sourceId` ASCII byte 순서로 만든 allocation SHA-256은 `2b71c38d4032f306419117ffbf120e888883e8da4e3e2d51f4392b350e026b66`과 정확히 일치한다.
- 전체 원장은 `migration/private/sequence/global-sequence-v1.json`에 mode 700/600으로 atomic 저장했고 공개 projection 349건은 `src/data/public-sequence-v1.json`에 별도 생성했다. 현재 상태가 genesis이므로 공개 projection digest도 `94c9769ea5cd3f61560943afc7032003dd2ff375b8d5c7841d947bdaf4977d01`과 정확히 일치한다. 이 digest는 향후 합법적인 전환 뒤 현재값을 고정하는 상수가 아니라 최초 증거로 유지한다.
- 공개 projection은 `globalSequence/source/sourceId/canonicalPath/legacyPaths` 다섯 필드만 담고 비공개 identity·날짜·순번 대응과 `nextSequence`를 포함하지 않는다. 공개 코드·빌드가 전체 원장을 import하거나 경로를 참조하면 validator가 거부한다.
- `migration/private/sequence/bootstrap-private-metadata-v1.json`에 최초 비공개 247건의 허용 metadata 5필드만 별도 보존했다. mode 600, symlink·hardlink 0이며 제목·본문·HTML·추가 필드는 0이다. 초기 채택 이후 sequence 도구는 글별 private migration manifest를 읽는 fallback이 없다.
- 같은 로컬 전용 디렉터리에 no-replace bootstrap seal, mode 700 append-only event journal, generation CAS lock, initialization/transaction marker와 stale-lock transfer marker를 추가했다. transfer receipt v2는 원 lock 증거와 prebound recovery token을 자체 SHA로 결속하고 linked recovery lock은 transfer ID·receipt SHA·generation을 exact schema로 보유한다. receipt 직후, recovery lock 취득 직후, reconcile 직후, recovery lock 제거 뒤 receipt 제거 전의 hard exit를 각각 같은 receipt에서 재개하며 recovery lock→권위 상태 재검증→receipt 순서로 정리한다. journal은 genesis event부터 SHA chain으로 이어지며 현재 generation 0·event 1이고 initialization·transaction·lock transfer pending은 0이다.
- `scripts/lib/global-sequence.mjs`와 `scripts/manage-global-sequence.mjs`에 append-only native 배정, 준비된 content/asset receipt preflight, private→public 순번 유지, tombstone·gap 재사용 금지, 초기화·교차 파일 commit·linked stale recovery와 원장 부재 시 fail-closed 명령을 추가했다. 양쪽 commit order, 초기화 모든 fault point, transfer·recovery 이중 hard-exit, receipt hash·generation·raw lock SHA 변조 거부, stale publication surface, 충돌·경로·원장 유실을 포함한 순수 self-test 117건과 실제 `recover-transfer` CLI fixture 5건, 실원장 verify를 통과했고 현재 next sequence는 597이다.
- `src/lib/posts.ts`는 공개 projection membership을 route/build 선택의 일차 기준으로 사용한다. tombstone된 공개 frontmatter는 다시 쓰지 않아도 빌드에서 제외되며, promotion은 같은 sequence로 projection에 들어온다.
- `scripts/lib/public-content-preflight.mjs`는 projection과 준비된 공개 content를 exact identity로 결합하고 cover·HTML/Markdown media·poster·href·srcset·CSS `url()`·`@import`·background·input/track source 등 렌더 가능한 로컬 참조를 전수 추출하며 active object/embed와 은닉 MDX·encoded media 참조를 거부한다. 최초 공개 면제 identity 349개는 불변 digest로 고정되고 mutable inventory injection, orphan·duplicate receipt는 실패한다. 2026-08-25 pre-curation 공개 asset 2,889개는 identity별 manifest 증거와 정확히 일치했으며, promotion/native는 content SHA와 exact asset set을 가진 build-safe receipt 없이는 실패한다.
- `scripts/lib/public-dist-assets.mjs`와 build validator는 manifest의 모든 자산을 genesis manifest 또는 identity-bound receipt의 exact 경로·크기·SHA-256·MIME와 대조하고 HTML payload·unsafe MIME·누락·변조를 거부한다. 2026-08-25 pre-curation 검증 수는 2,889개였다. `scripts/validate-public-only.mjs`는 비공개 root가 존재하지 않는 경로를 주입해 hydrated 공개 bundle만으로 build/runtime/validator가 통과하고 private 디렉터리를 만들지 않는지 검증한다.
- 읽기 전용 `verify`·validator는 mkdir·chmod·write를 하지 않는다. writer와 public preflight는 root부터 모든 ancestor·directory·leaf를 no-follow로 확인하고 symlink·hardlink·inode 교체를 거부한다. 초기화 중단은 `recover-init`, 일반 transaction은 `recover`, stale lock은 exact token의 transfer ID를 동반한 recovery로만 닫는다.
- `src/lib/public-address.ts`를 단일 공개 주소 API로 추가해 홈·카드·아카이브·분류·태그·검색·RSS·상세 meta·관련 글·이전/다음·본문 링크가 모두 `/posts/{globalSequence}`를 사용한다. imported frontmatter의 이전 canonical은 provenance로 그대로 유지했다.
- canonical article 349개와 legacy alias 349개를 서로 다른 정적 문서로 생성한다. alias는 본문을 복제하지 않고 noindex·최종 absolute canonical·즉시 refresh/JS·일반 fallback만 제공하며 검색·RSS·sitemap에서 제외한다.
- `docs/EDGE_REDIRECTS_V1.json`에 공개 alias 349개의 provider-neutral 308 manifest를 생성했다. 이는 향후 승인 뒤 edge 설정용 계약이며 provider 구성은 변경하지 않았다.

### 티스토리 이전

- 원문 HTML 164건을 변경 불가 스냅샷으로 보존했다.
- 제목, 설명, 게시일, 수정일, 카테고리, 태그, 원주소를 164건 모두 정규화했다.
- 본문 164건을 새 사이트 글 파일로 변환했다.
- 작성자 사진 814개를 로컬화하고 원주소·SHA-256·크기·MIME를 기록했다.
- 새 편집기 이미지 그리드, 링크 카드, 지도, 가로·세로 YouTube 영상을 보정했다.
- 사라진 내부 링크 카드 썸네일 2개는 원본 서버의 `410 Gone`을 기록하고 `미리보기 없음` 카드로 대체했다. 본문 사진 누락은 없다.
- 중복 생성 미디어 5개는 공개 폴더에서 `migration/tmp/orphaned-media/`로 옮겨 복구 가능하게 격리했다.

### 네이버 표본 조사와 원문 보존

- 공개·비공개 각각에서 세 편집기 세대를 대표하는 총 6건을 로그인된 브라우저로 먼저 조사했다.
- 전수 DOM 분류 결과는 legacy SmartEditor 71건, SmartEditor 3 319건, SmartEditor ONE 42건이다.
- 로그인된 브라우저가 각 글을 순차적으로 열고 렌더링된 DOM이 안정된 뒤 raw를 저장하도록 자동화했다. 기존 네이버 글에는 어떠한 수정·삭제도 하지 않았다.
- 최초 raw 캡처 432건의 `wrapper.html`, `page.html`, `content.html`과 매니페스트를 공개 185건·비공개 247건으로 분리해 저장했다.
- 감사에서 브라우저 반환 길이 제한을 발견했다. `page.html` 432건 전부와 `content.html` 11건이 잘린 사실을 확인했으며, 잘린 결과의 SHA 일치와 원문 완전성을 구분했다.
- 잘린 본문 11건은 인증 브라우저에서 48,000자 청크로 다시 읽어 `recapture-v2`에 no-replace 방식으로 저장했다. 공개 8건·비공개 3건이며 브라우저 전후 안정성·문자 수·UTF-8 바이트·SHA-256·닫힌 루트를 모두 검증했다.
- 완전했던 legacy 본문 421건은 기존 파일을 복사하거나 다시 쓰지 않고 완전성 증거를 v2 매니페스트에 기록했다.
- 결과적으로 v2 canonical raw 매니페스트는 432/432이고, canonical 본문·래퍼 파일은 864개다. 기존 legacy raw 1,296개는 바이트와 SHA-256이 변하지 않았다.
- `page.html` 432건은 전부 브라우저 반환 길이 제한으로 잘린 비정본 진단 파일로 유지했다. importer와 완전성 검증은 이 파일을 본문으로 사용하지 않는다.
- immutable writer를 동일 디렉터리 임시 파일·fsync·hard-link no-replace commit으로 강화했다. atomic 생성, 동일 재시도, 충돌 보존, 동시 commit, orphan temp 회복, symlink·경로 경계 거부 fixture를 통과했다.

### 네이버 정규화·미디어 v1 기준 실행

- 공개 정규화 본문 185건을 `src/data/posts/naver/`에, 비공개 정규화 본문 247건을 `migration/private/naver/`에 생성했다.
- v1 전수 실행은 432/432 처리 실패 없이 끝났다. 공개 185건은 모두 verified였고, 비공개는 241건 verified·6건 media-partial이었다.
- v1 이미지 매니페스트는 총 5,018건이다. 4,547건 다운로드, 7건 실패, 457건 외부 참조, 7건 플랫폼 placeholder 제외로 기록됐다.
- 첨부파일 3건은 모두 내려받아 해시를 기록했다.
- v1 실제 미디어 파일은 4,550개, 2,229,909,523바이트(약 2.077GiB)였다. 공개 1,868개·918,088,622바이트, 비공개 2,682개·1,311,820,901바이트로 물리적으로 분리됐다.

### 네이버 importer schema 2·normalization 3 최종 실행

- importer가 고정 raw 경로를 추정하지 않고 각 `recapture-v2/manifest.json`의 `files.content.path`를 canonical 본문으로 읽도록 바꿨다. 비정본 `page.html`은 본문 입력에 쓰지 않는다.
- 인라인 `background-image`, 비디오 poster, embedded data 이미지도 이미지 매니페스트 후보로 수집하고 로컬 경로로 치환하도록 보완했다.
- 직접 바이너리 비디오는 다운로드·해시·로컬 치환하고, 스트리밍·외부 플레이어는 외부 참조로 유지하는 정책을 추가했다.
- 첨부파일을 로컬화한 뒤 후속 링크 정리 단계가 다시 네이버 절대 URL로 바꾸던 순서 오류를 고쳤다.
- 공개 본문에서 비공개 네이버 글을 가리키던 링크는 대상 ID·미리보기 내용을 남기지 않는 중립 placeholder로 바꾸도록 보완했다.
- 고해상도 선호 URL 404로 실패했던 7개 발생 건(고유 바이너리 6개)은 raw에 기록된 관측 URL로 7/7 복구 가능함을 확인했다. 고유 6개 fallback은 HTTP 200과 정상 이미지 MIME·바이트·SHA-256을 확인했고, 선호·queryless URL은 고유 6개 모두 HTTP 404·0바이트였다.
- capture/importer는 경로 탐색·symlink, 정본 역할·경로 불일치, SHA-256·바이트·문자 수 불일치, 닫히지 않은 루트, capture method별 완료 증거 누락을 거부한다.
- schema 2·normalization 3 최종 실행은 432/432 `verified`, `partial` 0, 글 단위 실패 0으로 완료됐다. 공개 185건은 공개 트리, 비공개 247건은 로컬 전용 트리에만 저장했다.
- 최종 네이버 로컬 미디어는 4,806개·2,372,600,797바이트다. 공개 2,075개·1,056,582,743바이트와 비공개 2,731개·1,316,018,054바이트로 물리 분리했다.
- 로컬 미디어는 이미지 4,773개와 직접 비디오 33개다. 외부 iframe 비디오 2건은 외부 참조로 유지했고, 최종 첨부파일은 0건이다.
- v1에서 첨부로 오인했던 3개 파일은 실제로 HTML 응답임을 확인했다. 3개·358,339바이트 모두 공개 트리와 분리된 private quarantine에 보존했다.

## 주요 산출물

- `src/`: 새 블로그 화면, 콘텐츠 스키마, 검색·RSS·사이트맵 구현
- `src/lib/public-post.ts`: 보존 본문을 변경하지 않는 공개 메타 정제와 Naver 비디오 표시 정책
- `src/lib/public-links.ts`: 공개 전용 URL registry, strict legacy parser, 공통 HTML 링크 transformer와 unavailable 정책
- `src/lib/public-address.ts`: 공개 projection만 읽는 identity·sequence·canonical·legacy alias 단일 주소 API
- `src/data/public-sequence-v1.json`: 공개 active 글 349건만 담은 build-safe 전역 순번 projection
- `src/data/genesis-public-identities-v1.json`: 최초 공개 349 identity의 immutable public-only 면제 sidecar; count와 digest가 고정되며 현재 projection·content·local inventory에서 재추론하지 않음
- `src/data/public-asset-receipts-v1.json`: 공개 전환·native 글의 identity-bound content·asset 무결성 receipt; 현재 genesis baseline은 추가 receipt 0건
- `migration/private/sequence/global-sequence-v1.json`: 공개·비공개 596건의 로컬 전용 append-only 전체 원장(mode 600)
- `migration/private/sequence/bootstrap-private-metadata-v1.json`: 제목·본문·HTML이 없는 최초 비공개 247건 metadata-only sidecar(mode 600)
- `migration/private/sequence/global-sequence-v1.seal.json`, `events-v1/`: no-replace genesis seal과 append-only generation journal(로컬 전용)
- `src/lib/taxonomy.ts`: 중앙 taxonomy, leaf resolver, root/descendant 집계, 태그 slug, pagination, 관련 글·시간순 이동 규칙
- `src/components/CategoryDrawer.astro`, `CategoryTree.astro`, `CategoryBranch.astro`: 접근 가능한 갈래 서랍과 계층 메뉴
- `src/components/Breadcrumbs.astro`, `Pagination.astro`, `CategoryListing.astro`, `TagListing.astro`: 분류·태그 탐색 공통 UI
- `src/pages/category/`, `src/pages/tag/`, `src/pages/tags/`: category 40경로와 tag 660경로·검색 인덱스
- `src/data/posts/tistory/`: 티스토리 정규화 글 164개
- `public/media/tistory/`: 공개용 티스토리 미디어 814개, 약 1.2GB
- `migration/raw/tistory/`: 원문 HTML과 글별 매니페스트, Git 비추적
- `migration/source-inventory/tistory-posts.json`: 티스토리 164건과 미디어 출처·해시 기준표
- `migration/source-inventory/naver-posts.json`: 네이버 소유자 기준 432개 글 목록, 민감 메타데이터로 Git 비추적
- `migration/raw/naver/{logNo}/`: 공개 네이버 글의 legacy raw와 `recapture-v2/manifest.json`, Git 비추적
- `migration/private/naver/{logNo}/raw/`: 비공개 네이버 raw와 `recapture-v2/manifest.json`, 로컬 전용
- `src/data/posts/naver/`: 공개 네이버 정규화 글 185개
- `migration/private/naver/{logNo}/normalized/post.md`: 비공개 정규화 본문, 로컬 전용
- `public/media/naver/`: 공개 네이버 미디어 2,075개·1,056,582,743바이트, Git 비추적
- `migration/private/naver/{logNo}/media/`: 비공개 네이버 미디어 2,731개·1,316,018,054바이트, 로컬 전용
- `migration/raw/naver/{logNo}/migration.json`: 공개 schema 2·normalization 3 매니페스트
- `migration/private/naver/{logNo}/migration.json`: 비공개 schema 2·normalization 3 매니페스트, 로컬 전용
- `migration/private/naver/{logNo}/quarantine/`: 첨부로 오인된 HTML 응답 3개·358,339바이트, 로컬 격리
- `migration/source-inventory/naver-public-posts.json`: 공개 글만 포함하는 파생 인벤토리
- `migration/private/naver-inventory.json`: 제목·본문을 제외한 비공개 로컬 검증 요약
- `scripts/import-tistory.mjs`: 재시작·병합 가능한 티스토리 이전기
- `scripts/import-naver.mjs`: v2 canonical raw 검증, 정규화, 이미지·배경·poster·비디오·첨부 처리와 fallback 증거 기록
- `scripts/lib/naver-browser-capture.mjs`: 공개·비공개 분리, immutable legacy 캡처, 청크형 v2 재캡처, atomic/fsync/no-replace 저장과 경계 검증
- `scripts/validate-inventory.mjs`: 원문·본문·미디어 해시 및 공개 범위 검증기
- `scripts/validate-build.mjs`: 빌드 경로·검색·RSS·사이트맵·미디어에 더해 SmartEditor3 파생 메타, zero-width 잔류, 실제 렌더 기반 글 유형, Naver video 유형·재생 정책·fallback 접근성·대비·캡션·미디어 순서를 전수 검증
- `scripts/validate-taxonomy-build.mjs`: source frontmatter에서 독립 계산한 taxonomy·category/tag pagination·breadcrumb/menu·related/prev-next·검색/RSS·sitemap 전수 검증
- `scripts/test-public-links.mjs`: legacy URL parser·transformer 순수 fixture
- `scripts/validate-public-links-build.mjs`: 공개 registry·본문 link graph·external multiset·platform control·broken target·Tistory 표현 의미 전수 검증
- `scripts/lib/global-sequence.mjs`, `scripts/manage-global-sequence.mjs`: fail-closed 순번 생성·검증·append·공개 전환·tombstone, seal·journal·CAS transaction·recovery와 안전한 원장 저장
- `scripts/lib/public-content-preflight.mjs`: projection-backed 공개 content exact join, 안전한 경로·렌더 asset 추출, immutable genesis public sidecar 또는 identity-bound receipt 검증
- `scripts/lib/public-dist-assets.mjs`: 현재 projection의 manifest/receipt-backed 공개 자산을 dist exact 경로·크기·SHA-256·MIME와 대조하고 HTML payload를 거부
- `scripts/validate-public-only.mjs`: injected absent private root에서 local 또는 remote-manifest 공개 projection·content·dist만 검증하고 private 디렉터리 생성·권위 root 변경 0을 확인
- `scripts/test-global-sequence.mjs`, `scripts/validate-global-sequence.mjs`: 전이·공개 surface·불변 genesis/asset receipt·초기화/transaction fault injection·이중 hard-exit stale-transfer 재개·경로·append-only 순수 fixture 117건과 실제 원장·projection·private route·public import 경계 검증
- `scripts/test-global-sequence-cli.mjs`: 허용 메타데이터와 최소 공개 fixture로 실제 `recover-transfer` CLI의 recovery-lock 취득 직후·reconcile 직후 hard exit, 재실행 성공·최종 verify를 검증하는 5개 fixture
- `docs/MIGRATION_PLAN.md`: 이전 원칙과 단계
- `docs/URL_CONTRACT.md`: canonical·rewrite·unknown/private/shared·edge redirect 승인 계약
- `docs/EDGE_REDIRECTS_V1.json`: 공개 legacy alias 349개의 provider-neutral 308 manifest
- `scripts/lib/public-media-git.mjs`: 명시한 commit/tree/clean 상태를 `HEAD→status→HEAD`로 확인하고 검사 중 HEAD/tree 이동을 거부하는 공통 Git 결속
- `scripts/sync-public-media-r2.mjs`: 기존 exact 객체를 건너뛰고 missing만 `If-None-Match:*`로 만드는 bulk apply, 엄격한 post-inspection과 실제 요청·생성·412 복구 수를 담는 create-only receipt
- `scripts/inspect-public-media-r2.mjs`: exact·missing·mismatch·orphan 기대값 네 개와 실제 요청 수를 강제하는 staging validator-only v2 inspection
- `scripts/audit-public-media-r2-full.mjs`: 2.3GB GET 전에 receipt 목적지와 Git 상태를 검사하고 전체 object-set SHA·실제 요청 수·900초 이내 exposure capture SHA를 결속하는 full audit
- `scripts/test-r2-bulk-hardening.mjs`: 혼합 원격 상태, 안전 재실행, 412 복구, orphan/Git/output 경계, 최종 receipt 경합과 비밀값 비노출을 실제 entrypoint로 검증하는 142 assertions fixture

## 현재 검증 결과

### 네이버 raw·importer·미디어 최종 검증

- 네이버 인벤토리: 432개, 고유 ID 432개
- 네이버 공개 범위: 전체공개 185 + 비공개 247 = 432
- 공개 정규화 파일·공개 raw 디렉터리·공개 인벤토리는 각각 공개 ID 185개와 정확히 일치하고, 비공개 로컬 디렉터리는 비공개 ID 247개와 정확히 일치한다.
- v2 canonical raw: 432건, 본문·래퍼 864개 전수 검증 통과
- v2 방식별 수: 완전한 legacy 승격 421건 + 청크 재캡처 11건 = 432건
- 청크 재캡처로 legacy 잘림분 대비 2,052,066바이트와 이미지 요소 262개를 추가 회복했다.
- legacy raw 1,296개 파일의 바이트·SHA-256 불변을 재검증했다.
- 비공개 영역 권한: 디렉터리 700, 파일 600 위반 0; 공개·비공개 간 symlink·hardlink 공유 0
- 비공개 로컬 요약은 허용된 검증 필드만 포함하고 제목·본문을 포함하지 않는다.
- importer schema 2·normalization 3: 432/432 verified, partial 0, 처리 실패 0
- 로컬 미디어: 이미지 4,773 + 직접 비디오 33 = 4,806개, 크기·SHA-256 전수 일치
- 미디어 물리 분리: 공개 2,075개·1,056,582,743바이트 + 비공개 2,731개·1,316,018,054바이트
- 비디오: 직접 바이너리 33개 로컬화, 외부 iframe 2건 외부 참조, 첨부파일 0건
- 첨부로 오인한 HTML 응답: 3개·358,339바이트, 비공개 quarantine 격리
- fallback 7개 발생 건/고유 6개 바이너리: raw 관측 URL 로컬화·HTTP 200·MIME·크기·SHA-256 증거 통과
- importer 방어 규칙: canonical raw 432건·864개, 경로 경계·symlink·완전성 증거·정규화 SHA-256·비공개 링크 중립화·외부 이미지 잔류 검증 통과

### 공개 미디어 R2 전달 로컬 검증

- 2026-08-25 pre-curation checkpoint에서 `npm run media:manifest:check`: PASS. object 2,889, bytes 2,350,053,092, SHA-256 `5b9eb93474c0e96b3b371d233b4ea64cc24918a31d0fb754410c968544c2b165`.
- 같은 checkpoint에서 `npm run media:validate:source`: PASS. 공개 글 349, local media bytes read 0, manifest↔renderable reference exact set.
- 같은 checkpoint에서 `npm run media:validate:local`: PASS. missing 0, orphan 0, 크기·SHA-256·MIME mismatch 0. 이는 역사 기준선이고 현재 최종 2,758개는 2026-08-27에 다시 전수 검증했다.
- 2026-08-25 Stage 3 로컬 admission checkpoint의 12 suites·463 assertions PASS, 2026-08-27 signing identity 이전의 18 suites·833 assertions PASS, validator inspection commit 전의 19 suites·922 assertions PASS, S3 version-id 호환 commit 전의 19 suites·954 assertions PASS, 단일 객체 validator 변경의 20 suites·1,144 assertions PASS, private-exposure read-only 변경의 20 suites·1,299 assertions PASS는 역사 기록으로 보존한다. bulk hardening commit `ccec8bb855e45ef679a4b99faf0f0633a99e089e` 후보는 Cloudflare 관련 21 suites·1,452 assertions를 통과했다. 새 bulk fixture 142 assertions는 혼합 `exact+missing`, 기존 exact PUT 0, missing-only 조건부 생성, 중간 실패 뒤 안전 재실행, 412 exact 복구, post-orphan 증가 거부, preexisting/symlink/hardlink/unsafe parent/unwritable/racing output과 wrong Git의 network 0, tracked drift·HEAD 이동 때 receipt 0, strict expected counts, 실제 `LIST/HEAD/GET/PUT/DELETE` 수와 비밀값 비노출을 검증한다. 특히 첫 PUT 뒤 경쟁 receipt가 생겨도 경쟁 bytes를 보존하고 실패하며, 새 경로 재실행은 이미 exact인 객체 PUT 0으로 정상 receipt를 만든다. signing fixture 104 assertions는 bulk contract를 `media-receipt` 역할로 서명하려는 시도를 거부한다. 단일 객체 fixture 178 assertions는 exact HEAD 1·GET 1·PUT 0·DELETE 0과 재시도 0을 검증한다. auth 66·exposure 145 assertions는 FD EOF·지연 chunk/trailing·length/digest/max+1, env/argv/disk/Keychain 거부, bounded body cancel·fatal UTF-8, wrong account/bucket/purpose, jurisdiction/location/class·domain drift, non-GET·retry, token/account ID/endpoint/raw body 누출, Git HEAD/tree/worktree drift, symlink/preexisting/mode·partial/malformed response와 credential/API-free partial-output recovery를 안전하게 중단하는지 검증한다. 이 로컬 검증에서 live network·실제 Keychain·clipboard 호출·원격 객체 변경·overwrite·delete는 0이다.
- `npm run cloudflare:build:source`: PASS. Astro check 오류 0, HTML 1,404, canonical/legacy alias 349/349, 검색·RSS 349, sitemap 1,054, taxonomy/link/privacy 기존 계약 PASS, `dist/media` 0, `_redirects` 349.
- 2026-08-25 Git checkpoint 후보 493개만 복제한 `npm run cloudflare:isolated:source`: PASS. `migration/private`·`migration/raw`·`public/media`·`.git` 0인 채 source-only build와 전체 공개 validator를 통과했다. `cloudflare:isolated:lock`도 exact Wrangler lock과 외부 통신 없는 dependency 해석을 통과했다. npm registry만 허용한 `cloudflare:isolated:clean`도 376 packages의 실제 `npm ci`부터 exact Wrangler와 source-only build까지 PASS했다. 이는 2026-08-25 역사 fixture 검증으로 보존한다.
- 현재 public request surface는 1,410경로·SHA-256 `1666d8dd85ac05c2274513cfbe438f24ead06a190f873af3b67f7e3aa373307c`이다. exact Wrangler `4.125.0` type·startup·bundle 검증과 source-only build를 통과했고 upload는 0이다. release digest는 생성시각 README·source map·metafile 경로를 포함한 outdir aggregate가 아니라 실제 `worker.js` bytes와 static tree·전용 config의 개별 SHA로만 계산한다.
- 원격 전수 auditor는 승인·봉인된 final manifest 전체를 GET해 body SHA-256·총 bytes를 확인한 경우만 `full-get-sha256` receipt 후보를 만든다. bulk receipt는 운영 증거로만 남고 signer가 거부한다. 감사 `startedAt`과 receipt `verifiedAt`은 bulk 뒤 새로 수집한 exposure capture의 만료 전 시각으로 결속한다. tracked pre-curation fixture는 2,889개·2,350,053,092바이트에서 object/byte count와 변조 거부를 통과했고 live R2 호출은 0이다.
- production remote validation은 receipt·signature·read-only credential이 없을 때 `MEDIA_E_REMOTE_RECEIPT_REQUIRED`로 fail closed하며, sync도 complete account fingerprint·environment/bucket 결속·credential·expected digest·orphan approval이 없으면 첫 R2 요청 전에 거부한다.
- 로컬 validator inspection fixture는 빈 mock bucket을 LIST하고 manifest 2,758개를 HEAD해 exact 0·missing 2,758·mismatch 0·orphan 0, PUT 0·DELETE 0을 확인했다. 이는 실제 staging bucket 감사 결과가 아니라 로컬 안전장치 증거다.
- 최초 staging validator inspection은 exact 0·missing 2,758·mismatch 0·orphan 0으로 통과했고 기록 SHA-256은 `d058fce27c6a9114751fcbf5f2ba67f2dda9b8f385ad1d733c2864c847e4e263`이다. 첫 key `media/naver/220404726308/001-d5ada694e87e.png`에 create-only PUT을 최대 1회 수행한 뒤 nullable version 호환 commit으로 보강했다. source `df3c678456f6af3471d846a32e28faa5751b9a2e`·tree `bbe8306cbf6577cd556533079593872020ddc8b5`에서 같은 객체를 PUT 없이 HEAD 1·GET 1로 검증했다. ETag는 `"d3ded31a7b52f467702909afbc7d5340"`, Last-Modified는 `2026-08-27T00:24:12.000Z`, version은 `null`, verifiedAt은 `2026-08-27T05:07:48.418Z`, validation receipt SHA-256은 `fa72b1849496a9b6e4697721cfef9d4fcd17b8f463b41dcacd714c5f9bb2352a`다. 요청 집계는 HEAD 1·GET 1·PUT 0·DELETE 0이다. 이어 `2026-08-27T05:09:09.996Z`에 PUT 없이 다시 검사해 exact 1·missing 2,757·mismatch 0·orphan 0을 확인했고 post-one inspection receipt SHA-256은 `f00f3c13c9ae99f8a36599db85d7a180e31d8779776653bca72c2aee596d380e`다.
- source commit `ccec8bb855e45ef679a4b99faf0f0633a99e089e`·tree `241a654acc387233d4e2d5e076754b345619e9ac`의 clean 상태에서 bulk upload를 수행했다. 사전 상태 exact 1·missing 2,757·mismatch 0·orphan 0에서 기존 1개는 건너뛰고 `If-None-Match:*`로 2,757개만 생성했다. 사후 상태와 독립 inspection은 모두 exact 2,758·missing 0·mismatch 0·orphan 0이며 overwrite 0·DELETE 0이다. bulk receipt SHA-256은 `2974384ff720326830f5f3dcd9e2439dc56af4ec96c813bade88a2d0b7815444`, post-bulk inspection receipt SHA-256은 `f562129e14a65918bfebac26de313ff5e461ad3067774f9084a0e0514def0d84`다.
- 현재 기준 HEAD는 `ccec8bb855e45ef679a4b99faf0f0633a99e089e`·tree `241a654acc387233d4e2d5e076754b345619e9ac`이고 push는 0이다. bucket 비공개 설정의 canonical API capture와 전체 2,758개 full GET/SHA-256 감사는 아직 수행하지 않았다.
- 비공개 설정 확인을 위해 만들었던 읽기 전용 API token 두 개는 안전한 전달에 실패해 API GET 0·capture 0 상태로 각각 폐기했다. token 값이나 raw account ID는 문서에 기록하지 않았다. 다음 token 생성 전에 전달 방식을 다시 설계하고 안전 문구로 먼저 시험한다.

### 통합 inventory·check·build·build-validator

- `npm run inventory:validate`: PASS. 네이버 432/432 verified, 티스토리 164/164 verified, 공개 본문 안전성 185/185, 비공개 누출 marker 0
- `npm run check`: PASS. Astro 오류 0, 경고 0, 힌트 0
- `npm run build`: PASS. 정적 HTML 1,404개(공개 canonical 349 + legacy alias 349 + 일반 페이지·404), sitemap URL 1,054개 생성
- `npm run build:validate`: PASS. `/posts/{globalSequence}` 상세 349건, legacy alias 349건, 검색 349건, RSS 349건, sitemap 대상 URL 1,054건 일치
- 전역 순번 원장: genesis 596(공개 349 + 비공개 247), sequence 1–596, current generation 0·next 597·journal event 1, initialization·transaction·lock transfer pending 0. allocation/genesis public projection SHA-256 정확 일치, private reserved route 0
- sequence self-test: 순수 117/117 + 실제 CLI 5/5 PASS. native append와 private→public은 max+1/기존 번호를 보존하고, tombstone은 번호를 남기며 모든 공개 surface에서 제거한다. synthetic promotion/tombstone과 stale canonical·alias·검색·RSS·sitemap 거부, 14개 렌더 asset 참조·active embed/은닉 참조 거부, 불변 genesis 면제와 identity-bound receipt, receipt-backed dist 누락·변조·HTML payload·signature/MIME mismatch 거부, 양 commit order, initialization 모든 fault point, transfer receipt 직후 및 linked recovery lock 취득/상태 reconcile 직후 child hard-exit, wrong token/foreign replacement·receipt hash/generation/raw lock SHA 변조 거부·exact 재획득을 검증했다. 실제 CLI는 recovery lock 취득 직후, reconcile 직후, recovery lock 제거 뒤 receipt 제거 전의 세 hard exit를 순서대로 만들고 재시도한 뒤 최종 `verify`와 pending marker 0까지 통과했다. operation/state 불일치·unsafe identity·동결 imported namespace·mode·symlink·hardlink·seal 뒤 원장 유실은 fail closed 또는 검증된 replay로만 처리한다.
- 2026-08-25 pre-curation `npm run build:validate:public`: PASS. private root가 없는 경로를 주입한 상태에서 canonical 349·alias 349·HTML 1,404·sitemap 1,054·공개 자산 2,889개를 검증한 역사 기록이다. 2026-08-27 현재 최종 2,758개로 같은 private-root 미포함·링크·분류·검색·RSS 검증을 다시 통과했다.
- `npm run build:validate:public:remote`: PASS. source-only `dist/media=0`에서도 tracked manifest evidence로 같은 공개 surface를 검증하고 private 디렉터리 생성 0·권위 private root 변경 0을 확인했다.
- 공개 URL registry: 현재 genesis projection 기준 imported 349(티스토리 164 + 네이버 185), native 0, canonical/identity collision 0. 최초 imported 349는 불변 genesis 증거로 별도 보호하되 현재 registry와 모든 공개 surface는 projection-backed exact join으로 계산해 합법적인 기존 비공개 글 공개 전환·native append·tombstone을 반영한다.
- 공개 본문 내부 링크: canonical 75(Tistory 39 + Naver 36), 과거 joinable URL 잔류 0, 모든 target 존재, 내부 `target` 0, broken local 0
- RSS `link`·`guid`: exact canonical 349/349, trailing slash 불일치 0, permalink marker 349/349
- URL 표시문자: 과거 URL 21 → 0, canonical 표시 21. link card 탐색 metadata: 과거 값 57 → 0, canonical 값 57
- registry miss: allowlist와 일치하는 중립 note 2, href·target ID 노출 0. 기존 민감 중립 placeholder 3회·2글 유지
- Naver platform link: source current-post action 1,396, 최종 공개 DOM platform anchor 0. 외부 authored href 352(Tistory 266 + Naver 86) exact multiset 불변
- Tistory 공통 renderer 회귀: 이미지 814, video 0, iframe 11, pre 11, code 14와 legacy identity 기반 semantic SHA `207b841429e39d271eee81231866f2f8aa398561f5c6e15abf6fcbef4ff42376` source=built
- Naver 공개 media semantic SHA는 legacy identity 기반 `094f2f73a78304a0480bc429dc0ecbd6504508841493dcfafe6c083eaf342fe1`로 source=built이며 새 numeric canonical로 바뀌어도 역사 기준이 달라지지 않는다.
- 중앙 taxonomy: 18노드(8 root + 10 child), 공개 349글 단일 leaf 해석, inclusive membership 441, root union 349, cycle·orphan·ID/slug/matcher collision 0
- category: 첫 페이지 18개 + 후속 페이지 22개 = 40개, 페이지당 최대 15편, 부모 합집합 중복 0, `/page/1` 0, 수영 57/117·자동차 1/33
- tags: 고유 노드 660, 연결 740, slug collision·빈 slug 0, 상세 경로 660, 상세 태그 링크 740
- 상세 탐색: same-leaf 관련 글 1,698, 더 오래된 글 348, 더 새로운 글 348, 자기 자신·중복·비공개 대상 0
- 네이버 렌더 본문: 185/185, 정확한 `<img>` 2,257개, 의도하지 않은 code block 0, 비공개 route·marker 누출 0
- 네이버 연도별 아카이브 항목 185건, 통합 RSS 항목 349건 확인
- 공개 SmartEditor3 144건: 상세 meta description·OG description·검색 description/searchText·RSS description의 구조적 파생 결과 불일치 0, 플랫폼 chrome marker 0
- 공개 파생 zero-width 문자: 상세 description 0, OG description 0, 검색 description 0, searchText 0, RSS description 0
- 공개 글 유형: 사진형 148, 장문형 201, 실제 렌더 구조와 class 불일치 0.
- 공개 Naver video: 전체 81 = 로컬 재생 28 + source 없는 fallback 53. 로컬 28개는 GIF형 반복 재생 정책 28/28, fallback은 영상 길이 보존 53/53, 작성자 영상 캡션 보존 23/23, 연결되지 않은 복구 가능 로컬 video 0
- fallback 접근성: `role="note"`·`aria-labelledby`·결정적 `<strong id>` 연결 53/53, 고유 ID 53·중복 0, 제목 대비 14.1480:1(AAA), 설명 대비 4.8499:1(AA)
- 2026-08-25 pre-curation checkpoint에서 공개 Naver 본문의 이미지 2,257개, iframe, img/video/iframe 미디어 순서는 정규화 기준과 일치하며 다운로드 미디어 2,075개의 크기·SHA-256 검증을 통과했다. Tistory 814개를 합친 당시 2,889개는 정리 전 역사 기준선이다. 현재 최종 2,758개는 크기·SHA-256·MIME 전수 일치를 다시 확인했다.

### 브라우저 QA

- legacy SmartEditor, SmartEditor 3, SmartEditor ONE 공개 대표 글 각 1건과 비디오 중점 공개 글 1건을 데스크톱·모바일에서 검수했다.
- 원문과 새 사이트의 이미지 수는 검수 순서대로 21/21, 1/1, 25/25, 7/7 일치했다.
- 본문·이미지·레이아웃·비디오 표시, 데스크톱·모바일 가로 넘침 없음을 확인했고 콘솔 오류 0, 로컬 서버 오류 0이었다.
- taxonomy UI는 390×844에서 홈, category index, 수영 8쪽, tag index, 가장 긴 tag, 티스토리 상세, Naver 사진형·장문형을 검수했다. 모든 화면과 열린 서랍의 가로 넘침은 0이며 상단에 `dwnc.me / 모든 글 / 갈래 / 소개 / 찾기`가 모두 보인다.
- 갈래 서랍은 root 링크와 하위 toggle이 분리되고, active leaf·ancestor expanded, 첫 요소 `Shift+Tab → 마지막`·마지막 `Tab → 첫 요소` 순환, Escape 닫기, opener focus 복귀, background scroll 위치 보존을 확인했다. 검색 dialog도 입력 focus, 결과 12건 표시, Escape 닫기·opener focus 복귀를 재확인했다.
- 모바일 390×844에서 `갈래` opener는 실제 44×44px이고 인접 `/category` 링크와 hit area가 겹치지 않으며 header 가로 넘침은 0이다. 1440×900의 가장 긴 tag 상세도 `overflow-wrap: anywhere`·`word-break: normal`로 문서 가로 넘침 0을 확인했다.
- 1280×900에서는 176px 레일, 440px 갈래 서랍, 상세 related·prev/next·tag 링크, 가로 넘침 0과 콘솔 오류·경고 0을 확인했다.
- URL 호환 QA에서 `/posts/491`의 registry miss 2건은 링크·대상 ID 없는 중립 note로 표시되고 보존 이미지도 정상 노출됐다. 작성 본문 링크는 Tistory `/posts/437 → /posts/436`, Naver `/posts/285 → /posts/278`로 변환되며, 내부 `target`·외부 `rel` 제거, platform anchor 0, 가로 넘침 0, 콘솔 오류 0을 확인했다.
- 전역 순번 전환 뒤 데스크톱에서 공개 최저·최고 순번 `/posts/1`·`/posts/596`, Tistory `/posts/433`, Naver 사진형 `/posts/411`을 확인했다. canonical·OG URL은 모두 최종 절대 주소와 일치하고, legacy href·출처 badge·source note·플랫폼 이전 서사는 0이었다.
- 실제 legacy alias `/1`과 `/naver/220404726308`은 각각 `/posts/433`과 `/posts/1`로 도착했다. 최신 최고 순번 글의 본문 canonical 링크 `/posts/574`를 실제 클릭해 같은 최종 주소로 이동하는 것도 확인했다.
- 모바일 390×844에서 홈, 최저·최고 순번 `/posts/1`·`/posts/596`, Tistory `/posts/433`, Naver `/posts/411`은 문서 가로 넘침 0, 깨진 이미지 0이었다. 각 canonical은 `/posts/{globalSequence}`와 일치하고 브라우저 콘솔 오류·경고 0이며 공개 UI에 출처 badge·source note·대형 필명·물고기 장식이 없다.
- 2026-08-25 checkpoint의 source-only와 full-local 결과는 각각 전수 build validation을 통과했다. 당시 `dist/`는 공개 미디어 2,889개(Tistory 814 + Naver 2,075)를 포함했고, 당시 관측한 local preview와 대표 응답도 정상적이었다. 이 `dist`·PID·응답 기록은 **정리 전 역사 기준선**이다. 현재 최종 2,758개는 2026-08-27에 별도로 로컬·source-only 전수 검증했다.
- 2026-08-26 current combined build의 별도 local-only QA에서는 지도 5글·장소 카드 16개, 스티커 영향 2글, SBS GIF 글, unavailable-video fallback 대표를 1440px·390px desktop/mobile에서 검사했다. 지도·SBS·fallback은 P0/P1 finding 0이었고 최초 스티커 QA에서 두 글의 큰 세로 공백 P2를 발견했다. 이후 exact-boundary collapse로 이를 해소하고 구조·build validation을 통과했다. 외부 요청은 차단했고 현재 in-app browser session은 건드리지 않았다.

### 티스토리 완료 기준선

- 티스토리 importer는 이미 완료된 164건 기준선을 보존하기 위해 이번 네이버 작업에서 다시 실행하지 않았다.
- 티스토리 인벤토리: 164/164, 중복 0, 실패 0
- 티스토리 정규화 본문: 164/164
- 티스토리 미디어 검증 완료 글: 164/164
- 내려받은 미디어: 814개, 파일 크기·SHA-256 전수 일치
- 정규화 본문의 외부 이미지 주소: 0개
- Astro 검사: 오류 0, 경고 0, 힌트 0
- 정적 빌드: 총 181페이지 성공
- 빌드 후 검증: 티스토리 경로 164, 검색 164, RSS 164, 사이트맵 164, 배포 미디어 814 일치
- 실제 브라우저 검수: 홈, 전체 글 164개, `/1`, `/7` 지도, `/130` 지도·세로 영상, `/159` 복구 카드·사진 17개, `/173` 이미지 그리드·링크 카드 통과
- 모바일 390×844 및 데스크톱 1280×720에서 가로 넘침 없음

### 완료 조건 판정

- 네이버 432건의 raw 보존, 공개 185건 정규화·미디어·경로, 비공개 247건의 로컬 물리 분리, 통합 inventory·build, 실제 브라우저 QA까지 이전 기술 완료 조건을 달성했다.
- 공개 미디어의 로컬 Stage 2 구현과 Stage 3 staging admission/version-only 안전장치를 완료했다. 최종 media manifest 2,758개와 전체 로컬 회귀를 통과했고, 실제 staging R2에도 2,758개를 모두 create-only로 올렸다. 사후 상태는 exact 2,758·missing 0·mismatch 0·orphan 0·overwrite 0·delete 0이다.
- bulk 안전장치와 실행 기준은 commit `ccec8bb855e45ef679a4b99faf0f0633a99e089e`·tree `241a654acc387233d4e2d5e076754b345619e9ac`에 기록했고 push는 0이다. private-exposure canonical API evidence·전체 2,758개 full GET/SHA-256 감사·signed R2 receipt·staging Worker/version upload·activation·smoke는 미완료다.
- 2026-08-25 `dist/`는 정리 전 통합 QA 역사 기준선이다. 당시 최종 manifest·전체 회귀는 release-source commit에 포함됐지만 R2 upload와 Worker version 생성 전이었다.

## 미해결 문제

- 콘텐츠 이전 정확성·완전성 측면의 알려진 문제는 없다. Stage 3 R2 전체 2,758개 업로드와 사후 목록 확인은 완료됐다. 다음 무결성 단계는 새 private-exposure capture를 수집한 직후 수행하는 전체 2,758개 GET/SHA-256 감사다.
- HTTP→HTTPS, www→apex, trailing slash와 `/index.html` 정규화는 현재 로컬 소스가 아니라 운영 edge의 승인 항목이다. `docs/URL_CONTRACT.md` 체크리스트에 따라 배포·호스팅 승인 뒤 301/308 단일 hop, chain·loop 0을 검증해야 한다.
- 현재 imported 공개 349글의 다른 글 fragment 링크는 0건이다. 알려진 Naver 플랫폼 fragment와 향후 native deep link fragment는 target rendered ID map을 production 빌드에서 전수 생성·검증하기 전까지 버린다. fragment 보존 map 구현은 P2 후속이며 존재를 증명하지 않은 fragment는 보존하지 않는다.
- 태그 660개는 현재 `/tags` 검색 입력으로 즉시 걸러지지만 전체 노드를 한 페이지에 렌더한다. 초성·주제별 추가 filter나 분할 탐색은 P2 정보구조 개선 항목으로 남겨 두었다.
- 공개 이미지의 대체텍스트 품질·누락은 P2 접근성 개선 항목으로 남아 있다. 원문·정규화 본문을 일괄 수정하지 않고 별도 파생 정책을 설계해야 한다.
- 외부 CDN 없이 시스템 한글 폰트 조합을 사용하므로 운영체제별 글꼴 모양이 완전히 같지는 않다. 로컬 폰트 도입 여부는 라이선스·파일 출처를 확정한 뒤 결정한다.
- 티스토리 정규화 본문 1건의 종료된 영상 fallback HTML은 들여쓴 Markdown code block으로 렌더되어 태그 문자열이 화면에 보이는 기존 표시 문제가 있다. 이번 구조 분류는 실제 렌더 의미를 정확히 반영하지만, 원문·정규화 본문 불변 범위에서 이 표시 자체는 수정하지 않았으므로 별도 파생 표현 보완이 필요하다.
- 네이버 비공개 raw·정규화 본문·미디어는 공개 트리와 물리적으로 분리됐지만 별도 암호화 백업과 복구 절차는 아직 확정하지 않았다.
- 이 문서 수정 전 기준 Git HEAD는 `ccec8bb855e45ef679a4b99faf0f0633a99e089e`, tree는 `241a654acc387233d4e2d5e076754b345619e9ac`이다. local `main`은 저장된 `origin/main` ref보다 9 commits 앞서며 push는 0이다. 비개발자용 설명 원칙과 최신 실행 결과를 반영한 문서·검사 변경은 아직 commit하지 않았다.
- 네이버 공개 목록과 직접 작성 글 목록의 차이 10개(공유·스크랩 추정)에 대한 링크형 기록·제외 결정이 남아 있다.
- 지속적인 새 글 작성 방식을 저장소 기반 편집으로 둘지 로그인형 웹 편집기를 추가할지 최종 결정이 필요하다.
- 티스토리·네이버 댓글을 이식할지, 과거 댓글을 읽기 전용 기록으로만 보존할지 결정이 필요하다.
- 현재 최종 공개 미디어는 2,758개·2,346,220,246바이트·SHA-256 `61bb577d609f97cdb014ef3a14681045fbb3bec616f2b04c8d058519b640c532`로 검증 완료다. 2,889개는 2026-08-25 정리 전 역사 기준선이고 2,785개는 B 결정 전 중간 수치다. private staging bucket은 exact 2,758·missing 0·mismatch 0·orphan 0이며 overwrite·delete는 0이다. 전체 원격 파일 내용을 다시 읽은 signed full-set receipt·binding은 아직 없다.
- 2026-08-25의 사용 불가능한 기존 R2 token 두 개가 Cloudflare에서 Active 상태로 남아 있다. 새 uploader·validator가 다음 단계에서 정상 작동함을 확인한 뒤 별도 안전 확인을 거쳐 정리해야 하며, 현재는 삭제하지 않았다.
- Cloudflare Builds의 P0 raw-deploy blocker는 해소했다. 2026-08-25 exact readback은 `SKIP_DEPENDENCY_INSTALL=1`, Build `npm ci && npm run cloudflare:prepare:production`, Deploy `npm run cloudflare:upload:production-version`, Version `npx wrangler versions upload`, root `/`, branch `main`, include `*`이고 raw live `wrangler deploy` 설정은 0이었다. 다음 외부 변경 전 다시 읽으며 traffic promotion은 계속 Git trigger 밖에서 signed evidence와 exact version ID를 다시 승인한 job으로만 수행한다.
- tracked release policy의 staging account fingerprint는 domain-separated SHA-256 `6ef9d1a2e2a398e755e1d4108acabacde0f5218f9f455abf79f1af56a154ea0f`이고 실제 account와 exact 일치했다. `smokeAccessPolicySha256`는 `d6c554c1d80c68c08605636f12f26a411f7826bc40eddaee9233a30b6551781a`, staging `publicKeySpkiSha256`는 `69cb5866228f1624693b0903e60d52b0c046464040da621b2d144cb8bffb2182`, `releasePublicKeySpkiSha256`는 `2655be4122fb2238d47ba539b8e86aa9d39899631a7d713106ce711ea2de1ac2`로 확정했다. private key는 Keychain에만 보관했고 export하지 않았다. production account/media/release fingerprint는 모두 `null`로 유지한다.
- single-object create-only, 실제 `head()` probe, staging-only artifact와 admission smoke의 production 의존 분리는 로컬 구현·negative fixture·전체 회귀와 source commit까지 완료했다. push는 계속 승인되지 않았다.
- 실제 `npm ci`부터 시작하는 isolated clean-install fixture는 npm registry만 허용한 임시 Git-style tree에서 PASS했다. private/raw/local media는 0이었고 source-only build·공개 validator·exact Wrangler lock까지 통과했으며 권위 작업공간은 변경하지 않았다.
- `versions upload`은 대상 Worker가 존재하지 않으면 최초 version을 만들 수 없고, read-only 감사에서 staging Worker `dwnc-me-staging`이 없음을 확인했다. route·custom domain·trigger·asset·binding 0인 deny-all staging service bootstrap은 signed existence/authorization 아래 한 번만 수행하며 일반 release가 자동 우회하지 않는다.
- staging Worker·endpoint가 없으므로 아직 Worker GET/HEAD/Range probe를 수행할 표면이 없다. bootstrap→version-only upload→100% activation→Bearer로 보호한 `workers.dev` smoke를 승인된 순서대로 이어가며, 중간에 단순히 추가 승인을 받기 위해 멈추지 않는다.
- 티스토리와 네이버 raw HTML·미디어는 Git 비추적이므로 별도 백업이 필요하다.

## 다음 단계

1. 새 읽기 전용 열쇠를 만들기 전에, 열쇠가 화면·파일·실행 기록에 남지 않는 전달 방식을 안전 문구로 먼저 시험한다.
2. 안전한 전달이 확인되면 시험용 저장소의 비공개 설정을 읽기만 해서 확인하고 사용한 열쇠를 즉시 폐기한다.
3. 새로 확인한 비공개 설정 증거가 유효한 동안 전체 2,758개를 다시 내려받아 개별 SHA-256과 총 2,346,220,246바이트를 원본과 대조한다. 시간이 초과되면 새 증거와 새 결과 경로로 처음부터 다시 확인한다.
4. 전체 파일 내용 확인을 마치면 보호된 시험용 접근 열쇠와 서명 증거를 준비하고, 외부 요청을 모두 거부하는 시험용 Worker를 최초 생성한다.
5. 확정된 Git 기록과 R2 감사 결과에 묶인 staging Worker version만 올리고 적용한 뒤 정적 페이지·349 redirects·media GET/HEAD/304/206/416을 `workers.dev`에서 검증한다.
6. production 이름의 Cloudflare 자원·version 작업이 필요하면 같은 안전 절차로 계속한다. 실제 `dwnc.me` 도메인·DNS·route는 연결하지 않는다.
7. 공유·스크랩 추정 10개, 새 글 편집 방식, 과거 댓글과 private backup 정책을 별도 결정한다. 실제 도메인·DNS 연결을 후속으로 결정하면 `docs/URL_CONTRACT.md`의 edge redirect를 실제 응답으로 검증한다.

## 중요한 제약과 주의사항

- 기존 네이버·티스토리 글을 수정하거나 삭제하지 않는다.
- 완료된 티스토리 이전기를 다시 실행하지 않는다. 티스토리 산출물은 읽기 전용 기준선으로 취급한다.
- 공개 범위가 불명확한 글은 공개하지 않는다.
- 네이버 비공개 제목과 본문을 원격 저장소나 공개 빌드에 포함하지 않는다.
- 네이버 비공개 원문 HTML·정규화 본문·미디어·민감 인벤토리는 `migration/private/` 밖으로 복사하지 않으며 로그·상태 문서에도 제목·본문·ID 목록을 남기지 않는다.
- 공개 콘텐츠 트리에 비공개 글이 우연히 들어가더라도 공개 필터에 의존해 숨기는 방식은 허용하지 않는다. 캡처·저장·빌드 입력 단계의 물리 분리를 유지한다.
- 공유 글, 외부 링크 카드, 외부 임베드는 작성자 소유 원문과 동일하게 취급하지 않는다.
- 원문 스냅샷과 미디어 해시 기준표를 정규화 결과보다 우선하는 증거로 유지한다.
- legacy raw를 덮어쓰지 않는다. 재캡처나 복구는 버전 경로와 no-replace 의미를 유지하고 canonical 선택 근거를 별도 매니페스트에 기록한다.
- legacy `page.html`은 비정본 진단 파일이다. 본문 변환·원문 완전성 증거로 사용하지 않는다.
- `src/data/posts/naver/`, `public/media/naver/`, `dist/`는 최종 통합 QA를 통과한 로컬 후보다. 공개 R2에는 최종 manifest 2,758개만 create-only로 올리고 전수 검증 전에 서비스하지 않는다.
- 실제 `dwnc.me` 도메인·DNS·route 연결과 traffic 전환, Git push는 하지 않는다. Cloudflare의 production 이름 R2·Worker·version 작업은 실제 도메인과 연결되지 않아 현재 방문자에게 영향을 주지 않으며 승인된 순서 안에서 계속할 수 있다.
- 보호 절차 없이 직접 실행하는 `wrangler deploy`, 파일·R2 객체 덮어쓰기·삭제, orphan 자동 삭제, 자격증명·token·private key 값 기록을 하지 않는다.
- `wrangler.jsonc`의 staging bucket 이름은 실제 private bucket과 일치하지만 binding·Worker·route는 여전히 미배포 draft다. production 이름의 bucket·binding도 현재 실제 생성·연결을 의미하지 않는다.
- R2 key mismatch는 자동 overwrite하지 않고 orphan은 자동 삭제하지 않는다. public→private/tombstone은 cache 조회보다 먼저 작동하는 최신 allowlist deny release를 forward 적용한다. exact URL cache purge는 보장할 수 없으므로 보안 경계로 삼지 않고, privacy rollback에서도 최신 deny 상태를 유지한다.
- 실제 배포 전 기존 `dwnc.me/{숫자}` 164개 전수 응답·리디렉션 회귀 검증이 필요하다.
- 본문 링크 호환은 `src/lib/public-links.ts`의 공개 registry와 표현 transformer에서만 유지한다. raw·normalized·frontmatter·importer에 canonical 링크를 역기록하지 않는다.
- 비공개·공유·스크랩 미결정 자료를 공개 URL registry, alias, redirect, 검색, RSS, sitemap에 추가하지 않는다.
