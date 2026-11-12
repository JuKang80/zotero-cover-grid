# Zotero Cover Grid 로드맵 & 기능 체크리스트 🗺️

이 문서는 **Zotero Cover Grid** 확장기능의 단계별 구현 현황, 품질 검증 체크리스트 및 향후 버전별 기능 개발 로드맵을 정리한 문서입니다.

---

## 📌 현재 개발 현황 요약

- **현재 버전**: `v0.4.2` (구형 단독/스캔 PDF 지원, JBIG2/Type1 폰트 예외 처리, 그리드-목록 전환 스크롤 오프셋 정위치 복원, 0~9번 숫자 태그 네이티브 연동)
- **타깃 런타임**: Zotero 7 & 10+ (`Gecko 115 ~ 140+ ESR`, XUL+XHTML 통합 환경)
- **테스트 통과율**: **211 / 211 테스트 100% 통과** (32개 테스트 스위트)
- **패키징 산출물**: `build/zotero-cover-grid.xpi`

---

## ✅ 구현 완료 내역 (Release Highlights)

### v0.4.2 (구형 논문·단독 PDF 안정화 & 인터랙션 폴리싱) ✅ 완료
- [x] **구형 단독/스캔 PDF 및 메타데이터 미정리 논문 100% 렌더링**
  - 메타데이터가 없는 구형 논문이나 standalone PDF attachment가 컬렉션에서 누락되지 않도록 SQLite DB(`collectionItems`) 및 `zp.itemsView.getSortedItems()` 통합 매핑.
- [x] **PDF.js 렌더링 예외 안전 폴백**
  - 구형 스캔본의 JBIG2 디코더, Type1 커스텀 폰트, CMap 누락 등 렌더링 실패 시 크래시 없이 가상 타이포그래피 표지로 안전 자동 전환.
- [x] **그리드 $\leftrightarrow$ 목록 뷰 양방향 전환 스크롤 정위치 복원**
  - 가상화 테이블(`VirtualizedTable`)의 뷰포트 오프셋 계산 안정화 및 상단 빈 공간 발생 방지 (`scrollTop = 0` 정렬 및 Zotero 네이티브 가시성 보장 API 연동).
- [x] **숫자 키(`0~9`) 색상 태그 토글 Zotero 네이티브 일체화**
  - macOS 환경(한글 IME 포함) 카드 포커스 즉시 보장.
  - Zotero 공식 내장 태그 API(`Zotero.Tags.toggleItemsListTags`, `removeColoredTagsFromItems`)와 100% 연동하여 실행 취소(Undo) 및 태그 상태 양방향 동기화.

### v0.4.0 (Native Zotero Parity UX - 순정 조테로 감각 일체화) ✅ 완료
> **핵심 원칙**: "디자인만 카드 그리드로 바뀌었을 뿐, 손에 익은 Zotero 고유의 조작감·단축키·인터랙션은 100% 동일하게 유지한다."

- [x] **뷰 전환 시 선택 항목 & 스크롤 위치 양방향 동기화**: 리스트 $\leftrightarrow$ 그리드 전환 시 선택 상태 및 해당 카드로 포커스 이동.
- [x] **단축키 & 퀵 카피(Quick Copy) 패리티**: 카드 선택 상태에서 `Cmd+C` / `Ctrl+C` 입력 시 Zotero 기본 퀵 카피로 클립보드 복사.
- [x] **연속 다중 선택**: `Shift + 방향키(↑↓←→)`를 통한 그리드 내 인접 카드 연속 범위 확장 선택.
- [x] **삭제 정책 분기 처리**: `Backspace`(컬렉션에서 제외) vs `Cmd+Backspace`/`Shift+Delete`(휴지통 이동) 반영.
- [x] **좌측 컬렉션 트리 드래그 앤 드롭**: 마우스로 끌어 좌측 사이드바 컬렉션 폴더로 즉시 분류 (`text/x-zotero-drag-item`).
- [x] **다중 선택 인스펙터 연동**: 복수 카드 선택 시 우측 인스펙터 패널에 Zotero 네이티브 "N개 항목 선택됨" 요약창 표시.
- [x] **Zotero 순정 컨텍스트 메뉴 호환**: 카드 우클릭 시 Zotero 기본 메뉴 표출 및 macOS 트랙패드 `Control + 클릭` 지원.
- [x] **연구 노트 전용 메뉴 지원**: PDF 없는 독립 노트 카드의 맞춤형 액션 제공.
- [x] **좌측 하단 태그 셀렉터 실시간 연동**: 태그 다중 선택/해제 시 그리드 카드 0ms 실시간 필터링.

