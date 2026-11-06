# Zotero Cover Grid 로드맵 & 기능 체크리스트 🗺️

이 문서는 **Zotero Cover Grid** 확장기능의 단계별 구현 현황, 품질 검증 체크리스트 및 향후 버전별 기능 개발 로드맵을 정리한 문서입니다.

---

## 📌 현재 개발 현황 요약

- **현재 버전**: `v0.3.2` (레거시 탭 완전 제거, 0ms 뷰 전환, 0~9 색상 태그 단축키 및 Zotero Map 연동 완료)
- **타깃 런타임**: Zotero 10.0+ (`Gecko 140.0 ESR`, XUL+XHTML 통합 환경)
- **테스트 통과율**: **151 / 151 테스트 100% 통과** (24개 테스트 스위트)
- **패키징 산출물**: `build/zotero-cover-grid.xpi` (27.0 KB)

---

## ✅ v0.1.0 구현 완료 체크리스트 (Current Release)

### Step 1: 빌드 시스템 & 무인 부트스트랩
- [x] Gecko 140 ESR 단일 타깃 `esbuild` 번들링 파이프라인 (`scripts/build.mjs`)
- [x] XPCOM 부트스트랩 스코프 트래핑 방지 (`IIFE` + `var { install, startup, shutdown, uninstall }` export)
- [x] Zotero 10 매니페스트 구성 (`addon/manifest.json`, `strict_min_version: 10.0`)
- [x] XPI 무결성 패키징 자동화 스크립트 (`scripts/make-xpi.mjs`)
- [x] Headless Vitest + Happy-DOM Gecko 140 모의 환경 완전체 구축 (`tests/setup.ts`)

### Step 2: UI 스위처 & 툴바 컴포넌트
- [x] 검색창 우측 일체형 세그먼트 버튼 주입 (`[ ≡ 목록 | ⊞ 바둑판 ]`)
- [x] 140px ~ 320px 실시간 줌 슬라이더 (`--card-width` CSS 변수 연동)
- [x] XUL `<hbox>` 하위 HTML 커스텀 엘리먼트 0px 높이 붕괴 방지 엄격 CSS
- [x] `#zotero-cover-grid[hidden] { display: none !important; }` 오버라이드
- [x] 확장기능 비활성화/삭제 시 5단계 완전 언로드 롤백 (`#zotero-items-tree` 복구)

### Step 3: PDF.js 썸네일 파이프라인 & 4대 그래픽 방어
- [x] `ChromeUtils.importESModule('resource://zotero/reader/pdf/build/pdf.mjs')` 기반 썸네일 생성기
- [x] 캔버스 치수 Clamping (최대 640x854px, 2x Retina 매칭, A0 포스터 VRAM 폭발 방지)
- [x] 회전 각도(`page.rotate`) 보존 뷰포트 계산
- [x] JSTOR, Elsevier 등 1페이지 출판사 안내문(Splash) 감지 시 2페이지 표지 자동 추출
- [x] 암호화(`PasswordException`), 0바이트, 파일 손상 시 가상 타이포그래피 표지 자동 폴백
- [x] 3단계 다단계 안전 인코딩 (`WebP` ➔ `JPEG` ➔ `PNG`)
- [x] 디스크 WebP 캐시 및 메모리 LRU 캐시 (`URL.revokeObjectURL()` 누수 방지)

### Step 4: 2D 가상 스크롤, 인터랙션 & 데이터 동기화
- [x] APA 7 저자 인용 자동 포맷팅 (1명: `Kim (2026)`, 2명: `Kim & Lee (2026)`, 3명+: `Kim et al. (2026)`)
- [x] 신호등 읽기 상태 뱃지 (`#unread`, `#reading`, `#read`) 원클릭 순환 및 Zotero 태그 2way 실시간 동기화
- [x] Stable Keying (`Map<itemID, CardElement>`)으로 불필요한 DOM 파괴 방지 (깜빡임 0ms)
- [x] Scroll Anchoring: 동기화 중 상단 새 논문 추가 시 스크롤 튐 0px 보정
- [x] 방향키(`↑↓←→`) 포커스 이동 시 뷰포트 자동 추적 (`cardElement.scrollIntoView({ block: 'nearest' })`)
- [x] 방향키 및 클릭 시 Zotero 우측 인스펙터 서지정보 패널 실시간 동기화
- [x] 다중 선택: `Cmd/Ctrl + 클릭` (개별 토글), `Shift + 클릭` (연속 범위 선택)
- [x] 컬렉션 전환 시 이전 작업 즉시 중단 및 큐 플러시 (`AbortController.abort()`)
- [x] 창별 `Zotero.Notifier` 옵저버 등록 및 창 종료 시 완전 해제

### Step 5: 통합 검증, 다국어 & CI/CD
- [x] 150ms Trailing-edge 검색 디바운스 및 ESC/공백 시 0ms Fast-path 복원
- [x] 눈부심 방지 다크 모드 톤다운 필터 (`filter: brightness(0.9) contrast(1.05)`)
- [x] Zotero 고급 설정의 시스템 폰트 크기 자동 상속
- [x] Fluent 다국어 공식 지원 (`addon/locale/ko-KR/covergrid.ftl`, `en-US/covergrid.ftl`)
- [x] GitHub Actions 자동 빌드 및 릴리즈 첨부 워크플로우 (`.github/workflows/release.yml`)
- [x] 사용자 친화적 문서화 (`README.md`, `README.ko.md`)

---

## 🚀 차기 버전 개발 로드맵 (Upcoming Roadmap)

