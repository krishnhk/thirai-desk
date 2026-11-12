import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { AdminStore } from '../../core/admin-store';
import { addDays, formatDate, formatDay, formatMoney, formatMoneyShort, formatNumber, fromDateInput, sameDay, startOfDay, toDateInput } from '../../core/format';
import { Show } from '../../core/models';
import { EmptyStateComponent, KpiCardComponent, MeterComponent, SkeletonComponent } from '../../shared/ui';
import { BarDatum, BarListComponent, ColumnChartComponent } from './charts';

type Preset = 'today' | '7' | '14' | 'custom';

interface Agg { shows: number; seats: number; capacity: number; gross: number; cancelled: number; }
const emptyAgg = (): Agg => ({ shows: 0, seats: 0, capacity: 0, gross: 0, cancelled: 0 });

/** Sales and operations for a date range: KPIs, three charts and a theatre/screen breakdown. */
@Component({
  selector: 'app-performance-report',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, KpiCardComponent, MeterComponent, EmptyStateComponent, SkeletonComponent, ColumnChartComponent, BarListComponent],
  template: `
    <div class="stack">
      <div class="range card">
        <div class="segmented" role="group" aria-label="Date range">
          @for (p of presets; track p.id) { <button type="button" [attr.aria-pressed]="preset() === p.id" (click)="choose(p.id)">{{ p.label }}</button> }
        </div>
        <div class="dates">
          <label class="field"><span class="field-label">From</span><input class="input" type="date" [value]="fromValue()" [max]="toValue()" (change)="setFrom($any($event.target).value)" /></label>
          <label class="field"><span class="field-label">To</span><input class="input" type="date" [value]="toValue()" [min]="fromValue()" (change)="setTo($any($event.target).value)" /></label>
        </div>
        <span class="spacer"></span>
        <p class="muted small note">{{ rangeLabel() }}. Counts shows that have started; cancelled shows are separate.</p>
      </div>

      @if (store.loading()) {
        <section class="card"><app-skeleton [rows]="8" /></section>
      } @else {
        <div class="kpis">
          <app-kpi-card label="Shows run" icon="shows" [value]="formatNumber(totals().shows)" [hint]="days().length + ' days'" />
          <app-kpi-card label="Tickets sold" icon="ticket" [value]="formatNumber(totals().seats)" [hint]="'of ' + formatNumber(totals().capacity) + ' seats'" />
          <app-kpi-card label="Gross revenue" icon="rupee" [value]="formatMoneyShort(totals().gross)" hint="Confirmed bookings, fees included" />
          <app-kpi-card label="Average occupancy" icon="seats" [value]="pct(totals().seats, totals().capacity) + '%'" hint="Seats sold ÷ seats offered" />
          <app-kpi-card label="Cancellations" icon="cancel" [tone]="totals().cancelled ? 'danger' : 'default'" [value]="totals().cancelled" hint="Shows cancelled" link="/shows" [query]="{ tab: 'cancelled' }" />
          <app-kpi-card label="Refunds processed" icon="refund" [value]="formatMoneyShort(refunds().amount)" [hint]="refunds().count + ' refunds credited'" link="/refunds" />
        </div>

        @if (!totals().shows && !totals().cancelled) {
          <section class="card"><app-empty-state icon="reports" title="No shows ran in this range" text="Choose a range that includes past days. Future shows appear once they start." /></section>
        } @else {
          <div class="charts">
            <section class="card wide">
              <div class="card-head"><div><h2>Daily gross revenue</h2><p class="muted tiny">Confirmed bookings for shows that started each day</p></div></div>
              <div class="card-body"><app-column-chart [data]="daily()" [format]="moneyShort" ariaLabel="Daily gross revenue" /></div>
            </section>
            <section class="card">
              <div class="card-head"><div><h2>Occupancy by screen</h2><p class="muted tiny">Seats sold ÷ seats offered</p></div></div>
              <div class="card-body"><app-bar-list [data]="byScreen()" [max]="100" [format]="percent" /></div>
            </section>
            <section class="card">
              <div class="card-head"><div><h2>Top films by tickets</h2><p class="muted tiny">Top {{ topFilms().length }} films in the range</p></div></div>
              <div class="card-body"><app-bar-list [data]="topFilms()" [format]="number" /></div>
            </section>
          </div>

          <section class="card">
            <div class="card-head"><h2>By theatre and screen</h2><span class="muted small">{{ breakdown().length }} theatres</span></div>
            <div class="table-wrap">
              <table class="data-table">
                <thead><tr><th>Theatre / screen</th><th class="num">Shows run</th><th class="num">Tickets</th><th class="num">Gross</th><th>Occupancy</th><th class="num">Cancelled</th></tr></thead>
                <tbody>
                  @for (t of breakdown(); track t.id) {
                    <tr class="group">
                      <td><a class="plain" routerLink="/theatre"><strong>{{ t.name }}</strong></a></td>
                      <td class="num strong">{{ t.agg.shows }}</td><td class="num strong">{{ formatNumber(t.agg.seats) }}</td>
                      <td class="num strong">{{ formatMoney(t.agg.gross) }}</td>
                      <td><app-meter [value]="ratio(t.agg)" /></td><td class="num strong">{{ t.agg.cancelled || '—' }}</td>
                    </tr>
                    @for (s of t.screens; track s.id) {
                      <tr>
                        <td class="indent"><a class="plain soft" [routerLink]="['/screens', s.id]">{{ s.name }}</a></td>
                        <td class="num">{{ s.agg.shows }}</td><td class="num">{{ formatNumber(s.agg.seats) }}</td>
                        <td class="num">{{ formatMoney(s.agg.gross) }}</td>
                        <td><app-meter [value]="ratio(s.agg)" /></td><td class="num">{{ s.agg.cancelled || '—' }}</td>
                      </tr>
                    }
                  }
                </tbody>
              </table>
            </div>
          </section>
        }
      }
    </div>
  `,
  styles: `
    .range { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 12px 16px; padding: 12px 16px; }
    .dates { display: flex; gap: 10px; }
    .dates .field { width: 150px; }
    .note { max-width: 420px; }
    .kpis { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 12px; }
    @media (max-width: 1360px) { .kpis { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
    .charts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; align-items: start; }
    .charts .wide { grid-column: 1 / -1; }
    @media (max-width: 1100px) { .charts { grid-template-columns: minmax(0, 1fr); } }
    tr.group td { background: var(--surface-2); }
    .indent { padding-left: 30px; }
    .plain { color: var(--text); }
    .plain.soft { color: var(--text-soft); }
    .plain:hover { text-decoration: underline; }
  `,
})
export class PerformanceReportComponent {
  protected readonly store = inject(AdminStore);

