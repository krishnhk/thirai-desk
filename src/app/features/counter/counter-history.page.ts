import { ChangeDetectionStrategy, Component, computed, effect, inject, input, linkedSignal, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { AdminStore } from '../../core/admin-store';
import { formatDate, formatDay, formatMoney, formatNumber, formatTime, fromDateInput, sameDay, toDateInput } from '../../core/format';
import { COUNTER_PAYMENT_METHODS } from '../../core/models';
import { IconComponent } from '../../shared/icon.component';
import { tableState } from '../../shared/table';
import { EmptyStateComponent, PageHeaderComponent, PaginatorComponent, SkeletonComponent, SortHeaderComponent, StatusBadgeComponent } from '../../shared/ui';
import { BookingDetailDialog } from './history/booking-detail.dialog';
import { CancelBookingDialog } from './history/cancel-booking.dialog';
import { CashRefundDialog } from './history/cash-refund.dialog';
import { CounterRow, visibleCounterRows } from './history/counter-data';

type Dialog = { kind: 'cancel'; bookingId: string | null } | { kind: 'cash'; refundId: string; justCancelled: boolean };

/** Every counter transaction: filter, search by booking or ticket reference, open, reprint, cancel and refund. */
@Component({
  selector: 'app-counter-history-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink, IconComponent, PageHeaderComponent, EmptyStateComponent, SkeletonComponent, PaginatorComponent, SortHeaderComponent, StatusBadgeComponent,
    BookingDetailDialog, CancelBookingDialog, CashRefundDialog,
  ],
  template: `
    <div class="page">
      <app-page-header title="Counter history" [crumbs]="[{ label: 'Counter Booking', link: '/counter' }, { label: 'History' }]">
        <a class="btn primary" routerLink="/counter"><app-icon name="ticket" />Sell tickets</a>
        <a class="btn" routerLink="/counter/dashboard"><app-icon name="reports" />Counter dashboard</a>
        @if (hasAccess()) {
          <button class="btn ghost cancel-link" type="button" [disabled]="!canCancel()" [title]="canCancel() ? '' : 'A counter supervisor must approve cancellations.'" (click)="dialog.set({ kind: 'cancel', bookingId: null })"><app-icon name="cancel" />Cancel a booking</button>
        }
      </app-page-header>

      @if (!hasAccess()) {
        <section class="card">
          <app-empty-state icon="lock" title="You cannot view counter history" text="Your role has no access to box office transactions. Ask a theatre administrator for counter access." />
        </section>
      } @else if (store.loading()) {
        <section class="card"><app-skeleton [rows]="8" /></section>
      } @else {
        @if (!canCancel()) {
          <div class="callout info"><app-icon name="info" /><span>You see your own sales only. A counter supervisor must approve cancellations.</span></div>
        }
        <section class="card">
          <div class="toolbar">
            <div class="search-input grow">
              <app-icon name="search" />
              <input id="ch-search" class="input mono-ph" aria-label="Search by booking or ticket reference" placeholder="Search a booking or ticket, e.g. TC12AB34-2" [value]="query()" (input)="query.set($any($event.target).value)" />
            </div>
            <div class="daynav" role="group" aria-label="Business date">
              <button type="button" class="btn ghost sm icon" aria-label="Previous day" [disabled]="!date()" (click)="shiftDay(-1)"><app-icon name="chevronLeft" /></button>
              <input id="ch-date" type="date" class="dinput" aria-label="Business date" [value]="date()" (change)="date.set($any($event.target).value)" />
              <button type="button" class="btn ghost sm icon" aria-label="Next day" [disabled]="!date()" (click)="shiftDay(1)"><app-icon name="chevronRight" /></button>
              <button type="button" class="btn sm" [disabled]="date() === opDate()" (click)="date.set(opDate())">Today</button>
              <button type="button" class="btn sm toggle" [attr.aria-pressed]="!date()" (click)="date.set(date() ? '' : opDate())">All dates</button>
            </div>
            <button type="button" class="btn" [attr.aria-expanded]="filtersOpen()" (click)="filtersOpen.set(!filtersOpen())">
              <app-icon name="filter" />Filters@if (chips().length) { <span class="count">{{ chips().length }}</span> }
            </button>
          </div>

          @if (filtersOpen()) {
            <div class="panel">
              <div class="field">
                <label for="ch-movie">Film</label>
                <select id="ch-movie" class="select" [value]="movie()" (change)="movie.set($any($event.target).value); show.set('')">
                  <option value="">All films</option>
                  @for (o of movieOptions(); track o.id) { <option [value]="o.id">{{ o.label }}</option> }
                </select>
              </div>
              <div class="field">
                <label for="ch-screen">Screen</label>
                <select id="ch-screen" class="select" [value]="screen()" (change)="screen.set($any($event.target).value); show.set('')">
                  <option value="">All screens</option>
                  @for (o of screenOptions(); track o.id) { <option [value]="o.id">{{ o.label }}</option> }
                </select>
              </div>
              <div class="field wide">
                <label for="ch-show">Show</label>
                <select id="ch-show" class="select" (change)="show.set($any($event.target).value)">
                  <option value="" [selected]="!show()">All shows</option>
                  @for (o of showOptions(); track o.id) { <option [value]="o.id" [selected]="o.id === show()">{{ o.label }}</option> }
                </select>
              </div>
              <div class="field">
                <label for="ch-method">Payment</label>
                <select id="ch-method" class="select" [value]="method()" (change)="method.set($any($event.target).value)">
                  <option value="">All methods</option>
                  @for (m of methods; track m) { <option [value]="m">{{ m }}</option> }
                </select>
              </div>
              <div class="field">
                <label for="ch-status">Status</label>
                <select id="ch-status" class="select" [value]="status()" (change)="status.set($any($event.target).value)">
                  <option value="">All statuses</option>
                  <option value="confirmed">Confirmed</option>
                  <option value="cancelled">Cancelled</option>
                  <option value="refund-due">Refund not completed</option>
                </select>
              </div>
              @if (allAccess()) {
                <div class="field">
                  <label for="ch-op">Operator</label>
                  <select id="ch-op" class="select" [value]="operator()" (change)="operator.set($any($event.target).value)">
                    <option value="">All operators</option>
                    @for (o of operatorOptions(); track o) { <option [value]="o">{{ o }}</option> }
                  </select>
                </div>
              }
            </div>
          }

          @if (chips().length) {
            <div class="chips" aria-label="Active filters">
              @for (c of chips(); track c.key) {
                <span class="fchip"><span class="muted">{{ c.group }}</span> {{ c.label }}<button type="button" [attr.aria-label]="'Remove filter ' + c.group + ' ' + c.label" (click)="c.clear()"><app-icon name="close" /></button></span>
              }
              <button type="button" class="link" (click)="clearFilters()">Clear all</button>
            </div>
          }

          <!-- 3. The summary: four tiles you can read at a glance. -->
          <div class="stats" aria-label="Summary of the filtered bookings">
            <div class="stat"><span class="eyebrow">{{ totals().count === 1 ? 'Booking' : 'Bookings' }}</span><b>{{ formatNumber(totals().count) }}</b></div>
            <div class="stat"><span class="eyebrow">Tickets confirmed</span><b>{{ formatNumber(totals().tickets) }}</b></div>
            <div class="stat sales"><span class="eyebrow">Confirmed sales</span><b>{{ money(totals().amount) }}</b></div>
            <div class="stat" [class.quiet]="!totals().cancelled"><span class="eyebrow">Cancelled</span><b>{{ totals().cancelled }}</b></div>
          </div>

          @if (table.total()) {
            <div class="table-wrap">
              <table class="data-table">
                <thead>
                  <tr>
                    <th><app-sort-header [active]="table.isSorted('ref')" [dir]="table.dir()" (toggle)="table.sortBy('ref')">Booking</app-sort-header></th>
                    <th><app-sort-header [active]="table.isSorted('show')" [dir]="table.dir()" (toggle)="table.sortBy('show')">Film and show</app-sort-header></th>
                    <th>Seats</th>
                    <th class="num"><app-sort-header [active]="table.isSorted('tickets')" [dir]="table.dir()" (toggle)="table.sortBy('tickets')">Qty</app-sort-header></th>
                    <th class="num"><app-sort-header [active]="table.isSorted('amount')" [dir]="table.dir()" (toggle)="table.sortBy('amount')">Total</app-sort-header></th>
                    <th><app-sort-header [active]="table.isSorted('method')" [dir]="table.dir()" (toggle)="table.sortBy('method')">Payment</app-sort-header></th>
                    <th><app-sort-header [active]="table.isSorted('booked')" [dir]="table.dir()" (toggle)="table.sortBy('booked')">Sold at</app-sort-header></th>
                    <th><app-sort-header [active]="table.isSorted('operator')" [dir]="table.dir()" (toggle)="table.sortBy('operator')">Operator</app-sort-header></th>
                    <th><app-sort-header [active]="table.isSorted('status')" [dir]="table.dir()" (toggle)="table.sortBy('status')">Status</app-sort-header></th>
                    <th class="actions-col"><span class="sr-only">Open</span></th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of table.rows(); track row.booking.id) {
                    @let b = row.booking;
                    <tr class="clickable" [class.selected]="b.ref === highlight()" (click)="openId.set(b.id)">
                      <td><span class="mono strong">{{ b.ref }}</span>@if (matchedTicket(row); as t) { <small class="sub mono">Ticket {{ t }}</small> }</td>
                      <td class="film"><span class="truncate film-name" [title]="row.film">{{ row.film }}</span><small class="sub nowrap">{{ row.screen }} · {{ row.showStart ? day(row.showStart) + ', ' + time(row.showStart) : '' }}</small></td>
                      <td class="seats"><span class="truncate" [title]="b.seats.join(', ')">{{ b.seats.join(', ') }}</span></td>
                      <td class="num">{{ row.tickets }}</td>
                      <td class="num money strong">{{ money(b.amount) }}</td>
                      <td class="nowrap">{{ row.method }}@if (b.counterPayment?.txnRef; as txn) { <small class="sub mono">{{ txn }}</small> }</td>
                      <td class="nowrap">{{ time(b.bookedAt) }}<small class="sub">{{ day(b.bookedAt) }}</small></td>
                      <td class="nowrap">{{ row.operator }}</td>
                      <td>
                        <app-status-badge [status]="b.status" />
                        @if (row.refund; as r) { <small class="sub nowrap">Refund {{ r.status === 'successful' ? 'paid' : r.status }}</small> }
                      </td>
                      <td class="actions-col"><button class="btn sm ghost icon" type="button" [attr.aria-label]="'Open booking ' + b.ref" (click)="$event.stopPropagation(); openId.set(b.id)"><app-icon name="chevronRight" /></button></td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            <app-paginator [(page)]="table.page" [(pageSize)]="table.size" [total]="table.total()" />
          } @else {
            <app-empty-state icon="ticket" [title]="hasFilters() ? 'No counter bookings match these filters' : 'No counter bookings on ' + dateLabel()"
              [text]="query() ? 'Check the reference on the ticket, or look across all dates.' : 'Change the date or filters, or look across all dates.'">
              @if (date()) { <button class="btn" type="button" (click)="date.set('')">Show all dates</button> }
              @if (hasFilters()) { <button class="btn" type="button" (click)="clearFilters()">Clear filters</button> }
            </app-empty-state>
          }
        </section>
      }
    </div>

    @if (dialog(); as d) {
      @if (d.kind === 'cancel') {
        <app-cancel-booking-dialog [bookingId]="d.bookingId" (closed)="dialog.set(null)" (cashDue)="dialog.set({ kind: 'cash', refundId: $event, justCancelled: true })" />
      } @else {
        <app-cash-refund-dialog [refundId]="d.refundId" [justCancelled]="d.justCancelled" (closed)="dialog.set(null)" />
      }
    } @else if (openId(); as id) {
      <app-booking-detail-dialog [bookingId]="id" (closed)="openId.set(null)"
        (cancel)="dialog.set({ kind: 'cancel', bookingId: $event })" (handBack)="dialog.set({ kind: 'cash', refundId: $event, justCancelled: false })" />
    }
  `,
  styles: `
    .toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 12px; padding: 14px 16px; }
    .toolbar .grow { flex: 1 1 280px; min-width: 240px; }
    .daynav { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 4px; max-width: 100%; }
    .dinput { min-height: 34px; padding: 0 10px; border: 1px solid var(--border-strong); border-radius: var(--radius); background: var(--surface-2); color: var(--text); font: inherit; font-size: 0.86rem; }
    .daynav .toggle[aria-pressed='true'] { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); }
    .count { display: inline-grid; place-items: center; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 999px; background: var(--accent); color: var(--on-accent); font-size: 0.68rem; font-weight: 800; }
    .panel { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px 14px; padding: 12px 16px 14px; border-top: 1px solid var(--border-soft); background: var(--surface-2); }
    .panel .wide { grid-column: span 2; }
    .chips { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 10px 16px 0; }
    .fchip { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 4px 0 10px; border: 1px solid var(--accent-line); border-radius: 999px; background: var(--accent-soft); font-size: 0.8rem; font-weight: 600; }
    .fchip button { display: grid; place-items: center; width: 20px; height: 20px; padding: 0; border: 0; border-radius: 50%; background: none; color: var(--text-muted); }
    .fchip button:hover { background: var(--border); color: var(--text); }
    .fchip app-icon { width: 11px; height: 11px; }
    .link { border: 0; background: none; padding: 0; font-size: 0.8rem; color: var(--accent); }
    .stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; padding: 14px 16px; }
    .stat { display: flex; flex-direction: column; gap: 2px; padding: 11px 14px; border-radius: var(--radius-lg); background: var(--surface-2); }
    .stat b { font-size: 1.45rem; font-weight: 800; letter-spacing: -0.02em; line-height: 1.2; font-variant-numeric: tabular-nums; }
    .stat.sales b { color: var(--accent); }
    .stat.quiet b { color: var(--text-muted); font-weight: 600; }
    @media (max-width: 720px) { .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    .cancel-link:hover:not(:disabled) { color: var(--danger); }
    .sub { display: block; color: var(--text-muted); font-size: 0.74rem; font-weight: 400; }
    .film { max-width: 220px; }
    .film-name { display: block; font-weight: 600; }
    .seats { max-width: 130px; }
    .seats .truncate { display: block; }
  `,
})
export class CounterHistoryPage {
  /** ?ref=<booking ref>: opens and highlights that booking (audit links use it). */
  readonly ref = input<string>();