### v0.4.0 (Native Zotero Parity UX - 순정 조테로 감각 일체화)
> **핵심 원칙**: "디자인만 카드 그리드로 바뀌었을 뿐, 손에 익은 Zotero 고유의 조작감·단축키·인터랙션은 100% 동일하게 유지한다."

- [ ] **1. 뷰 전환 시 선택 항목 & 스크롤 위치 양방향 동기화**
  - 리스트 뷰에서 선택한 논문이 그리드 전환(`⊞`) 시 그대로 선택 상태를 유지하며 해당 카드로 스크롤 이동.
  - 그리드에서 카드를 선택한 뒤 리스트로 전환(`☰`) 시 네이티브 테이블 행(`zotero-items-tree`)으로 포커스 및 스크롤 동기화.
- [ ] **2. 단축키 & 퀵 카피(Quick Copy) 패리티**
  - 카드 선택 상태에서 `Cmd+C` / `Ctrl+C` 입력 시 Zotero 기본 퀵 카피(APA 7 또는 사용자 설정 인용/BibTeX 포맷)로 클립보드 복사.
  - `Shift + 방향키(↑↓←→)`를 통한 그리드 내 인접 카드 연속 범위 확장 선택.
  - `Backspace`(컬렉션에서 제거) vs `Cmd+Backspace`/`Shift+Delete`(휴지통 이동)의 Zotero 기본 삭제 정책 분기 처리.
- [ ] **3. 좌측 컬렉션 트리 드래그 앤 드롭 (Drag & Drop)**
  - 카드를 마우스로 끌어서 좌측 사이드바 컬렉션 폴더(`#zotero-collections-tree`)에 놓아 바로 분류할 수 있도록 `draggable="true"` 및 `text/x-zotero-drag-item` DataTransfer 연동.
- [ ] **4. 다중 선택(Multi-Selection) 완벽 연동**
  - 복수 카드 선택 시 우측 인스펙터 패널에 Zotero 네이티브 "N개 항목 선택됨" 요약창 표시.
  - 상단 메뉴 및 상태바의 "선택 항목 내보내기", "선택 항목 서지 생성" 등과 `zp.itemsView.selectItems(allIds)` 완전 동기화.
- [ ] **5. Zotero 순정 컨텍스트 메뉴 호환 & 맥북 트랙패드/노트 대응**
  - 카드 우클릭 시 Zotero 네이티브 컨텍스트 메뉴(`#zotero-item-contextmenu`)를 띄워 타 플러그인(번역기, Better BibTeX 등) 및 기본 메뉴(중복 병합, 내보내기 등)의 연속성 보장.
  - **맥북 트랙패드 지원**: 두 손가락 탭뿐만 아니라 macOS 표준 `Control + 클릭` 시 다중 선택으로 빠지지 않고 우클릭 컨텍스트 메뉴가 즉시 열리도록 보정.
  - **노트(Research Note) 카드 전용 메뉴**: PDF가 없는 독립 노트 카드의 경우 `📝 새 탭에서 노트 편집`, `📋 본문 복사`, `🗑️ 노트 삭제` 등 노트 맞춤형 액션 제공 (빈 메뉴 현상 방지).
- [ ] **6. 좌측 하단 태그 셀렉터(Tag Selector) 실시간 연동**
  - 좌측 하단 태그 창에서 태그를 다중 선택/해제할 때 그리드 카드가 0ms 실시간으로 필터링되도록 이벤트 바인딩.

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

## 🧪 테스트 스위트 체크 현황

| 테스트 파일 | 검증 항목 | 상태 |
| :--- | :--- | :---: |
| `tests/dom-lifecycle.test.ts` | 초기 주입 시 hidden 속성 및 DOM 무결성 | ✅ 통과 |
| `tests/unload-cleanup.test.ts` | 5단계 완전 언로드 롤백 및 네이티브 트리 복원 | ✅ 통과 |
| `tests/splash-detector.test.ts` | JSTOR, Elsevier 등 출판사 안내문 키워드 감지 | ✅ 통과 |
| `tests/cache-manager.test.ts` | 디스크/메모리 캐시 히트, LRU 용량 제한 및 URL 회수 | ✅ 통과 |
| `tests/pdf-edge-cases.test.ts` | A0 포스터 치수 Clamping, 암호화/0바이트 파일 가상 표지 폴백 | ✅ 통과 |
| `tests/apa-formatter.test.ts` | APA 7 저자 인용 규칙 (1명/2명/3명 이상/무명/무연도) | ✅ 통과 |
| `tests/virtual-scroller.test.ts` | Stable Keying DOM 유지, 뱃지 순환 클릭, 다중 선택 | ✅ 통과 |
| `tests/keyboard-navigation.test.ts` | 방향키 탐색, 자동 스크롤 추적(`scrollIntoView`), 엔터/삭제 | ✅ 통과 |
| `tests/multi-window-sync.test.ts` | 멀티 윈도우 독립 옵저버 등록 및 태그 실시간 동기화 | ✅ 통과 |
| `tests/sync-anchoring.test.ts` | 클라우드 동기화 중 상단 논문 추가 시 뷰포트 스크롤 튐 0px | ✅ 통과 |
| `tests/collection-switch-abort.test.ts` | 컬렉션 전환 시 AbortController 조기 탈출 및 큐 플러시 | ✅ 통과 |
| `tests/search-debounce.test.ts` | 150ms 검색 디바운스 및 ESC 0ms Fast-path 복원 | ✅ 통과 |
| `tests/integration.test.ts` | 확장기능 시작 ➔ 뷰 전환 ➔ 줌 ➔ 키보드 ➔ 언로드 전체 여정 E2E | ✅ 통과 |
