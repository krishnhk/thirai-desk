import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { AdminStore } from '../../../core/admin-store';
import { addMinutes, formatDateTime, formatDay, formatMoney, formatTime } from '../../../core/format';
import { WALK_IN } from '../../../core/models';
import { ActivityTimelineComponent } from '../../../shared/activity-timeline.component';
import { PrintMode, TicketPrinter, TicketSheetPreviewComponent } from '../../../shared/counter-ticket.component';
import { PrintOptionsComponent } from '../../../shared/print-options.component';
import { ToastService } from '../../../shared/feedback';
import { IconComponent } from '../../../shared/icon.component';
import { ModalComponent } from '../../../shared/modal.component';
import { StatusBadgeComponent } from '../../../shared/ui';
import { counterRows, seatCategories } from './counter-data';

type Tab = 'details' | 'tickets' | 'activity';

/** One counter booking: show, read-only payment record, refund, tickets with preview and reprint, audit. */
@Component({
  selector: 'app-booking-detail-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent, ModalComponent, StatusBadgeComponent, TicketSheetPreviewComponent, PrintOptionsComponent, ActivityTimelineComponent],
  template: `
    @if (view(); as v) {
      @let b = v.row.booking;
      <app-modal [title]="'Booking ' + b.ref" [eyebrow]="'Counter sale · ' + walkIn" size="lg" (closed)="closed.emit()">
        <div class="summary">
          <div class="who">
            <strong>{{ v.row.film }}</strong>
            <span class="muted small">{{ v.row.screen }} · {{ v.when }} · {{ b.seats.length }} {{ b.seats.length === 1 ? 'ticket' : 'tickets' }} · {{ money(b.amount) }}</span>
          </div>
          <div class="row-wrap">
            <app-status-badge [status]="b.status" />
            @if (v.row.refund; as r) { <app-status-badge [status]="r.status" [label]="'Refund ' + r.status" /> }
          </div>
        </div>

        <div class="tabs" role="tablist" aria-label="Booking sections">
          <button class="tab" type="button" role="tab" [attr.aria-selected]="tab() === 'details'" (click)="tab.set('details')">Details</button>
          <button class="tab" type="button" role="tab" [attr.aria-selected]="tab() === 'tickets'" (click)="tab.set('tickets')">Tickets<span class="count-pill">{{ b.seats.length }}</span></button>
          <button class="tab" type="button" role="tab" [attr.aria-selected]="tab() === 'activity'" (click)="tab.set('activity')">Activity<span class="count-pill">{{ v.audit.length }}</span></button>
        </div>

        @switch (tab()) {
          @case ('details') {
            <div class="grid-2 sections">
              <section>
                <h3 class="eyebrow">Show</h3>
                <dl class="facts">
                  <dt>Film</dt><dd>{{ v.row.film }}</dd>
                  <dt>Screen</dt><dd>{{ v.row.screen }}</dd>
                  <dt>Date and time</dt><dd>{{ v.when }}</dd>
                  <dt>Show status</dt><dd>@if (v.row.show) { <app-status-badge [status]="store.showStatus(v.row.show)" /> }</dd>
                  <dt>Seats</dt><dd>{{ b.seats.join(', ') }}</dd>
                  <dt>Customer</dt><dd>{{ walkIn }}</dd>
                  <dt>Sold by</dt><dd>{{ b.operator }}</dd>
                  <dt>Sold at</dt><dd>{{ dateTime(b.bookedAt) }}</dd>
                  @if (b.cancelledAt) { <dt>Cancelled at</dt><dd>{{ dateTime(b.cancelledAt) }}</dd> }
                </dl>
              </section>
              <section>
                <h3 class="eyebrow row"><app-icon name="lock" />Payment record</h3>
                @if (b.counterPayment; as p) {
                  <dl class="facts">
                    <dt>Method</dt><dd>{{ p.method }}</dd>
                    <dt>Amount payable</dt><dd>{{ money(b.amount) }}</dd>
                    <dt>Amount collected</dt><dd>{{ money(p.amountCollected) }}</dd>
                    @if (p.method === 'Cash') { <dt>Change returned</dt><dd>{{ money(p.change) }}</dd> }
                    <dt>Transaction ref</dt><dd class="mono">{{ p.txnRef ?? '—' }}</dd>
                    <dt>Payment ref</dt><dd class="mono">{{ b.paymentRef }}</dd>
                    <dt>Confirmed at</dt><dd>{{ dateTime(p.confirmedAt) }}</dd>
                  </dl>
                } @else {
                  <p class="muted small">No payment record.</p>
                }
                <p class="tiny muted lock">Payment records are fixed when the sale is confirmed and cannot be edited.</p>
              </section>
            </div>

            <section class="refund">
              <h3 class="eyebrow">Refund</h3>
              @if (v.row.refund; as r) {
                <div class="refund-row">
                  <div class="stack-sm">
                    <span class="row-wrap"><strong>{{ money(r.amount) }}</strong><span class="muted small">to {{ r.method === 'Cash' ? 'hand back in cash' : 'the original ' + r.method + ' payment ' + b.paymentRef }}</span></span>
                    <span class="small soft">
                      @switch (r.status) {
                        @case ('successful') { {{ r.method === 'Cash' ? 'Handed back in cash, reference ' + (r.cashRefundRef ?? '—') : 'Credited by the gateway, reference ' + (r.gatewayRef ?? '—') }}. }
                        @case ('processing') { Waiting for the payment gateway to confirm. }
                        @case ('failed') { The gateway declined it: {{ r.failureReason }} }
                        @default { {{ r.method === 'Cash' ? 'Approved. The cash has not been handed back yet.' : 'Approved. Not yet sent to the payment gateway.' }} }
                      }
                    </span>
                  </div>
                  <div class="row-wrap">
                    <app-status-badge [status]="r.status" />
                    @if (r.method === 'Cash' && (r.status === 'approved' || r.status === 'pending')) {
                      <button class="btn sm primary" type="button" [disabled]="!store.can('counter.refund')" [title]="store.can('counter.refund') ? '' : 'A counter supervisor must hand back cash.'" (click)="handBack.emit(r.id)"><app-icon name="rupee" />Hand back cash</button>
                    }
                    <a class="btn sm" [routerLink]="['/refunds', r.id]" (click)="closed.emit()">Open refund</a>
                  </div>
                </div>
              } @else if (b.status === 'cancelled') {
                <p class="muted small">Cancelled with the show; see Refunds for its refund.</p>
              } @else if (v.quote.eligible) {
                <p class="muted small">No refund. Cancellable until {{ v.cutoff }}: {{ money(v.quote.refundable) }} would be refunded after a {{ money(v.quote.deduction) }} cancellation fee.</p>
              } @else {
                <p class="muted small">No refund. {{ v.quote.reason }}</p>
              }
            </section>
          }
          @case ('tickets') {
            <div class="table-wrap tickets">
              <table class="data-table">
                <thead><tr><th>Ticket ref</th><th>Seat</th><th>Class</th><th class="num">Price</th></tr></thead>
                <tbody>
                  @for (seat of b.seats; track seat; let i = $index) {
                    <tr><td class="mono">{{ b.ticketRefs[i] }}</td><td class="strong">{{ seat }}</td><td>{{ v.categories[i] }}</td><td class="num money">{{ money(v.prices[i] ?? 0) }}</td></tr>
                  }
                </tbody>
              </table>
            </div>
            <p class="small soft prints"><app-icon name="ticket" />{{ printLine(b.printCount) }}</p>
            <app-print-options [seatCount]="b.seats.length" [(mode)]="mode" />
            <div class="preview"><app-ticket-sheet-preview [booking]="b" [mode]="mode()" [reprint]="b.printCount > 1" /></div>
          }
          @case ('activity') {
            <app-activity-timeline [entries]="v.audit" [compact]="true" emptyText="No activity recorded for this booking." />
          }
        }

        <ng-container footer>
          @if (b.status === 'confirmed' && !store.can('counter.cancel')) { <span class="muted small note">A counter supervisor must approve cancellations.</span> }
          <button class="btn danger-ghost" type="button" [disabled]="b.status !== 'confirmed' || !store.can('counter.cancel') || !v.quote.eligible"
            [title]="!store.can('counter.cancel') ? 'A counter supervisor must approve cancellations.' : v.quote.eligible ? '' : v.quote.reason" (click)="cancel.emit(b.id)">Cancel booking</button>
          <button class="btn" type="button" [disabled]="b.status !== 'confirmed'" [title]="b.status === 'confirmed' ? '' : 'Cancelled tickets cannot be printed.'" (click)="reprint()"><app-icon name="ticket" />{{ mode() === 'separate' && b.seats.length > 1 ? 'Reprint ' + b.seats.length + ' tickets' : 'Reprint ticket' }}</button>
          <button class="btn primary" type="button" (click)="closed.emit()">Close</button>
        </ng-container>
      </app-modal>
    }
  `,
  styles: `
    .summary { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px 16px; margin-bottom: 12px; }
    .who { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .who strong { font-size: 1rem; }
    .tabs { margin-bottom: 16px; }
    .sections { gap: 18px 28px; }
    h3.eyebrow { margin-bottom: 10px; }
    h3.row app-icon { width: 13px; height: 13px; }
    .lock { margin-top: 10px; }
    .refund { margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--border); }
    .refund-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px 16px; }
    .tickets { border: 1px solid var(--border); border-radius: var(--radius); }
    .prints { display: flex; align-items: center; gap: 6px; margin: 12px 0; }
    .prints app-icon { width: 15px; height: 15px; }
    app-print-options { margin-bottom: 10px; }
    .preview { padding: 14px; border-radius: var(--radius); background: var(--surface-2); max-height: 460px; overflow: auto; scrollbar-width: none; }
    .preview::-webkit-scrollbar { display: none; }
    .preview app-ticket-sheet-preview { width: 100%; min-width: 0; }
    .note { margin-right: auto; align-self: center; }
  `,
})
export class BookingDetailDialog {
  readonly store = inject(AdminStore);
  private readonly printer = inject(TicketPrinter);
  readonly mode = signal<PrintMode>('together');
  private readonly toast = inject(ToastService);

