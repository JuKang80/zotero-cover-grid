# Zotero Cover Grid 📚✨

**English** | [한국어](README.ko.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Zotero: 10.0+](https://img.shields.io/badge/Zotero-10.0%2B-red.svg)](https://www.zotero.org/)

> A visual bookcase extension for **Zotero 10** that turns text-heavy lists into an intuitive, high-fidelity **paper cover grid**.  
> Browse PDF covers, glance at APA 7 citations, and track your reading progress with one click.

---

## 📸 Screenshots

<!-- Full Screen Screenshot Placeholder -->
> 💡 *Screenshot: Full cover grid view*  
> `![Zotero Cover Grid Preview](docs/images/preview.png)`

<br>

| Toolbar & Zoom Slider | Paper Card & Status Badges |
| :---: | :---: |
| `![Toolbar Controls](docs/images/toolbar.png)` | `![Card Badges](docs/images/card.png)` |
| *[ ≡ List \| ⊞ Grid ] Toggle & Zoom Slider* | *APA 7 citation & Unread/Reading/Read badges* |

---

## ✨ Features

- **🖼️ First-Page PDF Bookcase**: Automatically turns the first page of attached PDFs into crisp paper covers
- **🧠 Smart Publisher Cover Detection**: Identifies publisher splash sheets (JSTOR, Elsevier, etc.) and uses **Page 2 as the true cover**
- **📖 Clean APA 7 Citations**: Smart author formatting (`Kim et al. (2026)`) so you can identify papers at a glance
- **🚦 One-Click Traffic Light Badges**: Cycle through `UNREAD ➔ READING ➔ READ` (instantly syncs with `#unread`, `#reading`, `#read` tags)
- **🔄 Instant View Switcher**: A segmented button `[ ≡ | ⊞ ]` right next to the search bar for zero-second toggling
- **🔍 Adjustable Card Zoom**: Scale cards smoothly from a compact 8-column bookcase to a large 3-column view
- **⚡ Smooth 60fps Scrolling**: Intelligent viewport rendering keeps browsing fast even with thousands of papers
- **🌙 Native Theme Harmony**: Supports dark mode dimming, respects system font sizes, and mirrors native deletion policies

---

## 📦 Installation in Zotero 10

1. Download `zotero-cover-grid.xpi` from the [Releases](https://github.com/JuKang80/zotero-cover-grid/releases) page.
2. Open Zotero 10.
3. In the top menu, go to **Tools** ➔ **Plugins** (or **Add-ons**).
4. Click the gear icon (⚙️) in the top-right corner and select **Install Add-on From File...**.
5. Select the downloaded `zotero-cover-grid.xpi` file and confirm.
6. The `[ ≡ | ⊞ ]` switcher will appear immediately next to the search bar!

---

## 🎮 Controls & Shortcuts

| Input / Shortcut | Action |
| :--- | :--- |
| **Click** | Synchronize with the right-hand metadata inspector |
| **Double-click / Enter** | Open PDF in the built-in reader tab or system viewer |
| **Arrow Keys (↑, ↓, ←, →)** | Mouse-less card navigation with auto-tracking viewport scroll |
| **Badge Click** | Cycle reading status (`UNREAD` ➔ `READING` ➔ `READ`) |
| **Cmd/Ctrl + Click** | Multi-select individual items (toggle) |
| **Shift + Click** | Select contiguous range of items |
| **Delete / Backspace** | Delete item (collection remove vs library trash) |
| **Search Input / ESC** | Real-time freeze-free filtering (`ESC` to instantly reset) |

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