  protected readonly formatNumber = formatNumber;
  protected readonly formatMoney = formatMoney;
  protected readonly formatMoneyShort = formatMoneyShort;
  readonly moneyShort = (v: number) => formatMoneyShort(Math.round(v));
  readonly percent = (v: number) => `${Math.round(v)}%`;
  readonly number = (v: number) => formatNumber(Math.round(v));

  readonly presets: { id: Preset; label: string }[] = [
    { id: 'today', label: 'Today' }, { id: '7', label: 'Last 7 days' }, { id: '14', label: 'Last 14 days' },
  ];
  readonly preset = signal<Preset>('7');
  private readonly today = computed(() => startOfDay(this.store.now()));
  readonly from = signal<Date>(addDays(startOfDay(new Date()), -6));
  readonly to = signal<Date>(startOfDay(new Date()));

  readonly fromValue = computed(() => toDateInput(this.from()));
  readonly toValue = computed(() => toDateInput(this.to()));
  readonly rangeLabel = computed(() => (sameDay(this.from(), this.to()) ? formatDate(this.from()) : `${formatDate(this.from())} to ${formatDate(this.to())}`));
  readonly scopeName = computed(() => this.store.scopedTheatres().length === 1 ? this.store.scopedTheatres()[0]!.name : 'All theatres');

  choose(p: Preset): void {
    this.preset.set(p);
    const t = this.today();
    this.to.set(t);
    this.from.set(p === 'today' ? t : addDays(t, p === '7' ? -6 : -13));
  }
  setFrom(v: string): void { if (v) { this.from.set(fromDateInput(v)); this.preset.set('custom'); if (this.from() > this.to()) this.to.set(this.from()); } }
  setTo(v: string): void { if (v) { this.to.set(fromDateInput(v)); this.preset.set('custom'); if (this.to() < this.from()) this.from.set(this.to()); } }

