import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';

import { AdminStore } from '../../../core/admin-store';
import { formatMoney, formatTime, formatDay } from '../../../core/format';
import { WALK_IN } from '../../../core/models';
import { TicketSheetPreviewComponent } from '../../../shared/counter-ticket.component';
import { PrintOptionsComponent } from '../../../shared/print-options.component';
import { IconComponent } from '../../../shared/icon.component';
import { PosSale } from './pos-sale';

/** After a sale the confirmation takes the whole screen: the booking summary and print actions on the left, the ticket as it prints on the right. */
@Component({
  selector: 'app-pos-confirmation',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, RouterLink, PrintOptionsComponent, TicketSheetPreviewComponent],
  template: `
    @if (sale.booking(); as b) {
      <div class="main">
      <div class="body">
        <header class="hero" role="status">
          <span class="tick"><app-icon name="check" /></span>
          <div class="ht">
            <h2>Booking confirmed</h2>
            <p>{{ b.seats.length === 1 ? 'Seat' : b.seats.length + ' seats' }} {{ seatSummary() }} {{ b.seats.length === 1 ? 'is' : 'are' }} now booked for every channel.</p>
          </div>
          <div class="refbox"><span class="eyebrow">Booking reference</span><b class="mono">{{ b.ref }}</b></div>
        </header>

        <div class="cards">
          <div class="card">
            <span class="eyebrow">Total paid</span>
            <b class="amt">{{ money(b.amount) }}</b>
            <span class="sub">
              by {{ b.counterPayment?.method }}
              @if (b.counterPayment?.method === 'Cash') { · received {{ money(b.counterPayment!.amountCollected) }} }
              @else { · ref <span class="mono">{{ b.counterPayment?.txnRef }}</span> }
            </span>
          </div>
          @if (b.counterPayment?.method === 'Cash') {
            <div class="card change">
              <span class="eyebrow">Give change</span>
              <b class="amt">{{ money(b.counterPayment!.change) }}</b>
              <span class="sub">Hand back before the guest leaves</span>
            </div>
          }
        </div>

        <dl class="facts">
          <div><dt>Film</dt><dd>{{ film() }}</dd></div>
          <div><dt>Show</dt><dd>{{ showLine() }}</dd></div>
          <div><dt>Seats</dt><dd [attr.title]="b.seats.join(', ')">{{ seatSummary() }}</dd></div>
          <div><dt>Customer</dt><dd>{{ walkIn }}</dd></div>
          <div><dt>Sold by</dt><dd>{{ b.operator }} · {{ time(b.bookedAt) }}</dd></div>
          <div><dt>Printed</dt><dd>{{ sale.printed() ? (b.printCount === 1 ? 'Once' : b.printCount + ' times') : 'Not yet' }}</dd></div>
        </dl>

        <section class="refs">
          <span class="eyebrow">Ticket references</span>
          <ul class="chips">
            @if (b.ticketRefs.length > 4) {
              <li><span class="mono">{{ b.ticketRefs[0] }} to -{{ b.ticketRefs.length }}</span><b>{{ b.ticketRefs.length }} tickets</b></li>
            } @else {
              @for (t of b.ticketRefs; track t; let i = $index) { <li><span class="mono">{{ t }}</span><b>{{ b.seats[i] }}</b></li> }
            }
          </ul>
          <a class="small" routerLink="/counter/history" [queryParams]="{ ref: b.ref }">Open in counter history</a>
        </section>
      </div>
      <footer class="foot">
        <div class="acts">
          @if (!sale.printed()) {
            <button type="button" class="btn primary big" (click)="sale.print()">
              <app-icon name="ticket" />Print {{ sale.seatMode() === 'separate' && b.seats.length > 1 ? b.seats.length + ' tickets' : 'ticket' }}<kbd>P</kbd>
            </button>
            <button type="button" class="btn big" (click)="sale.newSale()">New sale<kbd>N</kbd></button>
          } @else {
            <button type="button" class="btn primary big" (click)="sale.newSale()"><app-icon name="plus" />New sale<kbd>N</kbd></button>
            <button type="button" class="btn big" (click)="sale.reprint()" title="Marks the ticket REPRINT and records it in the audit log"><app-icon name="ticket" />Reprint<kbd>R</kbd></button>
          }
        </div>
        @if (sale.printNote()) { <p class="pn" role="status">{{ sale.printNote() }}</p> }
      </footer>
      </div>
      <aside class="paper" aria-label="Ticket preview">
        @if (b.seats.length > 1) { <app-print-options [seatCount]="b.seats.length" [(mode)]="sale.seatMode" /> }
        <div #stage class="stage">
          <div class="fit" [style.zoom]="fit()">
            <app-ticket-sheet-preview [booking]="b" [mode]="sale.seatMode()" [reprint]="sale.printed()" />
          </div>
        </div>
      </aside>
    }
  `,
  styles: `
    :host { display: grid; grid-template-columns: minmax(0, 1fr) minmax(320px, 420px); flex: 1; min-height: 0; width: 100%; }
    .main { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
    .body { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 22px; padding: 22px 24px; }
    /* The ticket exactly as it prints, on a neutral ground. */
    /* The options stay fixed at the top; the ticket below is scaled to fit, so it is always whole and never scrolls. */
    .paper { min-height: 0; min-width: 0; overflow: hidden; display: flex; flex-direction: column; gap: 12px; padding: 16px; border-left: 1px solid var(--border); background: var(--surface-2); }
    .paper app-print-options { flex-shrink: 0; }
    .stage { flex: 1; min-height: 0; min-width: 0; display: grid; place-items: center; overflow: hidden; }
    .fit { width: 100%; min-width: 0; }
    @media (max-width: 900px) { :host { grid-template-columns: minmax(0, 1fr); } .paper { border-left: 0; border-top: 1px solid var(--border); } .stage { flex: none; } }
    .hero { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
    .tick { display: grid; place-items: center; flex-shrink: 0; width: 42px; height: 42px; border-radius: 50%; background: var(--success-soft); color: var(--success); }
    .tick app-icon { width: 20px; height: 20px; }
    .ht { flex: 1 1 180px; min-width: 0; }
    .ht h2 { font-size: 1.2rem; }
    .ht p { margin: 2px 0 0; font-size: 0.84rem; color: var(--text-muted); }
    .refbox { margin-left: auto; text-align: right; }
    @media (max-width: 560px) { .refbox { margin-left: 0; text-align: left; flex-basis: 100%; } }
    .refbox b { display: block; font-size: 1.6rem; font-weight: 800; letter-spacing: 0.06em; line-height: 1.2; color: var(--accent); }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
    .card { display: flex; flex-direction: column; gap: 2px; padding: 14px 18px; border-radius: var(--radius-lg); background: var(--surface-2); }
    .amt { font-size: 1.9rem; font-weight: 800; letter-spacing: -0.02em; line-height: 1.15; font-variant-numeric: tabular-nums; }
    .sub { font-size: 0.8rem; color: var(--text-muted); }
    .card.change { background: var(--success-soft); }
    .card.change .amt { color: var(--success); }
    .facts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px 24px; margin: 0; }
    @media (max-width: 560px) { .facts { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    .facts div { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
    .facts dt { font-size: 0.68rem; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--text-muted); }
    .facts dd { margin: 0; font-size: 0.95rem; font-weight: 600; overflow-wrap: anywhere; }
    .refs { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
    .chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 0; padding: 0; list-style: none; }
    .chips li { display: inline-flex; align-items: baseline; gap: 8px; padding: 5px 11px; border-radius: var(--radius); background: var(--surface-2); font-size: 0.78rem; }
    .chips b { color: var(--accent); }
    .foot { display: flex; flex-direction: column; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--border); background: var(--surface); }
    .acts { display: grid; grid-template-columns: 2fr 1fr; gap: 8px; }
    .big { min-height: 46px; font-size: 0.95rem; }
    .two { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .two .btn { min-height: 42px; }
    .pn { font-size: 0.76rem; color: var(--text-muted); text-align: center; }
    kbd { margin-left: 4px; font: 600 0.66rem var(--mono); opacity: 0.7; }
  `,
})
export class PosConfirmationComponent {
  private readonly store = inject(AdminStore);
  readonly sale = inject(PosSale);
  readonly walkIn = WALK_IN;
  readonly film = computed(() => this.sale.movie()?.title ?? '');
  readonly showLine = computed(() => {
    const s = this.sale.show();
    return s ? `${formatDay(s.start)} · ${formatTime(s.start)} · ${this.store.screen(s.screenId)?.name ?? ''}` : '';
  });
  money = formatMoney;
  time = formatTime;

