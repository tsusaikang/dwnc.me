# dwnc.me 프로젝트 공식 상태

최종 갱신: 2026-08-24 KST — 전역 순번 linked recovery lease 이중 장애 복구·MIME fixture 최종 하드닝

## 현재 목표와 완료 조건

네이버 블로그 `blog.naver.com/tsusai`와 티스토리 기반 `dwnc.me`의 직접 작성 콘텐츠를 소유자가 통제하는 새 블로그로 이전한다. 원문, 이미지, 게시일, 카테고리, 태그, 기존 주소, 공개 범위를 보존하며 이후 새 글도 지속해서 작성할 수 있어야 한다.

전체 프로젝트 완료 조건은 다음과 같다.

- 티스토리 공개 164개와 네이버 공개 185개의 canonical을 전역 순번 `/posts/{globalSequence}`로 제공하고, 기존 `/{id}`·`/naver/{logNo}`는 정확한 alias로 유지한다.
- 네이버 전체공개 직접 작성 글 185개의 본문과 미디어를 새 공개 경로로 이전한다.
- 네이버 비공개 글 247개는 별도 로컬 영역에 보존하며 명시적 승인 전 공개 빌드에 포함하지 않는다.
- 네이버 공개 목록과 직접 작성 글 목록의 차이 10개(공유·스크랩 추정)는 저작권과 출처를 검토해 링크형 기록 또는 제외로 개별 결정한다.
- 원문 HTML과 정규화 본문을 분리하고, 미디어마다 원주소·SHA-256·크기·MIME·로컬 경로를 기록한다.
- 글 목록, 상세, 카테고리, 연도별 아카이브, 검색, RSS, 사이트맵, 데스크톱·모바일 화면을 검증한다.
- 기존 블로그 수정, 배포, DNS 변경은 별도 사용자 승인 뒤에만 수행한다.

## 현재 단계

- 티스토리 공개 콘텐츠 이전: **완료 및 전수 검증 통과**
- 네이버 소유 글 인벤토리: **완료**
- 네이버 편집기 세대·공개 범위 표본 조사: **완료**
- 네이버 canonical raw HTML v2 보존: **432/432 완료 및 전수 무결성 검증 통과**
- 네이버 importer schema 2·normalization 3 정규화·미디어 전수 실행: **432/432 verified, partial 0, failure 0**
- 네이버·티스토리 통합 inventory/check/build/build-validator: **모두 PASS**
- 공개 SmartEditor3 파생 메타 chrome 정제: **144/144 PASS, 노출 0**
- 공개 Naver 비디오 표시 정책: **81/81 분류·표시 검증 PASS**
- 공개 글 구조 분류: **사진형 149 + 장문형 200, 실제 렌더 구조 불일치 0**
- 공개 파생 텍스트 zero-width 정제: **meta·OG·검색·RSS 잔류 0**
- source 없는 Naver 비디오 fallback 접근성: **53/53 이름·고유 ID·AA 대비 PASS**
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
- 네이버 세 편집기 세대 대표·비디오 대표 데스크톱·모바일 브라우저 QA: **모두 PASS**
- 이전 기술 완료 조건: **달성**
- 운영 방식·호스팅·도메인 전환: **정책 결정 및 사용자 승인 대기 / 미배포**

## 작업 운영 원칙

