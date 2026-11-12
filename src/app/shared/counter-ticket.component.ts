import { ChangeDetectionStrategy, Component, Injectable, computed, inject, input, signal } from '@angular/core';
import qrcode from 'qrcode-generator';

import { AdminStore } from '../core/admin-store';
import { Booking } from '../core/models';
import { buildTicket } from './ticket-view';

export { ticketPayload } from './ticket-view';

/** A QR code drawn as one SVG path, so it prints crisply on thermal printers. */
@Component({
  selector: 'app-qr',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<svg [attr.viewBox]="'0 0 ' + size() + ' ' + size()" shape-rendering="crispEdges" role="img" [attr.aria-label]="'QR code ' + label()"><rect [attr.width]="size()" [attr.height]="size()" fill="#fff" /><path [attr.d]="path()" fill="#000" /></svg>`,
  styles: `:host { display: block; } svg { display: block; width: 100%; height: auto; }`,
})
export class QrComponent {
  readonly data = input.required<string>();
  readonly label = input('');
  private readonly qr = computed(() => {
    const q = qrcode(0, 'M');
    q.addData(this.data());
    q.make();
    return q;
  });
  /** Module count plus a 2-module quiet zone on each side. */
  readonly size = computed(() => this.qr().getModuleCount() + 4);
  readonly path = computed(() => {
    const q = this.qr();
    const n = q.getModuleCount();
    let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + 2} ${r + 2}h1v1h-1z`;
    return d;
  });
}

/**
 * The ticket for physical printing: black on white, four corner ticks instead of a frame, hairline rules and
 * light type, so it uses very little ink and stays readable in black and white. Always 80 x 164 mm, whether it
 * carries one seat or many, so the paper length never changes. Several seats are plain text grouped by class,
 * with no boxes. Carries no customer details.
 */
