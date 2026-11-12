import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { AdminStore } from '../../core/admin-store';
import { addDays, formatDay, formatMoney, formatTime, fromDateInput, toDateInput } from '../../core/format';
import { Movie, Screen, Show, ShowStatus, Theatre } from '../../core/models';
import { IconComponent } from '../../shared/icon.component';
import { tableState } from '../../shared/table';
import { EmptyStateComponent, PaginatorComponent, SkeletonComponent } from '../../shared/ui';
import { CalendarViewComponent } from '../calendar/calendar.page';
import { CancelledPanelComponent } from './cancelled-panel.component';
import { DraftsPanelComponent } from './drafts-panel.component';
import { ShowActions, minPrice, priceRange } from './show-utils';

interface Row {
  show: Show;
  movie: Movie | undefined;
  theatre: Theatre | undefined;
  screen: Screen | undefined;
  end: Date;
  status: ShowStatus;
  bookings: number;
  occupancy: number;
  price: string;
  minPrice: number;
  sold: number;
  capacity: number;
}

type StateFilter = '' | 'draft' | 'onsale' | 'running' | 'completed' | 'cancelled';

const STATE_ORDER = ['draft', 'scheduled', 'running', 'completed', 'cancelled'];

/** Shows: every show in scope with compact filters; drafts and the schedule timeline are their own tabs. */
@Component({
  selector: 'app-shows-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent, EmptyStateComponent, SkeletonComponent, PaginatorComponent, DraftsPanelComponent, CalendarViewComponent, CancelledPanelComponent],
  template: `
    <div class="page">
      <header class="head">
        <div class="head-text">
          <h1>Showtimes</h1>
          <p>{{ scopeName() }} · {{ table.total() }} {{ table.total() === 1 ? 'show' : 'shows' }} · {{ seatsSold() }} of {{ seatsTotal() }} seats sold</p>
        </div>
        <a class="btn primary schedule" routerLink="/shows/new"><app-icon name="plus" />Schedule show</a>
      </header>

      <div class="tabs" role="tablist" aria-label="Show lists">
          <button class="tab" type="button" role="tab" [attr.aria-selected]="!drafts() && !timeline() && !cancelled()" (click)="setTab(null)">All shows</button>
          <button class="tab" type="button" role="tab" [attr.aria-selected]="drafts()" (click)="setTab('drafts')">
            Drafts <span class="count-pill">{{ draftCount() }}</span>
          </button>
          <button class="tab" type="button" role="tab" [attr.aria-selected]="timeline()" (click)="setTab('timeline')">Timeline</button>
          <button class="tab" type="button" role="tab" [attr.aria-selected]="cancelled()" (click)="setTab('cancelled')">Cancelled <span class="count-pill">{{ cancelledCount() }}</span></button>
        </div>

      @if (!drafts() && !timeline() && !cancelled()) {
        <section class="card filters" aria-label="Filters">
          <div class="filter-grid" [class.with-theatre]="store.scopedTheatres().length > 1">
            <div class="field">
              <label for="f-from">From</label>
              <input id="f-from" class="input" type="date" [value]="from()" (change)="setDates('from', $any($event.target).value)" />
            </div>
            <div class="field">
              <label for="f-to">To</label>
              <input id="f-to" class="input" type="date" [value]="to()" [min]="from()" (change)="setDates('to', $any($event.target).value)" />
            </div>
            @if (store.scopedTheatres().length > 1) {
              <div class="field">
                <label for="f-theatre">Theatre</label>
                <select id="f-theatre" class="select" (change)="setTheatre($any($event.target).value)">
                  <option value="">All theatres</option>
                  @for (t of store.scopedTheatres(); track t.id) { <option [value]="t.id" [selected]="t.id === theatreId()">{{ t.name }}</option> }
                </select>
              </div>
            }
            <div class="field">
              <label for="f-screen">Screen</label>
              <select id="f-screen" class="select" (change)="set(screenId, $any($event.target).value)">
                <option value="">All screens</option>
                @for (s of screenOptions(); track s.id) { <option [value]="s.id" [selected]="s.id === screenId()">{{ s.name }}{{ theatreId() || store.scopedTheatres().length === 1 ? '' : ' · ' + (store.theatre(s.theatreId)?.code ?? '') }}</option> }
              </select>
            </div>
            <div class="field">
              <label for="f-movie">Movie</label>
              <select id="f-movie" class="select" (change)="set(movieId, $any($event.target).value)">
                <option value="">All movies</option>
                @for (m of movieOptions(); track m.id) { <option [value]="m.id" [selected]="m.id === movieId()">{{ m.title }}</option> }
              </select>
            </div>
            <div class="field">
              <label for="f-status">Status</label>
              <select id="f-status" class="select" (change)="set(state, $any($event.target).value)">
                <option value="" [selected]="!state()">All</option>
                <option value="onsale" [selected]="state() === 'onsale'">On sale</option>
                <option value="running" [selected]="state() === 'running'">Running</option>
                <option value="completed" [selected]="state() === 'completed'">Completed</option>
                <option value="cancelled" [selected]="state() === 'cancelled'">Cancelled</option>
                <option value="draft" [selected]="state() === 'draft'">Draft</option>
              </select>
            </div>
          </div>
          <div class="chip-row">
            <div class="chips" role="group" aria-label="Date range">
              <button type="button" class="chip" [attr.aria-pressed]="rangeMode() === 'today'" (click)="setRange('today')">Today</button>
              <button type="button" class="chip" [attr.aria-pressed]="rangeMode() === 'week'" (click)="setRange('week')">Next 7 days</button>
              <button type="button" class="chip" [attr.aria-pressed]="rangeMode() === 'fortnight'" (click)="setRange('fortnight')">Next 14 days</button>
              <button type="button" class="chip" [attr.aria-pressed]="rangeMode() === 'past'" (click)="setRange('past')">Past 30 days</button>
              @if (filtersChanged()) { <button type="button" class="link-btn reset" (click)="resetFilters()">Reset</button> }
            </div>
            <div class="segmented" role="group" aria-label="View">
              <button type="button" aria-pressed="true"><app-icon name="list" />List</button>
              <button type="button" aria-pressed="false" (click)="setTab('timeline')"><app-icon name="calendar" />Calendar</button>
            </div>
          </div>
        </section>
      }

      <section class="results" [class.card]="drafts() || cancelled() || timeline()">

        @if (drafts()) {
          <app-drafts-panel />
        } @else if (cancelled()) {
          <app-cancelled-panel />
        } @else if (timeline()) {
          <app-calendar-view />
        } @else {
          @if (store.loading()) {
            <div class="card"><app-skeleton [rows]="8" /></div>
          } @else if (!table.total()) {
            <app-empty-state class="card" icon="shows" title="No shows match these filters" text="Widen the date range or clear a filter to see more shows.">
              @if (filtersChanged()) { <button class="btn" type="button" (click)="resetFilters()">Reset filters</button> }
              <a class="btn primary" routerLink="/shows/new"><app-icon name="plus" />Create show</a>
            </app-empty-state>
          } @else {
            @for (g of groups(); track g.key) {
            <section class="card day">
              @if (g.label) {
                <div class="group-head">
                  <strong>{{ g.label }}</strong>
                  <span class="group-meta">{{ g.count }} {{ g.count === 1 ? 'show' : 'shows' }} · {{ g.sold }}/{{ g.capacity }} sold</span>
                  <a class="group-add" [routerLink]="['/shows/new']" [queryParams]="{ date: g.key }"><app-icon name="plus" />Add</a>
                </div>
              }
            <div class="rows">
                  @for (r of g.rows; track r.show.id) {
                    <div class="item" (click)="open(r.show, $event)">
                      <span class="t">{{ time(r.show.start) }}</span>
                      <div class="what">
                        <a class="title-link" [routerLink]="['/shows', r.show.id]"><strong class="truncate">{{ r.movie?.title }}</strong></a>
                        <small class="truncate">{{ r.screen?.name }}@if (store.scopedTheatres().length > 1) { · {{ r.theatre?.name }} } · {{ r.show.language }} · {{ r.show.format }} · from {{ money(r.minPrice) }}</small>
                      </div>
                      <div class="fill">
                        @if (r.show.publication === 'draft' || r.status === 'cancelled') {
                          <span class="muted">—</span>
                        } @else {
                          <span class="track"><span class="bar" [style.width.%]="r.capacity ? (r.sold / r.capacity) * 100 : 0"></span></span>
                          <small>{{ r.sold }}/{{ r.capacity }} · {{ r.capacity - r.sold }} left</small>
                        }
                      </div>
                      <span class="state">
                        @switch (stateOf(r)) {
                          @case ('draft') { <span class="badge violet">Draft</span> }
                          @case ('running') { <span class="badge accent">Running</span> }
                          @case ('completed') { <span class="badge neutral">Played</span> }
                          @case ('cancelled') { <span class="badge danger">Cancelled</span> }
                          @default { <span class="badge success">On sale</span> }
                        }
                      </span>
                        <div class="row-actions">
                          @if (r.show.publication === 'draft') { <button class="btn sm primary" type="button" (click)="actions.publish(r.show)">Publish</button> }
                        </div>
                    </div>
                  }
            </div>
          </section>
          }
            @if (table.total() > table.size()) { <app-paginator [(page)]="table.page" [(pageSize)]="table.size" [total]="table.total()" /> }
          }
        }
      </section>
    </div>
  `,
  styles: `
    .tabs { padding: 0 4px; }
    .data-table thead { display: none; }
    .results { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
    .results.card { display: block; }
    .day { overflow: hidden; }
    .group-head { padding: 14px 20px; background: var(--surface-2); border-bottom: 1px solid var(--border); }
    .group-head { display: flex; align-items: baseline; gap: 12px; }
    .group-head strong { font-size: 1.05rem; color: var(--text); }
    .group-meta { color: var(--text-muted); font-size: 0.9rem; }
    .group-add { display: inline-flex; align-items: center; gap: 8px; align-self: center; margin-left: auto; font-weight: 600; font-size: 0.95rem; color: var(--text); }
    .group-add:hover { color: var(--accent); }
    .group-add app-icon { width: 18px; height: 18px; }
    .head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px 20px; padding-top: 8px; }
    .head h1 { font-size: 2rem; line-height: 1.15; }
    .head p { margin-top: 6px; font-size: 1rem; color: var(--text-muted); }
    .schedule { min-height: 48px; padding: 0 22px; font-size: 1rem; }
    .schedule app-icon { width: 20px; height: 20px; }
    .filters { display: flex; flex-direction: column; align-items: stretch; justify-content: flex-start; gap: 16px; width: 100%; padding: 16px 18px; }
    .filter-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 14px; width: 100%; }
    .filter-grid.with-theatre { grid-template-columns: repeat(6, minmax(0, 1fr)); }
    @media (max-width: 1100px) { .filter-grid, .filter-grid.with-theatre { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
    @media (max-width: 640px) { .filter-grid, .filter-grid.with-theatre { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    .filters .field { gap: 6px; }
    .filters .field > label { font-size: 0.82rem; font-weight: 600; color: var(--text); }
    .filters .input, .filters .select { min-height: 40px; padding: 6px 12px; font-size: 0.9rem; border-radius: 8px; }
    .chip-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px 16px; width: 100%; }
    .chips { display: flex; flex: 0 1 auto; flex-wrap: wrap; align-items: center; justify-content: flex-start; gap: 8px; }
    .chip { min-height: 32px; padding: 0 14px; border: 1px solid var(--border-strong); border-radius: 999px; background: var(--surface); color: var(--text); font-size: 0.85rem; }
    .chip:hover { background: var(--surface-2); }
    .chip[aria-pressed='true'] { border-color: var(--accent); background: var(--accent-soft); }
    .reset { margin-left: 4px; font-size: 0.85rem; }
    .chip-row .segmented button { display: inline-flex; align-items: center; gap: 8px; padding: 0 14px; min-height: 32px; font-size: 0.85rem; }
    .chip-row .segmented app-icon { width: 16px; height: 16px; }
    .rows { display: flex; flex-direction: column; }
    .item { display: grid; grid-template-columns: 104px minmax(0, 1.4fr) minmax(180px, 1fr) 100px 96px; align-items: center; gap: 16px; padding: 16px 20px; background: var(--surface); border-bottom: 1px solid var(--border-soft); cursor: pointer; }
    .item:last-child { border-bottom: 0; }
    .item:hover { background: var(--surface-hover); }
    .t { font-size: 1rem; font-weight: 700; white-space: nowrap; }
    .what { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
    .what strong { display: block; font-size: 1rem; }
    .what small { color: var(--text-muted); font-size: 0.85rem; }
    .title-link { color: inherit; }
    .title-link:hover strong { color: var(--accent); }
    .fill { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
    .track { display: block; height: 8px; border-radius: 999px; background: var(--surface-3); overflow: hidden; }
    .bar { display: block; height: 100%; border-radius: 999px; background: var(--accent); }
    .fill small { font-size: 0.85rem; color: var(--text); }
    .state { display: flex; align-items: center; }
    .item .row-actions { justify-content: flex-end; min-height: 32px; }
    .row-actions { display: inline-flex; align-items: center; justify-content: flex-end; gap: 6px; }
    @media (max-width: 900px) {
      .item { grid-template-columns: minmax(0, 1fr) auto; row-gap: 8px; }
      .t { grid-column: 1; }
      .what { grid-column: 1; }
      .fill { grid-column: 1; }
      .state { grid-column: 2; grid-row: 1; justify-self: end; }
      .item .row-actions { grid-column: 2; grid-row: 2 / span 2; align-self: start; }
    }
  `,
})
export class ShowsPage {
  protected readonly store = inject(AdminStore);
  protected readonly actions = inject(ShowActions);
  private readonly router = inject(Router);

