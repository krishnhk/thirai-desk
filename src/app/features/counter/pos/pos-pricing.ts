/**
 * Pure helpers for the box office: GST on GST-inclusive ticket prices, the seat grid the chart
 * draws, and the "best available" picker. No state here, so the rules are easy to test.
 */
import { couplePartner, findSeat, SELLABLE, seatNumbers } from '../../../core/layout';
import { CellKind, SeatCategory, SeatLayout } from '../../../core/models';

/** Indian GST on cinema tickets: 12% up to ₹100, 18% above. */
export function gstRate(price: number): number {
  return price <= 100 ? 0.12 : 0.18;
}

/** The GST portion of a GST-inclusive price. */
export function gstPortion(price: number): number {
  const rate = gstRate(price);
  return price - price / (1 + rate);
}

export interface SeatLine {
  seat: string;
  categoryId: string;
  category: string;
  color: string;
  price: number;
}

/** Sale lines grouped by category, for the summary: "Premium × 3 @ ₹250". */
export interface CategoryLine {
  categoryId: string;
  category: string;
  color: string;
  price: number;
  seats: string[];
  subtotal: number;
}

export interface Breakdown {
  quantity: number;
  total: number;
  /** Total GST by rate (keys 0.12 / 0.18). */
  gst: { rate: number; amount: number }[];
  base: number;
}

export function breakdown(lines: SeatLine[]): Breakdown {
  const byRate = new Map<number, number>();
  let total = 0;
  for (const l of lines) {
    total += l.price;
    const r = gstRate(l.price);
    byRate.set(r, (byRate.get(r) ?? 0) + gstPortion(l.price));
  }
  const gst = [...byRate.entries()].sort((a, b) => a[0] - b[0]).map(([rate, amount]) => ({ rate, amount: Math.round(amount * 100) / 100 }));
  const gstTotal = gst.reduce((n, g) => n + g.amount, 0);
  return { quantity: lines.length, total, gst, base: Math.round((total - gstTotal) * 100) / 100 };
}

export function groupLines(lines: SeatLine[]): CategoryLine[] {
  const map = new Map<string, CategoryLine>();
  for (const l of lines) {
    const key = `${l.categoryId}|${l.price}`;
    const g = map.get(key);
    if (g) { g.seats.push(l.seat); g.subtotal += l.price; } else map.set(key, { categoryId: l.categoryId, category: l.category, color: l.color, price: l.price, seats: [l.seat], subtotal: l.price });
  }
  return [...map.values()];
}

/** What the chart draws for one grid cell. */
export interface ChartCell {
  key: string;
  kind: CellKind;
  /** Seat id such as "F7"; empty for aisles and gaps. */
  id: string;
  num: number | null;
  categoryId: string;
  color: string;
  side: 'l' | 'r' | null;
}

export interface ChartRow {
  index: number;
  label: string;
  cells: ChartCell[];
}

/** Couple cells pair up left to right within each run (the rule validateLayout uses). */
function coupleSides(kinds: CellKind[]): ('l' | 'r' | null)[] {
  const out: ('l' | 'r' | null)[] = kinds.map(() => null);
  let c = 0;
  while (c < kinds.length) {
    if (kinds[c] !== 'couple') { c++; continue; }
    const start = c;
    while (c < kinds.length && kinds[c] === 'couple') c++;
    for (let i = start; i + 1 < c; i += 2) { out[i] = 'l'; out[i + 1] = 'r'; }
  }
  return out;
}

export function chartRows(layout: SeatLayout): ChartRow[] {
  const colors = new Map(layout.categories.map((c) => [c.id, c.color]));
  return layout.cells.map((row, r) => {
    const nums = seatNumbers(layout, r);
    const label = layout.rowLabels[r] ?? '';
    const sides = coupleSides(row.map((c) => c.kind));
    return {
      index: r,
      label,
      cells: row.map((cell, c) => ({
        key: `${r},${c}`,
        kind: cell.kind,
        id: nums[c] != null ? `${label}${nums[c]}` : '',
        num: nums[c] ?? null,
        categoryId: cell.categoryId ?? '',
        color: (cell.categoryId && colors.get(cell.categoryId)) || '#7c8aa0',
        side: sides[c] ?? null,
      })),
    };
  });
}

/**
 * Picks `count` seats side by side in one row, as near the middle of the category (and of the
 * row) as possible. Couple seats are only picked as whole pairs. Returns null when no row has
 * that many free seats together.
 */
export function bestSeats(layout: SeatLayout, category: SeatCategory, count: number, taken: ReadonlySet<string>): string[] | null {
  if (count < 1) return null;
  const rows: number[] = [];
  layout.cells.forEach((row, r) => { if (row.some((c) => c.categoryId === category.id && SELLABLE.has(c.kind))) rows.push(r); });
  if (!rows.length) return null;
  const idealRow = rows[Math.floor((rows.length - 1) * 0.6)]!;
  const midCol = (layout.cols - 1) / 2;
  let best: { seats: string[]; score: number } | null = null;
  for (const r of rows) {
    const nums = seatNumbers(layout, r);
    const label = layout.rowLabels[r] ?? '';
    const row = layout.cells[r]!;
    // Runs of free seats of this category, broken by aisles, gaps, other categories and sold seats.
    let run: { col: number; id: string }[] = [];
    const runs: { col: number; id: string }[][] = [];
    row.forEach((cell, c) => {
      const id = nums[c] != null ? `${label}${nums[c]}` : '';
      const ok = !!id && cell.categoryId === category.id && SELLABLE.has(cell.kind) && !taken.has(id);
      if (ok) run.push({ col: c, id }); else { if (run.length) runs.push(run); run = []; }
    });
    if (run.length) runs.push(run);
    for (const seats of runs) {
      for (let i = 0; i + count <= seats.length; i++) {
        const pick = seats.slice(i, i + count);
        const ids = pick.map((p) => p.id);
        // A window may not split a couple pair.
        if (ids.some((id) => { const p = couplePartner(layout, id); return p != null && !ids.includes(p); })) continue;
        const centre = (pick[0]!.col + pick[pick.length - 1]!.col) / 2;
        const score = Math.abs(centre - midCol) + Math.abs(r - idealRow) * 1.6;
        if (!best || score < best.score) best = { seats: ids, score };
      }
    }
  }
  return best?.seats ?? null;
}

/** Normalises typed seat input ("f 7" → "F7"); returns null when it does not look like a seat id. */
export function parseSeatId(text: string, layout: SeatLayout): string | null {
  const id = text.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]+\d+$/.test(id)) return null;
  return findSeat(layout, id) ? id : null;
}
