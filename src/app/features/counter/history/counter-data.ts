import { AdminStore } from '../../../core/admin-store';
import { findSeat } from '../../../core/layout';
import { Booking, Refund, Show } from '../../../core/models';

/** A counter booking joined with its show, film, screen and refund, for lists and the detail view. */
export interface CounterRow {
  booking: Booking;
  show: Show | undefined;
  film: string;
  screen: string;
  screenId: string;
  movieId: string;
  showStart: Date | null;
  tickets: number;
  method: string;
  operator: string;
  refund: Refund | undefined;
}

/** Counter bookings in the theatre scope, joined for display. */
export function counterRows(store: AdminStore): CounterRow[] {
  const refundByBooking = new Map<string, Refund>();
  for (const r of store.refunds()) if (r.channel === 'counter' && r.status !== 'rejected') refundByBooking.set(r.bookingId, r);
  const out: CounterRow[] = [];
  for (const b of store.bookings()) {
    if (b.channel !== 'counter') continue;
    const show = store.show(b.showId);
    if (show && !store.inScope(show.theatreId)) continue;
    out.push({
      booking: b, show,
      film: show ? store.movie(show.movieId)?.title ?? 'Film' : 'Show removed',
      screen: show ? store.screen(show.screenId)?.name ?? 'Screen' : '',
      screenId: show?.screenId ?? '',
      movieId: show?.movieId ?? '',
      showStart: show?.start ?? null,
      tickets: b.seats.length,
      method: b.counterPayment?.method ?? b.paymentMethod,
      operator: b.operator ?? '—',
      refund: refundByBooking.get(b.id),
    });
  }
  return out;
}

/** Counter bookings the signed-in user may see: all of them, or only their own sales. */
export function visibleCounterRows(store: AdminStore): CounterRow[] {
  const rows = counterRows(store);
  if (store.can('counter.history.all')) return rows;
  if (store.can('counter.history.own')) {
    const me = store.currentUser().name;
    return rows.filter((r) => r.booking.operator === me);
  }
  return [];
}

/** The seat category name of each seat of a booking. */
export function seatCategories(store: AdminStore, b: Booking): string[] {
  const show = store.show(b.showId);
  const layout = show ? store.screen(show.screenId)?.layout ?? null : null;
  return b.seats.map((seat) => {
    const id = layout ? findSeat(layout, seat)?.cell.categoryId : undefined;
    return layout?.categories.find((c) => c.id === id)?.name ?? '—';
  });
}

/** The suggested reference for a cash refund, in the seed's format: CR- plus the booking code. */
export function suggestCashRef(bookingRef: string): string {
  return 'CR-' + bookingRef.replace(/^TC/, '');
}

export const CANCEL_REASONS = ['Customer changed plans', 'Wrong show or seats sold', 'Duplicate sale', 'Customer unwell', 'Other'] as const;
