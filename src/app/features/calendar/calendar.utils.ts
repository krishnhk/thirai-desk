/**
 * Pure helpers for the show calendar: conflict detection, lane packing and calendar ranges.
 * No Angular or store imports, so they can be checked on their own.
 */

/** One show reduced to the times that matter for scheduling, in epoch milliseconds. */
export interface ScheduleSlot {
  id: string;
  screenId: string;
  start: number;
  /** When the film and its interval end. */
  filmEnd: number;
  /** When the screen is ready again: the film end plus the cleaning buffer. */
  readyAt: number;
}

export type ConflictKind = 'overlap' | 'buffer';

/** Two shows on one screen whose time on the screen (film plus cleaning buffer) overlaps. */
export interface SlotConflict {
  /** The earlier show. */
  first: string;
  /** The later show. */
  second: string;
  screenId: string;
  /** 'overlap' when the films themselves overlap; 'buffer' when only the cleaning buffer is cut short. */
  kind: ConflictKind;
}

/**
 * Finds every pair of shows on the same screen where the later one starts before the earlier one's
 * screen is ready. Pass only shows that occupy the screen (cancelled shows do not).
 */
export function findConflicts(slots: readonly ScheduleSlot[]): SlotConflict[] {
  const byScreen = new Map<string, ScheduleSlot[]>();
  for (const s of slots) {
    const list = byScreen.get(s.screenId);
    if (list) list.push(s); else byScreen.set(s.screenId, [s]);
  }
  const out: SlotConflict[] = [];
  for (const [screenId, list] of byScreen) {
    list.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
    for (let i = 0; i < list.length; i++) {
      const a = list[i]!;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j]!;
        // Sorted by start, so once one show starts after the screen is ready, all later ones do.
        if (b.start >= a.readyAt) break;
        out.push({ first: a.id, second: b.id, screenId, kind: b.start < a.filmEnd ? 'overlap' : 'buffer' });
      }
    }
  }
  return out;
}

/**
 * Places intervals in the fewest rows so none in a row overlap (greedy by start time).
 * Returns the row of each item, in input order, and the number of rows used (at least 1).
 */
export function packRows(items: readonly { start: number; end: number }[]): { rows: number[]; count: number } {
  const order = items.map((_, i) => i).sort((a, b) => items[a]!.start - items[b]!.start);
  const rowEnds: number[] = [];
  const rows = new Array<number>(items.length).fill(0);
  for (const i of order) {
    const it = items[i]!;
    let row = rowEnds.findIndex((end) => end <= it.start);
    if (row === -1) { row = rowEnds.length; rowEnds.push(it.end); } else rowEnds[row] = it.end;
    rows[i] = row;
  }
  return { rows, count: Math.max(1, rowEnds.length) };
}

/** Midnight on the Monday of the week containing d (weeks run Monday to Sunday). */
export function startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

/** The same day of the month n months away, clamped to the month's last day. */
export function addMonths(d: Date, n: number): Date {
  const x = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate();
  x.setDate(Math.min(d.getDate(), last));
  return x;
}

/** The days shown on a month grid: from the Monday on or before the 1st to the Sunday on or after the last day. */
export function monthGridDays(d: Date): Date[] {
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  const start = startOfWeek(first);
  const days: Date[] = [];
  for (let x = start; x <= last || days.length % 7 !== 0; x = new Date(x.getFullYear(), x.getMonth(), x.getDate() + 1)) days.push(x);
  return days;
}
