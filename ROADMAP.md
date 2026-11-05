# Zotero Cover Grid 로드맵 & 기능 체크리스트 🗺️

이 문서는 **Zotero Cover Grid** 확장기능의 단계별 구현 현황, 품질 검증 체크리스트 및 향후 버전별 기능 개발 로드맵을 정리한 문서입니다.

---

## 📌 현재 개발 현황 요약

- **현재 버전**: `v0.1.0-alpha` (Step 1 ~ Step 5 전 기능 구현 및 통과)
- **타깃 런타임**: Zotero 10.0+ (`Gecko 140.0 ESR`, XUL+XHTML 통합 환경)
- **테스트 통과율**: **40 / 40 테스트 100% 통과** (13개 테스트 파일)
- **패키징 산출물**: `build/zotero-cover-grid.xpi` (10.2 KB)

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

### v0.2.0 (UX 편의성 강화)
- [ ] **수동 표지 선택 다이얼로그**: 논문 우클릭 컨텍스트 메뉴에서 `[페이지 번호 직접 지정하여 표지 변경]` 지원
- [ ] **외부 이미지 표지 등록**: 로컬 이미지 파일(JPG, PNG)을 드래그하여 논문 표지로 지정하는 기능
- [ ] **서가 정렬 기준 선택**: 툴바에 정렬 드롭다운 추가 (최신 출판순, 추가된 날짜순, 제목순)
- [ ] **읽기 뱃지 커스텀 라벨**: 사용자가 원하는 태그명 및 색상 매핑 설정 옵션

### v0.3.0 (고급 필터 & 컬렉션 뷰)
- [ ] **상단 상태별 원클릭 퀵 필터 칩**: `[전체] [읽지 않음] [읽는 중] [완독]` 필터 버튼
- [ ] **서브 컬렉션 재귀 탐색 토글**: 하위 폴더 논문 포함 여부 툴바 원클릭 토글
- [ ] **표지 캐시 관리 설정창**: Zotero 설정창 내에 `[디스크 캐시 용량 확인 및 비우기]` 버튼 제공

### v1.0.0 (안정화 및 Zotero 공식 디렉토리 등록)
- [ ] **커뮤니티 다국어 번역 확장**: 일본어(`ja-JP`), 중국어(`zh-CN`), 독일어(`de-DE`), 프랑스어(`fr-FR`) 추가
- [ ] **Zotero Plugins 공식 디렉토리 등록 PR 제출**
- [ ] **자동 업데이트(Update URL) 호스팅 구성**

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
