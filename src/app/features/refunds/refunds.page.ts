import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { AdminStore } from '../../core/admin-store';
import { formatDateTime, formatDay, formatMoney, formatMoneyShort, formatRelative, formatTime, fromDateInput, addDays } from '../../core/format';
import { REFUND_STATUSES, Refund, RefundReason, RefundStatus } from '../../core/models';
import { IconComponent } from '../../shared/icon.component';
import { selectionState, tableState } from '../../shared/table';
import {
  EmptyStateComponent, PageHeaderComponent, PaginatorComponent, SkeletonComponent, SortHeaderComponent, StatusBadgeComponent,
} from '../../shared/ui';
import { RefundActions, RefundRow, refundRow } from './refund-actions';
import { RejectRefundDialog } from './reject-refund.dialog';
import { CashRefundDialog } from '../counter/history/cash-refund.dialog';

const REASONS: RefundReason[] = ['Show cancelled', 'Customer cancellation', 'Duplicate payment', 'Seat not available'];
const sum = (list: Refund[]) => list.reduce((n, r) => n + r.amount, 0);

@Component({
  selector: 'app-refunds-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink, IconComponent, PageHeaderComponent, StatusBadgeComponent, EmptyStateComponent, SkeletonComponent,
    PaginatorComponent, SortHeaderComponent, RejectRefundDialog, CashRefundDialog,
  ],
  template: `
    <div class="page">
      <app-page-header title="Refunds" />

      @if (store.loading()) {
        <section class="card"><app-skeleton [rows]="6" /></section>
      } @else {
        <p class="stats" aria-label="Summary">
          <span><b>{{ short(kpi().total.amount) }}</b> in {{ kpi().total.count }} refunds</span>
          <a class="st pending" routerLink="/refunds" [queryParams]="{ status: 'pending' }"><b>{{ short(kpi().pending.amount) }}</b> pending<small>({{ kpi().pending.count }} to approve · {{ kpi().approved.count }} approved)</small></a>
          <a class="st processing" routerLink="/refunds" [queryParams]="{ status: 'processing' }"><b>{{ short(kpi().processing.amount) }}</b> processing<small>({{ kpi().processing.count }})</small></a>
          <a class="st ok" routerLink="/refunds" [queryParams]="{ status: 'successful' }"><b>{{ short(kpi().successful.amount) }}</b> successful<small>({{ kpi().successful.count }})</small></a>
          @if (kpi().failed.count) { <a class="st bad" routerLink="/refunds" [queryParams]="{ status: 'failed' }"><b>{{ short(kpi().failed.amount) }}</b> failed<small>({{ kpi().failed.count }} to retry)</small></a> }
        </p>

        @if (showContext(); as sc) {
          <section class="card show-ctx">
            <div class="ctx-main">
              <span class="eyebrow">Refunds for one show</span>
              <strong>{{ sc.film }} · {{ sc.screen }}</strong>
              <span class="muted small">{{ sc.theatre }} · {{ sc.when }}</span>
              <span class="row-wrap small">
                <app-status-badge [status]="sc.status" />
                <span class="soft">{{ sc.successful }} of {{ sc.total }} refunded · {{ money(sc.outstanding) }} outstanding</span>
              </span>
            </div>
            <div class="ctx-actions">
              @if (sc.pending.length) { <button class="btn" type="button" (click)="actions.approve(sc.pending)">Approve {{ sc.pending.length }} pending</button> }
              @if (sc.failed.length) { <button class="btn" type="button" (click)="actions.initiate(sc.failed, 'retry')"><app-icon name="refresh" />Retry {{ sc.failed.length }} failed</button> }
              @if (sc.processing) { <span class="gw small soft"><span class="pulse" aria-hidden="true"></span>{{ sc.processing }} waiting for the gateway</span> }
              @if (sc.approved.length) {
                <button class="btn primary" type="button" (click)="actions.initiate(sc.approved)">
                  Process all approved ({{ sc.approved.length }} · {{ money(sumOf(sc.approved)) }})
                </button>
              }
              <button class="btn ghost" type="button" (click)="go({ show: null })">Clear show</button>
            </div>
          </section>
        }

        <section class="card">
          <div class="tabs" role="tablist" aria-label="Refund status">
            @for (t of statusTabs; track t) {
              <button class="tab" type="button" role="tab" [attr.aria-selected]="statusFilter() === t" (click)="go({ status: t === 'all' ? null : t })">
                {{ t === 'all' ? 'All' : label(t) }}<span class="count-pill">{{ counts()[t] ?? 0 }}</span>
              </button>
            }
          </div>

          <div class="bar">
            <div class="search-input grow">
              <app-icon name="search" />
              <input class="input" type="search" aria-label="Search refunds" placeholder="Search booking ref, customer, phone or refund ID" [value]="query()" (input)="query.set($any($event.target).value)" />
            </div>
            <select class="select" aria-label="Reason" [value]="reason()" (change)="reason.set($any($event.target).value)">
              <option value="">All reasons</option>
              @for (r of reasons; track r) { <option [value]="r" [selected]="r === reason()">{{ r }}</option> }
            </select>
            <select class="select show-field" aria-label="Show" (change)="go({ show: $any($event.target).value || null })">
              <option value="" [selected]="!show()">All shows</option>
              @for (o of showOptions(); track o.id) { <option [value]="o.id" [selected]="o.id === show()">{{ o.label }}</option> }
            </select>
            <div class="range" role="group" aria-label="Requested between">
              <input class="input" type="date" aria-label="Requested from" [value]="from()" (change)="from.set($any($event.target).value)" />
              <span class="to" aria-hidden="true">–</span>
              <input class="input" type="date" aria-label="Requested to" [value]="to()" (change)="to.set($any($event.target).value)" />
            </div>
            @if (hasFilters()) { <button class="btn ghost" type="button" (click)="clearFilters()">Reset</button> }
          </div>

          @if (selected().length) {
            <div class="bulk" role="region" aria-label="Bulk actions">
              <span><strong>{{ selected().length }} selected</strong> <span class="muted">· {{ money(sumOf(selected())) }}</span></span>
              <span class="spacer"></span>
              <button class="btn sm" type="button" [disabled]="!bulk().approve.length" (click)="actions.approve(bulk().approve)">Approve ({{ bulk().approve.length }})</button>
              <button class="btn sm primary" type="button" [disabled]="!bulk().initiate.length" (click)="actions.initiate(bulk().initiate)">Initiate ({{ bulk().initiate.length }})</button>
              <button class="btn sm" type="button" [disabled]="!bulk().retry.length" (click)="actions.initiate(bulk().retry, 'retry')">Retry ({{ bulk().retry.length }})</button>
              <button class="btn sm danger-ghost" type="button" [disabled]="!bulk().reject.length" (click)="rejecting.set(bulk().reject)">Reject ({{ bulk().reject.length }})</button>
              <button class="btn sm ghost" type="button" (click)="sel.clear()">Clear</button>
            </div>
          }

          @if (table.total()) {
            <div class="table-wrap">
              <table class="data-table">
                <thead>
                  <tr>
                    <th class="check-col"><input type="checkbox" aria-label="Select all on this page" [checked]="sel.allOf(pageIds())" (change)="sel.setAll(pageIds(), $any($event.target).checked)" /></th>
                    <th><app-sort-header [active]="table.isSorted('ref')" [dir]="table.dir()" (toggle)="table.sortBy('ref')">Booking</app-sort-header></th>
                    <th><app-sort-header [active]="table.isSorted('customer')" [dir]="table.dir()" (toggle)="table.sortBy('customer')">Customer</app-sort-header></th>
                    <th><app-sort-header [active]="table.isSorted('show')" [dir]="table.dir()" (toggle)="table.sortBy('show')">Show</app-sort-header></th>
                    <th><app-sort-header [active]="table.isSorted('amount')" [dir]="table.dir()" (toggle)="table.sortBy('amount')">Refund</app-sort-header></th>
                    <th><app-sort-header [active]="table.isSorted('status')" [dir]="table.dir()" (toggle)="table.sortBy('status')">Status</app-sort-header></th>
                    <th class="col-req"><app-sort-header [active]="table.isSorted('requested')" [dir]="table.dir()" (toggle)="table.sortBy('requested')">Requested</app-sort-header></th>
                    <th class="actions-col"><span class="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of table.rows(); track row.refund.id) {
                    @let r = row.refund;
                    <tr class="clickable" [class.selected]="sel.has(r.id)" (click)="open(r.id)">
                      <td class="check-col" (click)="$event.stopPropagation()"><input type="checkbox" [attr.aria-label]="'Select refund for ' + row.ref" [checked]="sel.has(r.id)" (change)="sel.toggle(r.id, $any($event.target).checked)" /></td>
                      <td class="nowrap"><a class="mono strong ref" [routerLink]="['/refunds', r.id]" (click)="$event.stopPropagation()">{{ row.ref }}</a><span class="channel" [class.counter]="row.channel === 'counter'">{{ row.channel === 'counter' ? 'Counter' : 'Online' }}</span><small class="sub mono">{{ r.id }}</small></td>
                      <td class="nowrap">{{ row.customer }}<small class="sub">{{ row.channel === 'counter' && row.operator ? 'Sold by ' + row.operator + ' · ' : '' }}{{ r.reason }}</small></td>
                      <td class="film"><span class="truncate film-name" [title]="row.film">{{ row.film }}</span><small class="sub nowrap">{{ row.screen }} · {{ row.show ? day(row.show.start) + ', ' + time(row.show.start) : '' }}</small>@if (showTheatre()) {<small class="sub nowrap">{{ row.theatre }}</small>}</td>
                      <td><span class="two"><strong>{{ money(r.amount) }}</strong><small>of {{ money(row.paid) }} · {{ r.method }}</small></span></td>
                      <td>
                        <app-status-badge [status]="r.status" [label]="r.status === 'processing' && r.attempts > 1 ? 'Processing (retry ' + (r.attempts - 1) + ')' : ''" />
                        @if (r.status === 'processing') { <small class="sub gw"><span class="pulse" aria-hidden="true"></span>Waiting for the gateway</small> }
                        @if (r.status === 'failed' && r.failureReason) { <small class="sub fail truncate" [title]="r.failureReason">{{ r.failureReason }}</small> }
                      </td>
                      <td class="nowrap col-req" [title]="dateTime(r.requestedAt)">{{ day(r.requestedAt) }}<small class="sub">{{ relative(r.requestedAt) }}</small></td>
                      <td class="actions-col" (click)="$event.stopPropagation()">
                        @if (actions.canHandBackCash(r)) {
                          <button class="btn sm" type="button" [disabled]="!store.can('counter.refund')" [title]="store.can('counter.refund') ? 'Hand back cash at the counter' : 'A counter supervisor must hand back cash.'" (click)="cashRefundId.set(r.id)"><app-icon name="rupee" />Hand back cash</button>
                        } @else {
                        @switch (r.status) {
                          @case ('pending') { <button class="btn sm" type="button" (click)="actions.approve([r])">Approve</button> }
                          @case ('approved') { <button class="btn sm" type="button" (click)="actions.initiate([r])">Initiate</button> }
                          @case ('failed') { <button class="btn sm" type="button" (click)="actions.initiate([r], 'retry')"><app-icon name="refresh" />Retry</button> }
                        }
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            @if (table.total() > table.size()) { <app-paginator [(page)]="table.page" [(pageSize)]="table.size" [total]="table.total()" /> }
          } @else {
            <app-empty-state icon="refund" [title]="hasFilters() || statusFilter() !== 'all' ? 'No refunds match these filters' : 'No refunds yet'"
              [text]="hasFilters() || statusFilter() !== 'all' ? 'Change the status, show or dates, or clear the filters.' : 'Refunds appear here when a show is cancelled or a customer cancels a booking.'">
              @if (hasFilters() || statusFilter() !== 'all') { <button class="btn" type="button" (click)="clearFilters(); go({ status: null })">Clear filters</button> }
            </app-empty-state>
          }
        </section>
      }
    </div>

    @if (cashRefundId(); as id) {
      <app-cash-refund-dialog [refundId]="id" (closed)="cashRefundId.set(null)" />
    }

    @if (rejecting(); as list) {
      <app-reject-refund-dialog [count]="list.length" [amount]="sumOf(list)" (closed)="rejecting.set(null)" (rejected)="reject(list, $event)" />
    }
  `,
  styles: `
    .stats { display: flex; flex-wrap: wrap; gap: 4px 22px; margin: 0; padding: 0 4px; font-size: 0.86rem; color: var(--text-muted); }
    .stats b { color: var(--text); font-weight: 700; }
    .stats small { margin-left: 5px; font-size: inherit; }
    .stats a.st { color: var(--text-muted); }
    .stats a.st:hover { color: var(--text); }
    .stats .pending b { color: var(--warning); } .stats .processing b { color: var(--accent); } .stats .ok b { color: var(--success); } .stats .bad b { color: var(--danger); }
    .show-ctx { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 14px 20px; padding: 14px 18px; border-color: var(--border-strong); }
    .ctx-main { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
    .ctx-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .bar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 14px 16px; }
    .bar .grow { flex: 1 1 260px; min-width: 220px; }
    .bar .select { width: auto; min-width: 130px; max-width: 200px; }
    .bar .select.show-field { max-width: 260px; }
    .bar .input, .bar .select { height: 36px; min-height: 36px; padding-top: 0; padding-bottom: 0; }
    .range { display: inline-flex; align-items: center; gap: 6px; }
    .range .input { width: 140px; }
    .to { color: var(--text-muted); }
    .bulk { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 9px 16px; border-bottom: 1px solid var(--border); background: var(--surface-2); font-size: 0.85rem; }
    .sub { display: block; color: var(--text-muted); font-size: 0.74rem; font-weight: 400; }
    .ref { color: var(--text); }
    .ref:hover { color: var(--accent); }
    .film { max-width: 230px; }
    .film-name { display: block; font-weight: 600; }
    .table-wrap { position: relative; border-top: 1px solid var(--border); }
    .data-table th, .data-table td { padding-left: 12px; padding-right: 12px; }
    .two { display: flex; flex-direction: column; gap: 1px; white-space: nowrap; }
    .two small { color: var(--text-muted); font-size: 0.76rem; }
    .gw { display: flex; align-items: center; gap: 6px; margin-top: 3px; white-space: nowrap; }
    .fail { max-width: 160px; margin-top: 3px; color: var(--danger); }
    .pulse { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); animation: pulse 1.2s ease-in-out infinite; }
    @keyframes pulse { 50% { opacity: 0.25; } }
    .actions-col .btn + .btn { margin-left: 4px; }
    .channel { display: inline-block; margin-left: 6px; padding: 0 6px; border: 1px solid var(--border); border-radius: var(--radius-sm); color: var(--text-muted); font-size: 0.68rem; font-weight: 700; vertical-align: 1px; }
    .channel.counter { border-color: var(--info-line); color: var(--info); }

    /* Fixed column widths, so the header stays put whichever status is chosen. */
    @media (min-width: 1181px) {
      .data-table { table-layout: fixed; width: 100%; }
      .data-table th:nth-child(1) { width: 44px; }
      .data-table th:nth-child(2) { width: 17%; }
      .data-table th:nth-child(3) { width: 22%; }
      .data-table th:nth-child(4) { width: 20%; }
      .data-table th:nth-child(5) { width: 14%; }
      .data-table th:nth-child(6) { width: 15%; }
      .data-table th:nth-child(7) { width: 112px; }
      .data-table th.actions-col { width: 124px; }
      .data-table td { overflow: hidden; text-overflow: ellipsis; }
      .data-table td.check-col { overflow: visible; text-overflow: clip; }
      .two > * { overflow: hidden; text-overflow: ellipsis; }
      .film { max-width: none; }
    }
    @media (max-width: 1500px) { .col-req { display: none; } }
    /* Narrower than the table needs: each refund becomes a card. */
    @media (max-width: 1180px) {
      .data-table, .data-table tbody, .data-table tr, .data-table td { display: block; }
      .data-table thead { display: none; }
      .data-table tr { display: grid; grid-template-columns: 28px minmax(0, 1fr) auto; column-gap: 12px; row-gap: 4px; padding: 14px 16px; border-bottom: 1px solid var(--border-soft); }
      .data-table td { padding: 0; border: 0; white-space: normal; }
      .data-table td.check-col { grid-column: 1; grid-row: 1 / span 4; width: auto; padding-top: 3px; }
      .data-table td:nth-child(2) { grid-column: 2; grid-row: 1; }
      .data-table td:nth-child(3) { grid-column: 2; grid-row: 2; }
      .data-table td:nth-child(4) { grid-column: 2; grid-row: 3; max-width: none; }
      .data-table td:nth-child(5) { grid-column: 2; grid-row: 4; }
      .data-table td:nth-child(6) { grid-column: 3; grid-row: 1; justify-self: end; }
      .data-table td.actions-col { grid-column: 3; grid-row: 2 / span 3; align-self: start; justify-self: end; width: auto; }
      .col-req { display: none !important; }
      .two { white-space: normal; }
    }
    @media (max-width: 760px) { .range { flex: 1 1 100%; } .range .input { flex: 1; width: auto; } .bar .select { flex: 1 1 130px; max-width: none; } }
  `,
})
export class RefundsPage {
  /** ?status=pending */
  readonly status = input<string>();
  /** ?show=<showId> */
  readonly show = input<string>();

