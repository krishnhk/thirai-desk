import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { ALL_THEATRES, AdminStore } from '../../core/admin-store';
import { formatDay, formatMoney, formatMoneyShort, formatNumber, formatTime, sameDay } from '../../core/format';
import { Show } from '../../core/models';
import { ActivityTimelineComponent, splitLink } from '../../shared/activity-timeline.component';
import { IconComponent } from '../../shared/icon.component';
import { EmptyStateComponent, MeterComponent, PageHeaderComponent, SkeletonComponent, StatusBadgeComponent } from '../../shared/ui';

type ScheduleFilter = 'all' | 'upcoming' | 'draft' | 'cancelled';

/**
 * The operational overview: the day's numbers, the schedule for the operational date, what needs
 * attention, quick actions and the latest activity. Follows the header's theatre and date.
 */
@Component({
  selector: 'app-overview-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, PageHeaderComponent, StatusBadgeComponent, EmptyStateComponent, SkeletonComponent, MeterComponent, IconComponent, ActivityTimelineComponent],
  template: `
    <div class="page">
      <app-page-header title="Overview" [subtitle]="subtitle()">
      </app-page-header>

      @if (store.loading()) {
        <div class="kpis">@for (i of [1,2,3,4,5,6,7,8]; track i) { <div class="skeleton kpi-sk"></div> }</div>
        <section class="card"><app-skeleton [rows]="8" /></section>
      } @else {
        <!-- The four numbers that tell you how the day is going. -->
        <div class="hero">
          <a class="tile rev" routerLink="/reports">
            <span class="eyebrow">Revenue {{ dayWord() }}</span>
            <b class="val">{{ kpi().revenue }}</b>
            <span class="hint">{{ kpi().bookings }} bookings · {{ formatNumber(kpi().seats) }} seats</span>
          </a>
          <a class="tile" routerLink="/shows" [queryParams]="{ tab: 'timeline' }">
            <span class="eyebrow">Occupancy</span>
            <b class="val">{{ kpi().occupancy }}%</b>
            <app-meter [value]="kpi().occupancy / 100" />
            <span class="hint">{{ formatNumber(kpi().seats) }} of {{ formatNumber(kpi().capacity) }} seats sold</span>
          </a>
          <a class="tile" routerLink="/shows" [queryParams]="{ tab: 'timeline' }">
            <span class="eyebrow">Shows {{ dayWord() }}</span>
            <b class="val">{{ kpi().scheduled }}</b>
            <span class="hint">{{ kpi().running }} running · {{ kpi().upcoming }} to start · {{ kpi().completed }} done</span>
          </a>
          <button type="button" class="tile attn" [class.danger]="attention() === 'danger'" [class.warning]="attention() === 'warning'" (click)="toAlerts()">
            <span class="eyebrow">Needs attention</span>
            <b class="val">{{ store.alerts().length }}</b>
            <span class="hint">{{ kpi().refunds }} refunds waiting · {{ kpi().refundAmount }}</span>
          </button>
        </div>

        <!-- Setup facts: useful to know, rarely the thing to act on, so one quiet line. -->
        <nav class="setup" aria-label="Setup at a glance">
          <a routerLink="/screens"><b>{{ kpi().screensActive }}</b> of {{ kpi().screens }} screens active</a>
          <a routerLink="/shows" [queryParams]="{ tab: 'drafts' }"><b>{{ kpi().draftsAll }}</b> upcoming drafts</a>
          <a routerLink="/shows"><b>{{ kpi().published }}</b> published {{ dayWord() }}</a>
          <a routerLink="/shows" [queryParams]="{ tab: 'cancelled' }" [class.hot]="kpi().cancelled > 0"><b>{{ kpi().cancelled }}</b> cancelled {{ dayWord() }}</a>
        </nav>

        <div class="board">
          <section class="card schedule">
            <div class="card-head">
              <div>
                <h2>Show schedule · {{ dayLabel() }}</h2>
                <p class="muted tiny">{{ dayShows().length }} shows</p>
              </div>
              <div class="segmented" role="group" aria-label="Filter the schedule">
                @for (f of filters; track f.id) {
                  <button type="button" [attr.aria-pressed]="filter() === f.id" (click)="filter.set(f.id)">{{ f.label }} <span class="muted">{{ counts()[f.id] }}</span></button>
                }
              </div>
            </div>
            @if (rows().length) {
              <div class="table-wrap scroll">
                <table class="data-table">
                  <thead>
                    <tr><th>Start</th><th>Film</th><th>Screen</th><th>Status</th><th>Seats sold</th></tr>
                  </thead>
                  <tbody>
                    @for (r of rows(); track r.show.id) {
                      <tr class="clickable" [class.dim]="r.status === 'completed' || r.status === 'cancelled'" (click)="open(r.show)">
                        <td class="nowrap strong">{{ formatTime(r.show.start) }}</td>
                        <td>
                          <div class="cell-title">
                            @if (r.poster) { <img class="poster-thumb" [src]="r.poster" alt="" /> } @else { <span class="poster-thumb"></span> }
                            <span class="min0"><a class="title-link" [routerLink]="['/shows', r.show.id]" (click)="$event.stopPropagation()"><strong class="truncate">{{ r.title }}</strong></a><small>{{ r.show.format }} · {{ r.show.language }}</small></span>
                          </div>
                        </td>
                        <td><span class="nowrap">{{ r.screen }}</span>@if (allScope()) { <small class="block muted">{{ r.theatre }}</small> }</td>
                        <td><div class="badges"><app-status-badge class="pub-{{ r.show.publication }}" [status]="r.show.publication" />@if (r.status !== 'scheduled' || r.show.publication === 'published') { <app-status-badge [status]="r.status" /> }</div></td>
                        <td class="occ">
                          <span class="occ-n">{{ r.sold }}<span class="muted"> / {{ r.show.cancellation ? '—' : r.sold + r.available }}</span></span>
                          <app-meter [value]="r.occupancy" />
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            } @else {
              <app-empty-state icon="calendar" [title]="filter() === 'all' ? 'No shows on ' + dayLabel() : 'No shows match this filter'" [text]="filter() === 'all' ? 'Create shows for this day or publish drafts from Shows.' : ''">
                @if (filter() === 'all') { <a class="btn primary" routerLink="/shows/new"><app-icon name="plus" />Create show</a> }
              </app-empty-state>
            }
          </section>

          <div class="side">
            <section class="card" id="ov-alerts">
              <div class="card-head"><h2>Needs attention</h2><span class="count-pill">{{ store.alerts().length }}</span></div>
              @if (store.alerts().length) {
                <ul class="alerts">
                  @for (a of visibleAlerts(); track a.id) {
                    <li>
                      <a class="alert" [routerLink]="link(a.link).path" [queryParams]="link(a.link).query">
                        <span class="sev {{ a.level }}"><app-icon [name]="a.level === 'info' ? 'info' : 'alert'" /></span>
                        <span class="min0 grow"><strong>{{ a.title }}</strong><small>{{ a.detail }}</small></span>
                        <span class="sr-only">{{ a.level === 'danger' ? 'Critical' : a.level === 'warning' ? 'Warning' : 'Info' }}</span>
                        <app-icon class="chev" name="chevronRight" />
                      </a>
                    </li>
                  }
                </ul>
                @if (store.alerts().length > 5) {
                  <div class="card-foot"><button type="button" class="link-btn small" (click)="allAlerts.set(!allAlerts())">{{ allAlerts() ? 'Show fewer' : 'Show all ' + store.alerts().length + ' alerts' }}</button></div>
                }
              } @else {
                <p class="card-body muted small">Nothing needs attention. Every active screen has shows and no refunds are waiting.</p>
              }
            </section>

            <section class="card">
              <div class="card-head"><h2>Recent activity</h2><a class="small" routerLink="/reports" [queryParams]="{ tab: 'activity' }">Activity log</a></div>
              <div class="card-body"><app-activity-timeline [entries]="recent()" [compact]="true" /></div>
            </section>
          </div>
        </div>
      }
    </div>
  `,
  styles: `
    .hero { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
    .tile { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; padding: 16px 18px; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); color: inherit; text-align: left; text-decoration: none; }
    .tile:hover { border-color: var(--border-strong); background: var(--surface-hover); }
    .tile .val { font-size: 2rem; font-weight: 800; letter-spacing: -0.03em; line-height: 1.15; font-variant-numeric: tabular-nums; }
    .tile .hint { font-size: 0.78rem; color: var(--text-muted); }
    .tile app-meter { width: 100%; margin: 2px 0; }
    .tile.rev .val { color: var(--accent); }
    .tile.attn.warning { border-color: var(--warning-line); } .tile.attn.warning .val { color: var(--warning); }
    .tile.attn.danger { border-color: var(--danger-line); } .tile.attn.danger .val { color: var(--danger); }
    .setup { display: flex; flex-wrap: wrap; gap: 6px 22px; padding: 0 4px; font-size: 0.84rem; color: var(--text-muted); }
    .setup a { color: var(--text-muted); } .setup a:hover { color: var(--text); }
    .setup b { color: var(--text); font-weight: 700; }
    .setup a.hot, .setup a.hot b { color: var(--danger); }
    .board { display: grid; grid-template-columns: minmax(0, 1.9fr) minmax(300px, 1fr); gap: 16px; align-items: start; }
    .side { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
    .occ { min-width: 130px; }
    .occ-n { display: block; margin-bottom: 4px; font-size: 0.82rem; font-weight: 700; font-variant-numeric: tabular-nums; }
    .occ-n .muted { font-weight: 500; }
    @media (max-width: 1200px) { .board { grid-template-columns: minmax(0, 1fr); } .hero { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 760px) { .tile .val { font-size: 1.6rem; } .schedule .poster-thumb { display: none; } }
    .scroll { max-height: 560px; overflow-y: auto; }
    .scroll thead th { position: sticky; top: 0; z-index: 1; }
    .data-table td { padding-top: 8px; padding-bottom: 8px; }
    tr.dim td { color: var(--text-muted); }
    tr.dim .poster-thumb { opacity: 0.55; }
    .min0 { min-width: 0; }
    .grow { flex: 1; }
    .block { display: block; font-size: 0.74rem; }
    .title-link { color: inherit; }
    .title-link:hover strong { text-decoration: underline; }
    .cell-title strong.truncate { max-width: 200px; }
    .badges { display: flex; flex-wrap: nowrap; gap: 4px; }
    .segmented button span { margin-left: 2px; font-size: 0.74rem; }
    .alerts { list-style: none; margin: 0; padding: 4px 0; }
    .alert { display: flex; align-items: center; gap: 10px; padding: 9px 16px; color: inherit; }
    .alert .chev { width: 14px; height: 14px; color: var(--text-faint); flex-shrink: 0; }
    .alert:hover { background: var(--surface-hover); }
    .alert strong { display: block; font-size: 0.84rem; font-weight: 600; color: var(--text); }
    .alert small { display: block; font-size: 0.76rem; color: var(--text-muted); }
    .sev { display: grid; place-items: center; width: 24px; height: 24px; border-radius: var(--radius-sm); flex-shrink: 0; }
    .sev app-icon { width: 14px; height: 14px; }
    .sev.danger { background: var(--danger-soft); color: var(--danger); }
    .sev.warning { background: var(--warning-soft); color: var(--warning); }
    .sev.info { background: var(--info-soft); color: var(--info); }
  `,
})
export class OverviewPage {
  protected readonly store = inject(AdminStore);
  private readonly router = inject(Router);