- 부모 세션은 범위·승인 경계·검증·인수인계를 관리하는 오케스트레이션에 집중하고, 대량·장기 실작업은 내용에 맞춰 하위 에이전트에 위임한다.
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
7. 티스토리 지도는 정적 지도 이미지와 장소 설명으로 보존하고, YouTube 영상은 원본 외부 임베드를 유지한다.
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
- `scripts/lib/public-content-preflight.mjs`는 projection과 준비된 공개 content를 exact identity로 결합하고 cover·HTML/Markdown media·poster·href·srcset·CSS `url()`·`@import`·background·input/track source 등 렌더 가능한 로컬 참조를 전수 추출하며 active object/embed와 은닉 MDX·encoded media 참조를 거부한다. 최초 공개 면제 identity 349개는 불변 digest로 고정되고 mutable inventory injection, orphan·duplicate receipt는 실패한다. 현재 공개 asset 2,889개는 identity별 manifest 증거와 정확히 일치하며, promotion/native는 content SHA와 exact asset set을 가진 build-safe receipt 없이는 실패한다.
- `scripts/lib/public-dist-assets.mjs`와 build validator는 현재 projection의 모든 자산 2,889개를 genesis manifest 또는 identity-bound receipt의 exact 경로·크기·SHA-256·MIME와 대조하고 HTML payload·unsafe MIME·누락·변조를 거부한다. `scripts/validate-public-only.mjs`는 비공개 root가 존재하지 않는 경로를 주입해 hydrated 공개 bundle만으로 build/runtime/validator가 통과하고 private 디렉터리를 만들지 않는지 검증한다.
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
- `scripts/lib/public-content-preflight.mjs`: projection-backed 공개 content exact join, 안전한 경로·렌더 asset 추출, genesis inventory 또는 identity-bound receipt 검증
- `scripts/lib/public-dist-assets.mjs`: 현재 projection의 manifest/receipt-backed 공개 자산을 dist exact 경로·크기·SHA-256·MIME와 대조하고 HTML payload를 거부
- `scripts/validate-public-only.mjs`: injected absent private root에서 hydrated 공개 projection·content·media·dist만 검증하고 private 디렉터리 생성·권위 root 변경 0을 확인
- `scripts/test-global-sequence.mjs`, `scripts/validate-global-sequence.mjs`: 전이·공개 surface·불변 genesis/asset receipt·초기화/transaction fault injection·이중 hard-exit stale-transfer 재개·경로·append-only 순수 fixture 117건과 실제 원장·projection·private route·public import 경계 검증
- `scripts/test-global-sequence-cli.mjs`: 허용 메타데이터와 최소 공개 fixture로 실제 `recover-transfer` CLI의 recovery-lock 취득 직후·reconcile 직후 hard exit, 재실행 성공·최종 verify를 검증하는 5개 fixture
- `docs/MIGRATION_PLAN.md`: 이전 원칙과 단계
- `docs/URL_CONTRACT.md`: canonical·rewrite·unknown/private/shared·edge redirect 승인 계약
- `docs/EDGE_REDIRECTS_V1.json`: 공개 legacy alias 349개의 provider-neutral 308 manifest

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

### 통합 inventory·check·build·build-validator

