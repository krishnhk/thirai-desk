/**
 * Seat layout rules: labels, counts, building and validating a layout. Pure functions, so the
 * designer, the screen pages and the store all agree on what a seat is.
 */
import { CellKind, Issue, SeatCategory, SeatCell, SeatLayout } from './models';

/** Kinds that customers can book (blocked seats exist but are not sold). */
export const SELLABLE: ReadonlySet<CellKind> = new Set(['seat', 'couple', 'wheelchair']);
/** Kinds that are physical seats, sold or not. */
export const PHYSICAL: ReadonlySet<CellKind> = new Set(['seat', 'couple', 'wheelchair', 'blocked']);

export const CATEGORY_COLORS = ['#7c8aa0', '#e5a93d', '#a68bfa', '#43c07f', '#f0605a', '#5fa2f7', '#f08a3c', '#d36bc6'];

/** "A", "B", … "Z", "AA", "AB" … */
export function rowLabel(index: number): string {
  let n = index;
  let s = '';
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/**
 * The seat number of every seat in a row, by column; aisles and empty cells get no number.
 * Couple seats count as one number each (a pair is two seats).
 */
export function seatNumbers(layout: SeatLayout, row: number): (number | null)[] {
  const cells = layout.cells[row] ?? [];
  const order = cells.map((_, i) => i);
  if (layout.numbering === 'right-to-left') order.reverse();
  const out: (number | null)[] = cells.map(() => null);
  let n = 0;
  for (const c of order) if (PHYSICAL.has(cells[c]!.kind)) out[c] = ++n;
  return out;
}

/** "C7" for the cell, or null when it is not a seat. */
export function seatId(layout: SeatLayout, row: number, col: number): string | null {
  const num = seatNumbers(layout, row)[col];
  return num == null ? null : `${layout.rowLabels[row] ?? rowLabel(row)}${num}`;
}

/** The cell of a seat id such as "J7", or null when there is no such seat. */
export function findSeat(layout: SeatLayout, id: string): { row: number; col: number; cell: SeatCell } | null {
  for (let r = 0; r < layout.rows; r++) {
    const label = layout.rowLabels[r] ?? rowLabel(r);
    if (!id.startsWith(label)) continue;
    const num = Number(id.slice(label.length));
    if (!Number.isInteger(num)) continue;
    const nums = seatNumbers(layout, r);
    const col = nums.indexOf(num);
    if (col >= 0) return { row: r, col, cell: layout.cells[r]![col]! };
  }
  return null;
}

/** For a couple seat, the seat id of its partner (pairs run left to right in a row); otherwise null. */
export function couplePartner(layout: SeatLayout, id: string): string | null {
  const at = findSeat(layout, id);
  if (!at || at.cell.kind !== 'couple') return null;
  const row = layout.cells[at.row]!;
  let start = at.col;
  while (start > 0 && row[start - 1]!.kind === 'couple') start--;
  const partnerCol = (at.col - start) % 2 === 0 ? at.col + 1 : at.col - 1;
  return seatId(layout, at.row, partnerCol);
}

/** Every sellable seat id of a layout, row by row. */
export function sellableSeatIds(layout: SeatLayout): string[] {
  const ids: string[] = [];
  layout.cells.forEach((row, r) => {
    const nums = seatNumbers(layout, r);
    row.forEach((cell, c) => {
      if (SELLABLE.has(cell.kind) && nums[c] != null) ids.push(`${layout.rowLabels[r]}${nums[c]}`);
    });
  });
  return ids;
}

export interface LayoutStats {
  sellable: number;
  physical: number;
  blocked: number;
  wheelchair: number;
  couplePairs: number;
  aisles: number;
  byCategory: Record<string, number>;
}

export function layoutStats(layout: SeatLayout | null): LayoutStats {
  const s: LayoutStats = { sellable: 0, physical: 0, blocked: 0, wheelchair: 0, couplePairs: 0, aisles: 0, byCategory: {} };
  if (!layout) return s;
  let coupleCells = 0;
  for (const row of layout.cells) {
    for (const cell of row) {
      if (PHYSICAL.has(cell.kind)) s.physical++;
      if (SELLABLE.has(cell.kind)) {
        s.sellable++;
        if (cell.categoryId) s.byCategory[cell.categoryId] = (s.byCategory[cell.categoryId] ?? 0) + 1;
      }
      if (cell.kind === 'blocked') s.blocked++;
      if (cell.kind === 'wheelchair') s.wheelchair++;
      if (cell.kind === 'couple') coupleCells++;
      if (cell.kind === 'aisle') s.aisles++;
    }
  }
  s.couplePairs = Math.floor(coupleCells / 2);
  return s;
}

/** Couple cells pair up left to right within a row; returns "row,col" keys of cells left without a partner. */
export function loneCoupleCells(layout: SeatLayout): string[] {
  const lone: string[] = [];
  layout.cells.forEach((row, r) => {
    let c = 0;
    while (c < row.length) {
      if (row[c]!.kind !== 'couple') { c++; continue; }
      const start = c;
      while (c < row.length && row[c]!.kind === 'couple') c++;
      const run = c - start;
      if (run % 2 === 1) lone.push(`${r},${c - 1}`);
      // A pair must share one category.
      for (let i = start; i + 1 < c; i += 2) {
        if (row[i]!.categoryId !== row[i + 1]!.categoryId) lone.push(`${r},${i + 1}`);
      }
    }
  });
  return lone;
}

/** Everything that stops a layout from being published, plus warnings worth a look. */
export function validateLayout(layout: SeatLayout): Issue[] {
  const issues: Issue[] = [];
  if (layout.rows < 1 || layout.cols < 1) issues.push({ level: 'error', message: 'A layout needs at least one row and one column.' });
  if (layout.rows > 40 || layout.cols > 60) issues.push({ level: 'error', message: 'Layouts are limited to 40 rows and 60 columns.' });
  if (layout.cells.length !== layout.rows || layout.cells.some((r) => r.length !== layout.cols)) {
    issues.push({ level: 'error', message: 'The grid does not match the row and column count. Re-apply the size.' });
  }
  const labels = layout.rowLabels.map((l) => l.trim().toUpperCase());
  if (labels.some((l) => !l)) issues.push({ level: 'error', message: 'Every row needs a label.', where: 'rows' });
  const seen = new Set<string>();
  labels.forEach((l, i) => {
    if (l && seen.has(l)) issues.push({ level: 'error', message: `Row label ${l} is used more than once, so seat ids would repeat.`, where: `row:${i}` });
    seen.add(l);
  });
  const categoryIds = new Set(layout.categories.map((c) => c.id));
  if (!layout.categories.length) issues.push({ level: 'error', message: 'Add at least one seat category.' });
  layout.categories.forEach((c) => {
    if (!c.name.trim()) issues.push({ level: 'error', message: 'A seat category has no name.' });
    if (!(c.basePrice > 0)) issues.push({ level: 'error', message: `${c.name || 'A category'} needs a base price above zero.` });
  });
  let missing = 0;
  layout.cells.forEach((row, r) => row.forEach((cell, col) => {
    if (PHYSICAL.has(cell.kind) && (!cell.categoryId || !categoryIds.has(cell.categoryId))) {
      missing++;
      if (missing <= 5) issues.push({ level: 'error', message: `Seat ${seatId(layout, r, col) ?? `${r + 1}:${col + 1}`} has no category.`, where: `${r},${col}` });
    }
  }));
  if (missing > 5) issues.push({ level: 'error', message: `${missing - 5} more seats have no category.` });
  for (const key of loneCoupleCells(layout)) {
    const [r, c] = key.split(',').map(Number);
    issues.push({ level: 'error', message: `Couple seat ${seatId(layout, r!, c!)} has no partner of the same category beside it.`, where: key });
  }
  const stats = layoutStats(layout);
  if (stats.sellable === 0) issues.push({ level: 'error', message: 'The layout has no bookable seat.' });
  layout.categories.forEach((c) => {
    if (!stats.byCategory[c.id]) issues.push({ level: 'warning', message: `${c.name} has no seats; it will not be sold.` });
  });
  layout.cells.forEach((row, r) => {
    if (row.every((cell) => !PHYSICAL.has(cell.kind))) issues.push({ level: 'warning', message: `Row ${layout.rowLabels[r]} has no seats.`, where: `row:${r}` });
  });
  return issues;
}

export function emptyCells(rows: number, cols: number, kind: CellKind = 'empty', categoryId?: string): SeatCell[][] {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => (categoryId ? { kind, categoryId } : { kind })));
}