  /** `?tab=drafts` or `?tab=timeline` from the URL. */
  readonly tab = input<string>();
  protected readonly drafts = computed(() => this.tab() === 'drafts');
  protected readonly timeline = computed(() => this.tab() === 'timeline');
  protected readonly cancelled = computed(() => this.tab() === 'cancelled');
  protected readonly cancelledCount = computed(() => this.store.scopedShows().filter((s) => !!s.cancellation).length);

  private readonly defaultFrom = toDateInput(this.store.operationalDate());
  private readonly defaultTo = toDateInput(addDays(this.store.operationalDate(), 6));
  /** The date choice shown in the filter; the From and To boxes only appear for a custom range. */
  protected readonly rangeMode = signal<'today' | 'week' | 'fortnight' | 'past' | 'custom'>('week');

  protected readonly query = signal('');
  protected readonly theatreId = signal('');
  protected readonly screenId = signal('');
  protected readonly movieId = signal('');
  protected readonly from = signal(this.defaultFrom);
  protected readonly to = signal(this.defaultTo);
  protected readonly state = signal<StateFilter>('');


  constructor() {
    // Follow the header's theatre selector: a single theatre in scope becomes the filter.
    effect(() => {
      const scoped = this.store.scopedTheatres();
      untracked(() => {
        const only = scoped.length === 1 ? scoped[0]!.id : '';
        if (only || !scoped.some((t) => t.id === this.theatreId())) this.setTheatre(only);
      });
    });
  }

