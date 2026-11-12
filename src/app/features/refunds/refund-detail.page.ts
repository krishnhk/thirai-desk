import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { AdminStore } from '../../core/admin-store';
import { formatDateTime, formatDay, formatMoney, formatRelative, formatTime } from '../../core/format';
import { IconComponent } from '../../shared/icon.component';
import { EmptyStateComponent, PageHeaderComponent, SkeletonComponent, StatusBadgeComponent, statusTone } from '../../shared/ui';
import { RefundActions, refundRow } from './refund-actions';
import { RejectRefundDialog } from './reject-refund.dialog';
import { CashRefundDialog } from '../counter/history/cash-refund.dialog';
import { WALK_IN } from '../../core/models';

@Component({
  selector: 'app-refund-detail-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent, PageHeaderComponent, StatusBadgeComponent, EmptyStateComponent, SkeletonComponent, RejectRefundDialog, CashRefundDialog],
  template: `
    <div class="page">
      @if (store.loading()) {
        <app-page-header title="Refund" [crumbs]="[{ label: 'Refunds', link: '/refunds' }, { label: refundId() }]" />
        <section class="card"><app-skeleton [rows]="8" /></section>
      } @else if (view(); as v) {
        @let r = v.refund;
        <app-page-header [title]="'Refund for booking ' + v.ref" [crumbs]="[{ label: 'Refunds', link: '/refunds' }, { label: r.id }]"
          [subtitle]="(r.channel === 'counter' ? 'Counter booking · ' : 'Online booking · ') + r.reason + ' · requested ' + dateTime(r.requestedAt)">
          @if (actions.canHandBackCash(r)) {
            <button class="btn primary" type="button" [disabled]="!store.can('counter.refund')" [title]="store.can('counter.refund') ? '' : 'A counter supervisor must hand back cash.'" (click)="handingBack.set(true)"><app-icon name="rupee" />Hand back cash</button>
          }
          @if (actions.canApprove(r)) { <button class="btn" type="button" (click)="actions.approve([r])">Approve</button> }
          @if (actions.canReject(r)) { <button class="btn danger-ghost" type="button" (click)="rejecting.set(true)">Reject</button> }
          @if (actions.canInitiate(r)) { <button class="btn primary" type="button" (click)="actions.initiate([r])">Initiate refund</button> }
          @if (actions.canRetry(r)) { <button class="btn primary" type="button" (click)="actions.initiate([r], 'retry')"><app-icon name="refresh" />Retry refund</button> }
        </app-page-header>

        @if (r.method === 'Cash' && (r.status === 'pending' || r.status === 'approved')) {
          <div class="callout info"><app-icon name="rupee" /><span><strong>Hand back cash at the counter.</strong> {{ money(r.amount) }} is returned in cash at the box office, not through the payment gateway. Record the cash refund reference when it is handed over; the refund shows as successful only then.@if (!store.can('counter.refund')) { A counter supervisor must do this. }</span></div>
        } @else if (r.method === 'Cash' && r.status === 'successful') {
          <div class="callout success"><app-icon name="check" /><span><strong>{{ money(r.amount) }} handed back in cash.</strong> Cash refund reference <span class="mono">{{ r.cashRefundRef ?? '—' }}</span>, recorded {{ dateTime(r.updatedAt) }}.</span></div>
        } @else {
        @switch (r.status) {
          @case ('pending') {
            <div class="callout warning"><app-icon name="clock" /><span><strong>Waiting for approval.</strong> Approve it, send it straight away, or reject it if it is not due.</span></div>
          }
          @case ('approved') {
            <div class="callout info"><app-icon name="info" /><span><strong>Approved, not yet sent.</strong> No money has moved. Initiate the refund to send it to the payment gateway.</span></div>
          }
          @case ('processing') {
            <div class="callout processing"><span class="pulse" aria-hidden="true"></span><span><strong>Waiting for the payment gateway.</strong> Sent {{ relative(r.updatedAt) }} (attempt {{ r.attempts }}). The status changes here once the gateway confirms or declines the refund.</span></div>
          }
          @case ('successful') {
            <div class="callout success"><app-icon name="check" /><span><strong>{{ money(r.amount) }} credited to the customer.</strong> Gateway refund reference <span class="mono">{{ r.gatewayRef }}</span>, confirmed {{ dateTime(r.updatedAt) }}.</span></div>
          }
          @case ('failed') {
            <div class="callout danger"><app-icon name="alert" /><span><strong>The refund failed.</strong> {{ r.failureReason }} Retry the refund, or contact the customer if it fails again.</span></div>
          }
          @case ('rejected') {
            <div class="callout"><app-icon name="close" /><span><strong>Rejected.</strong> {{ v.lastNote }}</span></div>
          }
        }
        }

        <div class="layout">
          <div class="stack">
            <section class="card">
              <div class="card-head"><h2>Financial summary</h2><app-status-badge [status]="r.status" /></div>
              <div class="card-body">
                <dl class="ledger">
                  <dt>Ticket amount</dt><dd>{{ money(v.paid - v.fee) }}</dd>
                  <dt>Convenience fee</dt><dd>{{ money(v.fee) }}</dd>
                  <dt class="total-line">Original payment</dt><dd class="total-line">{{ money(v.paid) }}</dd>
                  @if (v.feeKept > 0) { <dt>Convenience fee kept</dt><dd class="minus">− {{ money(v.feeKept) }}</dd> }
                  @if (v.charges > 0) { <dt>Cancellation charges</dt><dd class="minus">− {{ money(v.charges) }}</dd> }
                  @if (!v.feeKept && !v.charges) { <dt>Deductions</dt><dd class="muted">None, full refund</dd> }
                  <dt class="refund-line">Refund amount</dt><dd class="refund-line">{{ money(r.amount) }}</dd>
                </dl>
              </div>
            </section>

            <div class="grid-2">
              <section class="card">
                <div class="card-head"><h2>Booking</h2></div>
                <div class="card-body">
                  @if (v.booking; as b) {
                    <dl class="facts">
                      <dt>Reference</dt><dd class="mono">@if (b.channel === 'counter') { <a [routerLink]="'/counter/history'" [queryParams]="{ ref: b.ref }">{{ b.ref }}</a> } @else { {{ b.ref }} }</dd>
                      <dt>Channel</dt><dd>{{ b.channel === 'counter' ? 'Counter (box office)' : 'Online' }}</dd>
                      @if (b.channel === 'counter') {
                        <dt>Customer</dt><dd>{{ walkIn }}</dd>
                        <dt>Sold by</dt><dd>{{ b.operator ?? '—' }}</dd>
                      } @else {
                        <dt>Customer</dt><dd>{{ b.customerName }}</dd>
                        <dt>Phone</dt><dd>{{ b.customerPhone }}</dd>
                        <dt>Email</dt><dd class="wrap">{{ b.customerEmail }}</dd>
                      }
                      <dt>Seats</dt><dd>{{ b.seats.join(', ') }} <span class="muted">({{ b.seats.length }})</span></dd>
                      <dt>Booked</dt><dd>{{ dateTime(b.bookedAt) }}</dd>
                      <dt>Booking status</dt><dd><app-status-badge [status]="b.status" /></dd>
                    </dl>
                  } @else {
                    <p class="muted small">Booking {{ r.bookingId }} is no longer on record.</p>
                  }
                </div>
              </section>

              <section class="card">
                <div class="card-head"><h2>Show</h2>@if (v.show) { <a class="small" [routerLink]="['/shows', v.show.id]">Open show</a> }</div>
                <div class="card-body">
                  @if (v.show; as s) {
                    <dl class="facts">
                      <dt>Film</dt><dd>{{ v.film }}</dd>
                      <dt>Theatre</dt><dd>{{ v.theatre }}</dd>
                      <dt>Screen</dt><dd>{{ v.screen }}</dd>
                      <dt>Date</dt><dd>{{ day(s.start) }}</dd>
                      <dt>Time</dt><dd>{{ time(s.start) }}</dd>
                      <dt>Show status</dt><dd><app-status-badge [status]="store.showStatus(s)" /></dd>
                      @if (s.cancellation; as c) { <dt>Cancelled for</dt><dd>{{ c.reason }}</dd> }
                    </dl>
                    @if (s.cancellation) { <a class="small more" routerLink="/refunds" [queryParams]="{ show: s.id }">All refunds for this show</a> }
                  } @else {
                    <p class="muted small">The show is no longer on record.</p>
                  }
                </div>
              </section>
            </div>

            <section class="card">
              <div class="card-head"><h2>Audit</h2><span class="muted small">{{ v.audit.length }} {{ v.audit.length === 1 ? 'entry' : 'entries' }}</span></div>
              @if (v.audit.length) {
                <ul class="audit">
                  @for (a of v.audit; track a.id) {
                    <li>
                      <span class="nowrap muted small">{{ dateTime(a.at) }}</span>
                      <span><strong>{{ a.user }}</strong> <span class="muted">({{ a.role }})</span> · {{ a.summary }}</span>
                    </li>
                  }
                </ul>
              } @else {
                <p class="card-body muted small">No audit entries for this refund yet. Approvals, gateway submissions and results are recorded here.</p>
              }
            </section>
          </div>

          <div class="stack">
            <section class="card">
              <div class="card-head"><h2>Payment</h2></div>
              <div class="card-body">
                <dl class="facts">
                  <dt>Method</dt><dd>{{ r.method }}</dd>
                  <dt>Payment ref</dt><dd class="mono">{{ v.booking?.paymentRef ?? '—' }}</dd>
                  @if (r.method === 'Cash') {
                    <dt>Cash refund ref</dt>
                    <dd>@if (r.cashRefundRef) { <span class="mono">{{ r.cashRefundRef }}</span> } @else { <span class="muted">Recorded when the cash is handed back</span> }</dd>
                  } @else {
                  <dt>Gateway refund</dt>
                  <dd>
                    @if (r.status === 'successful' && r.gatewayRef) { <span class="mono">{{ r.gatewayRef }}</span> }
                    @else if (r.status === 'processing') { <span class="muted">Waiting for the gateway</span> }
                    @else { <span class="muted">Issued once the refund succeeds</span> }
                  </dd>
                  }
                  <dt>Attempts</dt><dd>{{ r.attempts }}</dd>
                  <dt>Refund ID</dt><dd class="mono">{{ r.id }}</dd>
                  <dt>Last update</dt><dd>{{ dateTime(r.updatedAt) }}</dd>
                </dl>
              </div>
            </section>

            <section class="card">
              <div class="card-head"><h2>History</h2></div>
              <ol class="timeline">
                @for (e of v.history; track $index; let last = $last) {
                  <li [class.current]="last">
                    <span class="dot tone-{{ tone(e.status) }}"></span>
                    <div>
                      <div class="row-wrap"><app-status-badge [status]="e.status" /><span class="muted tiny">{{ dateTime(e.at) }}</span></div>
                      <p class="small soft">{{ e.note }}</p>
                      <p class="tiny muted">{{ e.by }}</p>
                    </div>
                  </li>
                }
                @if (r.status === 'processing') {
                  <li class="waiting"><span class="dot pulse"></span><p class="small muted">Waiting for the payment gateway…</p></li>
                }
              </ol>
            </section>
          </div>
        </div>

        @if (handingBack()) {
          <app-cash-refund-dialog [refundId]="r.id" (closed)="handingBack.set(false)" />
        }
        @if (rejecting()) {
          <app-reject-refund-dialog [amount]="r.amount" (closed)="rejecting.set(false)" (rejected)="reject($event)" />
        }
      } @else {
        <app-page-header title="Refund not found" [crumbs]="[{ label: 'Refunds', link: '/refunds' }, { label: refundId() }]" />
        <section class="card">
          <app-empty-state icon="refund" title="This refund does not exist" [text]="'There is no refund with the ID ' + refundId() + ', or it belongs to a theatre outside the current selection.'">
            <a class="btn" routerLink="/refunds">Back to refunds</a>
          </app-empty-state>
        </section>
      }
    </div>
  `,
  styles: `
    .layout { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 16px; align-items: start; }
    @media (max-width: 1180px) { .layout { grid-template-columns: minmax(0, 1fr); } }
    .layout .grid-2 { grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
    .ledger { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 9px 0; margin: 0; max-width: 520px; }
    .ledger dt { color: var(--text-muted); }
    .ledger dd { margin: 0; padding-left: 24px; text-align: right; font-weight: 600; white-space: nowrap; }
    .ledger .minus { color: var(--warning); }
    .ledger .total-line { padding-bottom: 9px; border-bottom: 1px solid var(--border); color: var(--text-soft); }
    .ledger .refund-line { padding-top: 4px; font-size: 1.15rem; font-weight: 700; color: var(--text); }
    .wrap { overflow-wrap: anywhere; }
    .more { display: inline-block; margin-top: 12px; }
    .callout.processing { border-color: var(--accent-line); background: var(--accent-soft); align-items: center; }
    .pulse { display: inline-block; flex-shrink: 0; width: 9px; height: 9px; border-radius: 50%; background: var(--accent); animation: pulse 1.2s ease-in-out infinite; }
    @keyframes pulse { 50% { opacity: 0.25; } }
    .timeline { list-style: none; margin: 0; padding: 16px 18px; display: flex; flex-direction: column; }
    .timeline li { position: relative; display: grid; grid-template-columns: 14px minmax(0, 1fr); gap: 12px; padding-bottom: 16px; }
    .timeline li:last-child { padding-bottom: 0; }
    .timeline li:not(:last-child)::before { content: ''; position: absolute; left: 6px; top: 16px; bottom: 0; width: 1px; background: var(--border); }
    .timeline li > div { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
    .dot { width: 13px; height: 13px; margin-top: 4px; border-radius: 50%; border: 3px solid var(--surface); background: var(--text-faint); box-shadow: 0 0 0 1px var(--border-strong); }
    .tone-warning { background: var(--warning); } .tone-info { background: var(--info); } .tone-accent { background: var(--accent); }
    .tone-success { background: var(--success); } .tone-danger { background: var(--danger); } .tone-neutral { background: var(--text-muted); }
    .waiting { align-items: center; }
    .waiting .dot { margin-top: 0; }
    .audit { list-style: none; margin: 0; padding: 0; }
    .audit li { display: grid; grid-template-columns: 170px minmax(0, 1fr); gap: 12px; padding: 10px 18px; border-bottom: 1px solid var(--border-soft); font-size: 0.85rem; }
    .audit li:last-child { border-bottom: 0; }
  `,
})
export class RefundDetailPage {
  readonly refundId = input.required<string>();

