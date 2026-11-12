import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';

import { AdminStore } from '../../../core/admin-store';
import { addDays, formatMoney, sameDay, startOfDay, toDateInput } from '../../../core/format';
import { couplePartner, findSeat, SELLABLE } from '../../../core/layout';
import { Booking, CounterPaymentMethod } from '../../../core/models';
import { TicketPrinter } from '../../../shared/counter-ticket.component';
import { ToastService } from '../../../shared/feedback';
import { bestSeats, breakdown, groupLines, SeatLine } from './pos-pricing';

/** The most tickets one counter sale can hold. */
export const MAX_SEATS = 20;

export type DigitalStatus = 'idle' | 'waiting' | 'confirmed';

export interface Notice {
  tone: 'info' | 'warning' | 'danger' | 'success';
  text: string;
  at: number;
}

/**
 * One box-office sale in progress: the show, the seats, the payment and, once confirmed, the
 * booking. Provided by the counter page, so every panel reads and changes the same sale. The
 * store stays the owner of the records; this only holds what the operator has not confirmed yet.
 */
@Injectable()
export class PosSale {
  private readonly store = inject(AdminStore);
  private readonly toast = inject(ToastService);
  private readonly printer = inject(TicketPrinter);

  readonly showId = signal<string | null>(null);
  readonly seats = signal<string[]>([]);
  readonly method = signal<CounterPaymentMethod>('Cash');
  /** Cash handed over by the customer. */
  readonly cashReceived = signal<number | null>(null);
  readonly digital = signal<{ status: DigitalStatus; ref: string }>({ status: 'idle', ref: '' });
  /** The confirmed booking, while the success state is on screen. */
  readonly bookingId = signal<string | null>(null);
  readonly printed = signal(false);
  /** All seats on one ticket (default), or a separate ticket per seat in the same print. */
  readonly seatMode = signal<'together' | 'separate'>('together');
  /** The last print action, shown under the print buttons. */
  readonly printNote = signal('');
  readonly notice = signal<Notice | null>(null);

  private digitalTimer: ReturnType<typeof setTimeout> | undefined;

  readonly canSell = computed(() => this.store.can('counter.sell'));
  readonly show = computed(() => { const id = this.showId(); return id ? this.store.show(id) ?? null : null; });

  // ------------------------------------------------------------------ Date (the header's operational date)

  /** The day the show list is on: the console's operational date, so the header and the POS agree. */
  readonly day = computed(() => startOfDay(this.store.operationalDate()));
  readonly today = computed(() => startOfDay(this.store.now()));
  /** The last day the box office can sell: today plus the advance booking window. */
  readonly lastDay = computed(() => { this.store.now(); return this.store.counterLastBookableDay(); });
  readonly isToday = computed(() => sameDay(this.day(), this.today()));
  /** Whether the selected day is one the box office can sell for (today through the advance window). */
  readonly dayInWindow = computed(() => this.inWindow(this.day()));
  /** Every day the box office can sell for, today first. */
  readonly windowDays = computed(() => {
    const out: Date[] = [];
    for (let d = this.today(); d <= this.lastDay(); d = addDays(d, 1)) out.push(d);
    return out;
  });
  /** The selected show is on a later day than today: an advance booking. */
  readonly isAdvance = computed(() => { const s = this.show(); return !!s && startOfDay(s.start) > this.today(); });

  /** For each day (yyyy-mm-dd): the published shows the counter lists, and how many are open for booking. */
  readonly dayStats = computed(() => {
    const map = new Map<string, { listed: number; open: number }>();
    for (const s of this.store.scopedShows()) {
      if (s.publication !== 'published') continue;
      const key = toDateInput(s.start);
      const st = map.get(key) ?? { listed: 0, open: 0 };
      st.listed++;
      if (this.store.counterSaleState(s).open) st.open++;
      map.set(key, st);
    }
    return map;
  });