  protected readonly draftCount = computed(() => this.store.scopedShows().filter((s) => s.publication === 'draft' && !s.cancellation).length);

  protected readonly screenOptions = computed(() => {
    const t = this.theatreId();
    return this.store.scopedScreens().filter((s) => !t || s.theatreId === t).sort((a, b) => a.theatreId.localeCompare(b.theatreId) || a.number - b.number);
  });

  /** Films that have shows in scope, so the list stays short. */
  protected readonly movieOptions = computed(() => {
    const ids = new Set(this.store.scopedShows().map((s) => s.movieId));
    return this.store.movies().filter((m) => ids.has(m.id)).sort((a, b) => a.title.localeCompare(b.title));
  });

  private readonly rows = computed<Row[]>(() => {
    const q = this.query().trim().toLowerCase();
    const t = this.theatreId(), sc = this.screenId(), m = this.movieId(), st = this.state();
    const from = this.from() ? fromDateInput(this.from()).getTime() : -Infinity;
    const to = this.to() ? addDays(fromDateInput(this.to()), 1).getTime() : Infinity;
    const out: Row[] = [];
    for (const show of this.store.scopedShows()) {
      const time = show.start.getTime();
      if (time < from || time >= to) continue;
      if ((t && show.theatreId !== t) || (sc && show.screenId !== sc) || (m && show.movieId !== m)) continue;
      const status = this.store.showStatus(show);
      if (st && !matches(st, show, status)) continue;
      const movie = this.store.movie(show.movieId);
      const theatre = this.store.theatre(show.theatreId);
      const screen = this.store.screen(show.screenId);
      if (q && ![movie?.title, theatre?.name, screen?.name, show.id].some((x) => x?.toLowerCase().includes(q))) continue;
      out.push({
        show, movie, theatre, screen, status,
        end: this.store.showEnd(show),
        bookings: this.store.confirmedBookingsOf(show.id).length,
        occupancy: this.store.occupancy(show),
        price: priceRange(show.prices),
        minPrice: minPrice(show.prices),
        sold: this.store.soldSeats(show.id),
        capacity: this.store.capacity(show.screenId),
      });
    }
    return out;
  });

