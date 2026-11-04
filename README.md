# Zotero Cover Grid 📚✨

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Zotero: 10.0+](https://img.shields.io/badge/Zotero-10.0%2B-red.svg)](https://www.zotero.org/)
[![Runtime: Gecko 140 ESR](https://img.shields.io/badge/Runtime-Gecko%20140%20ESR-orange.svg)]()

> A modern, seamless **Visual APA 7 Cover Grid & Card View** extension for **Zotero 10**.  
> Transform your text-heavy library into an intuitive visual bookcase with PDF first-page covers, smart caching, and 60fps virtual scrolling.

---

## 🌟 Key Features

- **📖 APA 7 Paper Cards**: Displays high-fidelity PDF first-page covers alongside formatted author citations (`Kim et al. (2026)`), item types, and interactive reading status badges.
- **⚡ Zero-Freeze Smart Pipeline**:
  - **Skeleton Loading**: Smooth pulse placeholders while thumbnails render.
  - **Idle Prefetching**: Automatically pre-renders the next 20 adjacent cards during idle time.
  - **Smart Splash Detection**: Automatically detects publisher cover sheets (JSTOR, Elsevier, etc.) and renders Page 2 as the true cover!
- **🔄 Seamless 0-second View Switching**: Toggle between standard List view (`≡`) and Cover Grid (`⊞`) with zero state loss or scroll jumps.
- **🔍 Realtime Zoom Slider**: Freely resize card thumbnails from compact (8 columns) to large (3 columns) in real-time.
- **🌙 Native Theme Harmony**: Respects Zotero's system font size settings, dark mode tone-down filters, and native deletion policies.
- **🏷️ Two-way Reading Status**: Cycle between `Unread ➔ Reading ➔ Read` with one click; automatically syncs with Zotero tags (`#unread`, `#reading`, `#read`).

---

## 🛠️ Architecture & Specifications

For the complete enterprise specification, see [PRD.md](./PRD.md).

- **Runtime**: Mozilla Gecko 140.0 ESR (Firefox 140 codebase)
- **Language**: TypeScript 5+ & Modern Web Components
- **Bundler**: esbuild with XPCOM lifecycle export hooks
- **Test Suite**: Vitest (Headless CLI verification)

---

## 🚀 Development & Build

```bash
# Install dependencies
npm install

# Type-check
npm run type-check

# Run unit tests
npm run test

# Build & Package .xpi for Zotero 10
npm run package
```

The compiled extension package will be generated at `build/zotero-cover-grid.xpi`.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
