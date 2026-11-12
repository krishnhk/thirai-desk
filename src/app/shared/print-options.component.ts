import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';

import { PrintMode } from './counter-ticket.component';

/**
 * How a booking with several seats prints: all seats on one ticket (the default), or a separate ticket for
 * each seat. A slim two-way switch with one line of text per choice. Shown only when there is more than one seat.
 */
@Component({
  selector: 'app-print-options',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="seg" role="radiogroup" aria-label="How to print the seats">
      <button type="button" role="radio" [attr.aria-checked]="mode() === 'together'" (click)="mode.set('together')">One ticket</button>
      <button type="button" role="radio" [attr.aria-checked]="mode() === 'separate'" (click)="mode.set('separate')">{{ seatCount() }} tickets, one per seat</button>
    </div>
  `,
  styles: `
    :host { display: block; }
    .seg { display: grid; grid-template-columns: 1fr 1fr; gap: 2px; padding: 2px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface-2); }
    button { min-width: 0; padding: 6px 10px; border: 0; border-radius: 6px; background: none; color: var(--text-muted); font-size: 0.8rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    button:hover { color: var(--text); }
    button[aria-checked='true'] { background: var(--accent-soft); color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent-line); }
  `,
})
export class PrintOptionsComponent {
  readonly seatCount = input.required<number>();
  readonly mode = model<PrintMode>('together');
}