/** Resizes a grid, keeping what fits and filling new cells as empty. */
export function resizeLayout(layout: SeatLayout, rows: number, cols: number): SeatLayout {
  const cells = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => layout.cells[r]?.[c] ? { ...layout.cells[r]![c]! } : { kind: 'empty' as CellKind }),
  );
  const rowLabels = Array.from({ length: rows }, (_, r) => layout.rowLabels[r] ?? rowLabel(r));
  return { ...layout, rows, cols, cells, rowLabels };
}

export function copyLayout(layout: SeatLayout): SeatLayout {
  return {
    ...layout,
    rowLabels: [...layout.rowLabels],
    cells: layout.cells.map((row) => row.map((cell) => ({ ...cell }))),
    categories: layout.categories.map((c) => ({ ...c })),
    updatedAt: new Date(layout.updatedAt),
  };
}

export interface LayoutBand {
  /** Number of rows in this band, front to back. */
  rows: number;
  category: SeatCategory;
  kind?: CellKind;
}

/**
 * Builds a realistic auditorium: bands of rows per category, aisles at the given columns,
 * wheelchair bays at the ends of the first row of the last band.
 */
export function buildLayout(cols: number, bands: LayoutBand[], aisleCols: number[], by: string, at: Date): SeatLayout {
  const cells: SeatCell[][] = [];
  for (const band of bands) {
    for (let i = 0; i < band.rows; i++) {
      cells.push(Array.from({ length: cols }, (_, c) =>
        aisleCols.includes(c) ? { kind: 'aisle' as CellKind } : { kind: band.kind ?? 'seat', categoryId: band.category.id },
      ));
    }
  }
  // Couple rows must pair cleanly: drop a lone end seat between aisles to empty.
  cells.forEach((row) => {
    if (row.some((c) => c.kind === 'couple')) {
      let c = 0;
      while (c < row.length) {
        if (row[c]!.kind !== 'couple') { c++; continue; }
        const s = c;
        while (c < row.length && row[c]!.kind === 'couple') c++;
        if ((c - s) % 2 === 1) row[c - 1] = { kind: 'empty' };
      }
    }
  });
  const rows = cells.length;
  const categories = bands.map((b) => b.category).filter((c, i, all) => all.findIndex((x) => x.id === c.id) === i);
  return {
    rows,
    cols,
    rowLabels: Array.from({ length: rows }, (_, r) => rowLabel(r)),
    cells,
    categories,
    numbering: 'left-to-right',
    version: 1,
    updatedAt: at,
    updatedBy: by,
  };
}
