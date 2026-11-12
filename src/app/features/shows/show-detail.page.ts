import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { AdminStore } from '../../core/admin-store';
import { formatDate, formatDateTime, formatDay, formatDuration, formatMoney, formatMoneyShort, formatNumber, formatPercent, formatRelative, formatTime } from '../../core/format';
import { layoutStats } from '../../core/layout';
import { Booking } from '../../core/models';
import { IconComponent } from '../../shared/icon.component';
import { tableState } from '../../shared/table';
import {
  EmptyStateComponent, KpiCardComponent, MeterComponent, PageHeaderComponent, PaginatorComponent, SkeletonComponent, SortHeaderComponent, StatusBadgeComponent,
} from '../../shared/ui';
import { ShowActions, editMode, errorsOf, warningsOf } from './show-utils';

/** Everything about one show: schedule, prices, sales, bookings, refunds and its history. */
@Component({
  selector: 'app-show-detail-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink, IconComponent, PageHeaderComponent, KpiCardComponent, StatusBadgeComponent, EmptyStateComponent, SkeletonComponent, MeterComponent,
    PaginatorComponent, SortHeaderComponent,
  ],
  template: `
    <div class="page">
      @if (!show()) {
        <app-page-header title="Show not found" [crumbs]="[{ label: 'Shows', link: '/shows' }, { label: 'Not found' }]" />
        <section class="card">
          <app-empty-state icon="shows" title="This show does not exist" text="It may have been a draft that was deleted. Published shows are never deleted; look for it in the show list.">
            <a class="btn" routerLink="/shows">Back to shows</a>
          </app-empty-state>
        </section>
      } @else {
        @let s = show()!;
        <app-page-header [title]="movie()?.title ?? 'Show'" [subtitle]="subtitle()" [crumbs]="[{ label: 'Shows', link: '/shows' }, { label: movie()?.title ?? s.id }]">
          @if (s.publication === 'draft') {
            <button class="btn danger-ghost" type="button" (click)="remove()"><app-icon name="trash" />Delete draft</button>
            <button class="btn" type="button" (click)="duplicate()"><app-icon name="copy" />Duplicate</button>
            <a class="btn" [routerLink]="['/shows', s.id, 'edit']"><app-icon name="edit" />Edit</a>
            <button class="btn primary" type="button" [disabled]="errors().length > 0" (click)="publish()"><app-icon name="upload" />Publish</button>
          } @else {
            <button class="btn" type="button" (click)="duplicate()"><app-icon name="copy" />Duplicate as draft</button>
            @if (status() === 'scheduled') {
              <a class="btn danger-ghost" [routerLink]="['/shows', s.id, 'cancel']"><app-icon name="cancel" />Cancel show</a>
              <a class="btn primary" [routerLink]="['/shows', s.id, 'edit']"><app-icon name="edit" />Edit</a>
            }
          }
        </app-page-header>

        @if (s.cancellation; as c) {
          <div class="callout danger">
            <app-icon name="cancel" />
            <div>
              <strong>Cancelled {{ dateTime(c.at) }} by {{ c.by }}: {{ c.reason }}.</strong>
              @if (c.notes) { <span> {{ c.notes }}</span> }
              <span> Customers {{ c.notifyCustomers ? 'were' : 'were not' }} notified. This show is kept as a historical record.</span>
            </div>
          </div>
        } @else if (s.publication === 'draft') {
          @if (errors().length) {
            <div class="callout danger">
              <app-icon name="alert" />
              <div><strong>Draft, not on sale. Fix {{ errors().length === 1 ? 'this' : 'these' }} before publishing:</strong>
                <ul>@for (e of errors(); track $index) { <li>{{ e.message }}</li> }</ul>
              </div>
            </div>
          } @else {
            <div class="callout info"><app-icon name="info" /><span><strong>Draft, not on sale.</strong> It passes every check and is ready to publish.</span></div>
          }
          @if (warnings().length) {
            <div class="callout warning"><app-icon name="alert" /><div><ul>@for (w of warnings(); track $index) { <li>{{ w.message }}</li> }</ul></div></div>
          }
        } @else if (status() === 'completed') {
          <div class="callout"><app-icon name="lock" /><span>This show has finished. It is kept as a historical record and cannot be edited.</span></div>
        } @else if (status() === 'running') {
          <div class="callout"><app-icon name="clock" /><span>This show is running now. Ends at {{ time(end()) }}.</span></div>
        } @else if (access().mode === 'prices') {
          <div class="callout"><app-icon name="info" /><span>Customers have booked this show. Only prices can be edited; to change the time or screen, cancel the show and create a new one.</span></div>
        }

        <div class="kpis">
          <app-kpi-card label="Seats sold" icon="seats" [value]="sold() + ' / ' + capacity()" [hint]="s.publication === 'draft' ? 'Not on sale' : available() + ' seats available'" />
          <app-kpi-card label="Occupancy" icon="activity" [value]="pct(occupancy())" [tone]="occupancy() >= 0.75 ? 'success' : 'default'" />
          <app-kpi-card label="Revenue" icon="rupee" [value]="moneyShort(revenue())" hint="Confirmed bookings, fees included" />
          <app-kpi-card label="Bookings" icon="ticket" [value]="confirmed()" [hint]="cancelledBookings() ? cancelledBookings() + ' cancelled' : ''" />
        </div>

        <div class="top">
          <section class="card">
            <div class="card-head">
              <h2>Show details</h2>
              <div class="row"><app-status-badge [status]="s.publication" /><app-status-badge [status]="status()" /></div>
            </div>
            <div class="card-body info">
              <img class="poster" [src]="movie()?.posterUrl ?? ''" [alt]="(movie()?.title ?? 'Film') + ' poster'" />
              <dl class="facts">
                <dt>Film</dt><dd>@if (movie(); as m) { {{ m.title }} <span class="tag">{{ m.certification }}</span> }</dd>
                <dt>Format</dt><dd>{{ s.format }} · {{ s.language }}</dd>
                <dt>Theatre</dt><dd><a routerLink="/theatre">{{ theatre()?.name }}</a></dd>
                <dt>Screen</dt><dd><a [routerLink]="['/screens', s.screenId]">{{ screen()?.name }}</a> <span class="muted small">{{ screen()?.type }}</span></dd>
                <dt>Date</dt><dd>{{ day(s.start) }}</dd>
                <dt>Time</dt><dd>{{ time(s.start) }} – {{ time(end()) }} <span class="muted small">({{ duration(movie()?.runtime ?? 0) }} film, {{ s.intermission ? s.intermission + ' min interval' : 'no interval' }})</span></dd>
                <dt>Screen ready</dt><dd>{{ time(store.turnaroundEnd(s)) }}</dd>
                <dt>Created</dt><dd>{{ dateTime(s.createdAt) }} <span class="muted small">by {{ s.createdBy }}</span></dd>
                <dt>Published</dt><dd>{{ s.publishedAt ? dateTime(s.publishedAt) : 'Not published' }}</dd>
                <dt>Last changed</dt><dd>{{ dateTime(s.updatedAt) }}</dd>
                <dt>Show id</dt><dd class="mono">{{ s.id }}</dd>
              </dl>
            </div>
          </section>

          <section class="card">
            <div class="card-head"><h2>Ticket prices</h2><span class="small muted">{{ capacity() }} seats</span></div>
            <table class="data-table">
              <thead><tr><th>Category</th><th class="num">Seats</th><th class="num">Price</th></tr></thead>
              <tbody>
                @for (p of priceRows(); track p.id) {
                  <tr>
                    <td><span class="cat"><i [style.background]="p.color"></i>{{ p.name }}</span></td>
                    <td class="num">{{ p.seats }}</td>
                    <td class="num">{{ money(p.price) }}@if (p.price !== p.base) { <small class="muted"> (base {{ money(p.base) }})</small> }</td>
                  </tr>
                }
              </tbody>
            </table>
            @if (s.publication === 'published') {
              <div class="card-body occ"><span class="small muted">Occupancy</span><app-meter [value]="occupancy()" /></div>
            }
          </section>
        </div>

        <section class="card">
          <div class="card-head">
            <h2>Bookings</h2>
            @if (bookings().length) {
              <div class="search-input bk-search">
                <app-icon name="search" />
                <input class="input" type="search" aria-label="Search bookings" placeholder="Reference, name or phone" [value]="bookingQuery()" (input)="bookingQuery.set($any($event.target).value); bookingTable.reset()" />
              </div>
            }
          </div>
          @if (store.loading()) {
            <app-skeleton [rows]="4" />
          } @else if (!bookings().length) {
            <app-empty-state icon="ticket" [title]="s.publication === 'draft' ? 'No bookings while this is a draft' : 'No bookings yet'"
              [text]="s.publication === 'draft' ? 'Customers can book once the show is published.' : 'Bookings appear here as customers buy tickets.'" />
          } @else {
            <div class="table-wrap">
              <table class="data-table">
                <thead>
                  <tr>
                    <th><app-sort-header [active]="bookingTable.isSorted('ref')" [dir]="bookingTable.dir()" (toggle)="bookingTable.sortBy('ref')">Reference</app-sort-header></th>
                    <th><app-sort-header [active]="bookingTable.isSorted('customer')" [dir]="bookingTable.dir()" (toggle)="bookingTable.sortBy('customer')">Customer</app-sort-header></th>
                    <th>Seats</th>
                    <th class="num"><app-sort-header [active]="bookingTable.isSorted('amount')" [dir]="bookingTable.dir()" (toggle)="bookingTable.sortBy('amount')">Amount</app-sort-header></th>
                    <th>Payment</th>
                    <th><app-sort-header [active]="bookingTable.isSorted('booked')" [dir]="bookingTable.dir()" (toggle)="bookingTable.sortBy('booked')">Booked</app-sort-header></th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  @for (b of bookingTable.rows(); track b.id) {
                    <tr>
                      <td class="mono">{{ b.ref }}</td>
                      <td><div class="cell-title"><span><strong>{{ b.customerName }}</strong><small>{{ b.customerPhone }}</small></span></div></td>
                      <td><span class="seats">{{ b.seats.join(', ') }}</span></td>
                      <td class="num">{{ money(b.amount) }}</td>
                      <td><span class="nowrap">{{ b.paymentMethod }}</span><br /><small class="muted mono">{{ b.paymentRef }}</small></td>
                      <td class="nowrap">{{ dateTime(b.bookedAt) }}</td>
                      <td><app-status-badge [status]="b.status" /></td>
                    </tr>
                  } @empty {
                    <tr><td colspan="7" class="muted">No bookings match "{{ bookingQuery() }}".</td></tr>
                  }
                </tbody>
              </table>
            </div>
            <app-paginator [(page)]="bookingTable.page" [(pageSize)]="bookingTable.size" [total]="bookingTable.total()" />
          }
        </section>

        @if (refunds().length) {
          <section class="card">
            <div class="card-head"><h2>Refunds</h2><span class="small muted">{{ refunds().length }} · {{ money(refundTotal()) }}</span></div>
            <div class="table-wrap">
              <table class="data-table">
                <thead><tr><th>Refund</th><th>Booking</th><th>Reason</th><th class="num">Amount</th><th>Method</th><th>Status</th><th>Updated</th></tr></thead>
                <tbody>
                  @for (r of refunds(); track r.id) {
                    <tr>
                      <td><a class="mono" [routerLink]="['/refunds', r.id]">{{ r.id }}</a></td>
                      <td class="mono">{{ store.booking(r.bookingId)?.ref }}</td>
                      <td>{{ r.reason }}</td>
                      <td class="num">{{ money(r.amount) }}</td>
                      <td>{{ r.method }}</td>
                      <td><app-status-badge [status]="r.status" /></td>
                      <td class="nowrap muted">{{ relative(r.updatedAt) }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </section>
        }

        <section class="card">
          <div class="card-head"><h2>History</h2><span class="small muted">{{ history().length }} {{ history().length === 1 ? 'entry' : 'entries' }}</span></div>
          @if (!history().length) {
            <p class="card-body muted small">No recorded changes for this show.</p>
          } @else {
            <ol class="history">
              @for (a of history(); track a.id) {
                <li>
                  <span class="when nowrap" [attr.title]="dateTime(a.at)">{{ dateTime(a.at) }}</span>
                  <div class="what">
                    <p><strong>{{ a.user }}</strong> <span class="muted small">{{ a.role }}</span></p>
                    <p class="soft">{{ a.summary }}</p>
                    @if (a.changes?.length) {
                      <ul class="changes">@for (c of a.changes; track $index) { <li><span class="muted">{{ c.field }}:</span> {{ c.from || '—' }} → {{ c.to }}</li> }</ul>
                    }
                  </div>
                </li>
              }
            </ol>
          }
        </section>
      }
    </div>
  `,
  styles: `
    .callout ul { margin: 4px 0 0; padding-left: 18px; }
    .kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
    .top { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr); gap: 16px; align-items: start; }
    .info { display: flex; gap: 18px; align-items: flex-start; }
    .poster { width: 120px; aspect-ratio: 2 / 3; border-radius: var(--radius); object-fit: cover; background: var(--surface-3); flex-shrink: 0; }
    .info .facts { flex: 1; }
    .info dd .tag, .info dd .muted { margin-left: 6px; }
    .cat { display: inline-flex; align-items: center; gap: 8px; }
    .cat i { width: 10px; height: 10px; border-radius: 3px; }
    .occ { display: flex; flex-direction: column; gap: 6px; border-top: 1px solid var(--border); }
    .bk-search { width: min(280px, 100%); }
    .bk-search .input { min-height: 32px; }
    .seats { display: inline-block; max-width: 220px; font-size: 0.8rem; }
    .history { margin: 0; padding: 4px 18px; list-style: none; }
    .history > li { display: grid; grid-template-columns: 170px minmax(0, 1fr); gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--border-soft); }
    .history > li:last-child { border-bottom: 0; }
    .when { font-size: 0.8rem; color: var(--text-muted); }
    .what { display: flex; flex-direction: column; gap: 2px; font-size: 0.86rem; min-width: 0; }
    .changes { margin: 4px 0 0; padding-left: 16px; font-size: 0.8rem; color: var(--text-soft); }
    @media (max-width: 1180px) { .top { grid-template-columns: minmax(0, 1fr); } }
    @media (max-width: 900px) { .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); } .history > li { grid-template-columns: minmax(0, 1fr); gap: 2px; } }
    @media (max-width: 600px) { .info { flex-direction: column; } }
  `,
})
export class ShowDetailPage {
  protected readonly store = inject(AdminStore);
  private readonly actions = inject(ShowActions);
  private readonly router = inject(Router);