  protected readonly table = tableState(this.rows, {
    film: (r) => r.movie?.title,
    screen: (r) => `${r.theatre?.name} ${r.screen?.number}`,
    start: (r) => r.show.start,
    price: (r) => r.minPrice,
    occupancy: (r) => r.occupancy,
    status: (r) => STATE_ORDER.indexOf(this.stateOf(r)),
  }, 'start', 'asc', 25);

  protected readonly filtersChanged = computed(() =>
    !!(this.query() || this.screenId() || this.movieId() || this.state()) ||
    this.from() !== this.defaultFrom || this.to() !== this.defaultTo ||
    (this.store.scopedTheatres().length > 1 && !!this.theatreId()));

  protected set<T>(target: { set(v: T): void }, value: T): void {
    target.set(value);
    this.table.reset();
  }

  protected setTheatre(id: string): void {
    this.theatreId.set(id);
    if (this.screenId() && !this.screenOptions().some((s) => s.id === this.screenId())) this.screenId.set('');
    this.table.reset();
  }

  protected setRange(mode: string): void {
    const today = this.store.operationalDate();
    this.rangeMode.set(mode as 'today' | 'week' | 'fortnight' | 'past' | 'custom');
    if (mode === 'today') { this.from.set(toDateInput(today)); this.to.set(toDateInput(today)); }
    else if (mode === 'week') { this.from.set(toDateInput(today)); this.to.set(toDateInput(addDays(today, 6))); }
    else if (mode === 'fortnight') { this.from.set(toDateInput(today)); this.to.set(toDateInput(addDays(today, 13))); }
    else if (mode === 'past') { this.from.set(toDateInput(addDays(today, -29))); this.to.set(toDateInput(today)); }
    this.table.reset();
  }