  readonly store = inject(AdminStore);
  private readonly router = inject(Router);

  readonly methods = COUNTER_PAYMENT_METHODS;
  readonly money = formatMoney;
  readonly formatNumber = formatNumber;
  readonly day = formatDay;
  readonly time = formatTime;

  readonly hasAccess = computed(() => this.store.can('counter.history.own') || this.store.can('counter.history.all'));
  readonly allAccess = computed(() => this.store.can('counter.history.all'));
  readonly canCancel = computed(() => this.store.can('counter.cancel'));

  readonly opDate = computed(() => toDateInput(this.store.operationalDate()));
  /** yyyy-mm-dd of the business date, or '' for all dates. Follows the header's operational date. */
  readonly date = linkedSignal(() => this.opDate());
  readonly dateLabel = computed(() => (this.date() ? formatDate(fromDateInput(this.date())) : 'any date'));
  readonly query = signal('');
  readonly movie = signal('');
  readonly screen = signal('');
  readonly show = signal('');
  readonly method = signal('');
  readonly status = signal('');
  readonly operator = signal('');
  readonly highlight = signal('');

  readonly filtersOpen = signal(false);
  readonly openId = signal<string | null>(null);
  readonly dialog = signal<Dialog | null>(null);

  readonly rows = computed(() => visibleCounterRows(this.store));