  readonly showId = input.required<string>();

  protected readonly show = computed(() => this.store.show(this.showId()));
  protected readonly movie = computed(() => { const s = this.show(); return s ? this.store.movie(s.movieId) : undefined; });
  protected readonly theatre = computed(() => { const s = this.show(); return s ? this.store.theatre(s.theatreId) : undefined; });
  protected readonly screen = computed(() => { const s = this.show(); return s ? this.store.screen(s.screenId) : undefined; });
  protected readonly status = computed(() => { const s = this.show(); return s ? this.store.showStatus(s) : 'scheduled'; });
  protected readonly end = computed(() => { const s = this.show(); return s ? this.store.showEnd(s) : new Date(); });
  protected readonly access = computed(() => { const s = this.show(); return s ? editMode(this.store, s) : { mode: 'locked' as const, reason: '' }; });

  protected readonly subtitle = computed(() => {
    const s = this.show();
    if (!s) return '';
    return `${this.screen()?.name ?? 'Screen'} · ${this.theatre()?.name ?? ''} · ${formatDay(s.start)}, ${formatTime(s.start)}–${formatTime(this.end())}`;
  });

  private readonly issues = computed(() => {
    const s = this.show();
    return s && s.publication === 'draft' && !s.cancellation ? this.actions.issues(s) : [];
  });
  protected readonly errors = computed(() => errorsOf(this.issues()));
  protected readonly warnings = computed(() => warningsOf(this.issues()));