@Component({
  selector: 'app-print-ticket',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [QrComponent],
  template: `
    @if (view(); as t) {
        <article class="pt" [attr.aria-label]="'Ticket for booking ' + t.ref">
          <i class="c tl"></i><i class="c tr"></i><i class="c bl"></i><i class="c br"></i>
          <header class="hd">
            @if (t.titleUrl) {
              <img class="title-img" [src]="t.titleUrl" [alt]="t.theatre" />
            } @else {
              <strong class="tname">{{ t.theatre }}</strong>
            }
            <span class="area">{{ t.area }}</span>
            @if (reprint()) { <span class="reprint">Reprint</span> }
          </header>

          <div class="ti">
            <h2>{{ t.film }}</h2>
            <p class="spec">{{ t.certification }} · {{ t.format }} · {{ t.language }}</p>
          </div>

          <div class="g">
            <div><span class="k">Date</span><b>{{ t.date }}</b></div>
            <div><span class="k">Time</span><b>{{ t.time }}</b></div>
            <div><span class="k">Screen</span><b>{{ t.screen }}</b></div>
            <div><span class="k">Class</span><b>{{ classNames() }}</b></div>
          </div>

          <div class="seats">
            <span class="k">{{ t.seatCount === 1 ? 'Seat' : 'Seats · ' + t.seatCount }}</span>
            @if (t.seatCount === 1) {
              <div class="sn">{{ t.groups[0]?.seats?.[0] }}</div>
              <span class="mc">{{ t.groups[0]?.name }}</span>
            } @else {
              @for (g of t.groups; track g.name + g.each) {
                <div class="mg"><span class="sl">{{ g.seats.join(', ') }}</span><span class="mc">{{ g.name }}</span></div>
              }
            }
          </div>

          <div class="pr">
            @for (g of t.groups; track g.name + g.each) {
              <div><span>{{ g.name }} · {{ g.count }} × {{ g.each }}</span><span>{{ g.subtotal }}</span></div>
            }
            <div><span>Price excl. GST</span><span>{{ t.base }}</span></div>
            @for (g of t.gst; track g.label) { <div><span>{{ g.label }}</span><span>{{ g.amount }}</span></div> }
            <div><span>Convenience fee</span><span>{{ t.fee }}</span></div>
            <div class="t"><span>Total paid</span><span>{{ t.total }}</span></div>
            <p class="pb">Paid by {{ t.payment }} · prices include GST</p>
          </div>

          <div class="ft">
            <app-qr class="qr" [data]="t.payload" [label]="t.ref" />
            <div class="ids">
              <span class="k">Booking ID</span>
              <b class="ref">{{ t.ref }}</b>
              <span class="k">Ticket no.</span>
              <span class="tn">{{ t.ticketRange }}</span>
              <span>{{ t.guest }}</span>
            </div>
          </div>
          <p class="fine">Counter sale {{ t.soldAt }} · Admit as shown · Not refundable after the show starts</p>
        </article>
    }
  `,
  styles: `
    :host { display: block; }
    /* One size for every ticket: 80 x 164 mm. Sections spread to fill it, so one seat or many never changes the length. */
    .pt { position: relative; box-sizing: border-box; width: 80mm; max-width: 100%; height: 164mm; margin: 0 auto; padding: 7mm 7mm 6mm; display: flex; flex-direction: column; justify-content: space-between; overflow: hidden; background: #fff; color: #000; border: 0.25mm #000; border-style: var(--pt-border, none); font: 9pt/1.3 'Jost', Arial, Helvetica, sans-serif; text-align: left; break-inside: avoid; }
    .pt * { box-sizing: border-box; }
    .c { position: absolute; width: 4.8mm; height: 4.8mm; border: 0 solid #000; pointer-events: none; }
    .c.tl { top: 2.7mm; left: 2.7mm; border-top-width: 0.3mm; border-left-width: 0.3mm; }
    .c.tr { top: 2.7mm; right: 2.7mm; border-top-width: 0.3mm; border-right-width: 0.3mm; }
    .c.bl { bottom: 2.7mm; left: 2.7mm; border-bottom-width: 0.3mm; border-left-width: 0.3mm; }
    .c.br { bottom: 2.7mm; right: 2.7mm; border-bottom-width: 0.3mm; border-right-width: 0.3mm; }
    .k { display: block; font-size: 6.4pt; font-weight: 500; letter-spacing: 0.16em; text-transform: uppercase; color: #555; }

    .hd { display: flex; flex-direction: column; align-items: center; gap: 0.6mm; text-align: center; }
    .title-img { display: block; width: 44mm; max-width: 100%; height: auto; margin: 0 0 0.8mm; filter: grayscale(1) contrast(1.8); }
    .hd strong { font-size: 9.5pt; letter-spacing: 0.2em; text-transform: uppercase; }
    .area { font-size: 6.8pt; letter-spacing: 0.14em; text-transform: uppercase; color: #444; }
    .reprint { position: absolute; top: 6mm; right: 7mm; padding: 0.3mm 1.6mm; border: 0.25mm solid #000; font-size: 6pt; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; }

    h2 { margin: 0; font: 400 26pt/1 'DM Serif Display', Georgia, 'Times New Roman', serif; text-wrap: balance; }
    .spec { margin: 1.2mm 0 0; font-size: 7pt; font-weight: 500; letter-spacing: 0.2em; text-transform: uppercase; }

    .g { display: grid; grid-template-columns: 1fr 1fr; gap: 2.4mm 3mm; }
    .g b { display: block; margin-top: 0.3mm; font-size: 11pt; font-weight: 400; line-height: 1.15; }

    /* Seats: one large numeral, or plain text grouped by class. No boxes either way. */
    .seats { display: flex; flex-direction: column; justify-content: center; gap: 1mm; }
    .sn { font: 400 44pt/1 'DM Serif Display', Georgia, serif; }
    .sl { display: block; font: 400 14pt/1.2 'DM Serif Display', Georgia, serif; letter-spacing: 0.04em; white-space: pre-wrap; }
    .mg { display: flex; flex-direction: column; gap: 0.6mm; margin-top: 1mm; }
    .mc { font-size: 6.6pt; font-weight: 500; letter-spacing: 0.2em; text-transform: uppercase; color: #444; }

    .pr { font-size: 7.8pt; }
    .pr > div { display: flex; justify-content: space-between; gap: 2mm; padding: 0.3mm 0; }
    .pr .t { margin-top: 1.2mm; padding-top: 1.2mm; border-top: 0.2mm solid #000; font-size: 11.5pt; font-weight: 600; }
    .pb { margin: 0.8mm 0 0; font-size: 7.2pt; color: #444; }

    .ft { display: flex; align-items: center; gap: 4mm; }
    .qr { width: 22mm; flex-shrink: 0; }
    .ids { display: flex; flex-direction: column; min-width: 0; font-size: 7.5pt; line-height: 1.45; }
    .ref { font-family: 'IBM Plex Mono', Consolas, 'Courier New', monospace; font-size: 11pt; font-weight: 600; letter-spacing: 0.1em; line-height: 1.2; }
    .tn { font-family: 'IBM Plex Mono', Consolas, 'Courier New', monospace; font-size: 7pt; overflow-wrap: anywhere; }
    .fine { margin: 0; font-size: 5.8pt; line-height: 1.35; color: #555; }

    @media print { .pt { border-color: #000; } }
  `,
})
export class PrintTicketComponent {
  private readonly store = inject(AdminStore);
  readonly booking = input.required<Booking>();
  /** One seat's own ticket, when printing a ticket per seat. */
  readonly seat = input<string | undefined>(undefined);
  readonly reprint = input(false);
  readonly view = computed(() => buildTicket(this.store, this.booking(), this.seat()));
  /** "Premium + Regular" when the booking spans classes. */
  readonly classNames = computed(() => this.view()?.groups.map((g) => g.name).join(' + ') ?? '');
}

/** All seats on one ticket (the default), or a separate ticket for each seat. */
export type PrintMode = 'together' | 'separate';

/** True when the booking prints as one ticket per seat. A single seat is always one ticket. */
export function isSeparate(mode: PrintMode, seats: number): boolean {
  return mode === 'separate' && seats > 1;
}