  /** Rows on the business date: the base for the option lists. */
  private readonly onDate = computed(() => {
    const d = this.date() ? fromDateInput(this.date()) : null;
    return d ? this.rows().filter((r) => sameDay(r.booking.bookedAt, d)) : this.rows();
  });

  readonly movieOptions = computed(() => uniq(this.onDate().map((r) => ({ id: r.movieId, label: r.film }))));
  readonly screenOptions = computed(() => uniq(this.onDate().map((r) => ({ id: r.screenId, label: r.screen }))).sort((a, b) => a.label.localeCompare(b.label, 'en', { numeric: true })));
  readonly operatorOptions = computed(() => [...new Set(this.rows().map((r) => r.operator))].sort());
  readonly showOptions = computed(() => {
    const map = new Map<string, { id: string; label: string; start: number }>();
    for (const r of this.onDate()) {
      if (!r.show || map.has(r.show.id)) continue;
      if (this.movie() && r.movieId !== this.movie()) continue;
      if (this.screen() && r.screenId !== this.screen()) continue;
      map.set(r.show.id, { id: r.show.id, start: r.show.start.getTime(), label: `${r.film} · ${r.screen} · ${formatDay(r.show.start)} ${formatTime(r.show.start)}` });
    }
    return [...map.values()].sort((a, b) => a.start - b.start);
  });