  protected setDates(which: 'from' | 'to', value: string): void {
    (which === 'from' ? this.from : this.to).set(value);
    this.rangeMode.set('custom');
    this.table.reset();
  }

  /**
   * The visible page of rows, split into one group per day while sorted by start time. Each group's
   * counts cover every filtered show of that day, not just the rows on this page.
   */
  protected readonly groups = computed(() => {
    const page = this.table.rows();
    if (!this.table.isSorted('start')) return [{ key: 'all', label: '', rows: page, count: 0, sold: 0, capacity: 0 }];
    const today = this.store.operationalDate();
    const totals = new Map<string, { count: number; sold: number; capacity: number }>();
    for (const r of this.rows()) {
      const t = totals.get(toDateInput(r.show.start)) ?? { count: 0, sold: 0, capacity: 0 };
      t.count++;
      if (r.show.publication !== 'draft' && r.status !== 'cancelled') {
        t.sold += this.store.soldSeats(r.show.id);
        t.capacity += this.store.capacity(r.show.screenId);
      }
      totals.set(toDateInput(r.show.start), t);
    }
    const out: { key: string; label: string; rows: Row[]; count: number; sold: number; capacity: number }[] = [];
    for (const r of page) {
      const key = toDateInput(r.show.start);
      let g = out[out.length - 1];
      if (g?.key !== key) {
        const diff = Math.round((fromDateInput(key).getTime() - fromDateInput(toDateInput(today)).getTime()) / 86_400_000);
        const prefix = diff === 0 ? 'Today · ' : diff === 1 ? 'Tomorrow · ' : diff === -1 ? 'Yesterday · ' : '';
        const t = totals.get(key)!;
        g = { key, label: prefix + formatDay(r.show.start), rows: [], count: t.count, sold: t.sold, capacity: t.capacity };
        out.push(g);
      }
      g.rows.push(r);
    }
    return out;
  });