- `npm run inventory:validate`: PASS. 네이버 432/432 verified, 티스토리 164/164 verified, 공개 본문 안전성 185/185, 비공개 누출 marker 0
- `npm run check`: PASS. Astro 오류 0, 경고 0, 힌트 0
- `npm run build`: PASS. 정적 HTML 1,404개(공개 canonical 349 + legacy alias 349 + 일반 페이지·404), sitemap URL 1,054개 생성
- `npm run build:validate`: PASS. `/posts/{globalSequence}` 상세 349건, legacy alias 349건, 검색 349건, RSS 349건, sitemap 대상 URL 1,054건 일치
- 전역 순번 원장: genesis 596(공개 349 + 비공개 247), sequence 1–596, current generation 0·next 597·journal event 1, initialization·transaction·lock transfer pending 0. allocation/genesis public projection SHA-256 정확 일치, private reserved route 0
- sequence self-test: 순수 117/117 + 실제 CLI 5/5 PASS. native append와 private→public은 max+1/기존 번호를 보존하고, tombstone은 번호를 남기며 모든 공개 surface에서 제거한다. synthetic promotion/tombstone과 stale canonical·alias·검색·RSS·sitemap 거부, 14개 렌더 asset 참조·active embed/은닉 참조 거부, 불변 genesis 면제와 identity-bound receipt, receipt-backed dist 누락·변조·HTML payload·signature/MIME mismatch 거부, 양 commit order, initialization 모든 fault point, transfer receipt 직후 및 linked recovery lock 취득/상태 reconcile 직후 child hard-exit, wrong token/foreign replacement·receipt hash/generation/raw lock SHA 변조 거부·exact 재획득을 검증했다. 실제 CLI는 recovery lock 취득 직후, reconcile 직후, recovery lock 제거 뒤 receipt 제거 전의 세 hard exit를 순서대로 만들고 재시도한 뒤 최종 `verify`와 pending marker 0까지 통과했다. operation/state 불일치·unsafe identity·동결 imported namespace·mode·symlink·hardlink·seal 뒤 원장 유실은 fail closed 또는 검증된 replay로만 처리한다.
- `npm run build:validate:public`: PASS. private root가 없는 경로를 주입한 상태에서 canonical 349·alias 349·HTML 1,404·sitemap 1,054·공개 자산 2,889·링크/분류/검색/RSS 검증을 통과했고, 주입 경로의 private 디렉터리 생성 0·권위 private root 변경 0이었다.
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
- 공개 글 유형: 사진형 149, 장문형 200, 1–3장·120자 미만 일반 규칙 적용 12건, 실제 렌더 구조와 class 불일치 0. 이전 raw 문자열 판정과 달라진 글은 19건이다.
- 공개 Naver video: 전체 81 = 로컬 재생 28 + source 없는 fallback 53. 로컬 28개는 GIF형 반복 재생 정책 28/28, fallback은 영상 길이 보존 53/53, 작성자 영상 캡션 보존 23/23, 연결되지 않은 복구 가능 로컬 video 0
- fallback 접근성: `role="note"`·`aria-labelledby`·결정적 `<strong id>` 연결 53/53, 고유 ID 53·중복 0, 제목 대비 14.1480:1(AAA), 설명 대비 4.8499:1(AA)
- 공개 Naver 본문의 이미지 2,257개, iframe, img/video/iframe 미디어 순서는 정규화 기준과 일치하며 다운로드 미디어 2,075개의 크기·SHA-256 검증을 통과했다. Tistory 814개를 합친 현재 projection 자산 2,889개도 dist의 크기·SHA-256·MIME까지 전수 일치한다.

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
- 최신 `dist/`는 전수 build validation을 통과했다. 사용자 검수용 Astro preview는 프로젝트 cwd의 PID 71662가 `127.0.0.1:4321`에서 제공하고, 루트·`/posts/1`·`/posts/596`·아카이브·두 legacy alias는 모두 HTTP 200 `text/html`이다. 현재 프로세스는 같은 cwd의 Astro module을 사용하며 최신 `/posts/{globalSequence}` 결과를 제공한다. 이는 로컬 검수 상태일 뿐 배포·DNS 승인이 아니다.

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
- 배포 승인 전 추가로 남은 필수 구현·검증 작업은 없다. 다만 운영 호스팅·백업·편집·댓글·공유 글 처리는 별도 정책 결정으로 남아 있다.
- `dist/`는 최종 통합 QA를 통과한 로컬 배포 후보이지만, 원격 배포·DNS·도메인 연결 승인을 의미하지 않는다.

## 미해결 문제

