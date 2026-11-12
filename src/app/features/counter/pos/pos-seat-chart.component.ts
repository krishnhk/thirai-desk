import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, inject, input, signal, viewChild } from '@angular/core';

import { formatMoney } from '../../../core/format';
import { SELLABLE } from '../../../core/layout';
import { CellKind } from '../../../core/models';
import { IconComponent } from '../../../shared/icon.component';
import { chartRows } from './pos-pricing';
import { MAX_SEATS, PosSale } from './pos-sale';

type SeatState = 'free' | 'sold' | 'sel';
interface CellView {
  key: string;
  kind: CellKind;
  id: string;
  num: number | null;
  color: string;
  cat: string;
  side: 'l' | 'r' | null;
  state: SeatState;
  narrow: boolean;
  label: string;
}
interface RowView { index: number; label: string; cells: CellView[]; }

const STATE_WORD: Record<SeatState, string> = { free: 'available', sold: 'booked', sel: 'selected' };
const KIND_WORD: Partial<Record<CellKind, string>> = { couple: 'couple seat', wheelchair: 'wheelchair space' };

/**
 * The centre panel: the screen's real layout as seat buttons. Seats take their category colour;
 * sold seats are dimmed and crossed, blocked seats hatched, selected seats amber with their
 * number. Fits the panel by default and zooms for touch terminals.
 */