  readonly filtered = computed(() => {
    const q = this.query().trim().toUpperCase();
    const { movie, screen, show, method, status, operator } = { movie: this.movie(), screen: this.screen(), show: this.show(), method: this.method(), status: this.status(), operator: this.operator() };
    return this.onDate().filter((r) => {
      const b = r.booking;
      if (q && !(b.ref.includes(q) || b.ticketRefs.some((t) => t.includes(q)) || (b.counterPayment?.txnRef ?? '').includes(q))) return false;
      if (movie && r.movieId !== movie) return false;
      if (screen && r.screenId !== screen) return false;
      if (show && b.showId !== show) return false;
      if (method && r.method !== method) return false;
      if (status === 'refund-due' ? !(r.refund && r.refund.status !== 'successful') : status && b.status !== status) return false;
      if (operator && r.operator !== operator) return false;
      return true;
    });
  });

  readonly totals = computed(() => {
    const list = this.filtered();
    const ok = list.filter((r) => r.booking.status === 'confirmed');
    return { count: list.length, tickets: ok.reduce((n, r) => n + r.tickets, 0), amount: ok.reduce((n, r) => n + r.booking.amount, 0), cancelled: list.length - ok.length };
  });

  readonly table = tableState(this.filtered, {
    ref: (r) => r.booking.ref,
    show: (r) => r.showStart,
    tickets: (r) => r.tickets,
    amount: (r) => r.booking.amount,
    method: (r) => r.method,
    booked: (r) => r.booking.bookedAt,
    operator: (r) => r.operator,
    status: (r) => r.booking.status,
  }, 'booked', 'desc', 25);

