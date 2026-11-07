# Zotero Cover Grid 📚✨

**English** | [한국어](README.ko.md) | [Roadmap & Checklist](ROADMAP.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Zotero: 10.0+](https://img.shields.io/badge/Zotero-10.0%2B-red.svg)](https://www.zotero.org/)

> Transform text-heavy lists into a visual bookcase in **Zotero 10**.  
> Browse PDF covers, glance at APA 7 citations, and track reading progress with a single click.

---

## 📸 Screenshots

<!-- Full Screen Screenshot Placeholder -->
> 💡 *Screenshot: Full cover grid view*  
> `![Zotero Cover Grid Preview](docs/images/preview.png)`

<br>

| Toolbar & Zoom Slider | Paper Card & Status Badges |
| :---: | :---: |
| `![Toolbar Controls](docs/images/toolbar.png)` | `![Card Badges](docs/images/card.png)` |
| *[ ≡ List \| ⊞ Grid ] Toggle & Zoom Slider* | *APA 7 citations & Unread/Reading/Read badges* |

---

## ✨ Features

- **🖼️ First-Page PDF Bookcase**: Renders the first page of attached PDFs into crisp, high-resolution book covers.
- **🧠 Smart Publisher Detection**: Automatically detects publisher splash pages (JSTOR, Elsevier, Springer) and uses **Page 2 as the true cover**.
- **📖 Standard APA 7 Citations**: Formats author citations according to APA 7th edition (`Kim et al. (2026)`) for effortless recognition.
- **🚦 Traffic-Light Reading Badges**: Click any card badge to cycle through `UNREAD ➔ READING ➔ READ` (syncs two-way with `#unread`, `#reading`, `#read` tags).
- **🔄 Zero-Lag View Switching**: A segmented `[ ≡ | ⊞ ]` toggle right next to the search bar switches between list and grid views instantly.
- **🔍 Fluid Card Zoom**: Smoothly scale thumbnails from a compact 8-column bookcase down to an expansive 3-column view.
- **⚡ 60fps Virtual Scrolling**: Lightweight rendering pipeline keeps navigation silky smooth, even across libraries with thousands of papers.
- **🌙 Native Theme Harmony**: Dark mode tone-down filter prevents white-page glare; inherits Zotero font scaling and native deletion policies.

---

## 📦 Installation (Zotero 10)

1. Download the latest `zotero-cover-grid.xpi` from the [Releases](https://github.com/JuKang80/zotero-cover-grid/releases) page.
2. In Zotero 10, go to the top menu and select **Tools** ➔ **Plugins** (or **Add-ons**).
3. Click the gear icon (⚙️) in the top-right corner and select **Install Add-on From File...**.
4. Choose the downloaded `zotero-cover-grid.xpi` file and confirm the installation.
5. Done! The `[ ≡ | ⊞ ]` view toggle and zoom slider will appear immediately next to the search bar.

---

## 🎮 Controls & Shortcuts

| Input / Shortcut | Action |
| :--- | :--- |
| **Click** | Select card and sync right-hand inspector pane |
| **Double-click / Enter** | Open PDF reader or research note in Zotero |
| **Arrow Keys (↑, ↓, ←, →)** | Keyboard navigation with automatic viewport scrolling |
| **Shift + Arrow Keys** | Expand continuous range multi-selection |
| **Cmd / Ctrl + Click** | Toggle selection of individual cards |
| **Shift + Click** | Select a contiguous range of cards |
| **Cmd / Ctrl + C** | Quick Copy citation / bibliography to clipboard |
| **Number Keys (0 - 9)** | Assign or toggle Zotero native color tags |
| **Drag to Left Collections** | Drag & drop cards directly into sidebar collection folders |
| **Right-Click / Trackpad 2-finger tap / Control+Click** | Native Zotero context menu (contextual actions for notes & PDFs) |
| **Backspace** | Remove item from current collection (preserves library copy) |
| **Cmd + Backspace / Shift + Delete** | Move item directly to library trash |
| **Badge Click** | Cycle reading status (`UNREAD` ➔ `READING` ➔ `READ`) |
| **Tag Selector Click** | Reactive 0ms real-time grid filtering from bottom-left tag pane |
| **Search / ESC** | Instant freeze-free search (`ESC` resets to full library instantly) |

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