@Component({
  selector: 'app-pos-seat-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <div class="bar">
      <div class="cats" role="group" aria-label="Seat categories. Choose one for best available.">
        @for (c of categories(); track c.id) {
          <button type="button" class="cat" [attr.aria-pressed]="preferred() === c.id" (click)="preferred.set(preferred() === c.id ? null : c.id)"
            [attr.title]="'Best available picks from ' + c.name">
            <span class="sw" [style.--c]="c.color"></span>
            <span class="cn">{{ c.name }}</span>
            <b>{{ c.price }}</b>
            <span class="muted">{{ c.free }} left</span>
          </button>
        }
      </div>
      <div class="acts">
        <div class="qty" role="group" aria-label="Best available">
          <button type="button" class="btn sm icon" aria-label="One seat fewer" [disabled]="qty() <= 1" (click)="qty.set(qty() - 1)">−</button>
          <span class="qn" aria-live="polite">{{ qty() }}</span>
          <button type="button" class="btn sm icon" aria-label="One seat more" [disabled]="qty() >= max" (click)="qty.set(qty() + 1)">+</button>
          <button type="button" class="btn sm" [disabled]="!interactive()" (click)="sale.pickBest(qty(), preferred())" [attr.title]="'Best ' + qty() + ' together' + (preferredName() ? ' in ' + preferredName() : '')">Best {{ qty() }}</button>
        </div>
      </div>
    </div>

    @if (typed() || problem()) {
      <div class="status" aria-live="polite">
        @if (typed()) {
          <span class="typed"><span class="mono">{{ typed() }}</span><span class="caret"></span> <span class="muted">{{ typedHint() }}</span></span>
        } @else if (problem(); as n) {
          <span class="note {{ n.tone }}">{{ n.text }}</span>
        }
      </div>
    }

    <div class="stage">
    <div class="zoom" role="group" aria-label="Zoom">
      <button type="button" class="btn sm icon" aria-label="Zoom out" [disabled]="zoom() <= 0.75" (click)="setZoom(zoom() - 0.25)"><app-icon name="zoomOut" /></button>
      <button type="button" class="btn sm" [attr.aria-pressed]="zoom() === 1" (click)="setZoom(1)">Fit</button>
      <button type="button" class="btn sm icon" aria-label="Zoom in" [disabled]="zoom() >= 2.5" (click)="setZoom(zoom() + 0.25)"><app-icon name="zoomIn" /></button>
    </div>
    <div class="viewport" #viewport>
      <div class="plan" [style.--cell]="cell() + 'px'" [style.--fs]="fontSize() + 'px'">
        <div class="screen-bar" aria-hidden="true"><span class="arc"></span><span class="eyebrow">Screen this way</span></div>
        <div class="grid" role="group" [attr.aria-label]="'Seats on ' + (sale.screen()?.name ?? 'screen')">
          @for (row of rows(); track row.index) {
            <div class="r">
              <span class="lbl" aria-hidden="true">{{ row.label }}</span>
              @for (c of row.cells; track c.key) {
                @switch (c.kind) {
                  @case ('blocked') { <span class="cell blocked" role="img" [attr.aria-label]="c.label" [attr.title]="c.label"></span> }
                  @case ('aisle') { <span class="cell gap" [class.narrow]="c.narrow"></span> }
                  @case ('empty') { <span class="cell gap" [class.narrow]="c.narrow"></span> }
                  @default {
                    <button type="button" class="cell seat st-{{ c.state }}" [class.dim]="!!preferred() && c.cat !== preferred() && c.state === 'free'" [class.l]="c.side === 'l'" [class.r]="c.side === 'r'" [class.wc]="c.kind === 'wheelchair'"
                      [style.--c]="c.color" [attr.aria-label]="c.label" [attr.title]="c.label" [attr.aria-pressed]="c.state === 'sel'"
                      [attr.aria-disabled]="c.state === 'sold' || !interactive() ? 'true' : null" (click)="sale.toggleSeat(c.id)">
                      @if (c.kind === 'wheelchair' && c.state !== 'sel') { <app-icon name="wheelchair" /> } @else if (showNumbers() || c.state === 'sel') { {{ c.num }} }
                    </button>
                  }
                }
              }
              <span class="lbl" aria-hidden="true">{{ row.label }}</span>
            </div>
          }
        </div>
      </div>
    </div>
    </div>

    <ul class="legend" aria-label="Legend">
      <li><span class="sw free"></span>Available</li>
      <li><span class="sw sel"></span>Selected</li>
      <li><span class="sw sold"></span>Booked</li>
      @if (has().blocked) { <li><span class="sw blk"></span>Blocked</li> }
      @if (has().couple) { <li><span class="sw pair"></span>Couple pair (sold together)</li> }
      @if (has().wheelchair) { <li><span class="sw wcs"><app-icon name="wheelchair" /></span>Wheelchair</li> }
    </ul>
  `,
  styles: `
    :host { display: flex; flex-direction: column; min-height: 0; flex: 1; }
    .bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 10px; padding: 8px 14px; border-bottom: 1px solid var(--border); }
    .cats { display: flex; flex-wrap: wrap; gap: 6px; min-width: 0; }
    .cat { display: inline-flex; align-items: center; gap: 6px; min-height: 32px; padding: 3px 10px 3px 9px; border: 1px solid var(--border); border-radius: 999px; background: var(--surface-2); color: var(--text-soft); font-size: 0.8rem; }
    .cat:hover { border-color: var(--border-strong); color: var(--text); }
    .cat[aria-pressed='true'] { border-color: var(--accent); background: var(--accent-soft); color: var(--text); }
    .cat b { color: var(--text); }
    .cat .muted { font-size: 0.72rem; }
    .sw { display: inline-grid; place-items: center; width: 14px; height: 14px; border-radius: 3px; flex-shrink: 0; background: color-mix(in srgb, var(--c) 12%, transparent); box-shadow: inset 0 0 0 1.5px var(--c); }
    .acts { display: flex; flex-wrap: wrap; gap: 8px; }
    .qty, .zoom { display: inline-flex; align-items: center; gap: 4px; }
    .qn { min-width: 22px; text-align: center; font-weight: 700; }
    .status { padding: 7px 14px; border-bottom: 1px solid var(--border-soft); font-size: 0.8rem; line-height: 1.35; }
    .note.success { color: var(--success); } .note.warning { color: var(--warning); } .note.danger { color: var(--danger); font-weight: 600; } .note.info { color: var(--text-soft); }
    .typed { display: inline-flex; align-items: center; gap: 6px; }
    .typed .mono { padding: 1px 8px; border: 1px solid var(--accent); border-radius: var(--radius-sm); background: var(--accent-soft); color: var(--accent); font-size: 0.95rem; font-weight: 700; }
    .caret { width: 2px; height: 16px; margin-left: -4px; background: var(--accent); }
    .stage { position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column; }
    .zoom { position: absolute; top: 8px; right: 14px; z-index: 3; padding: 2px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); }
    .viewport { flex: 1; min-height: 0; overflow: auto; padding: 14px 12px 10px; }
    .plan { --gap: 4px; width: max-content; min-width: 100%; display: flex; flex-direction: column; align-items: center; }
    .screen-bar { display: flex; flex-direction: column; align-items: center; gap: 3px; width: min(70%, 640px); margin-bottom: 16px; }
    .arc { display: block; width: 100%; height: 12px; border-top: 3px solid var(--text-muted); border-radius: 50% 50% 0 0 / 100% 100% 0 0; }
    .grid { display: flex; flex-direction: column; gap: var(--gap); }
    .r { display: flex; align-items: center; gap: var(--gap); }
    .lbl { width: 22px; text-align: center; font-size: 0.72rem; font-weight: 700; color: var(--text-muted); flex-shrink: 0; }
    .cell { position: relative; flex-shrink: 0; width: var(--cell); height: var(--cell); }
    .gap.narrow { width: calc(var(--cell) * 0.5); }
    .seat { display: grid; place-items: center; padding: 0; border: 0; border-radius: 5px 5px 3px 3px; font-size: var(--fs); font-weight: 700; line-height: 1; color: var(--text); touch-action: manipulation; }
    .seat::before { content: ''; position: absolute; left: 20%; right: 20%; bottom: 3px; height: 3px; border-radius: 2px; background: var(--c); pointer-events: none; }
    .st-free { background: var(--surface-2); box-shadow: inset 0 0 0 1.5px var(--border-strong); color: var(--text-soft); transition: transform 0.1s, box-shadow 0.1s; }
    .st-free:hover { box-shadow: inset 0 0 0 1.5px var(--c); color: var(--text); transform: translateY(-1px); }
    .st-sel { background: var(--accent); color: var(--on-accent); box-shadow: none; z-index: 1; }
    .st-sel::before { background: var(--on-accent); opacity: 0.45; }
    .st-sold { background: transparent; box-shadow: none; border: 1.5px dashed var(--border-strong); color: var(--text-faint); opacity: 0.55; cursor: not-allowed; }
    .st-sold::before { display: none; }
    .seat.dim { opacity: 0.25; }
    .seat.l { border-top-right-radius: 0; border-bottom-right-radius: 0; }
    .seat.l::after { content: ''; position: absolute; top: 0; bottom: 0; right: calc(-1 * var(--gap)); width: var(--gap); background: inherit; }
    .st-free.l { box-shadow: inset 1.5px 0 0 var(--border-strong), inset 0 1.5px 0 var(--border-strong), inset 0 -1.5px 0 var(--border-strong); }
    .st-free.r { box-shadow: inset -1.5px 0 0 var(--border-strong), inset 0 1.5px 0 var(--border-strong), inset 0 -1.5px 0 var(--border-strong); }
    .st-free.l::after { box-shadow: inset 0 1.5px 0 var(--border-strong), inset 0 -1.5px 0 var(--border-strong); }
    .seat.r { border-top-left-radius: 0; border-bottom-left-radius: 0; }
    .seat.wc app-icon { width: 70%; height: 70%; color: var(--text); }
    .blocked { border-radius: 5px 5px 3px 3px; background: repeating-linear-gradient(45deg, var(--surface-3) 0 3px, transparent 3px 6px); box-shadow: inset 0 0 0 1px var(--border-strong); }
    .seat:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; z-index: 2; }
    .legend { display: flex; flex-wrap: wrap; gap: 6px 16px; margin: 0; padding: 9px 14px; border-top: 1px solid var(--border); list-style: none; font-size: 0.76rem; color: var(--text-soft); }
    .legend li { display: inline-flex; align-items: center; gap: 7px; }
    .legend .sw { --c: var(--text-muted); }
    .legend .free { background: var(--surface-2); box-shadow: inset 0 0 0 1.5px var(--border-strong); }
    .legend .sel { background: var(--accent); box-shadow: none; }
    .legend .sold { background: transparent; box-shadow: none; border: 1.5px dashed var(--border-strong); opacity: 0.7; }
    .legend .blk { background: repeating-linear-gradient(45deg, var(--surface-3) 0 2px, transparent 2px 4px); box-shadow: inset 0 0 0 1px var(--border-strong); }
    .legend .pair { width: 26px; }
    .legend .wcs app-icon { width: 11px; height: 11px; }
  `,
})
export class PosSeatChartComponent {
  readonly sale = inject(PosSale);
  /** What the operator is typing on the keyboard, shown as a seat-entry prompt. */
  readonly typed = input('');
  private readonly viewport = viewChild.required<ElementRef<HTMLElement>>('viewport');

  readonly max = MAX_SEATS;
  readonly qty = signal(2);
  readonly preferred = signal<string | null>(null);
  readonly zoom = signal(1);
  private readonly box = signal({ w: 600, h: 500 });

  constructor() {
    const destroy = inject(DestroyRef);
    afterNextRender(() => {
      const el = this.viewport().nativeElement;
      const ro = new ResizeObserver(([e]) => { if (e) this.box.set({ w: e.contentRect.width, h: e.contentRect.height }); });
      ro.observe(el);
      destroy.onDestroy(() => ro.disconnect());
    });
  }

  readonly interactive = computed(() => this.sale.canSell() && this.sale.saleState().open && !this.sale.locked() && !this.sale.bookingId());

  /** Columns that are aisles in every row draw at half width. */
  private readonly narrowCols = computed(() => {
    const l = this.sale.layout();
    if (!l) return new Set<number>();
    const out = new Set<number>();
    for (let c = 0; c < l.cols; c++) if (l.cells.every((row) => row[c]?.kind === 'aisle' || row[c]?.kind === 'empty') && l.cells.some((row) => row[c]?.kind === 'aisle')) out.add(c);
    return out;
  });

  /** Seat size that fits the panel width (and a sensible height), times the zoom. */
  readonly fit = computed(() => {
    const l = this.sale.layout();
    if (!l) return 32;
    const gap = 4;
    const units = l.cols - this.narrowCols().size * 0.5;
    const w = (this.box().w - 2 * (22 + gap) - 4) / units - gap;
    const h = (this.box().h - 48) / l.rows - gap;
    return Math.max(16, Math.min(46, Math.floor(Math.min(w, Math.max(h, 30)))));
  });
  readonly cell = computed(() => Math.round(this.fit() * this.zoom()));
  readonly fontSize = computed(() => Math.max(8, Math.min(14, Math.round(this.cell() * 0.4))));
  readonly showNumbers = computed(() => this.cell() >= 22);

  readonly rows = computed<RowView[]>(() => {
    const layout = this.sale.layout();
    const show = this.sale.show();
    if (!layout || !show) return [];
    const sel = new Set(this.sale.seats());
    const taken = this.sale.taken();
    const narrow = this.narrowCols();
    const names = new Map(layout.categories.map((c) => [c.id, c.name]));
    return chartRows(layout).map((row) => ({
      index: row.index,
      label: row.label,
      cells: row.cells.map((c, col) => {
        let state: SeatState = 'free';
        if (sel.has(c.id)) state = 'sel';
        else if (taken.has(c.id)) state = 'sold';
        const cat = names.get(c.categoryId) ?? 'No category';
        const price = show.prices[c.categoryId];
        const kind = KIND_WORD[c.kind] ? `, ${KIND_WORD[c.kind]}` : '';
        const priceText = price == null ? 'no price' : formatMoney(price);
        const label = c.kind === 'blocked' ? `${c.id}, blocked, not for sale` : `${c.id}, ${cat}${kind}, ${priceText}, ${STATE_WORD[state]}`;
        return { key: c.key, kind: c.kind, id: c.id, num: c.num, color: c.color, cat: c.categoryId, side: c.side, state, narrow: narrow.has(col), label };
      }),
    }));
  });

  readonly categories = computed(() => {
    const layout = this.sale.layout();
    const show = this.sale.show();
    if (!layout || !show) return [];
    const taken = this.sale.taken();
    const free = new Map<string, number>();
    chartRows(layout).forEach((r) => r.cells.forEach((c) => {
      if (SELLABLE.has(c.kind) && c.id && !taken.has(c.id)) free.set(c.categoryId, (free.get(c.categoryId) ?? 0) + 1);
    }));
    return layout.categories.map((c) => ({ id: c.id, name: c.name, color: c.color, price: formatMoney(show.prices[c.id] ?? c.basePrice), free: free.get(c.id) ?? 0 }));
  });
  /** Only warnings and errors are spelled out above the map; adding a seat is visible on the map itself. */
  readonly problem = computed(() => {
    const n = this.sale.notice();
    return n && (n.tone === 'warning' || n.tone === 'danger') ? n : null;
  });
  readonly preferredName = computed(() => this.categories().find((c) => c.id === this.preferred())?.name ?? '');

  readonly has = computed(() => {
    const l = this.sale.layout();
    const kinds = new Set(l?.cells.flat().map((c) => c.kind) ?? []);
    return { blocked: kinds.has('blocked'), couple: kinds.has('couple'), wheelchair: kinds.has('wheelchair') };
  });

  readonly example = computed(() => {
    const l = this.sale.layout();
    const r = l ? l.rowLabels[Math.floor(l.rows / 2)] : 'F';
    return `${r ?? 'F'}7`;
  });

  readonly typedHint = computed(() => {
    const t = this.typed();
    if (/^\d+$/.test(t)) return `Enter: best ${t} seats together`;
    if (/^[A-Z]+\d+$/.test(t)) return 'Enter: add or remove this seat';
    return 'Keep typing the seat number';
  });

  /** Keyboard quantity: remembers it and picks the best seats in the preferred category. */
  pickBest(count: number): void {
    if (count >= 1 && count <= MAX_SEATS) this.qty.set(count);
    this.sale.pickBest(count, this.preferred());
  }

  setZoom(z: number): void {
    this.zoom.set(Math.max(0.75, Math.min(2.5, Math.round(z * 4) / 4)));
  }
}