### v0.1.0 ~ v0.3.0 (코어 엔진 & 기반 시스템) ✅ 완료
- [x] Gecko 140 ESR 단일 타깃 `esbuild` 번들링 및 XPCOM 스코프 트래핑 방지
- [x] 검색창 우측 일체형 세그먼트 버튼 (`[ ≡ 목록 | ⊞ 바둑판 ]`) 및 140px ~ 340px 줌 슬라이더
- [x] 캔버스 치수 Clamping (최대 640x854px, 2x Retina 매칭, A0 포스터 VRAM 폭발 방지)
- [x] JSTOR, Elsevier 등 1페이지 출판사 안내문(Splash) 감지 시 2페이지 표지 자동 추출
- [x] 3단계 다단계 안전 인코딩 (`WebP` ➔ `JPEG` ➔ `PNG`) 및 디스크/메모리 LRU 캐싱
- [x] APA 7 저자 인용 자동 포맷팅 및 신호등 읽기 상태 뱃지 (`#unread`, `#reading`, `#read`)

---

## 🚀 차기 버전 개발 로드맵 (Upcoming Roadmap)

### v0.5.0 (표지 커스터마이징 & 고급 서가 관리)
- [ ] **수동 표지 선택 다이얼로그**: 논문 우클릭 컨텍스트 메뉴에서 `[페이지 번호 직접 지정하여 표지 변경]` 지원
- [ ] **외부 이미지 표지 등록**: 로컬 이미지 파일(JPG, PNG)을 드래그하여 논문 표지로 지정하는 기능
- [ ] **서가 정렬 기준 선택**: 툴바에 정렬 드롭다운 추가 (최신 출판순, 추가된 날짜순, 제목순)
- [ ] **상단 상태별 원클릭 퀵 필터 칩**: `[전체] [읽지 않음] [읽는 중] [완독]` 필터 버튼
- [ ] **표지 캐시 관리 설정창**: Zotero 설정창 내에 `[디스크 캐시 용량 확인 및 비우기]` 버튼 제공

### v1.0.0 (안정화 및 Zotero 공식 디렉토리 등록)
- [ ] **커뮤니티 다국어 번역 확장**: 일본어(`ja-JP`), 중국어(`zh-CN`), 독일어(`de-DE`), 프랑스어(`fr-FR`) 추가
- [ ] **Zotero Plugins 공식 디렉토리 등록 PR 제출**

---

## 🧪 테스트 스위트 체크 현황 (32개 스위트 / 211개 테스트 전체 PASS)

| 주요 테스트 스위트 | 검증 항목 | 상태 |
| :--- | :--- | :---: |
| `tests/v0.4-native-parity.test.ts` | 뷰 전환 스크롤/선택 동기화, 퀵 카피, 드래그앤드롭, 트랙패드 | ✅ 통과 |
| `tests/view-state-sync.test.ts` | 목록 $\leftrightarrow$ 그리드 선택 ID 추출 및 뷰포트 오프셋 복원 | ✅ 통과 |
| `tests/collection-loading-parity.test.ts` | 컬렉션 항목 로딩, SQLite DB 및 ZoteroPane itemsView 일치성 | ✅ 통과 |
| `tests/tag-color-sync-uncached.test.ts` | 캐시되지 않은 항목의 0~9번 숫자 태그 토글 및 네이티브 연동 | ✅ 통과 |
| `tests/keyboard-shortcuts.test.ts` | Shift+방향키, 0~9 색상 태그, Cmd+C, ESC 키보드 조작 | ✅ 통과 |
| `tests/pdf-edge-cases.test.ts` | A0 포스터 치수 Clamping, 암호화/0바이트 파일 가상 표지 폴백 | ✅ 통과 |
| `tests/dom-lifecycle.test.ts` | 초기 주입 시 hidden 속성 및 DOM 무결성 | ✅ 통과 |
| `tests/unload-cleanup.test.ts` | 5단계 완전 언로드 롤백 및 네이티브 트리 복원 | ✅ 통과 |
| `tests/splash-detector.test.ts` | JSTOR, Elsevier 등 출판사 안내문 키워드 감지 | ✅ 통과 |
| `tests/cache-manager.test.ts` | 디스크/메모리 캐시 히트, LRU 용량 제한 및 URL 회수 | ✅ 통과 |
| `tests/apa-formatter.test.ts` | APA 7 저자 인용 규칙 (1명/2명/3명 이상/무명/무연도) | ✅ 통과 |
| `tests/virtual-scroller.test.ts` | Stable Keying DOM 유지, 뱃지 순환 클릭, 다중 선택 | ✅ 통과 |
| `tests/keyboard-navigation.test.ts` | 방향키 탐색, 자동 스크롤 추적(`scrollIntoView`), 엔터/삭제 | ✅ 통과 |
| `tests/multi-window-sync.test.ts` | 멀티 윈도우 독립 옵저버 등록 및 태그 실시간 동기화 | ✅ 통과 |
| `tests/sync-anchoring.test.ts` | 클라우드 동기화 중 상단 논문 추가 시 뷰포트 스크롤 튐 0px | ✅ 통과 |
| `tests/collection-switch-abort.test.ts` | 컬렉션 전환 시 AbortController 조기 탈출 및 큐 플러시 | ✅ 통과 |
| `tests/search-debounce.test.ts` | 150ms 검색 디바운스 및 ESC 0ms Fast-path 복원 | ✅ 통과 |
| `tests/integration.test.ts` | 확장기능 시작 ➔ 뷰 전환 ➔ 줌 ➔ 키보드 ➔ 언로드 전체 여정 E2E | ✅ 통과 |
