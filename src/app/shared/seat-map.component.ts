import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { formatMoney } from '../core/format';
import { layoutStats, PHYSICAL, seatNumbers } from '../core/layout';
import { CellKind, SeatCell, SeatLayout } from '../core/models';
import { IconComponent } from './icon.component';

export type CoupleSide = 'l' | 'r' | null;

/**
 * Couple cells pair up left to right within each run (the same rule `validateLayout` uses):
 * 'l' marks the left half of a pair, 'r' the right half, null a cell that is not paired.
 */
export function coupleSides(row: readonly SeatCell[]): CoupleSide[] {
  const out: CoupleSide[] = row.map(() => null);
  let c = 0;
  while (c < row.length) {
    if (row[c]!.kind !== 'couple') { c++; continue; }
    const start = c;
    while (c < row.length && row[c]!.kind === 'couple') c++;
    for (let i = start; i + 1 < c; i += 2) { out[i] = 'l'; out[i + 1] = 'r'; }
  }
  return out;
}

export const KIND_LABELS: Record<CellKind, string> = {
  seat: 'Seat', couple: 'Couple seat', wheelchair: 'Wheelchair space', blocked: 'Blocked seat', aisle: 'Aisle', empty: 'Empty space',
};

interface MapCell { kind: CellKind; color: string; side: CoupleSide; sold: boolean; hl: boolean; title: string; }
interface MapRow { index: number; label: string; cells: MapCell[]; }

/**
 * A read-only, top-down seat map with the screen at the top, row labels on both sides and a
 * legend. Pass `highlight` ("row,col" keys) to outline cells and `sold` (seat ids) to grey out
 * booked seats. Wide layouts scroll inside their own container.
 */
