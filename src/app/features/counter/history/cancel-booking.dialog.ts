import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { AdminStore } from '../../../core/admin-store';
import { addMinutes, formatDateTime, formatDay, formatMoney, formatTime } from '../../../core/format';
import { WALK_IN } from '../../../core/models';
import { ConfirmService, ToastService } from '../../../shared/feedback';
import { IconComponent } from '../../../shared/icon.component';
import { ModalComponent } from '../../../shared/modal.component';
import { StatusBadgeComponent } from '../../../shared/ui';
import { CANCEL_REASONS, visibleCounterRows } from './counter-data';

/**
 * Cancels a counter booking under the counter policy: look the booking up by reference, review
 * the show and payment, pick a reason, see the refundable amount, confirm. Cash refunds continue
 * in the hand-back step; digital refunds go back to the original payment through Refunds.
 */
@Component({
  selector: 'app-cancel-booking-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent, ModalComponent, StatusBadgeComponent],
  template: `
    <app-modal [title]="doneRefund() ? 'Booking cancelled' : 'Cancel a counter booking'" [eyebrow]="view() ? 'Booking ' + view()!.b.ref : 'Box office'" size="md" (closed)="closed.emit()">
      @if (doneRefund(); as r) {
        <div class="stack">
          <div class="callout success"><app-icon name="check" /><span><strong>Booking {{ view()?.b?.ref }} is cancelled.</strong> Seats {{ view()?.b?.seats?.join(', ') }} are back on sale online and at the counter.</span></div>
          <section class="panel stack-sm">
            <div class="row-wrap"><span class="strong">Refund {{ money(r.amount) }}</span><app-status-badge [status]="r.status" /></div>
            <p class="small soft">Recorded against the original {{ r.method }} payment <span class="mono">{{ view()?.b?.paymentRef }}</span>. It is <strong>approved, not yet paid</strong>: initiate it in Refunds to send it through the payment gateway, then track it there until the gateway confirms.</p>
          </section>
        </div>
      } @else {
        <div class="stack">
          @if (!bookingId()) {
            <form class="lookup" novalidate (submit)="$event.preventDefault(); find()">
              <div class="field grow">
                <label for="cx-ref">Booking or ticket reference</label>
                <input id="cx-ref" class="input mono" placeholder="TC12AB34 or TC12AB34-2" autocomplete="off" [value]="query()" (input)="query.set($any($event.target).value)" />
              </div>
              <button class="btn" type="submit"><app-icon name="search" />Find booking</button>
            </form>
            @if (lookupError()) { <div class="callout danger"><app-icon name="alert" /><span>{{ lookupError() }}</span></div> }
          }

          @if (view(); as v) {
            <div class="grid-2 facts-grid">
              <section>
                <h3 class="eyebrow">Booking</h3>
                <dl class="facts">
                  <dt>Film</dt><dd>{{ v.film }}</dd>
                  <dt>Show</dt><dd>{{ v.screen }} · {{ v.when }}</dd>
                  <dt>Seats</dt><dd>{{ v.b.seats.join(', ') }} <span class="muted">({{ v.b.seats.length }})</span></dd>
                  <dt>Customer</dt><dd>{{ walkIn }}</dd>
                  <dt>Sold</dt><dd>{{ dateTime(v.b.bookedAt) }}</dd>
                  <dt>Operator</dt><dd>{{ v.b.operator }}</dd>
                  <dt>Status</dt><dd><app-status-badge [status]="v.b.status" /></dd>
                </dl>
              </section>
              <section>
                <h3 class="eyebrow">Payment</h3>
                <dl class="facts">
                  <dt>Method</dt><dd>{{ v.method }}</dd>
                  <dt>Amount paid</dt><dd>{{ money(v.b.amount) }}</dd>
                  @if (v.b.counterPayment?.txnRef; as txn) { <dt>Transaction</dt><dd class="mono">{{ txn }}</dd> }
                  @else { <dt>Cash collected</dt><dd>{{ money(v.b.counterPayment?.amountCollected ?? v.b.amount) }}</dd> }
                  <dt>Payment ref</dt><dd class="mono">{{ v.b.paymentRef }}</dd>
                </dl>
              </section>
            </div>

            @if (v.quote.eligible) {
              <section class="quote">
                <dl class="ledger">
                  <dt>Paid</dt><dd>{{ money(v.quote.paid) }}</dd>
                  <dt>Cancellation fee <span class="muted">({{ money(fee()) }} × {{ v.b.seats.length }} {{ v.b.seats.length === 1 ? 'ticket' : 'tickets' }})</span></dt><dd class="minus">− {{ money(v.quote.deduction) }}</dd>
                  <dt class="total">Refundable</dt><dd class="total">{{ money(v.quote.refundable) }}</dd>
                </dl>
                <p class="muted small"><app-icon name="clock" />Cancellable until {{ v.cutoff }} ({{ cutoffMinutes() }} minutes before the show). {{ v.method === 'Cash' ? 'Cash is handed back at the counter in the next step.' : 'Goes back to the original ' + v.method + ' payment.' }}</p>
              </section>

              @if (canCancel()) {
                <div class="form-grid">
                  <div class="field">
                    <label for="cx-reason">Reason</label>
                    <select id="cx-reason" class="select" [class.invalid]="tried() && !reason()" [value]="reason()" (change)="reason.set($any($event.target).value)">
                      <option value="">Choose a reason</option>
                      @for (r of reasons; track r) { <option [value]="r">{{ r }}</option> }
                    </select>
                    @if (tried() && !reason()) { <span class="error-text">Choose why the booking is cancelled.</span> }
                  </div>
                  <div class="field">
                    <label for="cx-note">Note{{ reason() === 'Other' ? '' : ' (optional)' }}</label>
                    <input id="cx-note" class="input" maxlength="140" [class.invalid]="tried() && noteMissing()" [value]="note()" (input)="note.set($any($event.target).value)" />
                    @if (tried() && noteMissing()) { <span class="error-text">Describe the reason.</span> }
                  </div>
                </div>
              } @else {
                <div class="callout warning"><app-icon name="lock" /><span>A counter supervisor must approve cancellations.</span></div>
              }
            } @else {
              <div class="callout danger"><app-icon name="alert" /><span><strong>This booking cannot be cancelled.</strong> {{ v.quote.reason }}</span></div>
            }
          }
        </div>
      }
      <ng-container footer>
        @if (doneRefund(); as r) {
          <a class="btn" [routerLink]="['/refunds', r.id]" (click)="closed.emit()">Open refund</a>
          <button class="btn primary" type="button" (click)="closed.emit()">Done</button>
        } @else {
          <button class="btn" type="button" (click)="closed.emit()">Keep booking</button>
          <button class="btn danger" type="button" [disabled]="!view()?.quote?.eligible || !canCancel()" (click)="cancel()">
            Cancel booking@if (view()?.quote?.eligible) { · refund {{ money(view()!.quote.refundable) }} }
          </button>
        }
      </ng-container>
    </app-modal>
  `,
  styles: `
    .lookup { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 10px; }
    .lookup .grow { flex: 1; min-width: 200px; }
    .facts-grid h3 { margin-bottom: 8px; }
    .facts-grid { gap: 12px 20px; }
    .quote { display: flex; flex-direction: column; gap: 10px; padding: 14px 16px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface-2); }
    .quote p { display: flex; align-items: center; gap: 6px; }
    .quote p app-icon { width: 14px; height: 14px; }
    .ledger { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px 16px; margin: 0; }
    .ledger dt { color: var(--text-soft); }
    .ledger dd { margin: 0; text-align: right; font-weight: 600; white-space: nowrap; }
    .ledger .minus { color: var(--warning); }
    .ledger .total { padding-top: 6px; border-top: 1px solid var(--border); font-size: 1.05rem; font-weight: 700; color: var(--text); }
  `,
})
export class CancelBookingDialog {
  private readonly store = inject(AdminStore);
  private readonly confirmer = inject(ConfirmService);
  private readonly toast = inject(ToastService);

