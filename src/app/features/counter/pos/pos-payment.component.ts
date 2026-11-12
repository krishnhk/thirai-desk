import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import { formatMoney } from '../../../core/format';
import { CounterPaymentMethod } from '../../../core/models';
import { IconComponent } from '../../../shared/icon.component';
import { PosSale } from './pos-sale';

export const METHOD_KEYS: Record<CounterPaymentMethod, string> = { Cash: 'F2', UPI: 'F3', Card: 'F4', Other: 'F8' };
const REF_HINT: Record<CounterPaymentMethod, string> = { Cash: '', UPI: '12-digit UTR', Card: 'Approval code', Other: 'Reference' };
const DEVICE: Record<CounterPaymentMethod, string> = { Cash: '', UPI: 'UPI QR', Card: 'card terminal', Other: 'payment device' };

/**
 * Payment collection: cash with quick amounts and change due, or a digital payment that must be
 * confirmed (simulated terminal/UPI round trip, or the operator types the reference) before the
 * booking can be confirmed.
 */
@Component({
  selector: 'app-pos-payment',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <section class="sec">
      <div class="sh"><h3>Payment method</h3></div>
      <div class="methods" role="group" aria-label="Payment method">
        @for (m of sale.methods(); track m) {
          <button type="button" [attr.aria-pressed]="sale.method() === m" [disabled]="sale.locked() && sale.method() !== m" (click)="sale.setMethod(m)">
            {{ m }}<kbd>{{ keys[m] }}</kbd>
          </button>
        }
      </div>

      @if (!sale.seats().length) {
        <p class="muted small">Select seats to take the payment.</p>
      } @else if (sale.isCash()) {
        <label class="field-label" for="pos-cash">Cash received</label>
        <div class="cashrow">
          <div class="input-group cash">
            <span>₹</span>
            <input id="pos-cash" class="input" type="number" inputmode="numeric" min="0" step="10" placeholder="0" [disabled]="!ready()"
              [value]="sale.cashReceived() ?? ''" (input)="onCash($any($event.target).value)" />
          </div>
          <div class="change" [class.short]="(sale.change() ?? 0) < 0">
            @if (sale.change() == null) {
              <span>Change due</span><b class="money muted">—</b>
            } @else if (sale.change()! < 0) {
              <span>Collect more</span><b class="money">{{ money(-sale.change()!) }}</b>
            } @else {
              <span>Change due</span><b class="money">{{ money(sale.change()!) }}</b>
            }
          </div>
        </div>
        <div class="quick">
          @for (q of quick(); track q.value) {
            <button type="button" class="btn sm" [disabled]="!ready()" [attr.aria-pressed]="sale.cashReceived() === q.value" (click)="sale.setCash(q.value)">{{ q.label }}</button>
          }
        </div>
      } @else {
        @switch (sale.digital().status) {
          @case ('idle') {
            <button type="button" class="btn request" [disabled]="!ready()" (click)="sale.requestPayment()">
              <app-icon name="upload" />Send {{ money(sale.total()) }} to the {{ device() }}
            </button>
            <div class="manual">
              <label class="field-label" for="pos-ref">Or type the reference shown on the {{ device() }}</label>
              <div class="row">
                <input id="pos-ref" class="input mono" type="text" autocomplete="off" spellcheck="false" [placeholder]="refPlaceholder()" [disabled]="!ready()"
                  [value]="manualRef()" (input)="manualRef.set($any($event.target).value)" (keydown.enter)="recordRef($event)" />
                <button type="button" class="btn" [disabled]="!ready() || manualRef().trim().length < 6" (click)="recordRef()">Record</button>
              </div>
            </div>
          }
          @case ('waiting') {
            <div class="pstate waiting" role="status">
              <span class="ring" aria-hidden="true"></span>
              <span><strong>Waiting for payment confirmation…</strong><small>{{ money(sale.total()) }} sent to the {{ device() }}. Seats are held for this sale.</small></span>
            </div>
            <button type="button" class="btn sm danger-ghost" (click)="sale.voidPayment()">Cancel request</button>
          }
          @case ('confirmed') {
            <div class="pstate ok" role="status">
              <app-icon name="check" />
              <span><strong>Payment confirmed</strong><small>{{ sale.method() }} · {{ money(sale.total()) }} · Ref <span class="mono">{{ sale.digital().ref }}</span></small></span>
            </div>
            <button type="button" class="btn sm danger-ghost" (click)="sale.voidPayment()">Void payment</button>
          }
        }
      }
    </section>
  `,
  styles: `
    :host { display: block; }
    .sec { display: flex; flex-direction: column; gap: 6px; padding: 10px 14px; border-radius: var(--radius-lg); background: var(--surface-2); }
    .sh { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
    .sh h3 { font-size: 0.7rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted); }
    .sh b { color: var(--text); }
    .methods { display: flex; gap: 6px; }
    .methods button { flex: 1 1 0; min-width: 0; }
    .methods button { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0; min-height: 38px; padding: 2px; border: 1px solid transparent; border-radius: var(--radius); background: var(--surface-3); color: var(--text-soft); font-weight: 600; font-size: 0.86rem; }
    .methods button:hover:not(:disabled) { border-color: var(--border-strong); color: var(--text); }
    .methods button[aria-pressed='true'] { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); font-weight: 700; }
    .methods button:disabled { opacity: 0.4; cursor: not-allowed; }
    kbd { font: 600 0.6rem var(--mono); color: var(--text-faint); }
    .field-label { margin-top: 2px; font-size: 0.74rem; }
    .cash .input { min-height: 38px; font-size: 1.05rem; font-weight: 700; }
    .cash > span { font-size: 1.1rem; }
    .quick { display: grid; grid-template-columns: repeat(auto-fit, minmax(52px, 1fr)); gap: 5px; }
    .quick .btn { min-height: 32px; padding-inline: 4px; font-size: 0.78rem; }
    .quick .btn[aria-pressed='true'] { border-color: var(--accent); color: var(--text); }
    .change { display: flex; align-items: center; justify-content: space-between; padding: 6px 12px; border-radius: var(--radius); background: var(--surface-3); }
    .change span { font-size: 0.82rem; font-weight: 600; color: var(--text-soft); }
    .change b { font-size: 1.1rem; color: var(--success); }
    .change.short b { color: var(--warning); }
    .request { min-height: 40px; width: 100%; border-color: var(--accent-line); color: var(--text); }
    .manual { display: flex; flex-direction: column; gap: 6px; }
    .manual .row .input { flex: 1; min-width: 0; text-transform: uppercase; }
    .pstate { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface-2); }
    .pstate span { display: flex; flex-direction: column; line-height: 1.35; min-width: 0; }
    .pstate small { font-size: 0.76rem; color: var(--text-muted); overflow-wrap: anywhere; }
    .pstate.waiting { border-color: var(--info); background: var(--info-soft); }
    .pstate.ok { border-color: var(--success-line); background: var(--success-soft); }
    .pstate.ok > app-icon { width: 22px; height: 22px; color: var(--success); }
    .ring { width: 20px; height: 20px; flex-shrink: 0; border: 2.5px solid var(--info); border-right-color: transparent; border-radius: 50%; animation: spin 0.9s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .danger-ghost { align-self: flex-start; }
    @container checkout (max-height: 640px) {
      .sec { padding: 8px 12px; gap: 5px; }
      .methods button { min-height: 34px; }
      .cash .input { min-height: 34px; }
      .quick .btn { min-height: 28px; }
      .change { padding: 4px 12px; }
      .field-label { display: none; }
      .request { min-height: 36px; }
    }
    @container checkout (max-height: 540px) {
      .cashrow { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px; }
      .change { flex-direction: column; align-items: flex-end; justify-content: center; gap: 0; }
      .change span { font-size: 0.66rem; }
      .sh { display: none; }
      .methods button kbd { display: none; }
      .sec { gap: 4px; }
      .manual .btn { min-height: 32px; }
    }
  `,
})
export class PosPaymentComponent {
  readonly sale = inject(PosSale);
  readonly keys = METHOD_KEYS;
  readonly manualRef = signal('');

  readonly ready = computed(() => this.sale.canSell() && this.sale.saleState().open && this.sale.seats().length > 0);
  readonly device = computed(() => DEVICE[this.sale.method()]);
  readonly refPlaceholder = computed(() => REF_HINT[this.sale.method()]);

  /** Exact, the next ₹100, then the notes customers usually hand over. */
  readonly quick = computed(() => {
    const total = this.sale.total();
    if (!total) return [] as { label: string; value: number }[];
    const values = [total, Math.ceil(total / 100) * 100, 500, 1000, 2000, Math.ceil(total / 500) * 500].filter((v) => v >= total);
    const unique = [...new Set(values)].sort((a, b) => a - b).slice(0, 4);
    return unique.map((v) => ({ value: v, label: v === total ? `Exact ${formatMoney(v)}` : formatMoney(v) }));
  });

  money = formatMoney;

  onCash(value: string): void {
    this.sale.setCash(value === '' ? null : Number(value));
  }

  recordRef(e?: Event): void {
    e?.preventDefault();
    if (this.sale.confirmManualRef(this.manualRef())) this.manualRef.set('');
  }
}
