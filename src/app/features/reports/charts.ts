import { afterNextRender, ChangeDetectionStrategy, Component, computed, DestroyRef, ElementRef, inject, input, signal } from '@angular/core';

export interface BarDatum { label: string; value: number; sub?: string; }

/** A step of 1, 2, 2.5 or 5 × 10ⁿ giving about `count` gridlines up to at least `max`. */
export function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(v);
  if (ticks[ticks.length - 1]! < max) ticks.push(ticks[ticks.length - 1]! + step);
  return ticks;
}

/**
 * Vertical bars on a zero baseline, one series, drawn to scale with recessive gridlines.
 * Hovering a bar shows its exact value (native tooltip); the largest bar is labelled.
 */
@Component({
  selector: 'app-column-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg [attr.viewBox]="'0 0 ' + W() + ' ' + H" [attr.width]="W()" [attr.height]="H" role="img" [attr.aria-label]="ariaLabel()">
      @for (t of geo().ticks; track t.v) {
        <line class="grid" [attr.x1]="L" [attr.x2]="W() - R" [attr.y1]="t.y" [attr.y2]="t.y" [class.base]="t.v === 0" />
        <text class="axis" [attr.x]="L - 8" [attr.y]="t.y + 4" text-anchor="end">{{ format()(t.v) }}</text>
      }
      @for (b of geo().bars; track b.label) {
        <g class="bar-g">
          <rect class="hit" [attr.x]="b.cx - geo().band / 2" [attr.y]="T" [attr.width]="geo().band" [attr.height]="H - T - B" />
          @if (b.h > 0) { <path class="bar" [attr.d]="b.d" /> }
          @if (b.top) { <text class="val" [attr.x]="b.cx" [attr.y]="b.y - 6" text-anchor="middle">{{ format()(b.value) }}</text> }
          <text class="axis" [attr.x]="b.cx" [attr.y]="H - 8" text-anchor="middle">{{ b.label }}</text>
          <title>{{ b.label }}: {{ format()(b.value) }}{{ b.sub ? ' · ' + b.sub : '' }}</title>
        </g>
      }
    </svg>
  `,
  styles: `
    :host { display: block; }
    svg { display: block; overflow: visible; }
    .grid { stroke: var(--border-soft); stroke-width: 1; }
    .grid.base { stroke: var(--border-strong); }
    .axis { fill: var(--text-muted); font-size: 11px; }
    .val { fill: var(--text-soft); font-size: 11px; font-weight: 600; }
    .bar { fill: var(--info); }
    .hit { fill: transparent; }
    .bar-g:hover .hit { fill: var(--surface-hover); }
    .bar-g:hover .bar { fill: var(--accent-strong); }
  `,
})
export class ColumnChartComponent {
  readonly data = input.required<BarDatum[]>();
  readonly format = input<(v: number) => string>((v) => String(v));
  readonly ariaLabel = input('Bar chart');

  /** The drawing is sized to its container, so text stays at its real size at any width. */
  readonly W = signal(640);
  readonly H = 220;

  constructor() {
    const host = inject(ElementRef<HTMLElement>).nativeElement as HTMLElement;
    const destroy = inject(DestroyRef);
    afterNextRender(() => {
      const ro = new ResizeObserver(([e]) => { if (e) this.W.set(Math.max(280, Math.floor(e.contentRect.width))); });
      ro.observe(host);
      destroy.onDestroy(() => ro.disconnect());
    });
  }
  readonly L = 58;
  readonly R = 8;
  readonly T = 18;
  readonly B = 26;

  readonly geo = computed(() => {
    const data = this.data();
    const max = Math.max(0, ...data.map((d) => d.value));
    const ticks = niceTicks(max);
    const top = ticks[ticks.length - 1] || 1;
    const plotH = this.H - this.T - this.B;
    const y = (v: number) => this.T + plotH - (v / top) * plotH;
    const band = (this.W() - this.L - this.R) / Math.max(1, data.length);
    const bw = Math.min(34, band * 0.62);
    const maxIdx = data.findIndex((d) => d.value === max && max > 0);
    const bars = data.map((d, i) => {
      const cx = this.L + band * i + band / 2;
      const yTop = y(d.value);
      const h = this.T + plotH - yTop;
      const r = Math.min(4, h, bw / 2);
      const x0 = cx - bw / 2;
      const x1 = cx + bw / 2;
      const yb = this.T + plotH;
      const dPath = `M${x0},${yb} V${yTop + r} Q${x0},${yTop} ${x0 + r},${yTop} H${x1 - r} Q${x1},${yTop} ${x1},${yTop + r} V${yb} Z`;
      return { ...d, cx, y: yTop, h, d: dPath, top: i === maxIdx };
    });
    return { ticks: ticks.map((v) => ({ v, y: y(v) })), bars, band };
  });
}

/**
 * Horizontal bars with a label column, drawn to a shared scale (`max`, or the largest value).
 * Values sit at the end of each bar in text colour.
 */
@Component({
  selector: 'app-bar-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="list" role="list">
      @for (d of data(); track d.label) {
        <div class="row" role="listitem" [title]="d.label + ': ' + format()(d.value) + (d.sub ? ' · ' + d.sub : '')">
          <span class="label"><span class="truncate">{{ d.label }}</span>@if (d.sub) { <small class="truncate">{{ d.sub }}</small> }</span>
          <span class="track"><span class="fill" [style.width.%]="pct(d.value)"></span></span>
          <span class="value">{{ format()(d.value) }}</span>
        </div>
      }
    </div>
    @if (showScale()) {
      <div class="scale"><span></span><span class="ticks"><span>0</span><span>{{ format()(scaleMax() / 2) }}</span><span>{{ format()(scaleMax()) }}</span></span><span></span></div>
    }
  `,
  styles: `
    :host { display: block; }
    .list { display: flex; flex-direction: column; gap: 7px; }
    .row, .scale { display: grid; grid-template-columns: minmax(90px, 34%) minmax(0, 1fr) 64px; gap: 10px; align-items: center; }
    .label { display: flex; flex-direction: column; min-width: 0; font-size: 0.8rem; color: var(--text-soft); line-height: 1.25; }
    .label small { font-size: 0.7rem; color: var(--text-muted); }
    .track { position: relative; height: 12px; border-left: 1px solid var(--border-strong); background: repeating-linear-gradient(90deg, transparent 0 calc(50% - 1px), var(--border-soft) calc(50% - 1px) 50%); }
    .fill { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 0 4px 4px 0; background: var(--info); }
    .row:hover .fill { background: var(--accent-strong); }
    .value { font-size: 0.8rem; font-weight: 600; color: var(--text-soft); text-align: right; white-space: nowrap; }
    .scale { margin-top: 6px; }
    .ticks { display: flex; justify-content: space-between; font-size: 0.7rem; color: var(--text-muted); }
  `,
})
export class BarListComponent {
  readonly data = input.required<BarDatum[]>();
  readonly max = input<number | null>(null);
  readonly format = input<(v: number) => string>((v) => String(v));
  readonly showScale = input(true);

  readonly scaleMax = computed(() => this.max() ?? niceTicks(Math.max(0, ...this.data().map((d) => d.value))).at(-1) ?? 1);
  pct(v: number): number { return Math.max(0, Math.min(100, (v / (this.scaleMax() || 1)) * 100)); }
}
