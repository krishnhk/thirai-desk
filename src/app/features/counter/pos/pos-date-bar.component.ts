import { ChangeDetectionStrategy, Component, ElementRef, afterRenderEffect, computed, inject, signal, viewChild } from '@angular/core';

import { addDays, DAY, formatDay, sameDay, startOfDay, toDateInput } from '../../../core/format';
import { IconComponent } from '../../../shared/icon.component';
import { PosSale } from './pos-sale';

interface StripDay {
  key: string; date: Date; wd: string; n: number; full: string;
  today: boolean; listed: number; open: number;
  /** Short month name when this day starts a new month inside the strip ("Dec"). */
  newMonth: string;
}
interface CalCell { key: string; date: Date | null; n: number; enabled: boolean; today: boolean; sel: boolean; listed: number; open: number; }

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const LOCALE = 'en-IN';

/**
 * Date navigation for the show selector: the month being sold, previous / next day, a scrolling strip
 * of every day the box office can sell for (today through the advance booking window), a month
 * calendar and one Today shortcut. Days outside the window are not offered. The selected day is the
 * console's operational date (PosSale), so there is no second date state here.
 */
@Component({
  selector: 'app-pos-date-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  host: { '(document:click)': 'onDocClick($event)' },
  template: `
    <div class="track">
      <button type="button" class="step" aria-label="Previous day" title="Previous day ([)" [disabled]="!canPrev()" (click)="sale.shiftDay(-1)"><app-icon name="chevronLeft" /></button>
      <div class="strip" #stripEl role="group" aria-label="Bookable dates" [class.fade-l]="!atStart()" [class.fade-r]="!atEnd()" (scroll)="measure()">
        @for (d of strip(); track d.key) {
          @if (d.newMonth) { <span class="mon" aria-hidden="true">{{ d.newMonth }}</span> }
          <button type="button" class="day" [attr.data-day]="d.key" [attr.aria-pressed]="isSel(d.date)" [attr.aria-current]="d.today ? 'date' : null"
            [class.today]="d.today" [class.none]="!d.listed" [attr.aria-label]="dayLabel(d)"
            [attr.title]="d.listed ? d.open + ' of ' + d.listed + ' shows open for booking' : 'No shows scheduled'" (click)="sale.setDay(d.date)">
            <span class="dw">{{ d.wd }}</span><span class="dn">{{ d.n }}</span>
          </button>
        }
      </div>
      <button type="button" class="step" aria-label="Next day" title="Next day (])" [disabled]="!canNext()" (click)="sale.shiftDay(1)"><app-icon name="chevronRight" /></button>
    </div>

    <div class="acts">
      <button type="button" class="btn sm icon cal-btn" aria-label="Open the calendar" title="Pick a date" aria-haspopup="dialog" [attr.aria-expanded]="calOpen()" [class.on]="calOpen()" (click)="toggleCal()"><app-icon name="calendar" /></button>
      <button type="button" class="btn sm today-btn" title="Go to today" [disabled]="sale.isToday()" (click)="sale.goToday()">Today</button>

      @if (calOpen()) {
        <div class="cal" role="dialog" aria-label="Choose a date">
          <div class="ch">
            <button type="button" class="btn ghost sm icon" aria-label="Previous month" [disabled]="!canPrevMonth()" (click)="shiftMonth(-1)"><app-icon name="chevronLeft" /></button>
            <strong>{{ calMonthLabel() }}</strong>
            <button type="button" class="btn ghost sm icon" aria-label="Next month" [disabled]="!canNextMonth()" (click)="shiftMonth(1)"><app-icon name="chevronRight" /></button>
          </div>
          <div class="grid" role="grid">
            @for (w of weekdays; track $index) { <span class="wd" aria-hidden="true">{{ w }}</span> }
            @for (c of cells(); track c.key) {
              @if (c.date) {
                <button type="button" class="cell" [disabled]="!c.enabled" [class.today]="c.today" [class.sel]="c.sel" [class.none]="c.enabled && !c.listed"
                  [attr.data-date]="c.key" [attr.aria-pressed]="c.sel" [attr.aria-label]="cellLabel(c)" (click)="pick(c.date)">
                  {{ c.n }}@if (c.enabled && c.open) { <span class="dot" aria-hidden="true"></span> }
                </button>
              } @else { <span class="cell blank" aria-hidden="true"></span> }
            }
          </div>
          <p class="cf">Sells from today to <b>{{ lastLabel() }}</b> ({{ windowText() }}). Dots mark days with shows open for booking.</p>
        </div>
      }
    </div>
  `,
  styles: `
    :host { display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: 'label acts' 'track track'; align-items: center; gap: 6px 10px; min-width: 0; }
    .mlabel { grid-area: label; font-size: 0.8rem; font-weight: 700; color: var(--text-soft); white-space: nowrap; }

    .track { grid-area: track; display: flex; align-items: center; gap: 2px; min-width: 0; }
    .step { flex: none; display: grid; place-items: center; width: 26px; height: 46px; padding: 0; border: 0; border-radius: var(--radius-sm); background: none; color: var(--text-muted); }
    .step:hover:not(:disabled) { background: var(--surface-2); color: var(--text); }
    .step:disabled { opacity: 0.35; cursor: not-allowed; }
    .step app-icon { width: 16px; height: 16px; }

    .strip { --fl: 0px; --fr: 0px; display: flex; align-items: center; gap: 4px; min-width: 0; flex: 0 1 auto; overflow-x: auto; scrollbar-width: none; scroll-behavior: smooth;
      mask-image: linear-gradient(90deg, transparent 0, #000 var(--fl), #000 calc(100% - var(--fr)), transparent 100%); }
    .strip::-webkit-scrollbar { display: none; }
    .strip.fade-l { --fl: 22px; }
    .strip.fade-r { --fr: 22px; }
    .day { position: relative; flex: none; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px; width: 48px; height: 46px; padding: 0 0 5px; border: 1px solid transparent; border-radius: var(--radius); background: none; color: var(--text-soft); line-height: 1.1; transition: background 120ms ease, color 120ms ease; }
    .dw { font-size: 0.64rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-muted); }
    .dn { font-size: 1rem; font-weight: 800; font-variant-numeric: tabular-nums; }
    .day:hover { background: var(--surface-2); color: var(--text); }
    .day:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
    .day.none .dn { color: var(--text-faint); }
    .day.today { border-color: var(--border); }
    .day.today::after { content: ''; position: absolute; bottom: 5px; left: 50%; width: 4px; height: 4px; margin-left: -2px; border-radius: 50%; background: var(--text-soft); }
    .day[aria-pressed='true'] { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
    .day[aria-pressed='true'] .dw, .day[aria-pressed='true'] .dn { color: var(--on-accent); }
    .day[aria-pressed='true']::after { background: var(--on-accent); }
    .mon { flex: none; align-self: stretch; display: flex; align-items: center; padding: 0 4px 0 8px; margin-left: 2px; border-left: 1px solid var(--border); font-size: 0.66rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-muted); }

    .acts { grid-area: acts; position: relative; display: flex; align-items: center; gap: 6px; }
    .acts .btn { min-height: 32px; }
    .cal-btn { width: 32px; }
    .cal-btn.on { border-color: var(--accent-line); color: var(--accent); }
    .today-btn:disabled { opacity: 0.4; }

    .cal { position: absolute; z-index: 40; top: calc(100% + 6px); right: 0; width: 300px; max-width: calc(100vw - 32px); padding: 10px 12px 12px; border: 1px solid var(--border-strong); border-radius: var(--radius-lg); background: var(--surface-2); box-shadow: var(--shadow-lg); }
    .ch { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
    .ch strong { font-size: 0.88rem; }
    .grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 2px; }
    .wd { padding: 2px 0 4px; font-size: 0.68rem; font-weight: 700; color: var(--text-muted); text-align: center; }
    .cell { position: relative; display: grid; place-items: center; height: 34px; padding: 0; border: 0; border-radius: var(--radius-sm); background: none; color: var(--text); font-size: 0.82rem; font-weight: 600; }
    .cell:hover:not(:disabled) { background: var(--surface-3); }
    .cell:disabled { color: var(--text-faint); font-weight: 500; cursor: not-allowed; text-decoration: line-through; text-decoration-color: var(--text-faint); }
    .cell.none { color: var(--text-muted); }
    .cell.today { box-shadow: inset 0 0 0 1px var(--border-strong); }
    .cell.sel { background: var(--accent); color: var(--on-accent); }
    .dot { position: absolute; bottom: 4px; left: 50%; width: 4px; height: 4px; margin-left: -2px; border-radius: 50%; background: var(--success); }
    .cell.sel .dot { background: var(--on-accent); }
    .cf { margin-top: 8px; font-size: 0.72rem; color: var(--text-muted); line-height: 1.45; }
    .cf b { color: var(--text-soft); }

    /* Room for one row: month, strip, then the calendar and Today next to it. */
    @container shows (min-width: 560px) {
      :host { display: flex; align-items: center; gap: 12px; }
      .track { flex: 0 1 auto; }
      .acts { flex: none; padding-left: 12px; border-left: 1px solid var(--border-soft); }
    }
    @container shows (min-width: 1000px) {
      .day { width: 54px; }
    }
  `,
})
export class PosDateBarComponent {
  readonly sale = inject(PosSale);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly stripEl = viewChild<ElementRef<HTMLElement>>('stripEl');

