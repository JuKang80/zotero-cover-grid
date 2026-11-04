# Zotero Cover Grid 📚✨

**English** | [한국어](README.ko.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Zotero: 10.0+](https://img.shields.io/badge/Zotero-10.0%2B-red.svg)](https://www.zotero.org/)

> A visual bookcase extension for **Zotero 10** that turns text-heavy lists into an intuitive, high-fidelity **paper cover grid**.  
> Browse PDF covers, glance at APA 7 citations, and track your reading progress with one click.

---

## 📸 Screenshots

<!-- Main Preview Placeholder -->
> 💡 *Screenshot placeholder: Full cover grid view*  
> `![Zotero Cover Grid Preview](docs/images/preview.png)`

<br>

<div align="center">
  <table style="border: none;">
    <tr>
      <td align="center" width="50%">
        <!-- Screenshot 1: View Toggle & Zoom Slider -->
        <b>[ ≡ List | ⊞ Grid ] Toggle & Zoom Slider</b><br><br>
        <i>(Screenshot placeholder: Toolbar buttons & card resizing)</i>
      </td>
      <td align="center" width="50%">
        <!-- Screenshot 2: Paper Card & Reading Status Badge -->
        <b>Paper Card & Reading Status Badges</b><br><br>
        <i>(Screenshot placeholder: APA 7 citation & Unread/Reading/Read tags)</i>
      </td>
    </tr>
  </table>
</div>

---

## ✨ Features

- **🖼️ First-Page PDF Bookcase**: Automatically turns the first page of attached PDFs into crisp paper covers.
- **🧠 Smart Publisher Cover Detection**: Automatically identifies splash sheets from JSTOR, Elsevier, etc., and uses **Page 2 as the true cover**.
- **📖 Clean APA 7 Citations**: Smart author formatting (`Kim et al. (2026)`) so you can quickly identify papers at a glance.
- **🚦 One-Click Traffic Light Badges**: Click card badges to cycle through `UNREAD ➔ READING ➔ READ`; instantly synchronizes with native Zotero tags (`#unread`, `#reading`, `#read`).
- **🔄 Instant View Switcher**: A segmented button `[ ≡ | ⊞ ]` right next to the search bar for zero-second toggling between list and grid views.
- **🔍 Adjustable Card Zoom**: Smoothly scale cards from a compact 8-column bookcase down to a large 3-column view.
- **⚡ Smooth 60fps Scrolling**: Intelligent viewport management keeps browsing fast and responsive even with thousands of papers.
- **🌙 Native Theme Harmony**: Supports dark mode dimming filters, respects Zotero font size scaling, and follows native trash/deletion policies.

---

## 📦 Installation in Zotero 10

1. Download `zotero-cover-grid.xpi` from the [Releases](https://github.com/JuKang80/zotero-cover-grid/releases) page.
2. Open Zotero 10.
3. In the top menu, go to **Tools** ➔ **Plugins** (or **Add-ons**).
4. Click the gear icon (⚙️) in the top-right corner and select **Install Add-on From File...**.
5. Select the downloaded `zotero-cover-grid.xpi` file and confirm.
6. The `[ ≡ | ⊞ ]` switcher will appear immediately next to the search bar!

---

## 🎮 Navigation & Shortcuts

- **Click**: Inspect paper metadata in Zotero's right-hand sidebar.
- **Double-click / Enter**: Open PDF in the built-in reader tab or system viewer.
- **Arrow Keys (↑, ↓, ←, →)**: Mouse-less card navigation with automatic viewport scrolling (`scrollIntoView`).
- **Badge Click**: Cycle reading status (`UNREAD` ➔ `READING` ➔ `READ`).
- **Cmd/Ctrl + Click**: Multi-select individual items.
- **Shift + Click**: Select contiguous range of items.
- **Delete / Backspace**: Remove item (collection remove vs library trash).
- **Search**: Instant, freeze-free filtering as you type (`ESC` to instantly reset).

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
