import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';

import { formatMoney } from '../../core/format';
import { ModalComponent } from '../../shared/modal.component';

const QUICK_REASONS = [
  'Cancelled after the sales cut-off; not eligible under policy',
  'Duplicate request; the booking was already refunded',
  'Customer attended the show',
];

/** Asks for the reason before one or more refunds are rejected. The reason is kept in the refund history. */
@Component({
  selector: 'app-reject-refund-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ModalComponent],
  template: `
    <app-modal size="sm" [title]="count() === 1 ? 'Reject refund' : 'Reject ' + count() + ' refunds'" eyebrow="Refunds" (closed)="closed.emit()">
      <div class="stack">
        <p class="soft small">
          {{ count() === 1 ? 'The customer' : 'These customers' }} will not get {{ money(amount()) }} back. Rejection cannot be undone, and the reason is recorded in the refund history and the audit log.
        </p>
        <div class="field">
          <label for="reject-note">Reason for rejecting</label>
          <textarea id="reject-note" class="textarea" [class.invalid]="tried() && !valid()" [value]="note()" (input)="note.set($any($event.target).value)" placeholder="Say why the refund is not due"></textarea>
          @if (tried() && !valid()) { <span class="error-text">Enter a reason of at least 10 characters.</span> }
        </div>
        <div class="quick">
          @for (q of quick; track q) { <button type="button" class="btn sm" (click)="note.set(q)">{{ q }}</button> }
        </div>
      </div>
      <ng-container footer>
        <button class="btn" type="button" (click)="closed.emit()">Keep refund</button>
        <button class="btn danger" type="button" (click)="submit()">Reject</button>
      </ng-container>
    </app-modal>
  `,
  styles: `
    .quick { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
    .quick .btn { white-space: normal; text-align: left; justify-content: flex-start; }
  `,
})
export class RejectRefundDialog {
  readonly count = input(1);
  readonly amount = input(0);
  readonly closed = output<void>();
  readonly rejected = output<string>();

  readonly quick = QUICK_REASONS;
  readonly note = signal('');
  readonly tried = signal(false);
  readonly valid = computed(() => this.note().trim().length >= 10);
  readonly money = formatMoney;

  submit(): void {
    this.tried.set(true);
    if (this.valid()) this.rejected.emit(this.note().trim());
  }
}
