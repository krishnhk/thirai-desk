import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { ALL_THEATRES, AdminStore } from '../../core/admin-store';
import { formatDay, formatMoneyShort, formatNumber, formatTime, sameDay } from '../../core/format';
import { Show } from '../../core/models';
import { splitLink } from '../../shared/activity-timeline.component';
import { IconComponent } from '../../shared/icon.component';
import { EmptyStateComponent, SkeletonComponent, StatusBadgeComponent } from '../../shared/ui';

/**
 * The operational overview, kept to what matters at a glance: how the day is going (three numbers),
 * anything that needs attention (only when there is something), and the day's shows.
 * Follows the header's theatre and date.
 */
@Component({
  selector: 'app-overview-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, StatusBadgeComponent, EmptyStateComponent, SkeletonComponent, IconComponent],
  template: `
    <div class="page">
      <header class="head">
        <h1>Overview</h1>
        <p>{{ subtitle() }}</p>
      </header>

      @if (store.loading()) {
        <section class="card"><app-skeleton [rows]="8" /></section>
      } @else {
        <section class="card stats" aria-label="The day at a glance">
          <a routerLink="/reports">
            <span class="label">Revenue</span>
            <b>{{ kpi().revenue }}</b>
            <small>{{ kpi().bookings }} bookings</small>
          </a>
          <a routerLink="/shows">
            <span class="label">Seats sold</span>
            <b>{{ kpi().seats }}</b>
            <small>{{ kpi().occupancy }}% of {{ kpi().capacity }}</small>
          </a>
          <a routerLink="/shows">
            <span class="label">Shows</span>
            <b>{{ kpi().scheduled }}</b>
            <small>{{ kpi().running }} running · {{ kpi().upcoming }} to start</small>
          </a>
        </section>

        @if (store.alerts().length) {
          <section class="card">
            <div class="card-head"><h2>Needs attention</h2><span class="count-pill">{{ store.alerts().length }}</span></div>
            <ul class="alerts">
              @for (a of store.alerts().slice(0, 4); track a.id) {
                <li>
                  <a class="alert" [routerLink]="link(a.link).path" [queryParams]="link(a.link).query">
                    <span class="sev {{ a.level }}"><app-icon [name]="a.level === 'info' ? 'info' : 'alert'" /></span>
                    <span class="txt"><strong>{{ a.title }}</strong><small>{{ a.detail }}</small></span>
                    <app-icon class="chev" name="chevronRight" />
                  </a>
                </li>
              }
            </ul>
          </section>
        }

        <section class="card">
          <div class="card-head">
            <h2>Shows {{ dayWord() }}</h2>
            <a class="more" routerLink="/shows">All showtimes</a>
          </div>
          @if (rows().length) {
            <div class="rows">
              @for (r of rows(); track r.show.id) {
                <div class="item" [class.dim]="r.state === 'completed' || r.state === 'cancelled'" (click)="open(r.show)">
                  <span class="t">{{ time(r.show.start) }}</span>
                  <div class="what">
                    <strong class="truncate">{{ r.title }}</strong>
                    <small class="truncate">{{ r.screen }}@if (allScope()) { · {{ r.theatre }} } · {{ r.show.language }} · {{ r.show.format }}</small>
                  </div>
                  <small class="sold">@if (r.counts) { {{ r.sold }}/{{ r.capacity }} sold } @else { — }</small>
                  <span class="state"><app-status-badge [status]="r.state" [label]="r.label" /></span>
                </div>
              }
            </div>
          } @else {
            <app-empty-state icon="calendar" title="No shows scheduled" text="Schedule shows for this day from Showtimes.">
              <a class="btn primary" routerLink="/shows/new"><app-icon name="plus" />Schedule show</a>
            </app-empty-state>
          }
        </section>
      }
    </div>
  `,
  styles: `
    .head h1 { font-size: 1.8rem; }
    .head p { margin-top: 4px; color: var(--text-muted); }
    .stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .stats a { display: flex; flex-direction: column; gap: 2px; padding: 18px 22px; color: inherit; }
    .stats a + a { border-left: 1px solid var(--border-soft); }
    .stats a:hover { background: var(--surface-hover); }
    .stats .label { font-size: 0.82rem; color: var(--text-muted); }
    .stats b { font-size: 1.8rem; font-weight: 800; letter-spacing: -0.02em; line-height: 1.2; }
    .stats small { font-size: 0.82rem; color: var(--text-muted); }
    .more { font-size: 0.84rem; font-weight: 600; color: var(--text-muted); }
    .more:hover { color: var(--accent); }
    .alerts { margin: 0; padding: 0; list-style: none; }
    .alert { display: flex; align-items: center; gap: 12px; padding: 12px 18px; color: inherit; }
    .alert:hover { background: var(--surface-hover); }
    .alert + .alert, li + li .alert { border-top: 1px solid var(--border-soft); }
    .txt { display: flex; flex: 1; flex-direction: column; min-width: 0; }
    .txt strong { font-size: 0.9rem; }
    .txt small { color: var(--text-muted); font-size: 0.8rem; }
    .chev { width: 14px; height: 14px; color: var(--text-faint); flex-shrink: 0; }
    .sev { display: grid; place-items: center; width: 26px; height: 26px; border-radius: var(--radius-sm); flex-shrink: 0; }
    .sev app-icon { width: 14px; height: 14px; }
    .sev.danger { background: var(--danger-soft); color: var(--danger); }
    .sev.warning { background: var(--warning-soft); color: var(--warning); }
    .sev.info { background: var(--info-soft); color: var(--info); }
    .rows { display: flex; flex-direction: column; }
    .item { display: grid; grid-template-columns: 96px minmax(0, 1fr) 110px 100px; align-items: center; gap: 16px; padding: 14px 20px; cursor: pointer; }
    .item + .item { border-top: 1px solid var(--border-soft); }
    .item:hover { background: var(--surface-hover); }
    .item.dim .t, .item.dim .what strong { color: var(--text-muted); }
    .t { font-weight: 700; white-space: nowrap; }
    .what { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .what small, .sold { color: var(--text-muted); font-size: 0.84rem; }
    .state { display: flex; justify-content: flex-end; }
    @media (max-width: 760px) {
      .stats { grid-template-columns: minmax(0, 1fr); }
      .stats a + a { border-left: 0; border-top: 1px solid var(--border-soft); }
      .item { grid-template-columns: minmax(0, 1fr) auto; row-gap: 4px; }
      .sold { display: none; }
    }
  `,
})
export class OverviewPage {
  protected readonly store = inject(AdminStore);
  private readonly router = inject(Router);