  /** The booking to cancel; leave empty to look one up by reference. */
  readonly bookingId = input<string | null>(null);
  readonly closed = output<void>();
  /** Emitted after cancelling a cash booking: the cash is handed back next. */
  readonly cashDue = output<string>();

  readonly walkIn = WALK_IN;
  readonly reasons = CANCEL_REASONS;
  readonly money = formatMoney;
  readonly dateTime = formatDateTime;
  readonly canCancel = computed(() => this.store.can('counter.cancel'));
  readonly fee = computed(() => this.store.settings().counterCancellationFeePerTicket);
  readonly cutoffMinutes = computed(() => this.store.settings().counterCancellationCutoffMinutes);

  readonly query = signal('');
  readonly lookupError = signal('');
  readonly reason = signal('');
  readonly note = signal('');
  readonly tried = signal(false);
  readonly doneRefundId = signal<string | null>(null);
  readonly selectedId = linkedSignal<string | null>(() => this.bookingId());

  readonly noteMissing = computed(() => this.reason() === 'Other' && !this.note().trim());
  readonly doneRefund = computed(() => {
    const id = this.doneRefundId();
    return id ? this.store.refund(id) ?? null : null;
  });

  readonly view = computed(() => {
    const id = this.selectedId();
    const b = id ? this.store.booking(id) : undefined;
    if (!b) return null;
    const show = this.store.show(b.showId);
    return {
      b,
      film: show ? this.store.movie(show.movieId)?.title ?? 'Film' : 'Show removed',
      screen: show ? this.store.screen(show.screenId)?.name ?? '' : '',
      when: show ? `${formatDay(show.start)}, ${formatTime(show.start)}` : '',
      cutoff: show ? formatTime(addMinutes(show.start, -this.cutoffMinutes())) : '',
      method: b.counterPayment?.method ?? b.paymentMethod,
      quote: this.store.counterRefundQuote(b.id),
    };
  });

