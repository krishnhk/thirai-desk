import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { formatPercent, sameDay, toDateInput } from '../../core/format';
import { CalendarState } from './calendar.state';

interface MonthCell {
  date: Date; key: string; inMonth: boolean; today: boolean; selected: boolean;
  total: number; drafts: number; cancelled: number; clashes: number;
  /** Seats sold over seats offered, for published shows that are not cancelled; null with none. */
  occupancy: number | null;
  theatres: { code: string; count: number }[];
  aria: string;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** The month overview: per day, how many shows, drafts, cancellations and how full they are. */
@Component({
  selector: 'app-calendar-month',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="month">
      @for (w of weekdays; track w) { <div class="wd">{{ w }}</div> }
      @for (c of cells(); track c.key) {
        <button type="button" class="day" [class.out]="!c.inMonth" [class.today]="c.today" [class.sel]="c.selected" [class.empty]="!c.total"
          (click)="state.openDay(c.date)" [attr.aria-label]="c.aria">
          <span class="top">
            <span class="num">{{ c.date.getDate() }}</span>
            @if (c.total) { <span class="total">{{ c.total }} {{ c.total === 1 ? 'show' : 'shows' }}</span> }
          </span>
          @if (c.total) {
            <span class="lines">
              @if (c.drafts) { <span class="ln draft">{{ c.drafts }} draft</span> }
              @if (c.cancelled) { <span class="ln cancel">{{ c.cancelled }} cancelled</span> }
              @if (c.clashes) { <span class="ln cancel">{{ c.clashes }} in conflict</span> }
              @for (t of c.theatres; track t.code) { <span class="ln th"><span class="truncate">{{ t.code }}</span><span>{{ t.count }}</span></span> }
            </span>
            @if (c.occupancy !== null) {
              <span class="occ" [attr.title]="'Seats sold: ' + pct(c.occupancy)">
                <span class="bar"><span [style.width.%]="c.occupancy * 100" [class.high]="c.occupancy >= 0.75" [class.low]="c.occupancy < 0.25"></span></span>
                <span class="pct">{{ pct(c.occupancy) }}</span>
              </span>
            }
          }
        </button>
      }
    </div>
  `,
  styles: `
    :host { display: block; min-width: 0; }
    .month { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); }
    .wd { padding: 8px 10px; background: var(--surface-2); border-bottom: 1px solid var(--border); font-size: 0.68rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted); }
    .day { display: flex; flex-direction: column; gap: 6px; min-width: 0; min-height: 104px; padding: 8px 10px; border: 0; border-right: 1px solid var(--border-soft); border-bottom: 1px solid var(--border-soft); background: none; color: var(--text-soft); text-align: left; }
    .day:nth-child(7n + 7) { border-right: 0; }
    .day:hover { background: var(--surface-hover); }
    .day.out { background: var(--tint-dim); }
    .day.out .num, .day.out .total { color: var(--text-faint); }
    .day.out .lines, .day.out .occ { opacity: 0.5; }
    .day.out .total { background: none; }
    .day.today:not(.sel) { background: var(--tint); }
    .day.sel { box-shadow: inset 0 0 0 1px var(--border-strong); background: var(--surface-2); }
    .top { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
    .num { display: grid; place-items: center; min-width: 24px; height: 24px; padding: 0 4px; border-radius: 999px; font-size: 0.84rem; font-weight: 700; color: var(--text); }
    .today .num { background: var(--accent); color: var(--on-accent); }
    .total { padding: 1px 9px; border-radius: 999px; background: var(--surface-3); font-size: 0.74rem; font-weight: 700; color: var(--text); white-space: nowrap; }
    .lines { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
    .ln { font-size: 0.7rem; line-height: 1.4; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ln::before { content: ''; display: inline-block; width: 6px; height: 6px; margin-right: 6px; border-radius: 50%; background: currentColor; vertical-align: 1px; }
    .ln.th::before { display: none; }
    .ln.draft { color: var(--violet); }
    .ln.cancel { color: var(--danger); }
    .ln.th { display: flex; justify-content: space-between; gap: 6px; }
    .occ { display: flex; align-items: center; gap: 6px; margin-top: auto; }
    .bar { flex: 1; height: 5px; border-radius: 999px; background: var(--surface-3); overflow: hidden; }
    .bar > span { display: block; height: 100%; border-radius: inherit; background: var(--accent); }
    .bar > span.high { background: var(--success); }
    .bar > span.low { background: var(--text-faint); }
    .pct { font-size: 0.68rem; color: var(--text-muted); min-width: 28px; text-align: right; }

    @media (max-width: 1100px) { .day { min-height: 104px; padding: 6px 7px; } .ln.th { display: none; } }
  `,
})
export class CalendarMonthComponent {
  readonly state = inject(CalendarState);
  readonly weekdays = WEEKDAYS;

  readonly cells = computed<MonthCell[]>(() => {
    const store = this.state.store;
    const byDay = this.state.byDay();
    const month = this.state.date().getMonth();
    const sel = this.state.date();
    const perTheatre = this.state.group() === 'theatre' && this.state.multiTheatre();
    const order = this.state.groups().map((g) => g.theatre.code);
    return this.state.days().map((date) => {
      const key = toDateInput(date);
      const list = byDay.get(key) ?? [];
      let sold = 0, cap = 0;
      const theatres = new Map<string, number>();
      for (const c of list) {
        if (c.kind === 'published' || c.kind === 'completed') { sold += store.soldSeats(c.show.id); cap += store.capacity(c.show.screenId); }
        if (perTheatre) { const code = store.theatre(c.show.theatreId)?.code ?? ''; theatres.set(code, (theatres.get(code) ?? 0) + 1); }
      }
      const drafts = list.filter((c) => c.kind === 'draft').length;
      const cancelled = list.filter((c) => c.kind === 'cancelled').length;
      const clashes = list.filter((c) => c.conflicts.length).length;
      const label = date.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
      return {
        date, key, inMonth: date.getMonth() === month, today: this.state.isToday(date), selected: sameDay(date, sel),
        total: list.length, drafts, cancelled, clashes,
        occupancy: cap ? sold / cap : null,
        theatres: order.filter((code) => theatres.has(code)).map((code) => ({ code, count: theatres.get(code)! })),
        aria: `${label}: ${list.length} shows, ${drafts} drafts, ${cancelled} cancelled${clashes ? `, ${clashes} in conflict` : ''}. Open the day view.`,
      };
    });
  });

  pct(v: number): string { return formatPercent(v); }
}