  readonly allScope = computed(() => this.store.selectedTheatreId() === ALL_THEATRES);
  readonly isToday = computed(() => sameDay(this.store.operationalDate(), this.store.now()));
  readonly dayWord = computed(() => (this.isToday() ? 'today' : 'on ' + formatDay(this.store.operationalDate()).replace(/^\w+, /, '')));
  readonly subtitle = computed(() => `${this.isToday() ? 'Today, ' : ''}${formatDay(this.store.operationalDate())}`);

  readonly kpi = computed(() => {
    const s = this.store;
    const live = s.dayShows().filter((x) => !x.cancellation);
    const published = live.filter((x) => x.publication === 'published');
    const statuses = live.map((x) => s.showStatus(x));
    const bookings = published.flatMap((x) => s.confirmedBookingsOf(x.id));
    const seats = bookings.reduce((n, b) => n + b.seats.length, 0);
    const capacity = published.reduce((n, x) => n + s.capacity(x.screenId), 0);
    return {
      scheduled: live.length,
      running: statuses.filter((x) => x === 'running').length,
      upcoming: statuses.filter((x) => x === 'scheduled').length,
      bookings: formatNumber(bookings.length),
      seats: formatNumber(seats),
      capacity: formatNumber(capacity),
      revenue: formatMoneyShort(bookings.reduce((n, b) => n + b.amount, 0)),
      occupancy: capacity ? Math.round((seats / capacity) * 100) : 0,
    };
  });

  readonly rows = computed(() => this.store.dayShows().map((show) => {
    const movie = this.store.movie(show.movieId);
    const status = this.store.showStatus(show);
    const state = show.publication === 'draft' && status !== 'cancelled' ? 'draft' : status;
    return {
      show,
      state,
      label: state === 'completed' ? 'Played' : state === 'scheduled' ? 'On sale' : '',
      title: movie?.title ?? 'Film',
      screen: this.store.screen(show.screenId)?.name ?? 'Screen',
      theatre: this.store.theatre(show.theatreId)?.name ?? '',
      counts: state !== 'draft' && state !== 'cancelled',
      sold: this.store.soldSeats(show.id),
      capacity: this.store.capacity(show.screenId),
    };
  }));

  link(l: string) { return splitLink(l); }
  time(d: Date): string { return formatTime(d).toLowerCase(); }
  open(show: Show): void { void this.router.navigate(['/shows', show.id]); }
}