  /** The filters in force (other than the search box and the date), each removable on its own. */
  readonly chips = computed(() => {
    const out: { key: string; group: string; label: string; clear: () => void }[] = [];
    const opt = (list: { id: string; label: string }[], id: string) => list.find((o) => o.id === id)?.label ?? id;
    if (this.movie()) out.push({ key: 'film', group: 'Film', label: opt(this.movieOptions(), this.movie()), clear: () => { this.movie.set(''); this.show.set(''); } });
    if (this.screen()) out.push({ key: 'screen', group: 'Screen', label: opt(this.screenOptions(), this.screen()), clear: () => { this.screen.set(''); this.show.set(''); } });
    if (this.show()) out.push({ key: 'show', group: 'Show', label: opt(this.showOptions(), this.show()), clear: () => this.show.set('') });
    if (this.method()) out.push({ key: 'method', group: 'Payment', label: this.method(), clear: () => this.method.set('') });
    if (this.status()) out.push({ key: 'status', group: 'Status', label: { confirmed: 'Confirmed', cancelled: 'Cancelled', 'refund-due': 'Refund not completed' }[this.status()] ?? this.status(), clear: () => this.status.set('') });
    if (this.operator()) out.push({ key: 'op', group: 'Operator', label: this.operator(), clear: () => this.operator.set('') });
    return out;
  });

  readonly hasFilters = computed(() => !!(this.query() || this.movie() || this.screen() || this.show() || this.method() || this.status() || this.operator()));

  constructor() {
    effect(() => {
      this.query(); this.date(); this.movie(); this.screen(); this.show(); this.method(); this.status(); this.operator();
      this.table.reset();
    });
    // ?ref= finds the booking across all dates, highlights it and opens it.
    effect(() => {
      const ref = this.ref()?.trim().toUpperCase();
      if (!ref || this.store.loading()) return;
      untracked(() => {
        const row = this.rows().find((r) => r.booking.ref === ref || r.booking.ticketRefs.includes(ref));
        this.query.set(ref);
        this.date.set('');
        this.highlight.set(row?.booking.ref ?? '');
        if (row) this.openId.set(row.booking.id);
        this.router.navigate([], { queryParams: { ref: null }, queryParamsHandling: 'merge', replaceUrl: true });
      });
    });
  }

  /** The ticket reference the search matched, when it matched a ticket rather than the booking. */
  matchedTicket(row: CounterRow): string | null {
    const q = this.query().trim().toUpperCase();
    return q.includes('-') ? row.booking.ticketRefs.find((t) => t === q) ?? null : null;
  }

  /** Previous or next business day; does nothing while all dates are shown. */
  shiftDay(by: number): void {
    if (!this.date()) return;
    const d = fromDateInput(this.date());
    d.setDate(d.getDate() + by);
    this.date.set(toDateInput(d));
  }

  clearFilters(): void {
    this.query.set(''); this.movie.set(''); this.screen.set(''); this.show.set(''); this.method.set(''); this.status.set(''); this.operator.set(''); this.highlight.set('');
  }
}

function uniq(list: { id: string; label: string }[]): { id: string; label: string }[] {
  const map = new Map<string, { id: string; label: string }>();
  for (const o of list) if (o.id && !map.has(o.id)) map.set(o.id, o);
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
}