- 배포 승인 전 이전 정확성·완전성 측면의 알려진 기술 blocker는 없다. 이하는 운영·보존·콘텐츠 정책 결정이다.
- HTTP→HTTPS, www→apex, trailing slash와 `/index.html` 정규화는 현재 로컬 소스가 아니라 운영 edge의 승인 항목이다. `docs/URL_CONTRACT.md` 체크리스트에 따라 배포·호스팅 승인 뒤 301/308 단일 hop, chain·loop 0을 검증해야 한다.
- 현재 imported 공개 349글의 다른 글 fragment 링크는 0건이다. 알려진 Naver 플랫폼 fragment와 향후 native deep link fragment는 target rendered ID map을 production 빌드에서 전수 생성·검증하기 전까지 버린다. fragment 보존 map 구현은 P2 후속이며 존재를 증명하지 않은 fragment는 보존하지 않는다.
- 태그 660개는 현재 `/tags` 검색 입력으로 즉시 걸러지지만 전체 노드를 한 페이지에 렌더한다. 초성·주제별 추가 filter나 분할 탐색은 P2 정보구조 개선 항목으로 남겨 두었다.
- 공개 이미지의 대체텍스트 품질·누락은 P2 접근성 개선 항목으로 남아 있다. 원문·정규화 본문을 일괄 수정하지 않고 별도 파생 정책을 설계해야 한다.
- 외부 CDN 없이 시스템 한글 폰트 조합을 사용하므로 운영체제별 글꼴 모양이 완전히 같지는 않다. 로컬 폰트 도입 여부는 라이선스·파일 출처를 확정한 뒤 결정한다.
- 티스토리 정규화 본문 1건의 종료된 영상 fallback HTML은 들여쓴 Markdown code block으로 렌더되어 태그 문자열이 화면에 보이는 기존 표시 문제가 있다. 이번 구조 분류는 실제 렌더 의미를 정확히 반영하지만, 원문·정규화 본문 불변 범위에서 이 표시 자체는 수정하지 않았으므로 별도 파생 표현 보완이 필요하다.
- 네이버 비공개 raw·정규화 본문·미디어는 공개 트리와 물리적으로 분리됐지만 별도 암호화 백업과 복구 절차는 아직 확정하지 않았다.
- 현재 작업 폴더에는 Git 저장소가 없다. 향후 Git 초기화나 원격 연결 전 `.gitignore`와 독립 누출 검증으로 비공개 제목·본문·원문·미디어가 추적 대상이 아님을 다시 증명해야 한다.
- 네이버 공개 목록과 직접 작성 글 목록의 차이 10개(공유·스크랩 추정)에 대한 링크형 기록·제외 결정이 남아 있다.
- 지속적인 새 글 작성 방식을 저장소 기반 편집으로 둘지 로그인형 웹 편집기를 추가할지 최종 결정이 필요하다.
- 티스토리·네이버 댓글을 이식할지, 과거 댓글을 읽기 전용 기록으로만 보존할지 결정이 필요하다.
- 티스토리 약 1.2GB와 네이버 최종 2,372,600,797바이트 미디어를 운영 환경에서 정적 번들로 제공할지 객체 저장소로 분리할지 결정이 필요하다.
- 티스토리와 네이버 raw HTML·미디어는 Git 비추적이므로 별도 백업이 필요하다.

## 다음 단계

1. 사용자는 현재 `http://127.0.0.1:4321`에서 최신 로컬 완성본을 검수한다. 이후 작업에서 프로세스가 사라졌다면 exact PID·cwd·port를 다시 확인한 뒤 최신 `dist/` preview만 안전하게 재기동한다.
2. 사용자와 대용량 미디어 호스팅, 비공개 로컬 보존 영역의 암호화 백업·복구 방식을 결정한다.
3. 공유·스크랩 추정 10개를 링크형 기록으로 남길지 제외할지 결정한다.
4. 새 글 편집 방식과 과거 댓글 보존 정책을 결정한다.
5. 사용자가 배포를 승인하면 현재 최종 QA 기준을 재확인한 뒤 원격 배포를 진행한다.
6. 호스팅 승인 뒤 `docs/URL_CONTRACT.md`의 HTTP/HTTPS·www/apex·trailing slash edge redirect를 실제 응답으로 검증한다.
7. DNS·도메인 연결은 배포와도 별도의 명시적 사용자 승인을 받은 뒤만 진행한다.

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
- `src/data/posts/naver/`, `public/media/naver/`, `dist/`는 최종 통합 QA를 통과했지만 로컬 배포 후보일 뿐이다. 사용자 승인 전에는 원격으로 올리거나 서비스하지 않는다.
- 원격 배포, DNS 전환, 도메인 연결은 사용자 승인 전 수행하지 않는다.
- 실제 배포 전 기존 `dwnc.me/{숫자}` 164개 전수 응답·리디렉션 회귀 검증이 필요하다.
- 본문 링크 호환은 `src/lib/public-links.ts`의 공개 registry와 표현 transformer에서만 유지한다. raw·normalized·frontmatter·importer에 canonical 링크를 역기록하지 않는다.
- 비공개·공유·스크랩 미결정 자료를 공개 URL registry, alias, redirect, 검색, RSS, sitemap에 추가하지 않는다.