  readonly days = computed(() => {
    const out: Date[] = [];
    for (let d = this.from(); d <= this.to() && out.length < 92; d = addDays(d, 1)) out.push(d);
    return out;
  });

  private readonly inRange = computed(() => {
    const start = this.from().getTime();
    const end = addDays(this.to(), 1).getTime();
    return this.store.scopedShows().filter((s) => s.start.getTime() >= start && s.start.getTime() < end);
  });

  /** Published, not cancelled, already started. */
  private readonly ran = computed(() => {
    const now = this.store.now();
    return this.inRange().filter((s) => !s.cancellation && s.publication === 'published' && s.start <= now);
  });

  private add(agg: Agg, s: Show): void {
    if (s.cancellation) { agg.cancelled++; return; }
    agg.shows++;
    agg.seats += this.store.soldSeats(s.id);
    agg.capacity += this.store.capacity(s.screenId);
    agg.gross += this.store.revenue(s.id);
  }

  private readonly counted = computed(() => [...this.ran(), ...this.inRange().filter((s) => s.cancellation)]);

  readonly totals = computed(() => {
    const agg = emptyAgg();
    for (const s of this.counted()) this.add(agg, s);
    return agg;
  });

  readonly refunds = computed(() => {
    const start = this.from().getTime();
    const end = addDays(this.to(), 1).getTime();
    const done = this.store.scopedRefunds().filter((r) => r.status === 'successful' && r.updatedAt.getTime() >= start && r.updatedAt.getTime() < end);
    return { count: done.length, amount: done.reduce((n, r) => n + r.amount, 0) };
  });

  readonly daily = computed<BarDatum[]>(() => {
    const ran = this.ran();
    return this.days().map((d) => {
      const shows = ran.filter((s) => sameDay(s.start, d));
      return { label: this.days().length > 10 ? String(d.getDate()) : formatDay(d).replace(',', ''), value: shows.reduce((n, s) => n + this.store.revenue(s.id), 0), sub: `${shows.length} shows` };
    });
  });

  readonly byScreen = computed<BarDatum[]>(() => {
    const map = new Map<string, Agg>();
    for (const s of this.ran()) {
      const a = map.get(s.screenId) ?? emptyAgg();
      this.add(a, s);
      map.set(s.screenId, a);
    }
    const multi = this.store.scopedTheatres().length > 1;
    return [...map.entries()]
      .map(([id, a]) => {
        const sc = this.store.screen(id);
        return { label: sc?.name ?? 'Screen', sub: multi ? this.store.theatre(sc?.theatreId ?? '')?.name : undefined, value: a.capacity ? (a.seats / a.capacity) * 100 : 0 };
      })
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  });

  readonly topFilms = computed<BarDatum[]>(() => {
    const map = new Map<string, number>();
    for (const s of this.ran()) map.set(s.movieId, (map.get(s.movieId) ?? 0) + this.store.soldSeats(s.id));
    return [...map.entries()]
      .map(([id, v]) => ({ label: this.store.movie(id)?.title ?? 'Film', value: v }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  });

  readonly breakdown = computed(() => {
    const byTheatre = new Map<string, { agg: Agg; screens: Map<string, Agg> }>();
    for (const s of this.counted()) {
      const t = byTheatre.get(s.theatreId) ?? { agg: emptyAgg(), screens: new Map<string, Agg>() };
      this.add(t.agg, s);
      const sa = t.screens.get(s.screenId) ?? emptyAgg();
      this.add(sa, s);
      t.screens.set(s.screenId, sa);
      byTheatre.set(s.theatreId, t);
    }
    return [...byTheatre.entries()]
      .map(([id, t]) => ({
        id, name: this.store.theatre(id)?.name ?? 'Theatre', agg: t.agg,
        screens: [...t.screens.entries()].map(([sid, agg]) => ({ id: sid, name: this.store.screen(sid)?.name ?? 'Screen', number: this.store.screen(sid)?.number ?? 0, agg })).sort((a, b) => a.number - b.number),
      }))
      .sort((a, b) => b.agg.gross - a.agg.gross);
  });

  ratio(a: Agg): number { return a.capacity ? a.seats / a.capacity : 0; }
  pct(n: number, d: number): number { return d ? Math.round((n / d) * 100) : 0; }
}