  protected readonly capacity = computed(() => { const s = this.show(); return s ? this.store.capacity(s.screenId) : 0; });
  protected readonly sold = computed(() => { const s = this.show(); return s ? this.store.soldSeats(s.id) : 0; });
  protected readonly available = computed(() => Math.max(0, this.capacity() - this.sold()));
  protected readonly occupancy = computed(() => { const s = this.show(); return s ? this.store.occupancy(s) : 0; });
  protected readonly revenue = computed(() => { const s = this.show(); return s ? this.store.revenue(s.id) : 0; });

  protected readonly priceRows = computed(() => {
    const s = this.show();
    const layout = this.screen()?.layout;
    if (!s || !layout) return [];
    const counts = layoutStats(layout).byCategory;
    return layout.categories.map((c) => ({ id: c.id, name: c.name, color: c.color, seats: counts[c.id] ?? 0, price: s.prices[c.id] ?? 0, base: c.basePrice }));
  });

  protected readonly bookings = computed(() => { const s = this.show(); return s ? this.store.bookingsOf(s.id) : []; });
  protected readonly confirmed = computed(() => this.bookings().filter((b) => b.status === 'confirmed').length);
  protected readonly cancelledBookings = computed(() => this.bookings().length - this.confirmed());
  protected readonly bookingQuery = signal('');
  private readonly filteredBookings = computed(() => {
    const q = this.bookingQuery().trim().toLowerCase();
    return q ? this.bookings().filter((b) => [b.ref, b.customerName, b.customerPhone, b.customerEmail].some((x) => x.toLowerCase().includes(q))) : this.bookings();
  });
  protected readonly bookingTable = tableState<Booking>(this.filteredBookings, {
    ref: (b) => b.ref, customer: (b) => b.customerName, amount: (b) => b.amount, booked: (b) => b.bookedAt,
  }, 'booked', 'desc');