  readonly store = inject(AdminStore);
  readonly actions = inject(RefundActions);
  private readonly router = inject(Router);

  readonly reasons = REASONS;
  readonly statusTabs = ['all', ...REFUND_STATUSES] as const;
  readonly query = signal('');
  readonly reason = signal('');
  readonly from = signal('');
  readonly to = signal('');
  readonly rejecting = signal<Refund[] | null>(null);
  readonly cashRefundId = signal<string | null>(null);
  readonly sel = selectionState();

  readonly money = formatMoney;
  readonly short = formatMoneyShort;
  readonly dateTime = formatDateTime;
  readonly day = formatDay;
  readonly time = formatTime;
  readonly relative = (d: Date) => formatRelative(d, this.store.now());
  readonly label = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  readonly sumOf = sum;

  readonly statusFilter = computed(() => {
    const s = this.status();
    return s && (REFUND_STATUSES as readonly string[]).includes(s) ? (s as RefundStatus) : 'all';
  });
  readonly showTheatre = computed(() => this.store.selectedTheatreId() === 'all');

  readonly rows = computed<RefundRow[]>(() => this.store.scopedRefunds().map((r) => refundRow(this.store, r)));

  readonly kpi = computed(() => {
    const list = this.store.scopedRefunds();
    const pick = (s: RefundStatus) => { const l = list.filter((r) => r.status === s); return { count: l.length, amount: sum(l) }; };
    const live = list.filter((r) => r.status !== 'rejected');
    return {
      total: { count: live.length, amount: sum(live) },
      pending: pick('pending'), approved: pick('approved'), processing: pick('processing'), successful: pick('successful'), failed: pick('failed'),
    };
  });

