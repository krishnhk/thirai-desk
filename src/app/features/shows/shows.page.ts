import { ChangeDetectionStrategy, Component, HostListener, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { AdminStore } from '../../core/admin-store';
import { addDays, formatDay, formatTime, fromDateInput, toDateInput } from '../../core/format';
import { Movie, Screen, Show, ShowStatus, Theatre } from '../../core/models';
import { IconComponent } from '../../shared/icon.component';
import { tableState } from '../../shared/table';
import { EmptyStateComponent, MeterComponent, PageHeaderComponent, PaginatorComponent, SkeletonComponent, SortHeaderComponent } from '../../shared/ui';
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
}

type StateFilter = '' | 'draft' | 'onsale' | 'running' | 'completed' | 'cancelled';

const STATE_ORDER = ['draft', 'scheduled', 'running', 'completed', 'cancelled'];

/** Shows: every show in scope with compact filters; drafts and the schedule timeline are their own tabs. */
@Component({
  selector: 'app-shows-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent, PageHeaderComponent, EmptyStateComponent, SkeletonComponent, PaginatorComponent, MeterComponent, SortHeaderComponent, DraftsPanelComponent, CalendarViewComponent, CancelledPanelComponent],
  template: `
    <div class="page">
      <app-page-header title="Shows">
        <a class="btn primary" routerLink="/shows/new"><app-icon name="plus" />Create show</a>
      </app-page-header>

      <section class="card">
        <div class="tabs" role="tablist" aria-label="Show lists">
          <button class="tab" type="button" role="tab" [attr.aria-selected]="!drafts() && !timeline() && !cancelled()" (click)="setTab(null)">All shows</button>
          <button class="tab" type="button" role="tab" [attr.aria-selected]="drafts()" (click)="setTab('drafts')">
            Drafts <span class="count-pill">{{ draftCount() }}</span>
          </button>
          <button class="tab" type="button" role="tab" [attr.aria-selected]="timeline()" (click)="setTab('timeline')">Timeline</button>
          <button class="tab" type="button" role="tab" [attr.aria-selected]="cancelled()" (click)="setTab('cancelled')">Cancelled <span class="count-pill">{{ cancelledCount() }}</span></button>
        </div>

        @if (drafts()) {
          <app-drafts-panel />
        } @else if (cancelled()) {
          <app-cancelled-panel />
        } @else if (timeline()) {
          <app-calendar-view />
        } @else {
          <div class="bar">
            <div class="search-input grow">
              <app-icon name="search" />
              <input class="input" type="search" aria-label="Search shows" placeholder="Search film or screen" [value]="query()" (input)="set(query, $any($event.target).value)" />
            </div>
            @if (store.scopedTheatres().length > 1) {
              <select class="select" aria-label="Theatre" [value]="theatreId()" (change)="setTheatre($any($event.target).value)">
                <option value="">All theatres</option>
                @for (t of store.scopedTheatres(); track t.id) { <option [value]="t.id" [selected]="t.id === theatreId()">{{ t.name }}</option> }
              </select>
            }
            <select class="select" aria-label="Screen" [value]="screenId()" (change)="set(screenId, $any($event.target).value)">
              <option value="">All screens</option>
              @for (s of screenOptions(); track s.id) { <option [value]="s.id" [selected]="s.id === screenId()">{{ s.name }}{{ theatreId() || store.scopedTheatres().length === 1 ? '' : ' · ' + (store.theatre(s.theatreId)?.code ?? '') }}</option> }
            </select>
            <select class="select" aria-label="Film" [value]="movieId()" (change)="set(movieId, $any($event.target).value)">
              <option value="">All films</option>
              @for (m of movieOptions(); track m.id) { <option [value]="m.id" [selected]="m.id === movieId()">{{ m.title }}</option> }
            </select>
            <select class="select" aria-label="Status" [value]="state()" (change)="set(state, $any($event.target).value)">
              <option value="">Any status</option>
              <option value="onsale">On sale</option>
              <option value="running">Running</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
              <option value="draft">Draft</option>
            </select>
            <select class="select" aria-label="Dates" [value]="rangeMode()" (change)="setRange($any($event.target).value)">
              <option value="today">Today</option>
              <option value="week">Next 7 days</option>
              <option value="month">Next 30 days</option>
              <option value="all">All dates</option>
              <option value="custom">Choose dates…</option>
            </select>
            @if (rangeMode() === 'custom') {
              <div class="range" role="group" aria-label="Custom dates">
                <input class="input" type="date" aria-label="From" [value]="from()" (change)="set(from, $any($event.target).value)" />
                <span class="to" aria-hidden="true">–</span>
                <input class="input" type="date" aria-label="To" [value]="to()" [min]="from()" (change)="set(to, $any($event.target).value)" />
              </div>
            }
            @if (filtersChanged()) { <button class="btn ghost" type="button" (click)="resetFilters()">Reset</button> }
          </div>

          <p class="stats"><span><b>{{ table.total() }}</b> {{ table.total() === 1 ? 'show' : 'shows' }}</span></p>

          @if (store.loading()) {
            <app-skeleton [rows]="8" />
          } @else if (!table.total()) {
            <app-empty-state icon="shows" title="No shows match these filters" text="Widen the date range or clear a filter to see more shows.">
              @if (filtersChanged()) { <button class="btn" type="button" (click)="resetFilters()">Reset filters</button> }
              <a class="btn primary" routerLink="/shows/new"><app-icon name="plus" />Create show</a>
            </app-empty-state>
          } @else {
            <div class="table-wrap">
              <table class="data-table">
                <thead>
                  <tr>
                    <th><app-sort-header [active]="table.isSorted('film')" [dir]="table.dir()" (toggle)="table.sortBy('film')">Film</app-sort-header></th>
                    <th><app-sort-header [active]="table.isSorted('screen')" [dir]="table.dir()" (toggle)="table.sortBy('screen')">Screen</app-sort-header></th>
                    <th><app-sort-header [active]="table.isSorted('start')" [dir]="table.dir()" (toggle)="table.sortBy('start')">When</app-sort-header></th>
                    <th class="num col-price"><app-sort-header [active]="table.isSorted('price')" [dir]="table.dir()" (toggle)="table.sortBy('price')">Price</app-sort-header></th>
                    <th class="col-sold"><app-sort-header [active]="table.isSorted('occupancy')" [dir]="table.dir()" (toggle)="table.sortBy('occupancy')">Sold</app-sort-header></th>
                    <th><app-sort-header [active]="table.isSorted('status')" [dir]="table.dir()" (toggle)="table.sortBy('status')">Status</app-sort-header></th>
                    <th class="actions-col"><span class="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  @for (r of table.rows(); track r.show.id) {
                    <tr class="clickable" (click)="open(r.show, $event)">
                      <td>
                        <div class="cell-title">
                          <img class="poster-thumb" [src]="r.movie?.posterUrl ?? ''" alt="" loading="lazy" />
                          <span class="min0">
                            <a class="title-link" [routerLink]="['/shows', r.show.id]"><strong class="truncate">{{ r.movie?.title }}</strong></a>
                            <small class="truncate">{{ r.show.format }} · {{ r.show.language }}</small>
                          </span>
                        </div>
                      </td>
                      <td>
                        <span class="two"><strong>{{ r.screen?.name }}</strong>@if (store.scopedTheatres().length > 1) { <small>{{ r.theatre?.name }}</small> }</span>
                      </td>
                      <td>
                        <span class="two"><strong>{{ time(r.show.start) }} <span class="muted dash">– {{ time(r.end) }}</span></strong><small>{{ day(r.show.start) }}</small></span>
                      </td>
                      <td class="num col-price">{{ r.price }}</td>
                      <td class="col-sold">
                        @if (r.show.publication === 'draft' || r.status === 'cancelled') { <span class="muted">—</span> }
                        @else { <span class="sold"><span class="n">{{ r.bookings }}</span><app-meter [value]="r.occupancy" /></span> }
                      </td>
                      <td>
                        @switch (stateOf(r)) {
                          @case ('draft') { <span class="badge violet">Draft</span> }
                          @case ('running') { <span class="badge accent">Running</span> }
                          @case ('completed') { <span class="badge neutral">Completed</span> }
                          @case ('cancelled') { <span class="badge danger">Cancelled</span> }
                          @default { <span class="badge success">On sale</span> }
                        }
                      </td>
                      <td class="actions-col">
                        <div class="row-actions">
                          @if (r.show.publication === 'draft') { <button class="btn sm primary" type="button" (click)="actions.publish(r.show)">Publish</button> }
                          @if (hasMenu(r)) {
                            <button class="btn ghost sm icon" type="button" [attr.aria-label]="'More actions for ' + (r.movie?.title ?? 'show')" [attr.aria-expanded]="menuFor() === r.show.id" (click)="toggleMenu(r.show.id, $event)"><app-icon name="more" /></button>
                            @if (menuFor() === r.show.id) {
                              <div class="menu" role="menu" [style.top.px]="menuPos().top" [style.bottom.px]="menuPos().bottom" [style.right.px]="menuPos().right">
                                <a role="menuitem" [routerLink]="['/shows', r.show.id, 'edit']"><app-icon name="edit" />Edit show</a>
                                @if (r.show.publication === 'draft') {
                                  <button role="menuitem" type="button" (click)="menuFor.set(null); actions.duplicate(r.show)"><app-icon name="copy" />Duplicate</button>
                                  <button role="menuitem" type="button" class="danger" (click)="menuFor.set(null); actions.deleteDraft(r.show)"><app-icon name="trash" />Delete draft…</button>
                                } @else {
                                  <a role="menuitem" class="danger" [routerLink]="['/shows', r.show.id, 'cancel']"><app-icon name="cancel" />Cancel show…</a>
                                }
                              </div>
                            }
                          }
                        </div>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            @if (table.total() > table.size()) { <app-paginator [(page)]="table.page" [(pageSize)]="table.size" [total]="table.total()" /> }
          }
        }
      </section>
    </div>
  `,
  styles: `
    .bar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 14px 16px; }
    .bar .grow { flex: 1 1 240px; min-width: 200px; }
    .bar .select { flex: 0 1 auto; width: auto; min-width: 130px; max-width: 190px; }
    .bar .input, .bar .select { height: 36px; min-height: 36px; padding-top: 0; padding-bottom: 0; }
    .range { display: inline-flex; align-items: center; gap: 6px; }
    .range .input { width: 140px; }
    .to { color: var(--text-muted); }
    .stats { display: flex; flex-wrap: wrap; gap: 4px 20px; margin: 0; padding: 0 18px 12px; font-size: 0.84rem; color: var(--text-muted); border-bottom: 1px solid var(--border); }
    .stats b { color: var(--text); font-weight: 700; }
    .stats .bad b { color: var(--danger); }
    .table-wrap { position: relative; }
    .data-table td, .data-table th { padding-left: 12px; padding-right: 12px; }
    .data-table td { white-space: nowrap; }
    .cell-title { min-width: 200px; }
    .min0 { min-width: 0; }
    .cell-title .truncate { display: block; max-width: 210px; }
    .title-link { color: inherit; }
    .title-link:hover strong { color: var(--accent); }
    .two { display: flex; flex-direction: column; gap: 1px; }
    .two small, .cell-title small { color: var(--text-muted); font-size: 0.76rem; }
    .dash { font-weight: 500; }
    .sold { display: inline-flex; align-items: center; gap: 10px; }
    .sold .n { min-width: 26px; text-align: right; font-variant-numeric: tabular-nums; }
    .row-actions { display: inline-flex; align-items: center; justify-content: flex-end; gap: 6px; }
    .menu { position: fixed; z-index: 60; min-width: 180px; padding: 5px; border: 1px solid var(--border-strong); border-radius: var(--radius); background: var(--surface-2); box-shadow: var(--shadow); text-align: left; }
    .menu a, .menu button { display: flex; align-items: center; gap: 9px; width: 100%; padding: 7px 10px; border: 0; border-radius: var(--radius-sm); background: none; color: var(--text-soft); font-size: 0.84rem; font-weight: 600; text-decoration: none; }
    .menu a:hover, .menu button:hover { background: var(--surface-3); color: var(--text); }
    .menu app-icon { width: 15px; height: 15px; color: var(--text-muted); }
    .menu .danger, .menu .danger app-icon { color: var(--danger); }
    /* Narrower than the table needs: each show becomes a card, with its status and actions in reach. */
    @media (max-width: 1180px) {
      .data-table, .data-table tbody, .data-table tr, .data-table td { display: block; }
      .data-table thead, .data-table td.col-price { display: none; }
      .data-table tr { display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: 12px; row-gap: 4px; padding: 14px 16px; border-bottom: 1px solid var(--border-soft); }
      .data-table td { padding: 0; border: 0; white-space: normal; }
      .data-table td:nth-child(1) { grid-column: 1; grid-row: 1; }
      .data-table td:nth-child(2) { grid-column: 1; grid-row: 2; }
      .data-table td:nth-child(3) { grid-column: 1; grid-row: 3; }
      .data-table td.col-sold { grid-column: 1; grid-row: 4; margin-top: 2px; }
      .data-table td:nth-child(6) { grid-column: 2; grid-row: 1; justify-self: end; }
      .data-table td.actions-col { grid-column: 2; grid-row: 2 / span 2; justify-self: end; align-self: start; width: auto; }
      .data-table td:nth-child(2) .two { flex-direction: row; align-items: baseline; gap: 8px; }
      .cell-title { min-width: 0; }
      .cell-title .truncate { max-width: none; }
    }
    @media (max-width: 760px) {
      .col-sold { display: none; }
      .range { flex: 1 1 100%; }
      .range .input { flex: 1; width: auto; }
      .bar .select { flex: 1 1 130px; max-width: none; }
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
  protected readonly rangeMode = signal<'today' | 'week' | 'month' | 'all' | 'custom'>('week');

  protected readonly query = signal('');
  protected readonly theatreId = signal('');
  protected readonly screenId = signal('');
  protected readonly movieId = signal('');
  protected readonly from = signal(this.defaultFrom);
  protected readonly to = signal(this.defaultTo);
  protected readonly state = signal<StateFilter>('');

  protected readonly menuFor = signal<string | null>(null);
  protected readonly menuPos = signal<{ top: number | null; bottom: number | null; right: number }>({ top: 0, bottom: null, right: 0 });

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
    this.rangeMode.set(mode as 'today' | 'week' | 'month' | 'all' | 'custom');
    if (mode === 'today') { this.from.set(toDateInput(today)); this.to.set(toDateInput(today)); }
    else if (mode === 'week') { this.from.set(toDateInput(today)); this.to.set(toDateInput(addDays(today, 6))); }
    else if (mode === 'month') { this.from.set(toDateInput(today)); this.to.set(toDateInput(addDays(today, 29))); }
    else if (mode === 'all') { this.from.set(''); this.to.set(''); }
    this.table.reset();
  }

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

  /** Edit is possible for drafts and shows that have not started. */
  protected hasMenu(r: Row): boolean { return r.show.publication === 'draft' || r.status === 'scheduled'; }

  protected toggleMenu(id: string, event: Event): void {
    event.stopPropagation();
    if (this.menuFor() === id) { this.menuFor.set(null); return; }
    const r = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const right = Math.max(8, window.innerWidth - r.right);
    this.menuPos.set(r.bottom + 150 > window.innerHeight ? { top: null, bottom: window.innerHeight - r.top + 4, right } : { top: r.bottom + 4, bottom: null, right });
    this.menuFor.set(id);
  }

  @HostListener('document:click')
  @HostListener('window:resize')
  @HostListener('document:keydown.escape')
  closeMenu(): void { this.menuFor.set(null); }

  protected open(show: Show, event: MouseEvent): void {
    if ((event.target as HTMLElement).closest('a, button, .menu')) return;
    void this.router.navigate(['/shows', show.id]);
  }

  protected day(d: Date): string { return formatDay(d); }
  protected time(d: Date): string { return formatTime(d); }
}

function matches(filter: StateFilter, show: Show, status: ShowStatus): boolean {
  if (filter === 'draft') return show.publication === 'draft';
  if (show.publication === 'draft') return false;
  return filter === 'onsale' ? status === 'scheduled' : status === filter;
}