  /** The nearest other day in the window with shows open for booking (later days first), or null. */
  nextDayWithShows(from = this.day()): Date | null {
    const stats = this.dayStats();
    const days = this.windowDays();
    const later = days.filter((d) => d > from);
    const earlier = days.filter((d) => d < from).reverse();
    return [...later, ...earlier].find((d) => (stats.get(toDateInput(d))?.open ?? 0) > 0) ?? null;
  }

  inWindow(d: Date): boolean {
    const x = startOfDay(d);
    return x >= this.today() && x <= this.lastDay();
  }

  /** Moves the show list (and the header) to a day inside the advance window. */
  setDay(d: Date): boolean {
    if (!this.inWindow(d)) return false;
    this.store.operationalDate.set(startOfDay(d));
    return true;
  }

  /** Previous or next day, kept inside the window (from a day outside it, the nearest end of it). */
  shiftDay(delta: number): boolean {
    const cur = this.day();
    let target = addDays(cur, delta);
    if (cur < this.today()) target = this.today();
    else if (cur > this.lastDay()) target = this.lastDay();
    if (sameDay(target, cur) || !this.inWindow(target)) return false;
    return this.setDay(target);
  }

  goToday(): void {
    this.store.operationalDate.set(this.today());
  }

  readonly screen = computed(() => { const s = this.show(); return s ? this.store.screen(s.screenId) ?? null : null; });
  readonly movie = computed(() => { const s = this.show(); return s ? this.store.movie(s.movieId) ?? null : null; });
  readonly layout = computed(() => this.screen()?.layout ?? null);
  readonly saleState = computed(() => { const s = this.show(); return s ? this.store.counterSaleState(s) : { open: false, reason: '', status: 'unavailable' as const }; });
  readonly taken = computed(() => { const id = this.showId(); return id ? this.store.seatsTaken(id) : new Set<string>(); });
  readonly booking = computed<Booking | null>(() => { const id = this.bookingId(); return id ? this.store.booking(id) ?? null : null; });

  readonly methods = computed(() => this.store.settings().counterPaymentMethods);

  readonly lines = computed<SeatLine[]>(() => {
    const show = this.show();
    const layout = this.layout();
    if (!show || !layout) return [];
    const cats = new Map(layout.categories.map((c) => [c.id, c]));
    return this.seats().map((seat) => {
      const catId = findSeat(layout, seat)?.cell.categoryId ?? '';
      const cat = cats.get(catId);
      return { seat, categoryId: catId, category: cat?.name ?? '—', color: cat?.color ?? '#7c8aa0', price: this.store.seatPrice(show, seat) ?? 0 };
    });
  });
  readonly groups = computed(() => groupLines(this.lines()));
  readonly totals = computed(() => breakdown(this.lines()));
  readonly total = computed(() => this.totals().total);

  readonly isCash = computed(() => this.method() === 'Cash');
  readonly change = computed(() => {
    const got = this.cashReceived();
    return got == null ? null : got - this.total();
  });
  /** Once a terminal or UPI payment is requested, the seats are fixed until it is voided. */
  readonly locked = computed(() => !this.isCash() && this.digital().status !== 'idle');

  /** Why the sale cannot be confirmed yet; empty when it can. */
  readonly blockers = computed<string[]>(() => {
    if (!this.canSell()) return ['Your role cannot sell tickets.'];
    const show = this.show();
    if (!show) return ['Choose a show.'];
    const state = this.saleState();
    if (!state.open) return [state.reason];
    if (!this.seats().length) return ['Select at least one seat.'];
    if (this.isCash()) {
      const got = this.cashReceived();
      if (got == null || got < this.total()) return [`Enter the cash received: at least ${formatMoney(this.total())}.`];
    } else if (this.digital().status !== 'confirmed') {
      return [`Take the ${this.method()} payment and wait for it to be confirmed.`];
    }
    return [];
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.digitalTimer));