  /** Everything except the status filter, so the tab counts follow the other filters. */
  private readonly beforeStatus = computed(() => {
    const q = this.query().trim().toLowerCase();
    const reason = this.reason();
    const showId = this.show();
    const from = this.from() ? fromDateInput(this.from()) : null;
    const to = this.to() ? addDays(fromDateInput(this.to()), 1) : null;
    return this.rows().filter((row) => {
      const r = row.refund;
      if (showId && r.showId !== showId) return false;
      if (reason && r.reason !== reason) return false;
      if (from && r.requestedAt < from) return false;
      if (to && r.requestedAt >= to) return false;
      if (q) {
        const hay = `${row.ref} ${row.customer} ${row.booking?.customerPhone ?? ''} ${row.booking?.customerEmail ?? ''} ${r.id} ${row.booking?.paymentRef ?? ''} ${row.operator ?? ''} ${r.cashRefundRef ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  });

  readonly counts = computed(() => {
    const out: Record<string, number> = { all: this.beforeStatus().length };
    for (const row of this.beforeStatus()) out[row.refund.status] = (out[row.refund.status] ?? 0) + 1;
    return out;
  });

  readonly filtered = computed(() => {
    const s = this.statusFilter();
    return s === 'all' ? this.beforeStatus() : this.beforeStatus().filter((row) => row.refund.status === s);
  });

  private readonly statusRank: Record<RefundStatus, number> = { failed: 0, pending: 1, approved: 2, processing: 3, successful: 4, rejected: 5 };
  readonly table = tableState(this.filtered, {
    ref: (x) => x.ref,
    customer: (x) => x.customer,
    show: (x) => x.show?.start,
    tickets: (x) => x.tickets,
    paid: (x) => x.paid,
    amount: (x) => x.refund.amount,
    status: (x) => this.statusRank[x.refund.status],
    requested: (x) => x.refund.requestedAt,
  }, 'requested', 'desc', 25);

  readonly pageIds = computed(() => this.table.rows().map((x) => x.refund.id));

  /** Only selected refunds that are still visible are acted on. */
  readonly selected = computed(() => this.filtered().filter((x) => this.sel.has(x.refund.id)).map((x) => x.refund));
  readonly bulk = computed(() => {
    const list = this.selected();
    return {
      approve: list.filter((r) => this.actions.canApprove(r)),
      initiate: list.filter((r) => this.actions.canInitiate(r)),
      retry: list.filter((r) => this.actions.canRetry(r)),
      reject: list.filter((r) => this.actions.canReject(r)),
    };
  });

  readonly showOptions = computed(() => {
    const seen = new Map<string, { id: string; label: string; start: number }>();
    for (const row of this.rows()) {
      if (!row.show || seen.has(row.show.id)) continue;
      const s = row.show;
      seen.set(s.id, { id: s.id, start: s.start.getTime(), label: `${row.film} · ${row.screen} · ${formatDay(s.start)} ${formatTime(s.start)}${s.cancellation ? ' (cancelled)' : ''}` });
    }
    return [...seen.values()].sort((a, b) => b.start - a.start);
  });

  readonly showContext = computed(() => {
    const id = this.show();
    const s = id ? this.store.show(id) : undefined;
    if (!s) return null;
    const list = this.store.refundsOf(s.id).filter((r) => this.store.inScope(s.theatreId));
    return {
      film: this.store.movie(s.movieId)?.title ?? 'Film',
      screen: this.store.screen(s.screenId)?.name ?? 'Screen',
      theatre: this.store.theatre(s.theatreId)?.name ?? '',
      when: `${formatDay(s.start)}, ${formatTime(s.start)}`,
      status: this.store.showStatus(s),
      total: list.filter((r) => r.status !== 'rejected').length,
      successful: list.filter((r) => r.status === 'successful').length,
      outstanding: sum(list.filter((r) => r.status !== 'successful' && r.status !== 'rejected')),
      pending: list.filter((r) => r.status === 'pending'),
      approved: list.filter((r) => r.status === 'approved' && this.actions.canInitiate(r)),
      failed: list.filter((r) => r.status === 'failed' && this.actions.canRetry(r)),
      processing: list.filter((r) => r.status === 'processing').length,
    };
  });

  readonly hasFilters = computed(() => !!(this.query() || this.reason() || this.from() || this.to() || this.show()));

  constructor() {
    // Back to the first page whenever the filters change.
    effect(() => {
      this.query(); this.reason(); this.from(); this.to(); this.show(); this.statusFilter();
      this.table.reset();
    });
  }

  go(params: { status?: string | null; show?: string | null }): void {
    this.router.navigate([], { queryParams: params, queryParamsHandling: 'merge', replaceUrl: true });
  }

  clearFilters(): void {
    this.query.set('');
    this.reason.set('');
    this.from.set('');
    this.to.set('');
    if (this.show()) this.go({ show: null });
  }

  open(id: string): void {
    this.router.navigate(['/refunds', id]);
  }

  reject(list: Refund[], note: string): void {
    this.actions.reject(list, note);
    this.rejecting.set(null);
    this.sel.clear();
  }
}
