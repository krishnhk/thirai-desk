import { AdminStore } from '../core/admin-store';
import { formatDate, formatMoney, formatTime } from '../core/format';
import { findSeat } from '../core/layout';
import { Booking, WALK_IN } from '../core/models';
import { breakdown, groupLines, SeatLine } from '../features/counter/pos/pos-pricing';

/** The text a ticket's QR code carries: the booking and its seats. The entry scanner looks the booking up. */
export function ticketPayload(booking: Booking): string {
  return `GKC1|${booking.ref}|${booking.showId}|${booking.seats.join(',')}`;
}

export interface TicketSeatGroup {
  name: string;
  color: string;
  seats: string[];
  count: number;
  /** "₹250" */
  each: string;
  subtotal: string;
}

/**
 * Everything a ticket shows, worked out once. The on-screen ticket, the printer and the PDF all read this,
 * so they can never disagree. Counter tickets carry no customer details: the guest is always a walk-in.
 */
export interface TicketView {
  ref: string;
  logoUrl: string;
  /** The theatre's title artwork, or '' to print its name as text. */
  titleUrl: string;
  theatre: string;
  area: string;
  film: string;
  certification: string;
  format: string;
  language: string;
  screen: string;
  /** "Wed, 11 Nov 2026" */
  date: string;
  time: string;
  guest: string;
  seatCount: number;
  groups: TicketSeatGroup[];
  /** Ticket price before GST (prices at the counter include it). */
  base: string;
  gst: { label: string; amount: string }[];
  gstTotal: string;
  fee: string;
  total: string;
  payment: string;
  soldAt: string;
  ticketRefs: string[];
  /** "TC20AW31-1 to -6", or the single reference. */
  ticketRange: string;
  payload: string;
}

/**
 * Builds the ticket for a booking, or null when its show no longer exists. With `onlySeat` it builds the
 * single-seat ticket (its own price, reference and QR), for printing one ticket per seat.
 */
export function buildTicket(store: AdminStore, b: Booking, onlySeat?: string): TicketView | null {
  const show = store.show(b.showId);
  if (!show) return null;
  const movie = store.movie(show.movieId);
  const screen = store.screen(show.screenId);
  const theatre = store.theatre(show.theatreId);
  const layout = screen?.layout ?? null;

  const seats = onlySeat ? b.seats.filter((s) => s === onlySeat) : b.seats;
  const lines: SeatLine[] = seats.map((seat) => {
    const cell = layout ? findSeat(layout, seat)?.cell : undefined;
    const cat = layout?.categories.find((c) => c.id === cell?.categoryId);
    return { seat, categoryId: cat?.id ?? '', category: cat?.name ?? '—', color: cat?.color ?? '#7c8aa0', price: store.seatPrice(show, seat) ?? 0 };
  });
  const totals = breakdown(lines);
  const gstTotal = totals.gst.reduce((n, g) => n + g.amount, 0);
  const share = seats.length / (b.seats.length || 1);
  const fee = (b.convenienceFee ?? 0) * share;
  const refs = onlySeat ? b.ticketRefs.filter((_, i) => b.seats[i] === onlySeat) : b.ticketRefs;
  const paid = onlySeat ? totals.total + fee : b.amount;

  return {
    ref: b.ref,
    logoUrl: theatre?.logoUrl ?? '',
    // The wordmark alone (no emblem), when the cover is the branded wordmark.
    titleUrl: (theatre?.coverBranded ? theatre.coverUrl : '') || theatre?.titleUrl || '',
    theatre: theatre?.name ?? '',
    area: theatre ? `${theatre.area}, ${theatre.city}` : '',
    film: movie?.title ?? 'Film',
    certification: movie?.certification ?? '',
    format: show.format,
    language: show.language,
    screen: screen?.name ?? '',
    date: formatDate(show.start),
    time: formatTime(show.start),
    guest: WALK_IN,
    seatCount: seats.length,
    groups: groupLines(lines).map((g) => ({
      name: g.category,
      color: g.color,
      seats: g.seats,
      count: g.seats.length,
      each: formatMoney(g.price),
      subtotal: formatMoney(g.subtotal),
    })),
    base: formatMoney(totals.base, 2),
    gst: totals.gst.map((g) => ({ label: `GST ${Math.round(g.rate * 100)}%`, amount: formatMoney(g.amount, 2) })),
    gstTotal: formatMoney(gstTotal, 2),
    fee: formatMoney(fee, 2),
    total: formatMoney(paid, 2),
    payment: b.counterPayment?.method ?? b.paymentMethod,
    soldAt: `${formatDate(b.bookedAt)} · ${formatTime(b.bookedAt)}`,
    ticketRefs: refs,
    ticketRange: refs.length <= 1 ? (refs[0] ?? '') : `${refs[0]} to -${refs.length}`,
    payload: onlySeat ? `GKC1|${b.ref}|${b.showId}|${onlySeat}` : ticketPayload(b),
  };
}