  /** "A1–A18", "C5, C6, D19–D21": seats in the same row that run on are shown as a range. */
  readonly seatSummary = computed(() => {
    const seats = this.sale.booking()?.seats ?? [];
    const rows = new Map<string, number[]>();
    const other: string[] = [];
    for (const id of seats) {
      const m = /^([A-Z]+)(\d+)$/.exec(id);
      if (!m) { other.push(id); continue; }
      rows.set(m[1]!, [...(rows.get(m[1]!) ?? []), Number(m[2])]);
    }
    const parts: string[] = [];
    for (const [row, nums] of rows) {
      const sorted = [...nums].sort((a, b) => a - b);
      let start = sorted[0]!;
      let prev = start;
      const flush = () => parts.push(start === prev ? `${row}${start}` : prev - start === 1 ? `${row}${start}, ${row}${prev}` : `${row}${start}–${row}${prev}`);
      for (const n of sorted.slice(1)) {
        if (n === prev + 1) { prev = n; continue; }
        flush();
        start = prev = n;
      }
      flush();
    }
    const all = [...parts, ...other];
    return all.length > 4 ? `${all.slice(0, 3).join(', ')} +${all.length - 3} more` : all.join(', ');
  });

  /** How much the ticket is scaled down to fit the panel: 1 when it fits as is. */
  readonly fit = signal(1);
  private readonly stage = viewChild<ElementRef<HTMLElement>>('stage');

  constructor() {
    effect((onCleanup) => {
      const el = this.stage()?.nativeElement;
      if (!el) return;
      const measure = () => {
        // Stacked layout (phone): the panel grows with the ticket, so no scaling.
        if (window.matchMedia('(max-width: 900px)').matches) { this.fit.set(1); return; }
        // The ticket is 80 x 164 mm: about 302 x 620 px.
        this.fit.set(Math.max(0.45, Math.min(1, (el.clientHeight - 8) / 632, (el.clientWidth - 8) / 310)));
      };
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      measure();
      onCleanup(() => ro.disconnect());
    });
  }
}
