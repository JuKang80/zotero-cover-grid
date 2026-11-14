import { PaperCardData } from '../types';
import { richTextToPlainText } from '../utils/rich-text';

export interface QuickLookRenderResult {
  url: string;
  totalPages: number;
  actualPageNumber: number;
}

export interface QuickLookOpenParams {
  card: PaperCardData;
  initialPage: number;
  totalPages: number;
  pageOffset?: number;
  onRenderPage: (card: PaperCardData, page: number) => Promise<QuickLookRenderResult | null>;
  onPageChange?: (card: PaperCardData, page: number) => void;
  onOpenInTab?: (card: PaperCardData, actualPageNumber: number) => void;
  onClose?: () => void;
}

const HTML_NS = 'http://www.w3.org/1999/xhtml';
const MIN_ZOOM = 100;
const MAX_ZOOM = 250;

export class QuickLookModal {
  private win: any;
  private doc: Document;
  private rootEl: HTMLElement | null = null;
  private dialogEl: HTMLElement | null = null;
  private titleEl: HTMLElement | null = null;
  private metaEl: HTMLElement | null = null;
  private zoomSliderEl: HTMLInputElement | null = null;
  private zoomLabelEl: HTMLButtonElement | null = null;
  private openTabBtnEl: HTMLButtonElement | null = null;
  private closeBtnEl: HTMLButtonElement | null = null;
  private prevBtnEl: HTMLButtonElement | null = null;
  private nextBtnEl: HTMLButtonElement | null = null;
  private stageEl: HTMLElement | null = null;
  private pageWrapperEl: HTMLElement | null = null;
  private imgEl: HTMLImageElement | null = null;
  private spinnerEl: HTMLElement | null = null;
  private pageIndicatorEl: HTMLElement | null = null;
  private dragHintEl: HTMLElement | null = null;

  private activeParams: QuickLookOpenParams | null = null;
  private currentPage = 1;
  private totalPages = 1;
  private pageOffset = 0;
  private actualPageNumber = 1;
  private zoom = 100;
  private panX = 0;
  private panY = 0;
  private isDragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragOriginPanX = 0;
  private dragOriginPanY = 0;
  private renderSeq = 0;
  private activeObjectUrl: string | null = null;
  private previouslyFocusedEl: HTMLElement | null = null;
  private isDestroyed = false;

  private boundKeyDown = (e: KeyboardEvent) => this.handleKeyDown(e);
  private boundMouseMove = (e: MouseEvent) => this.handleMouseMove(e);
  private boundMouseUp = () => this.handleMouseUp();
  private boundWindowBlur = () => this.handleMouseUp();

  constructor(win: any) {
    this.win = win;
    this.doc =
      win?.document ||
      (typeof document !== 'undefined' ? document : null);
  }

  public isOpen(): boolean {
    return Boolean(this.rootEl && !this.rootEl.hidden && this.rootEl.style.display !== 'none');
  }

  public getState() {
    return {
      isOpen: this.isOpen(),
      currentPage: this.currentPage,
      totalPages: this.totalPages,
      actualPageNumber: this.actualPageNumber,
      zoom: this.zoom,
      panX: this.panX,
      panY: this.panY
    };
  }

  private ensureDOM(): void {
    if (this.rootEl || !this.doc) return;

    const createEl = <K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] => {
      return (typeof this.doc.createElementNS === 'function'
        ? this.doc.createElementNS(HTML_NS, tag)
        : this.doc.createElement(tag)) as HTMLElementTagNameMap[K];
    };

    const existing = this.doc.getElementById('zotero-cover-grid-quick-look');
    if (existing) {
      existing.remove();
    }