  protected readonly formatTime = formatTime;
  protected readonly formatNumber = formatNumber;

  readonly filter = signal<ScheduleFilter>('all');
  readonly allAlerts = signal(false);
  readonly filters: { id: ScheduleFilter; label: string }[] = [
    { id: 'all', label: 'All' }, { id: 'upcoming', label: 'Not started' }, { id: 'draft', label: 'Drafts' }, { id: 'cancelled', label: 'Cancelled' },
  ];

  readonly allScope = computed(() => this.store.selectedTheatreId() === ALL_THEATRES);
  readonly isToday = computed(() => sameDay(this.store.operationalDate(), this.store.now()));
  readonly dayWord = computed(() => (this.isToday() ? 'today' : 'on ' + formatDay(this.store.operationalDate()).replace(/^\w+, /, '')));
  readonly dayLabel = computed(() => (this.isToday() ? `today, ${formatDay(this.store.operationalDate())}` : formatDay(this.store.operationalDate())));
  readonly subtitle = computed(() => `${this.isToday() ? 'Today, ' : ''}${formatDay(this.store.operationalDate())}`);

  readonly dayShows = computed(() => this.store.dayShows());

  readonly kpi = computed(() => {
    const s = this.store;
    const theatres = s.scopedTheatres();
    const screens = s.scopedScreens();
    const shows = this.dayShows();
    const live = shows.filter((x) => !x.cancellation);
    const published = live.filter((x) => x.publication === 'published');
    const statuses = live.map((x) => s.showStatus(x));
    const bookings = published.flatMap((x) => s.confirmedBookingsOf(x.id));
    const seats = bookings.reduce((n, b) => n + b.seats.length, 0);
    const capacity = published.reduce((n, x) => n + s.capacity(x.screenId), 0);
    const now = s.now();
    const refunds = s.scopedRefunds().filter((r) => r.status === 'pending' || r.status === 'approved');
    return {
      theatres: theatres.length,
      theatresActive: theatres.filter((t) => t.status === 'active').length,
      screens: screens.length,
      screensActive: screens.filter((x) => x.status === 'active' && s.theatre(x.theatreId)?.status === 'active').length,
      scheduled: live.length,
      running: statuses.filter((x) => x === 'running').length,
      completed: statuses.filter((x) => x === 'completed').length,
      published: published.length,
      drafts: live.filter((x) => x.publication === 'draft').length,
      draftsAll: s.scopedShows().filter((x) => x.publication === 'draft' && x.start > now).length,
      cancelled: shows.length - live.length,
      capacity,
      upcoming: statuses.filter((x) => x === 'scheduled').length,
      bookings: formatNumber(bookings.length),
      seats,
      revenue: formatMoneyShort(bookings.reduce((n, b) => n + b.amount, 0)),
      occupancy: capacity ? Math.round((seats / capacity) * 100) : 0,
      refunds: refunds.length,
      refundAmount: formatMoney(refunds.reduce((n, r) => n + r.amount, 0)),
    };
  });