    // The shared inventory: a seat sold online (or at another counter) while it sits in this
    // sale is taken out of the sale at once, with its couple partner.
    effect(() => {
      const taken = this.taken();
      const selected = untracked(this.seats);
      const layout = untracked(this.layout);
      if (!layout || !selected.length) return;
      const lost = selected.filter((s) => taken.has(s));
      if (!lost.length) return;
      const drop = new Set(lost);
      for (const s of lost) { const p = couplePartner(layout, s); if (p) drop.add(p); }
      untracked(() => {
        this.seats.set(selected.filter((s) => !drop.has(s)));
        const list = sortSeats([...drop]).join(', ');
        this.say('danger', `${list} ${drop.size === 1 ? 'was' : 'were'} just sold on another channel and removed from this sale.`);
        this.toast.error('Seats no longer available', `${list} ${drop.size === 1 ? 'was' : 'were'} just sold. Choose other seats.`);
        if (!this.isCash() && this.digital().status !== 'idle') this.voidPayment(true);
      });
    });

    // Keep the payment method to one the box office accepts.
    effect(() => {
      const methods = this.methods();
      if (methods.length && !methods.includes(untracked(this.method))) untracked(() => this.setMethod(methods[0]!));
    });
  }

  say(tone: Notice['tone'], text: string): void {
    this.notice.set({ tone, text, at: Date.now() });
  }

  // ------------------------------------------------------------------ Show

  selectShow(id: string): boolean {
    if (id === this.showId() && !this.bookingId()) return true;
    if (this.locked()) {
      this.blockedByPayment('changing the show');
      return false;
    }
    const show = this.store.show(id);
    if (!show) return false;
    this.showId.set(id);
    this.seats.set([]);
    this.bookingId.set(null);
    this.printed.set(false);
    this.resetPayment();
    this.notice.set(null);
    return true;
  }

  /**
   * Back to the show list with nothing carried over: no show, seats, payment or notice. Refused while a digital
   * payment is in progress, so money already taken is never lost. Completed bookings stay in the store.
   */
  leaveShow(): boolean {
    if (this.locked()) {
      this.blockedByPayment('leaving this show');
      return false;
    }
    this.showId.set(null);
    this.seats.set([]);
    this.bookingId.set(null);
    this.printed.set(false);
    this.resetPayment();
    this.method.set(this.methods()[0] ?? 'Cash');
    this.notice.set(null);
    return true;
  }

  // ------------------------------------------------------------------ Seats

  private seatChangeBlocker(): { tone: Notice['tone']; text: string } | null {
    if (!this.canSell()) return { tone: 'info', text: 'Your role cannot sell tickets.' };
    if (this.bookingId()) return { tone: 'info', text: 'Start a new sale to choose seats.' };
    if (!this.saleState().open) return { tone: 'warning', text: this.saleState().reason };
    if (this.locked()) return { tone: 'warning', text: `Seats are fixed while the ${this.method()} payment is in progress. Void it to change seats.` };
    return null;
  }

  /** Adds or removes a seat (a couple seat brings its partner). Explains why when it cannot. */
  toggleSeat(id: string): boolean {
    const layout = this.layout();
    if (!layout) return false;
    const blocked = this.seatChangeBlocker();
    if (blocked) { this.say(blocked.tone, blocked.text); return false; }
    const found = findSeat(layout, id);
    if (!found) { this.say('warning', `There is no seat ${id} on ${this.screen()?.name ?? 'this screen'}.`); return false; }
    if (!SELLABLE.has(found.cell.kind)) { this.say('warning', `${id} is blocked and cannot be sold.`); return false; }
    const partner = couplePartner(layout, id);
    const group = partner ? [id, partner] : [id];
    const taken = this.taken();
    const sold = group.filter((s) => taken.has(s));
    if (sold.length) { this.say('danger', `${sold.join(' and ')} ${sold.length === 1 ? 'is' : 'are'} already booked.`); return false; }
    const current = this.seats();
    if (current.includes(id)) {
      this.seats.set(current.filter((s) => !group.includes(s)));
      this.say('info', partner ? `Removed couple pair ${group.join(' + ')}.` : `Removed ${id}.`);
      return true;
    }
    if (current.length + group.length > MAX_SEATS) { this.say('warning', `One sale can hold up to ${MAX_SEATS} tickets.`); return false; }
    this.seats.set(sortSeats([...current, ...group]));
    this.say('success', partner ? `Added couple pair ${group.join(' + ')}.` : `Added ${id}.`);
    this.invalidateCash();
    return true;
  }

  removeSeat(id: string): void {
    if (this.locked()) { this.say('warning', 'Void the payment to change seats.'); return; }
    const layout = this.layout();
    const partner = layout ? couplePartner(layout, id) : null;
    this.seats.update((list) => list.filter((s) => s !== id && s !== partner));
  }

  clearSeats(): void {
    if (this.locked()) { this.say('warning', 'Void the payment to change seats.'); return; }
    if (this.seats().length) this.say('info', 'Cleared the selection.');
    this.seats.set([]);
    this.cashReceived.set(null);
  }

  /** Replaces the selection with the best `count` seats together, in the given category or the best one that has room. */
  pickBest(count: number, categoryId?: string | null): boolean {
    const layout = this.layout();
    if (!layout) { this.say('info', 'Choose a show first.'); return false; }
    const blocked = this.seatChangeBlocker();
    if (blocked) { this.say(blocked.tone, blocked.text); return false; }
    if (count < 1 || count > MAX_SEATS) { this.say('warning', `Pick between 1 and ${MAX_SEATS} seats.`); return false; }
    const show = this.show()!;
    const price = (id: string) => show.prices[id] ?? 0;
    const cats = categoryId
      ? layout.categories.filter((c) => c.id === categoryId)
      : [...layout.categories].sort((a, b) => Number(this.isCoupleCategory(a.id)) - Number(this.isCoupleCategory(b.id)) || price(b.id) - price(a.id));
    for (const cat of cats) {
      const seats = bestSeats(layout, cat, count, this.taken());
      if (seats) {
        this.seats.set(seats);
        this.invalidateCash();
        this.say('success', `Best ${count} together in ${cat.name}: ${seats.join(', ')}.`);
        return true;
      }
    }
    const where = categoryId ? layout.categories.find((c) => c.id === categoryId)?.name ?? 'that category' : 'any category';
    this.say('warning', `No ${count} seats together in ${where}. Pick seats on the chart.`);
    return false;
  }

  /** Categories made only of couple seats are picked last by best available. */
  private isCoupleCategory(categoryId: string): boolean {
    const cells = this.layout()?.cells.flat().filter((c) => c.categoryId === categoryId && SELLABLE.has(c.kind)) ?? [];
    return cells.length > 0 && cells.every((c) => c.kind === 'couple');
  }

  // ------------------------------------------------------------------ Payment

  setMethod(method: CounterPaymentMethod): void {
    if (method === this.method()) return;
    if (this.locked()) { this.say('warning', `Void the ${this.method()} payment before switching method.`); return; }
    this.method.set(method);
    this.resetPayment();
  }

  setCash(amount: number | null): void {
    this.cashReceived.set(amount == null || Number.isNaN(amount) ? null : Math.max(0, Math.round(amount)));
  }

  /** Sends the amount to the card terminal or UPI QR and waits for the confirmation. */
  requestPayment(): void {
    if (this.isCash() || !this.seats().length || this.digital().status !== 'idle') return;
    this.digital.set({ status: 'waiting', ref: '' });
    clearTimeout(this.digitalTimer);
    this.digitalTimer = setTimeout(() => {
      if (this.digital().status !== 'waiting') return;
      this.digital.set({ status: 'confirmed', ref: makeTxnRef(this.method()) });
      this.say('success', `${this.method()} payment of ${formatMoney(this.total())} confirmed.`);
    }, 1500);
  }

  /** The operator types the reference shown on the terminal or the customer's UPI app. */
  confirmManualRef(ref: string): boolean {
    const clean = ref.trim().toUpperCase();
    if (clean.length < 6) { this.say('warning', 'Enter the full transaction reference shown on the terminal (6 characters or more).'); return false; }
    clearTimeout(this.digitalTimer);
    this.digital.set({ status: 'confirmed', ref: clean });
    this.say('success', `${this.method()} payment recorded with reference ${clean}.`);
    return true;
  }

  voidPayment(silent = false): void {
    clearTimeout(this.digitalTimer);
    const was = this.digital().status;
    this.digital.set({ status: 'idle', ref: '' });
    if (!silent && was !== 'idle') this.say('warning', `${this.method()} payment voided. Reverse it on the terminal if it went through.`);
  }

  /** A clear, hard-to-miss refusal: a toast for the operator plus the note by the seat chart. */
  private blockedByPayment(action: string): void {
    const text = `A ${this.method()} payment is in progress. Void it before ${action}.`;
    this.say('warning', text);
    this.toast.error('Payment in progress', text);
  }

  private resetPayment(): void {
    clearTimeout(this.digitalTimer);
    this.cashReceived.set(null);
    this.digital.set({ status: 'idle', ref: '' });
  }

  /** A changed total makes a typed cash amount stale when it no longer covers it. */
  private invalidateCash(): void {
    const got = this.cashReceived();
    if (got != null && got < this.total()) this.cashReceived.set(null);
  }

  // ------------------------------------------------------------------ Confirm and print

  /** Confirms the sale. Only called once the payment is confirmed; the store re-checks the seats. */
  confirm(): Booking | null {
    const blockers = this.blockers();
    if (blockers.length) { this.say('warning', blockers[0]!); return null; }
    const cash = this.isCash();
    const result = this.store.createCounterBooking({
      showId: this.showId()!,
      seats: this.seats(),
      method: this.method(),
      amountCollected: cash ? this.cashReceived()! : this.total(),
      txnRef: cash ? null : this.digital().ref,
    });
    if (!result.booking) {
      this.say('danger', result.errors.join(' '));
      this.toast.error('Booking not confirmed', result.errors.join(' '));
      return null;
    }
    const b = result.booking;
    this.seats.set([]);
    this.resetPayment();
    this.bookingId.set(b.id);
    this.printed.set(false);
    this.printNote.set('');
    this.notice.set(null);
    return b;
  }

  /** Prints on the 80 mm receipt roll: one ticket for all seats, or one per seat. */
  print(): void {
    const id = this.bookingId();
    if (!id) return;
    const reprint = this.printed();
    const count = this.booking()?.seats.length ?? 0;
    const separate = this.seatMode() === 'separate' && count > 1;
    if (this.printer.print(id, reprint, this.seatMode())) {
      this.printed.set(true);
      const where = separate ? `Sent to the printer: ${count} tickets, one per seat.` : 'Sent to the printer.';
      this.printNote.set(reprint ? 'Reprint sent to the printer and recorded in the audit log.' : where);
    }
  }

  reprint(): void {
    const id = this.bookingId();
    if (!id) return;
    if (this.printer.print(id, true, this.seatMode())) {
      this.printed.set(true);
      this.printNote.set(`Reprint sent to the printer (print ${this.booking()?.printCount ?? ''}) and recorded in the audit log.`);
    }
  }

  /** Back to an empty sale on the same show, for the next customer in the queue. */
  newSale(): void {
    this.bookingId.set(null);
    this.printed.set(false);
    this.seats.set([]);
    this.resetPayment();
    this.method.set(this.methods()[0] ?? 'Cash');
    this.seatMode.set('together');
    this.notice.set(null);
  }
}

/** Row order, then seat number: "F7, F8, G1". */
export function sortSeats(seats: string[]): string[] {
  const split = (s: string) => { const m = /^([A-Z]+)(\d+)$/.exec(s); return m ? [m[1]!, Number(m[2])] as const : [s, 0] as const; };
  return [...seats].sort((a, b) => {
    const [ra, na] = split(a);
    const [rb, nb] = split(b);
    return ra.length - rb.length || ra.localeCompare(rb) || na - nb;
  });
}

/** A simulated terminal reference: a 12-digit UPI UTR, or a card approval code. */
function makeTxnRef(method: CounterPaymentMethod): string {
  const digits = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');
  if (method === 'UPI') return `6${digits(11)}`;
  if (method === 'Card') return `AUTH${digits(6)}`;
  return `OTH${digits(8)}`;
}
