import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { AdminStore } from '../../../core/admin-store';
import { formatDateTime, formatMoney } from '../../../core/format';
import { ToastService } from '../../../shared/feedback';
import { IconComponent } from '../../../shared/icon.component';
import { ModalComponent } from '../../../shared/modal.component';
import { suggestCashRef } from './counter-data';

/**
 * Hand back cash at the counter: the operator confirms the amount handed over and records a cash
 * refund reference. Only then does the cash refund become successful.
 */
@Component({
  selector: 'app-cash-refund-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent, ModalComponent],
  template: `
    @if (view(); as v) {
      <app-modal title="Hand back cash" [eyebrow]="'Booking ' + v.ref" size="sm" (closed)="closed.emit()">
        <div class="stack">
          @if (justCancelled()) {
            <div class="callout success"><app-icon name="check" /><span><strong>Booking cancelled. Seats {{ v.seats }} are back on sale.</strong> The refund is approved but not paid yet.</span></div>
          }
          @if (v.done) {
            <div class="callout success"><app-icon name="check" /><span><strong>Cash refund recorded.</strong> {{ money(v.amount) }} handed back, reference <span class="mono">{{ v.cashRef }}</span>.</span></div>
          } @else {
            <div class="amount">
              <span class="eyebrow">Hand back to the customer</span>
              <strong>{{ money(v.amount) }}</strong>
              <span class="muted small">Cash · paid {{ money(v.paid) }}@if (v.paid > v.amount) { · {{ money(v.paid - v.amount) }} kept under the cancellation policy }</span>
            </div>
            @if (canRefund()) {
              <div class="field">
                <label for="cash-ref">Cash refund reference</label>
                <input id="cash-ref" class="input mono" [class.invalid]="tried() && !refText().trim()" [value]="refText()" (input)="refText.set($any($event.target).value)" />
                @if (tried() && !refText().trim()) { <span class="error-text">Enter the reference written on the cash refund slip.</span> }
                @else { <span class="hint">Suggested from the booking. Use the number on the refund slip if it differs.</span> }
              </div>
              <label class="check"><input type="checkbox" [checked]="handed()" (change)="handed.set($any($event.target).checked)" />I have handed {{ money(v.amount) }} in cash to the customer.</label>
              @if (tried() && !handed()) { <span class="error-text">Confirm that the cash was handed over.</span> }
            } @else {
              <div class="callout warning"><app-icon name="lock" /><span>A counter supervisor must hand back the cash and record the reference. The refund stays approved until then.</span></div>
            }
          }
          <p class="muted tiny">Refund {{ v.id }} · opened {{ dateTime(v.requestedAt) }} · <a [routerLink]="['/refunds', v.id]" (click)="closed.emit()">Open in Refunds</a></p>
        </div>
        <ng-container footer>
          @if (v.done || !canRefund()) {
            <button class="btn" type="button" (click)="closed.emit()">{{ v.done ? 'Done' : 'Close' }}</button>
          } @else {
            <button class="btn" type="button" (click)="closed.emit()">Later</button>
            <button class="btn primary" type="button" (click)="confirm()"><app-icon name="rupee" />Confirm cash handed back</button>
          }
        </ng-container>
      </app-modal>
    }
  `,
  styles: `
    .amount { display: flex; flex-direction: column; gap: 2px; padding: 14px 16px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface-2); }
    .amount strong { font-size: 1.6rem; letter-spacing: -0.02em; }
  `,
})
export class CashRefundDialog {
  private readonly store = inject(AdminStore);
  private readonly toast = inject(ToastService);

  readonly refundId = input.required<string>();
  /** Shows the "booking cancelled" note when the dialog follows a cancellation. */
  readonly justCancelled = input(false);
  readonly closed = output<void>();

  readonly money = formatMoney;
  readonly dateTime = formatDateTime;
  readonly canRefund = computed(() => this.store.can('counter.refund'));
  readonly tried = signal(false);
  readonly handed = signal(false);

  readonly view = computed(() => {
    const r = this.store.refund(this.refundId());
    if (!r) return null;
    const b = this.store.booking(r.bookingId);
    return {
      id: r.id, amount: r.amount, requestedAt: r.requestedAt, cashRef: r.cashRefundRef,
      done: r.status === 'successful', ref: b?.ref ?? r.bookingId, paid: b?.amount ?? r.amount, seats: b?.seats.join(', ') ?? '',
    };
  });
  /** A string, so other refunds updating in the background do not reset what was typed. */
  private readonly bookingRef = computed(() => this.view()?.ref ?? '');
  readonly refText = linkedSignal(() => suggestCashRef(this.bookingRef()));

  confirm(): void {
    this.tried.set(true);
    const v = this.view();
    if (!v || !this.handed() || !this.refText().trim()) return;
    if (this.store.confirmCashRefund(v.id, this.refText())) {
      this.toast.success('Cash refund recorded', `${formatMoney(v.amount)} handed back for booking ${v.ref}.`);
    } else {
      this.toast.error('Could not record the cash refund', 'The refund is no longer waiting for cash, or your role cannot hand back cash.');
    }
  }
}