  readonly calOpen = signal(false);
  /** The first day of the month the calendar shows. */
  readonly calMonth = signal(monthStart(new Date()));
  readonly weekdays = WEEKDAYS;
  /** Whether the strip is scrolled to its start / end (for the edge fades). */
  readonly atStart = signal(true);
  readonly atEnd = signal(true);

  /** The selected day's month and year: "November 2026". */
  readonly monthLabel = computed(() => this.sale.day().toLocaleDateString(LOCALE, { month: 'long', year: 'numeric' }));
  readonly canPrev = computed(() => this.sale.day() > this.sale.today());
  readonly canNext = computed(() => this.sale.day() < this.sale.lastDay());
  readonly lastLabel = computed(() => formatDay(this.sale.lastDay()));
  readonly windowText = computed(() => {
    const n = Math.round((this.sale.lastDay().getTime() - this.sale.today().getTime()) / DAY);
    return n === 0 ? 'today only' : `${n} ${n === 1 ? 'day' : 'days'} ahead`;
  });

  readonly strip = computed<StripDay[]>(() => {
    const stats = this.sale.dayStats();
    const today = this.sale.today();
    return this.sale.windowDays().map((date, i) => {
      const key = toDateInput(date);
      const s = stats.get(key);
      return {
        key, date, n: date.getDate(), full: formatDay(date),
        wd: date.toLocaleDateString(LOCALE, { weekday: 'short' }),
        today: sameDay(date, today), listed: s?.listed ?? 0, open: s?.open ?? 0,
        newMonth: i > 0 && date.getDate() === 1 ? date.toLocaleDateString(LOCALE, { month: 'short' }) : '',
      };
    });
  });

