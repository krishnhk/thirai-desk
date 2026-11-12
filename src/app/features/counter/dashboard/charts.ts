import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { formatMoney, formatMoneyShort } from '../../../core/format';
import { Bar, ChannelDay } from './counter-stats';

/*
 * Counter charts. Counter is drawn in the info blue and online in neutral grey, so the box
 * office stands out against the rest of the theatre's sales; amber stays for actions.
 * Every bar is drawn to scale from a zero baseline.
 */

/** Horizontal bars for one measure, labelled with their values. */
@Component({
  selector: 'app-bar-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (bars().length) {
      <ul class="bars">
        @for (b of bars(); track b.key) {
          <li [title]="b.label + ': ' + b.text">
            <span class="label"><span class="truncate">{{ b.label }}</span>@if (b.sub) { <small>{{ b.sub }}</small> }</span>
            <span class="track"><span class="fill" [style.width.%]="pct(b.value)"></span></span>
            <span class="value">{{ b.text }}</span>
          </li>
        }
      </ul>
    } @else {
      <p class="muted small empty">{{ empty() }}</p>
    }
  `,
  styles: `
    .bars { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
    li { display: grid; grid-template-columns: minmax(80px, 140px) minmax(0, 1fr) auto; align-items: center; gap: 12px; }
    .label { display: flex; flex-direction: column; min-width: 0; font-size: 0.85rem; color: var(--text-soft); }
    .label small { color: var(--text-muted); font-size: 0.72rem; }
    .track { height: 10px; border-radius: 0 4px 4px 0; background: var(--surface-3); overflow: hidden; }
    .fill { display: block; height: 100%; border-radius: 0 4px 4px 0; background: var(--info); min-width: 2px; }
    .value { min-width: 72px; text-align: right; font-size: 0.85rem; font-weight: 600; white-space: nowrap; }
    .empty { padding: 8px 0; }
  `,
})
export class BarListComponent {
  readonly bars = input.required<Bar[]>();
  readonly empty = input('Nothing sold yet.');
  private readonly max = computed(() => Math.max(1, ...this.bars().map((b) => b.value)));
  pct(v: number): number { return (v / this.max()) * 100; }
}

/** Counter against online revenue for each day, side by side on one scale. */
@Component({
  selector: 'app-channel-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="legend small">
      <span><i class="sw counter"></i>Counter</span>
      <span><i class="sw online"></i>Online</span>
      <span class="muted">Scale 0 – {{ short(max()) }}</span>
    </div>
    <div class="plot" role="img" [attr.aria-label]="summary()">
      <div class="grid"><span></span><span></span><span></span></div>
      @for (d of days(); track d.key; let last = $last) {
        <div class="day" [class.today]="last" tabindex="0">
          <div class="cols">
            <span class="col counter" [style.height.%]="pct(d.counter)"></span>
            <span class="col online" [style.height.%]="pct(d.online)"></span>
          </div>
          <span class="tip" role="tooltip">
            <strong>{{ d.label }}</strong>
            <span><i class="sw counter"></i>Counter {{ money(d.counter) }} · {{ d.counterTickets }} tickets</span>
            <span><i class="sw online"></i>Online {{ money(d.online) }} · {{ d.onlineTickets }} tickets</span>
            <span class="muted">Counter share {{ share(d) }}</span>
          </span>
        </div>
      }
    </div>
    <div class="axis">
      @for (d of days(); track d.key) { <span>{{ d.label }}</span> }
    </div>
  `,
  styles: `
    :host { display: block; }
    .legend { display: flex; flex-wrap: wrap; gap: 6px 16px; margin-bottom: 10px; color: var(--text-soft); }
    .legend span { display: inline-flex; align-items: center; gap: 6px; }
    .sw { display: inline-block; width: 10px; height: 10px; border-radius: 3px; }
    .sw.counter { background: var(--info); }
    .sw.online { background: var(--text-muted); }
    .plot { position: relative; display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 6px; height: 180px; border-bottom: 1px solid var(--border-strong); }
    .grid { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: space-between; pointer-events: none; }
    .grid span { border-top: 1px dashed var(--border-soft); }
    .day { position: relative; display: flex; align-items: flex-end; justify-content: center; height: 100%; border-radius: var(--radius-sm); outline-offset: 0; }
    .day:hover, .day:focus-visible { background: var(--tint); }
    .cols { display: flex; align-items: flex-end; gap: 2px; height: 100%; width: min(100%, 44px); }
    .col { flex: 1; min-height: 1px; border-radius: 4px 4px 0 0; }
    .col.counter { background: var(--info); }
    .col.online { background: var(--text-muted); }
    .tip { position: absolute; z-index: 5; bottom: calc(100% - 30px); left: 50%; transform: translateX(-50%); display: none; flex-direction: column; gap: 3px; width: max-content; max-width: 240px; padding: 8px 10px; border: 1px solid var(--border-strong); border-radius: var(--radius); background: var(--surface-3); box-shadow: var(--shadow); font-size: 0.76rem; color: var(--text-soft); pointer-events: none; }
    .tip span { display: flex; align-items: center; gap: 6px; }
    .tip strong { color: var(--text); }
    .day:first-child .tip { left: 0; transform: none; }
    .day:last-child .tip { left: auto; right: 0; transform: none; }
    .day:hover .tip, .day:focus-visible .tip { display: flex; }
    .axis { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 6px; margin-top: 6px; font-size: 0.72rem; color: var(--text-muted); text-align: center; }
    .axis span:last-child { color: var(--text); font-weight: 600; }
  `,
})
export class ChannelChartComponent {
  readonly days = input.required<ChannelDay[]>();
  readonly money = formatMoney;
  readonly short = formatMoneyShort;
  readonly max = computed(() => Math.max(1, ...this.days().flatMap((d) => [d.counter, d.online])));
  readonly summary = computed(() => 'Counter and online revenue, last 7 days: ' + this.days().map((d) => `${d.label} counter ${formatMoney(d.counter)}, online ${formatMoney(d.online)}`).join('; '));
  pct(v: number): number { return (v / this.max()) * 100; }
  share(d: ChannelDay): string {
    const t = d.counter + d.online;
    return t ? Math.round((d.counter / t) * 100) + '%' : '—';
  }
}

/** One show's seats as a stacked bar: counter, online, available. */
@Component({
  selector: 'app-seat-split',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="split" [attr.aria-label]="counter() + ' counter, ' + online() + ' online, ' + available() + ' available of ' + capacity()">
      @if (counter()) { <span class="seg counter" [style.flex-grow]="counter()" [title]="counter() + ' sold at the counter'"></span> }
      @if (online()) { <span class="seg online" [style.flex-grow]="online()" [title]="online() + ' sold online'"></span> }
      @if (available()) { <span class="seg free" [style.flex-grow]="available()" [title]="available() + ' available'"></span> }
    </div>
  `,
  styles: `
    :host { display: block; min-width: 140px; }
    .split { display: flex; gap: 2px; height: 10px; }
    .seg { flex-basis: 0; min-width: 2px; }
    .seg:first-child { border-radius: 4px 0 0 4px; }
    .seg:last-child { border-radius: 0 4px 4px 0; }
    .seg:only-child { border-radius: 4px; }
    .counter { background: var(--info); }
    .online { background: var(--text-muted); }
    .free { background: var(--surface-3); }
  `,
})
export class SeatSplitComponent {
  readonly counter = input.required<number>();
  readonly online = input.required<number>();
  readonly available = input.required<number>();
  readonly capacity = input.required<number>();
}