  readonly bookingId = input.required<string>();
  readonly closed = output<void>();
  readonly cancel = output<string>();
  readonly handBack = output<string>();

  readonly tab = signal<Tab>('details');
  readonly walkIn = WALK_IN;
  readonly money = formatMoney;
  readonly dateTime = formatDateTime;

  readonly view = computed(() => {
    const id = this.bookingId();
    const row = counterRows(this.store).find((r) => r.booking.id === id);
    if (!row) return null;
    const b = row.booking;
    const show = row.show;
    const refundLink = row.refund ? `/refunds/${row.refund.id}` : null;
    const target = `Booking ${b.ref}`;
    return {
      row,
      when: show ? `${formatDay(show.start)}, ${formatTime(show.start)}` : '',
      cutoff: show ? formatTime(addMinutes(show.start, -this.store.settings().counterCancellationCutoffMinutes)) : '',
      quote: this.store.counterRefundQuote(b.id),
      categories: seatCategories(this.store, b),
      prices: b.seats.map((s) => (show ? this.store.seatPrice(show, s) : null)),
      audit: this.store.audit().filter((a) => a.target === target || (refundLink && a.link === refundLink) || a.link === `/counter/history?ref=${b.ref}`),
    };
  });

  printLine(n: number): string {
    const reprints = n - 1;
    return `Printed ${n} ${n === 1 ? 'time' : 'times'}${reprints > 0 ? `, including ${reprints} ${reprints === 1 ? 'reprint' : 'reprints'}` : ''}. Only confirmed bookings can be printed.`;
  }

  reprint(): void {
    const b = this.view()?.row.booking;
    if (!b) return;
    if (this.printer.print(b.id, true, this.mode())) this.toast.success('Reprint sent to the printer', `${b.seats.length} ${b.seats.length === 1 ? 'ticket' : 'tickets'} for booking ${b.ref}, marked REPRINT.`);
    else this.toast.error('Cannot print these tickets', 'Only confirmed counter bookings can be printed.');
  }
}