  private readonly allRows = computed(() => this.dayShows().map((show) => {
    const movie = this.store.movie(show.movieId);
    const screen = this.store.screen(show.screenId);
    return {
      show,
      title: movie?.title ?? 'Film',
      poster: movie?.posterUrl ?? '',
      screen: screen?.name ?? 'Screen',
      theatre: this.store.theatre(show.theatreId)?.name ?? '',
      status: this.store.showStatus(show),
      sold: this.store.soldSeats(show.id),
      available: this.store.availableSeats(show),
      occupancy: this.store.occupancy(show),
    };
  }));

  readonly counts = computed<Record<ScheduleFilter, number>>(() => {
    const rows = this.allRows();
    return {
      all: rows.length,
      upcoming: rows.filter((r) => r.status === 'scheduled').length,
      draft: rows.filter((r) => r.show.publication === 'draft' && !r.show.cancellation).length,
      cancelled: rows.filter((r) => r.status === 'cancelled').length,
    };
  });

  readonly rows = computed(() => {
    const f = this.filter();
    const rows = this.allRows();
    if (f === 'upcoming') return rows.filter((r) => r.status === 'scheduled');
    if (f === 'draft') return rows.filter((r) => r.show.publication === 'draft' && !r.show.cancellation);
    if (f === 'cancelled') return rows.filter((r) => r.status === 'cancelled');
    return rows;
  });

  /** The worst thing waiting: drives the colour of the attention tile. */
  readonly attention = computed(() => {
    const a = this.store.alerts();
    return a.some((x) => x.level === 'danger') ? 'danger' : a.length ? 'warning' : 'ok';
  });
  toAlerts(): void { document.getElementById('ov-alerts')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }

  readonly visibleAlerts = computed(() => (this.allAlerts() ? this.store.alerts() : this.store.alerts().slice(0, 5)));
  readonly recent = computed(() => this.store.scopedAudit().slice(0, 4));

  link(l: string) { return splitLink(l); }
  open(show: Show): void { void this.router.navigate(['/shows', show.id]); }
}