  protected readonly refunds = computed(() => { const s = this.show(); return s ? this.store.refundsOf(s.id) : []; });
  protected readonly refundTotal = computed(() => this.refunds().reduce((n, r) => n + r.amount, 0));

  protected readonly history = computed(() => {
    const link = `/shows/${this.showId()}`;
    return this.store.audit().filter((a) => a.link === link).sort((a, b) => b.at.getTime() - a.at.getTime());
  });

  protected publish(): void {
    const s = this.show();
    if (s) void this.actions.publish(s);
  }

  protected async remove(): Promise<void> {
    const s = this.show();
    if (s && (await this.actions.deleteDraft(s))) await this.router.navigate(['/shows'], { queryParams: { tab: 'drafts' } });
  }

  protected duplicate(): void {
    const s = this.show();
    const copy = s ? this.actions.duplicate(s) : null;
    if (copy) void this.router.navigate(['/shows', copy.id]);
  }

  protected money(n: number): string { return formatMoney(n); }
  protected moneyShort(n: number): string { return formatMoneyShort(n); }
  protected pct(n: number): string { return formatPercent(n); }
  protected num(n: number): string { return formatNumber(n); }
  protected day(d: Date): string { return formatDay(d) + ' ' + d.getFullYear(); }
  protected date(d: Date): string { return formatDate(d); }
  protected time(d: Date): string { return formatTime(d); }
  protected dateTime(d: Date): string { return formatDateTime(d); }
  protected duration(n: number): string { return formatDuration(n); }
  protected relative(d: Date): string { return formatRelative(d, this.store.now()); }
}
