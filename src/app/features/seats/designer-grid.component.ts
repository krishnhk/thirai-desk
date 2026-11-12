import { ChangeDetectionStrategy, Component, ElementRef, HostListener, computed, input, output, signal, viewChild } from '@angular/core';

import { PHYSICAL, seatNumbers } from '../../core/layout';
import { CellKind, SeatLayout } from '../../core/models';
import { IconComponent } from '../../shared/icon.component';
import { CoupleSide, coupleSides, KIND_LABELS } from '../../shared/seat-map.component';
import { key, Tool } from './layout-editor';

interface GridCell { key: string; kind: CellKind; color: string; side: CoupleSide; num: string; label: string; sel: boolean; err: boolean; }
interface GridRow { index: number; label: string; err: boolean; sel: boolean; cells: GridCell[]; }

export interface CellEvent { r: number; c: number; additive: boolean; }

/**
 * The designer's editable, top-down seat grid. It reports pointer and keyboard intent
 * (down, over, up, activate, row click, zoom); the page decides what the active tool does.
 * Arrow keys move a roving focus between cells; Enter or Space applies the tool. The grid pans
 * with the Pan tool, the middle mouse button, or Space + drag, and zooms with Ctrl + wheel.
 */
@Component({
  selector: 'app-designer-grid',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <div #viewport class="viewport" [class.panning]="panning()" [class.pan-tool]="tool() === 'pan' || spaceDown()"
      (pointerdown)="viewportDown($event)" (pointermove)="viewportMove($event)" (pointerup)="viewportUp($event)" (wheel)="wheel($event)">
      <div class="plan" [style.--cell]="cellSize() + 'px'" [class.tiny]="cellSize() < 20">
        <div class="screen-bar" aria-hidden="true"><span class="arc"></span><span class="eyebrow">Screen</span></div>
        <div class="grid" role="grid" [attr.aria-label]="'Seat layout, ' + layout().rows + ' rows by ' + layout().cols + ' columns. Arrow keys move, Enter applies the tool.'" [attr.aria-rowcount]="layout().rows">
          @for (row of rows(); track row.index) {
            <div class="g-row" role="row">
              <button type="button" class="lbl" role="rowheader" [class.err]="row.err" [class.sel]="row.sel" [attr.aria-label]="'Row ' + (row.label || (row.index + 1)) + ', select row'" tabindex="-1"
                (click)="rowClick.emit({ r: row.index, c: 0, additive: $event.shiftKey || $event.ctrlKey || $event.metaKey })">{{ row.label || '?' }}</button>
              @for (cell of row.cells; track $index) {
                <button type="button" role="gridcell" class="cell k-{{ cell.kind }}" [class.l]="cell.side === 'l'" [class.r]="cell.side === 'r'" [class.sel]="cell.sel" [class.err]="cell.err"
                  [style.--c]="cell.color" [attr.data-k]="cell.key" [attr.aria-label]="cell.label" [attr.aria-selected]="cell.sel" [attr.title]="cell.label"
                  [tabIndex]="cell.key === focusKey() ? 0 : -1"
                  (pointerdown)="cellDown(row.index, $index, $event)" (pointerenter)="cellEnter(row.index, $index, $event)" (keydown)="cellKey(row.index, $index, $event)" (focus)="focusKey.set(cell.key)">
                  @if (cell.kind === 'wheelchair') { <app-icon name="wheelchair" /> } @else if (showNumbers() && cell.num) { <span class="n">{{ cell.num }}</span> }
                </button>
              }
              <span class="lbl ghost" aria-hidden="true">{{ row.label }}</span>
            </div>
          }
        </div>
      </div>
    </div>
  `,
  styles: `
    :host { display: block; min-width: 0; }
    :host { display: flex; flex-direction: column; flex: 1; min-height: 0; }
    .viewport { flex: 1; min-height: 340px; max-height: clamp(360px, calc(100vh - 300px), 820px); overflow: auto; display: flex; flex-direction: column; padding: 18px 12px 24px; background: var(--bg); border-radius: var(--radius); user-select: none; touch-action: none; }
    .viewport.pan-tool { cursor: grab; }
    .viewport.panning { cursor: grabbing; }
    .viewport.pan-tool .cell, .viewport.pan-tool .lbl { cursor: inherit; }
    .plan { --gap: 3px; width: max-content; flex-shrink: 0; margin: auto; }
    .screen-bar { display: flex; flex-direction: column; align-items: center; gap: 2px; width: 70%; margin: 0 auto 16px; }
    .arc { display: block; width: 100%; height: 12px; border-top: 3px solid var(--text-muted); border-radius: 50% 50% 0 0 / 100% 100% 0 0; }
    .grid { display: flex; flex-direction: column; gap: var(--gap); }
    .g-row { display: flex; align-items: center; gap: var(--gap); }
    .lbl { display: grid; place-items: center; width: 26px; height: var(--cell); padding: 0; border: 0; border-radius: 4px; background: none; color: var(--text-muted); font-size: 0.7rem; font-weight: 700; text-align: center; }
    button.lbl:hover { background: var(--surface-2); color: var(--text); }
    .lbl.sel { color: var(--accent); }
    .lbl.err { background: var(--danger-soft); color: var(--danger); }
    .lbl.ghost { color: var(--text-faint); }
    .cell { position: relative; display: grid; place-items: center; width: var(--cell); height: var(--cell); padding: 0; border: 1px solid transparent; border-radius: 4px 4px 2px 2px; background: none; color: var(--bg); font-size: calc(var(--cell) * 0.4); font-weight: 700; line-height: 1; cursor: crosshair; }
    .k-empty { border: 1px dotted var(--border); }
    .k-aisle { background: var(--surface-2); border-radius: 2px; }
    .k-seat, .k-couple, .k-wheelchair { background: color-mix(in srgb, var(--c, #5f6774) 85%, transparent); }
    .k-couple.l { border-top-right-radius: 0; border-bottom-right-radius: 0; }
    .k-couple.l::after { content: ''; position: absolute; top: -1px; bottom: -1px; right: calc(-1 * var(--gap) - 1px); width: calc(var(--gap) + 1px); background: inherit; }
    .k-couple.r { border-top-left-radius: 0; border-bottom-left-radius: 0; }
    .k-couple:not(.l):not(.r) { border: 2px dashed var(--danger); }
    .k-wheelchair app-icon { width: 80%; height: 80%; }
    .k-blocked { border: 1px dashed color-mix(in srgb, var(--c, #8b93a1) 75%, transparent); background: var(--surface-3); color: var(--text-faint); }
    .k-blocked::before { content: '×'; font-size: calc(var(--cell) * 0.75); font-weight: 400; }
    .k-blocked .n { display: none; }
    .tiny .n { display: none; }
    .cell:hover { filter: brightness(1.2); border-color: var(--text-soft); }
    .cell.sel { outline: 2px solid var(--accent); outline-offset: 1px; z-index: 2; }
    .cell.err { box-shadow: 0 0 0 2px var(--danger); z-index: 1; }
    .cell.err.k-empty, .cell.err.k-aisle { background: var(--danger-soft); }
    .cell:focus-visible { outline: 2px solid var(--text); outline-offset: 2px; z-index: 3; }
  `,
})
export class DesignerGridComponent {
  readonly layout = input.required<SeatLayout>();
  readonly tool = input.required<Tool>();
  readonly cellSize = input(24);
  readonly selection = input<ReadonlySet<string>>(new Set());
  /** "row,col" keys with validation errors. */
  readonly errorCells = input<ReadonlySet<string>>(new Set());
  readonly errorRows = input<ReadonlySet<number>>(new Set());
  readonly showNumbers = input(true);

  readonly down = output<CellEvent>();
  readonly over = output<CellEvent>();
  readonly up = output<void>();
  readonly activate = output<CellEvent>();
  readonly rowClick = output<CellEvent>();
  readonly zoom = output<number>();

  readonly focusKey = signal('0,0');
  readonly panning = signal(false);
  readonly spaceDown = signal(false);
  private readonly viewport = viewChild.required<ElementRef<HTMLElement>>('viewport');
  private pressed = false;
  private panStart: { x: number; y: number; left: number; top: number; id: number } | null = null;

  readonly rows = computed<GridRow[]>(() => {
    const layout = this.layout();
    const sel = this.selection();
    const errs = this.errorCells();
    const errRows = this.errorRows();
    const cats = new Map(layout.categories.map((c) => [c.id, c]));
    return layout.cells.map((row, r) => {
      const nums = seatNumbers(layout, r);
      const sides = coupleSides(row);
      const label = layout.rowLabels[r] ?? '';
      let rowSel = row.length > 0;
      const cells = row.map((cell, c) => {
        const k = key(r, c);
        const cat = cell.categoryId ? cats.get(cell.categoryId) : undefined;
        const num = nums[c] != null ? String(nums[c]) : '';
        const what = PHYSICAL.has(cell.kind) ? `${label}${num} · ${KIND_LABELS[cell.kind]} · ${cat?.name ?? 'no category'}` : `${KIND_LABELS[cell.kind]}, row ${label || r + 1} column ${c + 1}`;
        const isSel = sel.has(k);
        if (!isSel) rowSel = false;
        return { key: k, kind: cell.kind, color: cat?.color ?? '', side: sides[c] ?? null, num, label: what, sel: isSel, err: errs.has(k) };
      });
      return { index: r, label, err: errRows.has(r), sel: rowSel, cells };
    });
  });

  /** Scrolls a cell into view and focuses it. */
  focusCell(k: string): void {
    this.focusKey.set(k);
    queueMicrotask(() => {
      const el = this.viewport().nativeElement.querySelector<HTMLElement>(`[data-k="${k}"]`);
      el?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
      el?.focus({ preventScroll: true });
    });
  }

  /** The cell size at which every column fits the visible width. */
  fitSize(cols: number): number {
    const width = this.viewport().nativeElement.clientWidth - 24 - 2 * 26 - 3 * 2;
    return Math.floor(width / cols - 3);
  }

  cellDown(r: number, c: number, e: PointerEvent): void {
    if (e.button !== 0 || this.isPanGesture(e)) return;
    e.preventDefault();
    this.pressed = true;
    this.focusKey.set(key(r, c));
    this.down.emit({ r, c, additive: e.shiftKey || e.ctrlKey || e.metaKey });
  }

  cellEnter(r: number, c: number, e: PointerEvent): void {
    if (this.pressed && (e.buttons & 1)) this.over.emit({ r, c, additive: e.shiftKey || e.ctrlKey || e.metaKey });
  }

  @HostListener('document:pointerup')
  @HostListener('document:pointercancel')
  release(): void {
    if (!this.pressed) return;
    this.pressed = false;
    this.up.emit();
  }

  cellKey(r: number, c: number, e: KeyboardEvent): void {
    const layout = this.layout();
    const moves: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    const m = moves[e.key];
    if (m) {
      e.preventDefault();
      const nr = Math.min(layout.rows - 1, Math.max(0, r + m[0]));
      const nc = Math.min(layout.cols - 1, Math.max(0, c + m[1]));
      this.focusCell(key(nr, nc));
      if (e.shiftKey) this.activate.emit({ r: nr, c: nc, additive: true });
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      this.activate.emit({ r, c, additive: e.shiftKey || e.ctrlKey || e.metaKey });
    }
  }

  // ---------------------------------------------------------------- Pan and zoom

  @HostListener('document:keydown', ['$event'])
  onKeyDown(e: KeyboardEvent): void {
    if (e.code === 'Space' && !isTyping(e) && !(e.target as HTMLElement)?.closest?.('button')) { this.spaceDown.set(true); e.preventDefault(); }
  }

  @HostListener('document:keyup', ['$event'])
  onKeyUp(e: KeyboardEvent): void {
    if (e.code === 'Space') this.spaceDown.set(false);
  }

  private isPanGesture(e: PointerEvent): boolean {
    return this.tool() === 'pan' || this.spaceDown() || e.button === 1;
  }

  viewportDown(e: PointerEvent): void {
    if (!this.isPanGesture(e)) return;
    e.preventDefault();
    const vp = this.viewport().nativeElement;
    vp.setPointerCapture(e.pointerId);
    this.panStart = { x: e.clientX, y: e.clientY, left: vp.scrollLeft, top: vp.scrollTop, id: e.pointerId };
    this.panning.set(true);
  }

  viewportMove(e: PointerEvent): void {
    const p = this.panStart;
    if (!p || e.pointerId !== p.id) return;
    const vp = this.viewport().nativeElement;
    vp.scrollLeft = p.left - (e.clientX - p.x);
    vp.scrollTop = p.top - (e.clientY - p.y);
  }

  viewportUp(e: PointerEvent): void {
    if (!this.panStart || e.pointerId !== this.panStart.id) return;
    this.viewport().nativeElement.releasePointerCapture(e.pointerId);
    this.panStart = null;
    this.panning.set(false);
  }

  wheel(e: WheelEvent): void {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    this.zoom.emit(e.deltaY < 0 ? 1 : -1);
  }
}

export function isTyping(e: Event): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}