  protected readonly scopeName = computed(() => {
    const scoped = this.store.scopedTheatres();
    return this.store.theatre(this.theatreId())?.name ?? (scoped.length === 1 ? scoped[0]!.name : 'All theatres');
  });
  private readonly seatStats = computed(() => {
    let sold = 0;
    let total = 0;
    for (const r of this.rows()) {
      if (r.show.publication === 'draft' || r.status === 'cancelled') continue;
      sold += this.store.soldSeats(r.show.id);
      total += this.store.capacity(r.show.screenId);
    }
    return { sold, total };
  });
  protected readonly seatsSold = computed(() => this.seatStats().sold.toLocaleString('en-IN'));
  protected readonly seatsTotal = computed(() => this.seatStats().total.toLocaleString('en-IN'));

  protected resetFilters(): void {
    this.rangeMode.set('week');
    this.query.set('');
    this.screenId.set('');
    this.movieId.set('');
    this.state.set('');
    this.from.set(this.defaultFrom);
    this.to.set(this.defaultTo);
    const scoped = this.store.scopedTheatres();
    this.theatreId.set(scoped.length === 1 ? scoped[0]!.id : '');
    this.table.reset();
  }

  protected setTab(tab: 'drafts' | 'timeline' | 'cancelled' | null): void {
    void this.router.navigate([], { queryParams: { tab }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  /** The one state a show is shown in: draft, or its run state. */
  protected stateOf(r: Row): string { return r.show.publication === 'draft' ? 'draft' : r.status; }

  protected open(show: Show, event: MouseEvent): void {
    if ((event.target as HTMLElement).closest('a, button, .menu')) return;
    void this.router.navigate(['/shows', show.id]);
  }

  protected day(d: Date): string { return formatDay(d); }
  protected time(d: Date): string { return formatTime(d).toLowerCase(); }
  protected money(n: number): string { return formatMoney(n); }
}

function matches(filter: StateFilter, show: Show, status: ShowStatus): boolean {
  if (filter === 'draft') return show.publication === 'draft';
  if (show.publication === 'draft') return false;
  return filter === 'onsale' ? status === 'scheduled' : status === filter;
}