  readonly store = inject(AdminStore);
  readonly actions = inject(RefundActions);
  readonly rejecting = signal(false);
  readonly handingBack = signal(false);
  readonly walkIn = WALK_IN;

  readonly money = formatMoney;
  readonly dateTime = formatDateTime;
  readonly day = formatDay;
  readonly time = formatTime;
  readonly tone = statusTone;
  readonly relative = (d: Date) => formatRelative(d, this.store.now());

  readonly view = computed(() => {
    const r = this.store.refund(this.refundId());
    if (!r) return null;
    const row = refundRow(this.store, r);
    if (row.show && !this.store.inScope(row.show.theatreId)) return null;
    const paid = row.booking?.amount ?? r.amount;
    const fee = row.booking?.convenienceFee ?? 0;
    const withheld = Math.max(0, paid - r.amount);
    const feeKept = Math.min(fee, withheld);
    const link = `/refunds/${r.id}`;
    // Single-refund actions link here; seeded and gateway entries name the booking.
    const target = `Booking ${row.ref}`;
    return {
      ...row,
      paid, fee, feeKept,
      charges: withheld - feeKept,
      history: r.history,
      lastNote: r.history[r.history.length - 1]?.note ?? '',
      audit: this.store.audit().filter((a) => a.link === link || (a.target === target && a.action.startsWith('refund.'))).sort((a, b) => b.at.getTime() - a.at.getTime()),
    };
  });

  reject(note: string): void {
    const r = this.view()?.refund;
    if (r) this.actions.reject([r], note);
    this.rejecting.set(false);
  }
}