@Component({
  selector: 'app-seat-map',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <div class="scroll">
      <div class="plan" [style.--cell]="cellSize() + 'px'">
        <div class="screen-bar" aria-hidden="true"><span class="arc"></span><span class="eyebrow">Screen</span></div>
        <div class="grid" role="img" [attr.aria-label]="summary()">
          @for (row of rows(); track row.index) {
            <div class="map-row">
              <span class="lbl">{{ row.label }}</span>
              @for (c of row.cells; track $index) {
                <span class="cell k-{{ c.kind }}" [class.l]="c.side === 'l'" [class.r]="c.side === 'r'" [class.sold]="c.sold" [class.hl]="c.hl"
                  [style.--c]="c.color" [attr.title]="c.title || null">@if (c.kind === 'wheelchair') { <app-icon name="wheelchair" /> }</span>
              }
              <span class="lbl">{{ row.label }}</span>
            </div>
          }
        </div>
      </div>
    </div>
    @if (legend()) {
      <ul class="legend" aria-label="Legend">
        @for (c of categories(); track c.id) {
          <li><span class="sw" [style.background]="c.color"></span>{{ c.name }} <span class="muted">{{ c.price }} · {{ c.count }}</span></li>
        }
        @if (has().couple) { <li><span class="sw pair"></span>Couple pair</li> }
        @if (has().wheelchair) { <li><span class="sw wc"><app-icon name="wheelchair" /></span>Wheelchair</li> }
        @if (has().blocked) { <li><span class="sw blk">×</span>Blocked</li> }
        @if (sold()) { <li><span class="sw sold"></span>Sold</li> }
      </ul>
    }
  `,
  styles: `
    :host { display: block; min-width: 0; }
    .scroll { overflow: auto; padding: 4px 0 8px; }
    .plan { --gap: 3px; width: max-content; margin-inline: auto; }
    .screen-bar { display: flex; flex-direction: column; align-items: center; gap: 2px; margin: 0 auto 14px; width: 70%; }
    .arc { display: block; width: 100%; height: 10px; border-top: 3px solid var(--text-muted); border-radius: 50% 50% 0 0 / 100% 100% 0 0; }
    .grid { display: flex; flex-direction: column; gap: var(--gap); }
    .map-row { display: flex; align-items: center; gap: var(--gap); }
    .lbl { width: 22px; text-align: center; font-size: 0.68rem; font-weight: 700; color: var(--text-muted); }
    .cell { position: relative; display: grid; place-items: center; width: var(--cell); height: var(--cell); border-radius: 4px 4px 2px 2px; }
    .k-seat, .k-couple, .k-wheelchair { background: color-mix(in srgb, var(--c, #7c8aa0) 82%, transparent); }
    .k-couple.l { border-top-right-radius: 0; border-bottom-right-radius: 0; }
    .k-couple.l::after { content: ''; position: absolute; top: 0; bottom: 0; right: calc(-1 * var(--gap)); width: var(--gap); background: inherit; }
    .k-couple.r { border-top-left-radius: 0; border-bottom-left-radius: 0; }
    .k-wheelchair { color: var(--bg); }
    .k-wheelchair app-icon { width: 78%; height: 78%; }
    .k-blocked { border: 1px dashed color-mix(in srgb, var(--c, #7c8aa0) 70%, transparent); background: var(--surface-3); }
    .k-blocked::before { content: '×'; font-size: calc(var(--cell) * 0.7); line-height: 1; color: var(--text-faint); }
    .sold { background: var(--surface-3) !important; box-shadow: inset 0 0 0 1px var(--border-strong); }
    .hl { outline: 2px solid var(--accent); outline-offset: 1px; z-index: 1; }
    .legend { display: flex; flex-wrap: wrap; gap: 6px 16px; margin: 10px 0 0; padding: 10px 0 0; border-top: 1px solid var(--border-soft); list-style: none; font-size: 0.78rem; color: var(--text-soft); }
    .legend li { display: inline-flex; align-items: center; gap: 7px; }
    .sw { display: inline-grid; place-items: center; width: 14px; height: 14px; border-radius: 3px; }
    .sw.pair { width: 24px; background: var(--text-muted); }
    .sw.wc { background: var(--text-soft); color: var(--bg); } .sw.wc app-icon { width: 12px; height: 12px; }
    .sw.blk { border: 1px dashed var(--text-muted); background: var(--surface-3); color: var(--text-faint); font-size: 12px; line-height: 1; }
    .sw.sold { background: var(--surface-3); box-shadow: inset 0 0 0 1px var(--border-strong); }
  `,
})
export class SeatMapComponent {
  readonly layout = input.required<SeatLayout>();
  /** "row,col" keys to outline. */
  readonly highlight = input<ReadonlySet<string> | null>(null);
  /** Seat ids (such as "C7") already sold. */
  readonly sold = input<ReadonlySet<string> | null>(null);
  readonly cellSize = input(16);
  readonly legend = input(true);

  readonly rows = computed<MapRow[]>(() => {
    const layout = this.layout();
    const hl = this.highlight();
    const sold = this.sold();
    const colors = new Map(layout.categories.map((c) => [c.id, c]));
    return layout.cells.map((row, r) => {
      const nums = seatNumbers(layout, r);
      const sides = coupleSides(row);
      const label = layout.rowLabels[r] ?? '';
      return {
        index: r,
        label,
        cells: row.map((cell, c) => {
          const cat = cell.categoryId ? colors.get(cell.categoryId) : undefined;
          const id = nums[c] != null ? `${label}${nums[c]}` : '';
          const isSold = !!id && !!sold?.has(id);
          const title = PHYSICAL.has(cell.kind) ? `${id} · ${cat?.name ?? 'No category'} · ${KIND_LABELS[cell.kind]}${isSold ? ' · Sold' : ''}` : '';
          return { kind: cell.kind, color: cat?.color ?? '', side: sides[c] ?? null, sold: isSold, hl: !!hl?.has(`${r},${c}`), title };
        }),
      };
    });
  });

  private readonly stats = computed(() => layoutStats(this.layout()));
  readonly has = computed(() => {
    const s = this.stats();
    return { couple: s.couplePairs > 0, wheelchair: s.wheelchair > 0, blocked: s.blocked > 0 };
  });
  readonly categories = computed(() => {
    const by = this.stats().byCategory;
    return this.layout().categories.map((c) => ({ id: c.id, name: c.name, color: c.color, price: formatMoney(c.basePrice), count: by[c.id] ?? 0 }));
  });
  readonly summary = computed(() => {
    const l = this.layout();
    return `Seat map: ${l.rows} rows, ${this.stats().sellable} bookable seats, screen at the top.`;
  });
}
