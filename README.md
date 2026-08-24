# 대왕날치 — dwnc.me

개인 기록의 원문과 공개 범위, 미디어 무결성을 보존하며 직접 운영하는 Astro 블로그 프로젝트다.

## 현재 상태

- 티스토리 공개 글 164개와 사진 814개 이전 완료
- 네이버 직접 작성 글 432개 보존 완료: 공개 185개 + 로컬 전용 비공개 247개
- 전역 순번 canonical 공개 글 349개와 legacy alias 349개 로컬 빌드·검증 완료
- 실제 배포와 DNS 변경은 미승인 상태

세부 진행 상황과 검증 증거는 `PROJECT_STATE.md`를 기준으로 한다.

## 로컬 미리보기

```sh
npm install
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
```

`inventory:validate`와 authoritative sequence 변경은 로컬 원장·원본 인벤토리를 갖춘 보존 작업공간에서 실행한다. `build:validate:public`은 private root가 없는 상태를 주입해 승인된 공개 projection과 content·media·dist만으로 검증되는지 확인한다. private 원장이 없는 공개 전용 환경은 이 자료가 모두 포함된 hydrated bundle일 때만 build·validate할 수 있으며, allocation이나 visibility 변경은 할 수 없다. Git 비추적 media가 빠진 단순 clone은 완전한 빌드 입력이 아니다.

`migration/raw/`, `public/media/tistory/`, 네이버 비공개 메타데이터는 Git에 포함되지 않는다. 새 컴퓨터로 옮기기 전에는 이 로컬 자산을 별도로 백업해야 한다.