  find(): void {
    const q = this.query().trim().toUpperCase();
    this.lookupError.set('');
    this.selectedId.set(null);
    if (!q) { this.lookupError.set('Enter a booking reference, such as TC12AB34, or a ticket reference, such as TC12AB34-2.'); return; }
    const any = this.store.bookings().find((b) => b.ref === q || b.ticketRefs.includes(q));
    if (!any) { this.lookupError.set(`No booking has the reference ${q}. Check the reference printed on the ticket.`); return; }
    if (any.channel !== 'counter') { this.lookupError.set(`${any.ref} is an online booking. Online cancellations and refunds are handled in Refunds.`); return; }
    if (!visibleCounterRows(this.store).some((r) => r.booking.id === any.id)) { this.lookupError.set(`${any.ref} belongs to another theatre or operator and is not visible to you.`); return; }
    this.selectedId.set(any.id);
  }

  async cancel(): Promise<void> {
    this.tried.set(true);
    const v = this.view();
    if (!v || !v.quote.eligible || !this.canCancel() || !this.reason() || this.noteMissing()) return;
    const ok = await this.confirmer.ask({
      title: `Cancel booking ${v.b.ref}?`,
      message: 'The seats go back on sale straight away. The booking stays on record as cancelled, and a refund is opened under the counter policy.',
      details: [
        { label: 'Show', value: `${v.film} · ${v.screen} · ${v.when}` },
        { label: 'Seats', value: v.b.seats.join(', ') },
        { label: 'Refundable', value: `${formatMoney(v.quote.refundable)} of ${formatMoney(v.quote.paid)}` },
        { label: 'Refund to', value: v.method === 'Cash' ? 'Cash at the counter' : `Original ${v.method} payment ${v.b.paymentRef}` },
      ],
      consequences: v.quote.deduction ? [`${formatMoney(v.quote.deduction)} is kept as the cancellation fee.`] : undefined,
      confirmLabel: 'Cancel booking',
      cancelLabel: 'Keep booking',
      tone: 'danger',
    });
    if (!ok) return;
    const refund = this.store.cancelCounterBooking(v.b.id, this.reason(), this.note().trim());
    if (!refund) {
      this.toast.error('The booking was not cancelled', 'It is no longer eligible under the cancellation policy, or your role cannot cancel bookings.');
      return;
    }
    this.toast.success(`Booking ${v.b.ref} cancelled`, `${v.b.seats.length} ${v.b.seats.length === 1 ? 'seat' : 'seats'} released. Refund of ${formatMoney(refund.amount)} approved.`);
    if (refund.method === 'Cash') this.cashDue.emit(refund.id);
    else this.doneRefundId.set(refund.id);
  }
}