/** What the operator sees before printing, laid out as it will come out of the printer. */
@Component({
  selector: 'app-ticket-sheet-preview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PrintTicketComponent],
  template: `
    <div class="strip" [class.slides]="separate()" [class.dragging]="dragging" aria-label="Receipt roll preview"
      (pointerdown)="dragStart($event)" (pointermove)="dragMove($event)" (pointerup)="dragEnd($event)" (pointercancel)="dragEnd($event)" (wheel)="onWheel($event)">
      @if (separate()) {
        @for (s of booking().seats; track s) { <app-print-ticket [booking]="booking()" [seat]="s" [reprint]="reprint()" /> }
      } @else {
        <app-print-ticket [booking]="booking()" [reprint]="reprint()" />
      }
    </div>
  `,
  styles: `
    :host { display: block; }
    /* One ticket, or a row of tickets to slide through. The scroll bar stays out of sight. */
    .strip { display: flex; justify-content: center; scrollbar-width: none; -ms-overflow-style: none; }
    .strip::-webkit-scrollbar { display: none; }
    .strip.slides { justify-content: flex-start; gap: 24px; overflow-x: auto; scroll-snap-type: x mandatory; padding: 2px 8px; }
    .strip.slides app-print-ticket { flex: 0 0 auto; scroll-snap-align: center; }
    .strip.slides { cursor: grab; }
    .strip.dragging { cursor: grabbing; scroll-snap-type: none; user-select: none; }
  `,
})
export class TicketSheetPreviewComponent {
  readonly booking = input.required<Booking>();
  readonly mode = input<PrintMode>('together');
  readonly reprint = input(false);
  readonly separate = computed(() => isSeparate(this.mode(), this.booking().seats.length));

  // Sliding with a mouse: drag the tickets, or turn the wheel. A touch screen scrolls them natively.
  dragging = false;
  private startX = 0;
  private startLeft = 0;

  dragStart(e: PointerEvent): void {
    if (!this.separate() || e.pointerType !== 'mouse') return;
    const el = e.currentTarget as HTMLElement;
    this.dragging = true;
    this.startX = e.clientX;
    this.startLeft = el.scrollLeft;
    el.setPointerCapture(e.pointerId);
  }

  dragMove(e: PointerEvent): void {
    if (!this.dragging) return;
    (e.currentTarget as HTMLElement).scrollLeft = this.startLeft - (e.clientX - this.startX);
  }

  dragEnd(e: PointerEvent): void {
    if (!this.dragging) return;
    this.dragging = false;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  }

  onWheel(e: WheelEvent): void {
    if (!this.separate() || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).scrollBy({ left: e.deltaY, behavior: 'auto' });
  }
}

/**
 * Prints counter tickets. Only confirmed bookings print; a reprint is recorded in the audit trail.
 * The tickets render in the print host at the app root and only they appear on paper. By default every
 * seat is on one ticket; the separate mode prints a ticket per seat in the same print operation.
 */
@Injectable({ providedIn: 'root' })
export class TicketPrinter {
  private readonly store = inject(AdminStore);
  readonly job = signal<{ booking: Booking; reprint: boolean; separate: boolean } | null>(null);

  /** Prints the tickets of a confirmed counter booking. Returns false when it cannot be printed. */
  print(bookingId: string, reprint = false, mode: PrintMode = 'together'): boolean {
    const b = this.store.booking(bookingId);
    if (!b || b.status !== 'confirmed' || b.channel !== 'counter') return false;
    if (reprint) this.store.recordReprint(bookingId);
    this.setPage();
    const booking = this.store.booking(bookingId)!;
    this.job.set({ booking, reprint, separate: isSeparate(mode, booking.seats.length) });
    // Let the print host render, then open the browser's print dialog.
    setTimeout(() => {
      window.print();
      this.job.set(null);
    }, 60);
    return true;
  }

  /** The paper: always an 80 mm receipt roll, with no margins. */
  private setPage(): void {
    const id = 'ticket-page-style';
    const el = document.getElementById(id) ?? Object.assign(document.createElement('style'), { id });
    el.textContent = '@page { size: 80mm auto; margin: 0; }';
    if (!el.isConnected) document.head.appendChild(el);
  }
}

/** Placed once at the app root: holds the tickets being printed, hidden on screen. */
@Component({
  selector: 'app-print-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PrintTicketComponent],
  template: `
    @if (printer.job(); as job) {
      <div class="print-area" [class.sep]="job.separate">
        @if (job.separate) {
          @for (s of job.booking.seats; track s) { <app-print-ticket [booking]="job.booking" [seat]="s" [reprint]="job.reprint" /> }
        } @else {
          <app-print-ticket [booking]="job.booking" [reprint]="job.reprint" />
        }
      </div>
    }
  `,
  styles: `
    .print-area { position: fixed; left: -10000px; top: 0; width: 80mm; }
    @media print {
      .print-area { position: static !important; }
      /* On a roll, each seat's ticket is its own page, so the printer cuts between them. */
      .print-area.sep app-print-ticket { break-after: page; }
      .print-area.sep app-print-ticket:last-child { break-after: auto; }
    }
  `,
})
export class PrintHostComponent {
  readonly printer = inject(TicketPrinter);
}