    const backdrop = createEl('div');
    backdrop.id = 'zotero-cover-grid-quick-look';
    backdrop.className = 'quick-look-backdrop';
    backdrop.hidden = true;
    backdrop.style.display = 'none';
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        this.close();
      }
    });

    const dialog = createEl('div');
    dialog.className = 'quick-look-dialog';
    dialog.tabIndex = -1;
    dialog.addEventListener('click', (e) => e.stopPropagation());

    // Header
    const header = createEl('div');
    header.className = 'quick-look-header';

    const titleGroup = createEl('div');
    titleGroup.className = 'quick-look-title-group';

    const titleEl = createEl('div');
    titleEl.className = 'quick-look-title';
    const metaEl = createEl('div');
    metaEl.className = 'quick-look-meta';
    titleGroup.appendChild(titleEl);
    titleGroup.appendChild(metaEl);

    // Zoom control group
    const zoomGroup = createEl('div');
    zoomGroup.className = 'quick-look-zoom-group';

    const zoomTitle = createEl('span');
    zoomTitle.className = 'quick-look-zoom-title';
    zoomTitle.textContent = '확대';

    const zoomSlider = createEl('input');
    zoomSlider.type = 'range';
    zoomSlider.min = String(MIN_ZOOM);
    zoomSlider.max = String(MAX_ZOOM);
    zoomSlider.step = '1';
    zoomSlider.value = '100';
    zoomSlider.className = 'quick-look-zoom-slider';
    zoomSlider.title = '확대/축소 (더블클릭으로 100% 초기화)';
    zoomSlider.addEventListener('input', (e) => {
      this.setZoom(Number((e.target as HTMLInputElement).value));
    });
    zoomSlider.addEventListener('dblclick', () => {
      this.setZoom(100);
    });
    zoomSlider.addEventListener('change', () => {
      zoomSlider.blur?.();
    });

    const zoomLabel = createEl('button');
    zoomLabel.type = 'button';
    zoomLabel.className = 'quick-look-zoom-label';
    zoomLabel.textContent = '100%';
    zoomLabel.title = '클릭하여 100%로 초기화';
    zoomLabel.addEventListener('click', () => {
      this.setZoom(100);
      zoomLabel.blur?.();
    });

    zoomGroup.appendChild(zoomTitle);
    zoomGroup.appendChild(zoomSlider);
    zoomGroup.appendChild(zoomLabel);

    // Right actions
    const actionsGroup = createEl('div');
    actionsGroup.className = 'quick-look-actions';

    const openTabBtn = createEl('button');
    openTabBtn.type = 'button';
    openTabBtn.className = 'quick-look-open-tab-btn';
    openTabBtn.textContent = '↗ 탭에서 열기';
    openTabBtn.addEventListener('click', () => {
      const params = this.activeParams;
      const targetPage = this.actualPageNumber;
      this.close();
      if (params?.onOpenInTab) {
        params.onOpenInTab(params.card, targetPage);
      }
    });

    const closeBtn = createEl('button');
    closeBtn.type = 'button';
    closeBtn.className = 'quick-look-close-btn';
    closeBtn.textContent = '✕';
    closeBtn.title = '닫기 (Esc)';
    closeBtn.setAttribute('aria-label', '닫기');
    closeBtn.addEventListener('click', () => this.close());

    actionsGroup.appendChild(openTabBtn);
    actionsGroup.appendChild(closeBtn);

    header.appendChild(titleGroup);
    header.appendChild(zoomGroup);
    header.appendChild(actionsGroup);

    // Body / Viewport Stage
    const stage = createEl('div');
    stage.className = 'quick-look-stage';

    const prevBtn = createEl('button');
    prevBtn.type = 'button';
    prevBtn.className = 'quick-look-nav-btn quick-look-nav-prev';
    prevBtn.textContent = '‹';
    prevBtn.title = '이전 페이지';
    prevBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void this.goToPage(this.currentPage - 1);
      prevBtn.blur?.();
    });

    const nextBtn = createEl('button');
    nextBtn.type = 'button';
    nextBtn.className = 'quick-look-nav-btn quick-look-nav-next';
    nextBtn.textContent = '›';
    nextBtn.title = '다음 페이지';
    nextBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void this.goToPage(this.currentPage + 1);
      nextBtn.blur?.();
    });

    const pageWrapper = createEl('div');
    pageWrapper.className = 'quick-look-page-wrapper';

    const img = createEl('img');
    img.className = 'quick-look-page-img';
    img.setAttribute('draggable', 'false');
    pageWrapper.appendChild(img);

    const spinner = createEl('div');
    spinner.className = 'quick-look-spinner';
    spinner.textContent = '페이지 불러오는 중...';
    spinner.hidden = true;
    spinner.style.display = 'none';

    const bottomPill = createEl('div');
    bottomPill.className = 'quick-look-page-pill';
    const pageIndicator = createEl('span');
    pageIndicator.className = 'quick-look-page-indicator';
    pageIndicator.textContent = '1 / 1';
    const dragHint = createEl('span');
    dragHint.className = 'quick-look-drag-hint';
    dragHint.textContent = '드래그하여 이동';
    dragHint.hidden = true;
    dragHint.style.display = 'none';

    bottomPill.appendChild(pageIndicator);
    bottomPill.appendChild(dragHint);

    stage.appendChild(prevBtn);
    stage.appendChild(pageWrapper);
    stage.appendChild(nextBtn);
    stage.appendChild(spinner);
    stage.appendChild(bottomPill);

    // Wheel listener: Pinch-to-Zoom (ctrlKey/metaKey) + Two-Finger Pan when zoomed
    stage.addEventListener(
      'wheel',
      (e: WheelEvent) => {
        if (!this.isOpen()) return;
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          e.stopPropagation();
          let delta = -e.deltaY * 1.5;
          if (Math.abs(delta) < 1 && e.deltaY !== 0) {
            delta = e.deltaY < 0 ? 5 : -5;
          }
          this.setZoom(Math.round(this.zoom + delta));
          return;
        }
        if (this.zoom > 100) {
          e.preventDefault();
          e.stopPropagation();
          const unitScale = e.deltaMode === 1 ? 20 : e.deltaMode === 2 ? 200 : 1;
          this.panX -= (e.deltaX || 0) * unitScale;
          this.panY -= (e.deltaY || 0) * unitScale;
          this.clampPan();
          this.applyTransform(true);
        }
      },
      { passive: false }
    );

    // Drag-to-pan when zoomed (> 100%)
    stage.addEventListener('mousedown', (e: MouseEvent) => {
      if (!this.isOpen() || this.zoom <= 100 || e.button !== 0) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('.quick-look-nav-btn, .quick-look-page-pill')) return;
      e.preventDefault();
      this.isDragging = true;
      this.dragStartX = e.clientX;
      this.dragStartY = e.clientY;
      this.dragOriginPanX = this.panX;
      this.dragOriginPanY = this.panY;
      stage.classList.add('is-dragging');
    });

    dialog.appendChild(header);
    dialog.appendChild(stage);
    backdrop.appendChild(dialog);

    const mountTarget =
      this.doc.body ||
      this.doc.getElementById?.('zotero-main-window') ||
      this.doc.documentElement;
    mountTarget?.appendChild(backdrop);

    this.rootEl = backdrop;
    this.dialogEl = dialog;
    this.titleEl = titleEl;
    this.metaEl = metaEl;
    this.zoomSliderEl = zoomSlider;
    this.zoomLabelEl = zoomLabel;
    this.openTabBtnEl = openTabBtn;
    this.closeBtnEl = closeBtn;
    this.prevBtnEl = prevBtn;
    this.nextBtnEl = nextBtn;
    this.stageEl = stage;
    this.pageWrapperEl = pageWrapper;
    this.imgEl = img;
    this.spinnerEl = spinner;
    this.pageIndicatorEl = pageIndicator;
    this.dragHintEl = dragHint;

    this.doc.addEventListener('keydown', this.boundKeyDown, true);
    this.doc.addEventListener('mousemove', this.boundMouseMove);
    this.doc.addEventListener('mouseup', this.boundMouseUp);
    this.win?.addEventListener?.('blur', this.boundWindowBlur);
  }

  public async open(params: QuickLookOpenParams): Promise<void> {
    if (this.isDestroyed) return;
    this.ensureDOM();
    if (!this.rootEl) return;

    const currentFocus = this.doc?.activeElement as HTMLElement | null;
    if (currentFocus && !this.rootEl.contains(currentFocus)) {
      this.previouslyFocusedEl = currentFocus;
    }

    this.revokeActiveObjectUrl();
    if (this.imgEl) {
      this.imgEl.removeAttribute('src');
      this.imgEl.alt = '';
    }

    this.activeParams = params;
    this.totalPages = Math.max(1, params.totalPages || 1);
    this.pageOffset = Math.max(0, params.pageOffset ?? 0);
    this.currentPage = Math.min(this.totalPages, Math.max(1, params.initialPage || 1));
    this.actualPageNumber = this.currentPage + this.pageOffset;

    if (this.titleEl) {
      const plainTitle = richTextToPlainText(params.card.title || 'Untitled');
      this.titleEl.textContent = plainTitle;
      this.titleEl.title = plainTitle;
    }
    if (this.metaEl) {
      this.metaEl.textContent = params.card.citationText || params.card.authorText || '';
    }

    this.setZoom(100);
    this.rootEl.hidden = false;
    this.rootEl.removeAttribute('hidden');
    this.rootEl.style.display = 'flex';
    this.updateNavigationUI();
    try {
      this.dialogEl?.focus?.({ preventScroll: true });
    } catch {}

    await this.renderCurrentPage();
  }

  public async goToPage(pageNum: number): Promise<void> {
    if (!this.activeParams) return;
    const clamped = Math.min(this.totalPages, Math.max(1, Math.floor(pageNum)));
    if (clamped === this.currentPage) return;

    this.currentPage = clamped;
    this.actualPageNumber = clamped + this.pageOffset;
    this.panX = 0;
    this.panY = 0;
    this.applyTransform(false);
    this.updateNavigationUI();
    this.activeParams.onPageChange?.(this.activeParams.card, clamped);
    await this.renderCurrentPage();
  }

  public setZoom(nextZoom: number): void {
    const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(nextZoom)));
    this.zoom = clamped;
    if (clamped === MIN_ZOOM) {
      this.panX = 0;
      this.panY = 0;
    } else {
      this.clampPan();
    }
    if (this.zoomSliderEl) {
      this.zoomSliderEl.value = String(clamped);
    }
    if (this.zoomLabelEl) {
      this.zoomLabelEl.textContent = `${clamped}%`;
    }
    if (this.stageEl) {
      if (clamped > MIN_ZOOM) {
        this.stageEl.classList.add('is-zoomed');
      } else {
        this.stageEl.classList.remove('is-zoomed', 'is-dragging');
      }
    }
    if (this.dragHintEl) {
      const showHint = clamped > MIN_ZOOM;
      this.dragHintEl.hidden = !showHint;
      this.dragHintEl.style.display = showHint ? 'inline' : 'none';
    }
    this.applyTransform(false);
  }

  private clampPan(): void {
    const scale = this.zoom / 100;
    if (scale <= 1) {
      this.panX = 0;
      this.panY = 0;
      return;
    }
    const stageRect = this.stageEl?.getBoundingClientRect?.();
    const imgW = this.imgEl?.clientWidth || stageRect?.width || 600;
    const imgH = this.imgEl?.clientHeight || stageRect?.height || 800;
    const maxX = Math.max(120, Math.round((imgW * (scale - 1)) / 2 + 80));
    const maxY = Math.max(120, Math.round((imgH * (scale - 1)) / 2 + 80));
    this.panX = Math.min(maxX, Math.max(-maxX, this.panX));
    this.panY = Math.min(maxY, Math.max(-maxY, this.panY));
  }

  private applyTransform(disableTransition = false): void {
    if (!this.pageWrapperEl) return;
    const scale = this.zoom / 100;
    this.pageWrapperEl.style.transition = disableTransition ? 'none' : '';
    this.pageWrapperEl.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${scale})`;
  }

  private updateNavigationUI(): void {
    if (this.pageIndicatorEl) {
      this.pageIndicatorEl.textContent = `${this.currentPage} / ${this.totalPages}`;
    }
    if (this.prevBtnEl) {
      this.prevBtnEl.disabled = this.currentPage <= 1;
      this.prevBtnEl.classList.toggle('disabled', this.currentPage <= 1);
    }
    if (this.nextBtnEl) {
      this.nextBtnEl.disabled = this.currentPage >= this.totalPages;
      this.nextBtnEl.classList.toggle('disabled', this.currentPage >= this.totalPages);
    }
  }

  private setLoading(loading: boolean): void {
    if (!this.spinnerEl) return;
    this.spinnerEl.hidden = !loading;
    this.spinnerEl.style.display = loading ? 'flex' : 'none';
  }

  private revokeActiveObjectUrl(): void {
    if (this.activeObjectUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      try {
        URL.revokeObjectURL(this.activeObjectUrl);
      } catch {}
    }
    this.activeObjectUrl = null;
  }

  private async renderCurrentPage(): Promise<void> {
    const params = this.activeParams;
    if (!params) return;

    const seq = ++this.renderSeq;
    const targetPage = this.currentPage;
    this.setLoading(true);

    try {
      const res = await params.onRenderPage(params.card, targetPage);
      if (seq !== this.renderSeq || !this.isOpen()) {
        if (res?.url && res.url !== this.activeObjectUrl && typeof URL?.revokeObjectURL === 'function') {
          try {
            URL.revokeObjectURL(res.url);
          } catch {}
        }
        return;
      }

      if (res) {
        if (res.totalPages > 0) {
          this.totalPages = res.totalPages;
          const clampedTarget = Math.min(res.totalPages, Math.max(1, targetPage));
          this.actualPageNumber = res.actualPageNumber || (clampedTarget + this.pageOffset);
          this.pageOffset = Math.max(0, this.actualPageNumber - clampedTarget);
        } else {
          this.actualPageNumber = targetPage + this.pageOffset;
        }
        const prevUrl = this.activeObjectUrl;
        this.activeObjectUrl = res.url;
        if (this.imgEl) {
          this.imgEl.src = res.url;
          this.imgEl.alt = `${richTextToPlainText(params.card.title || '')} - Page ${this.currentPage}`;
        }
        if (prevUrl && prevUrl !== res.url && typeof URL?.revokeObjectURL === 'function') {
          try {
            URL.revokeObjectURL(prevUrl);
          } catch {}
        }
        this.updateNavigationUI();
      }
    } finally {
      if (seq === this.renderSeq) {
        this.setLoading(false);
      }
    }
  }

  private handleMouseMove(e: MouseEvent): void {
    if (!this.isDragging || !this.isOpen()) return;
    this.panX = this.dragOriginPanX + (e.clientX - this.dragStartX);
    this.panY = this.dragOriginPanY + (e.clientY - this.dragStartY);
    this.clampPan();
    this.applyTransform(true);
  }

  private handleMouseUp(): void {
    if (!this.isDragging) return;
    this.isDragging = false;
    this.stageEl?.classList.remove('is-dragging');
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (!this.isOpen()) return;

    const stopEvent = () => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation?.();
    };

    if (e.key === 'Escape') {
      stopEvent();
      this.close();
      return;
    }

    if (e.key === 'ArrowLeft') {
      stopEvent();
      void this.goToPage(this.currentPage - 1);
      return;
    }

    if (e.key === 'ArrowRight') {
      stopEvent();
      void this.goToPage(this.currentPage + 1);
      return;
    }

    if ((e.metaKey || e.ctrlKey) && !e.altKey) {
      const code = e.code;
      const key = e.key;
      if (key === '=' || key === '+' || code === 'Equal' || code === 'NumpadAdd') {
        stopEvent();
        this.setZoom(this.zoom + 15);
        return;
      }
      if (key === '-' || key === '_' || code === 'Minus' || code === 'NumpadSubtract') {
        stopEvent();
        this.setZoom(this.zoom - 15);
        return;
      }
      if (key === '0' || code === 'Digit0' || code === 'Numpad0') {
        stopEvent();
        this.setZoom(100);
        return;
      }
    }

    // Prevent grid shortcuts behind open modal from mutating selection, tags, or opening tabs
    const blockedGridKeys = [
      'ArrowUp',
      'ArrowDown',
      'PageUp',
      'PageDown',
      'Home',
      'End',
      'Delete',
      'Backspace'
    ];
    if (
      blockedGridKeys.includes(e.key) ||
      /^[0-9]$/.test(e.key) ||
      ((e.metaKey || e.ctrlKey) && ['a', 'c'].includes(e.key.toLowerCase()))
    ) {
      stopEvent();
      return;
    }

    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Space') {
      const target = e.target as HTMLElement | null;
      if (!target || !this.rootEl?.contains(target) || target.tagName?.toLowerCase() !== 'button') {
        stopEvent();
      }
    }
  }

  public close(): void {
    if (!this.rootEl) return;
    this.renderSeq++;
    this.isDragging = false;
    this.stageEl?.classList.remove('is-dragging', 'is-zoomed');
    this.rootEl.hidden = true;
    this.rootEl.setAttribute('hidden', 'true');
    this.rootEl.style.display = 'none';
    if (this.imgEl) {
      this.imgEl.removeAttribute('src');
    }
    this.revokeActiveObjectUrl();
    const onCloseCb = this.activeParams?.onClose;
    this.activeParams = null;
    const prevFocus = this.previouslyFocusedEl;
    this.previouslyFocusedEl = null;
    if (prevFocus && prevFocus.isConnected) {
      try {
        prevFocus.focus?.({ preventScroll: true });
      } catch {}
    }
    onCloseCb?.();
  }

  public destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    this.close();
    if (this.doc && typeof this.doc.removeEventListener === 'function') {
      this.doc.removeEventListener('keydown', this.boundKeyDown, true);
      this.doc.removeEventListener('mousemove', this.boundMouseMove);
      this.doc.removeEventListener('mouseup', this.boundMouseUp);
    }
    this.win?.removeEventListener?.('blur', this.boundWindowBlur);
    this.rootEl?.remove();
    this.rootEl = null;
    this.dialogEl = null;
  }
}