  readonly calMonthLabel = computed(() => this.calMonth().toLocaleDateString(LOCALE, { month: 'long', year: 'numeric' }));
  readonly canPrevMonth = computed(() => this.calMonth() > monthStart(this.sale.today()));
  readonly canNextMonth = computed(() => this.calMonth() < monthStart(this.sale.lastDay()));
  readonly cells = computed<CalCell[]>(() => {
    const first = this.calMonth();
    const stats = this.sale.dayStats();
    const out: CalCell[] = [];
    for (let i = 0; i < first.getDay(); i++) out.push({ key: `b${i}`, date: null, n: 0, enabled: false, today: false, sel: false, listed: 0, open: 0 });
    for (let d = first; d.getMonth() === first.getMonth(); d = addDays(d, 1)) {
      const key = toDateInput(d);
      const s = stats.get(key);
      out.push({ key, date: d, n: d.getDate(), enabled: this.sale.inWindow(d), today: sameDay(d, this.sale.today()), sel: sameDay(d, this.sale.day()), listed: s?.listed ?? 0, open: s?.open ?? 0 });
    }
    return out;
  });

  constructor() {
    // Keep the selected day in view on the strip (after it renders, also when the window changes).
    afterRenderEffect(() => {
      const key = toDateInput(this.sale.day());
      this.strip();
      const strip = this.stripEl()?.nativeElement;
      if (!strip) return;
      const el = strip.querySelector<HTMLElement>(`[data-day="${key}"]`);
      if (el) {
        const s = strip.getBoundingClientRect();
        const r = el.getBoundingClientRect();
        const pad = 28;
        if (r.left < s.left + pad) strip.scrollLeft -= s.left + pad - r.left;
        else if (r.right > s.right - pad) strip.scrollLeft += r.right - (s.right - pad);
      }
      this.measure();
    });
  }

  /** Updates the edge fades from the strip's scroll position. */
  measure(): void {
    const strip = this.stripEl()?.nativeElement;
    if (!strip) return;
    this.atStart.set(strip.scrollLeft <= 1);
    this.atEnd.set(strip.scrollLeft + strip.clientWidth >= strip.scrollWidth - 1);
  }

  isSel(d: Date): boolean { return sameDay(d, this.sale.day()); }

  dayLabel(d: StripDay): string {
    const shows = d.listed ? `${d.open} of ${d.listed} shows open` : 'no shows';
    return `${d.full}${d.today ? ' (today)' : ''}, ${shows}`;
  }

  toggleCal(): void {
    if (!this.calOpen()) this.calMonth.set(monthStart(this.sale.dayInWindow() ? this.sale.day() : this.sale.today()));
    this.calOpen.update((v) => !v);
  }

  shiftMonth(delta: number): void {
    const m = this.calMonth();
    this.calMonth.set(new Date(m.getFullYear(), m.getMonth() + delta, 1));
  }

  pick(d: Date): void {
    if (this.sale.setDay(d)) this.calOpen.set(false);
  }

  cellLabel(c: CalCell): string {
    const d = formatDay(c.date!);
    if (!c.enabled) return `${d}, not bookable at the counter`;
    return c.listed ? `${d}, ${c.open} of ${c.listed} shows open` : `${d}, no shows`;
  }

  /** Closes the calendar; true when there was one to close (Esc). */
  dismiss(): boolean {
    if (!this.calOpen()) return false;
    this.calOpen.set(false);
    return true;
  }

  onDocClick(e: MouseEvent): void {
    if (this.calOpen() && !(this.host.nativeElement as HTMLElement).contains(e.target as Node)) this.calOpen.set(false);
  }
}

function monthStart(d: Date): Date {
  const x = startOfDay(d);
  return new Date(x.getFullYear(), x.getMonth(), 1);
}
