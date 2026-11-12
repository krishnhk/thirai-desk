import { AdminStore } from '../../../core/admin-store';
import { addDays, formatDay, sameDay, toDateInput } from '../../../core/format';
import { Booking, COUNTER_PAYMENT_METHODS, Show, ShowStatus } from '../../../core/models';
import { CounterRow, counterRows } from '../history/counter-data';

export interface Tally { count: number; tickets: number; amount: number; }
export interface Bar { key: string; label: string; sub?: string; value: number; text: string; }
export interface ShowOccupancy { show: Show; label: string; screen: string; status: ShowStatus; capacity: number; counter: number; online: number; available: number; }
export interface ChannelDay { key: string; label: string; counter: number; online: number; counterTickets: number; onlineTickets: number; }
export interface OperatorDay { name: string; role: string; counter: string; count: number; tickets: number; amount: number; cash: number; last: Date | null; active: boolean; }

const tally = (rows: { booking: Booking }[]): Tally => ({
  count: rows.length,
  tickets: rows.reduce((n, r) => n + r.booking.seats.length, 0),
  amount: rows.reduce((n, r) => n + r.booking.amount, 0),
});

/** Minutes back that count an operator as active. */
export const ACTIVE_WINDOW_MINUTES = 120;

/**
 * Counter figures for one business date (sales are counted on the day they were sold).
 * `operator` limits every figure to one operator's own sales.
 */
export function counterStats(store: AdminStore, day: Date, operator: string | null) {
  const now = store.now();
  let rows: CounterRow[] = counterRows(store);
  if (operator) rows = rows.filter((r) => r.booking.operator === operator);
  const sold = rows.filter((r) => sameDay(r.booking.bookedAt, day));
  const confirmed = sold.filter((r) => r.booking.status === 'confirmed');
  const cancelled = rows.filter((r) => r.booking.status === 'cancelled' && r.booking.cancelledAt && sameDay(r.booking.cancelledAt, day));
  const byMethod = COUNTER_PAYMENT_METHODS.map((m) => ({ method: m, ...tally(confirmed.filter((r) => r.method === m)) }));

  const since = now.getTime() - ACTIVE_WINDOW_MINUTES * 60_000;
  const active = [...new Set(rows.filter((r) => r.booking.bookedAt.getTime() >= since && r.booking.bookedAt <= now).map((r) => r.operator))];

  const screens = new Map<string, { label: string; tally: Tally; rows: CounterRow[] }>();
  for (const r of confirmed) {
    const e = screens.get(r.screenId) ?? { label: r.screen, tally: { count: 0, tickets: 0, amount: 0 }, rows: [] };
    e.rows.push(r);
    screens.set(r.screenId, e);
  }
  const byScreen: Bar[] = [...screens.entries()].map(([key, e]) => {
    const t = tally(e.rows);
    return { key, label: e.label, sub: `${t.tickets} tickets`, value: t.amount, text: '' };
  }).sort((a, b) => a.label.localeCompare(b.label, 'en', { numeric: true }));

  return {
    sold, confirmed, cancelled, byMethod, byScreen, active,
    total: tally(confirmed),
    cancelledTally: tally(cancelled),
    cash: byMethod.find((m) => m.method === 'Cash')!,
    upi: byMethod.find((m) => m.method === 'UPI')!,
    card: byMethod.find((m) => m.method === 'Card')!,
    recent: [...sold].sort((a, b) => b.booking.bookedAt.getTime() - a.booking.bookedAt.getTime()).slice(0, 8),
  };
}

/** Seats per published show on the day: sold at the counter, sold online, still available. */
export function showOccupancy(store: AdminStore, day: Date): ShowOccupancy[] {
  return store.scopedShows()
    .filter((s) => s.publication === 'published' && sameDay(s.start, day))
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .map((s) => {
      const bookings = store.confirmedBookingsOf(s.id);
      const counter = bookings.filter((b) => b.channel === 'counter').reduce((n, b) => n + b.seats.length, 0);
      const online = bookings.filter((b) => b.channel !== 'counter').reduce((n, b) => n + b.seats.length, 0);
      const capacity = store.capacity(s.screenId);
      return {
        show: s, label: store.movie(s.movieId)?.title ?? 'Film', screen: store.screen(s.screenId)?.name ?? '', status: store.showStatus(s),
        capacity, counter, online, available: s.cancellation ? 0 : Math.max(0, capacity - counter - online),
      };
    });
}

/** Confirmed sales by channel for each of the seven days ending on `day`, by the day they were sold. */
export function channelDays(store: AdminStore, day: Date): ChannelDay[] {
  const days: ChannelDay[] = [];
  const index = new Map<string, ChannelDay>();
  for (let i = 6; i >= 0; i--) {
    const d = addDays(day, -i);
    const e: ChannelDay = { key: toDateInput(d), label: i === 0 ? 'Today' : formatDay(d), counter: 0, online: 0, counterTickets: 0, onlineTickets: 0 };
    days.push(e);
    index.set(e.key, e);
  }
  for (const b of store.bookings()) {
    if (b.status !== 'confirmed') continue;
    const e = index.get(toDateInput(b.bookedAt));
    if (!e) continue;
    const show = store.show(b.showId);
    if (show && !store.inScope(show.theatreId)) continue;
    if (b.channel === 'counter') { e.counter += b.amount; e.counterTickets += b.seats.length; }
    else { e.online += b.amount; e.onlineTickets += b.seats.length; }
  }
  return days;
}

/** Each counter staff member's sales on the day, for supervisors and the operator list in settings. */
export function operatorDay(store: AdminStore, day: Date): OperatorDay[] {
  const rows = counterRows(store).filter((r) => sameDay(r.booking.bookedAt, day) && r.booking.status === 'confirmed');
  const since = store.now().getTime() - ACTIVE_WINDOW_MINUTES * 60_000;
  return store.staffUsers()
    .filter((u) => u.role === 'Counter Operator' || u.role === 'Counter Supervisor')
    .map((u) => {
      const mine = rows.filter((r) => r.booking.operator === u.name);
      const t = tally(mine);
      const last = mine.reduce<Date | null>((d, r) => (!d || r.booking.bookedAt > d ? r.booking.bookedAt : d), null);
      return {
        name: u.name, role: u.role, counter: u.counter ?? '—', ...t,
        cash: mine.filter((r) => r.method === 'Cash').reduce((n, r) => n + r.booking.amount, 0),
        last, active: !!last && last.getTime() >= since,
      };
    });
}
