/**
 * The seat designer's working copy: the layout being edited, undo and redo history, and the
 * pure edits the designer applies. Every edit returns a new layout (unchanged edits return the
 * same object), so history is a list of snapshots and "unsaved" is a reference comparison.
 */
import { computed, signal } from '@angular/core';

import { buildLayout, CATEGORY_COLORS, PHYSICAL, resizeLayout, rowLabel } from '../../core/layout';
import { CellKind, SeatCategory, SeatCell, SeatLayout } from '../../core/models';

export type Tool = 'select' | 'pan' | CellKind;

const HISTORY_LIMIT = 100;

export class LayoutEditor {
  readonly layout = signal<SeatLayout>(starterLayout(''));
  private readonly undoStack = signal<SeatLayout[]>([]);
  private readonly redoStack = signal<SeatLayout[]>([]);
  /** The layout as last loaded or saved; anything else is unsaved. */
  private readonly saved = signal<SeatLayout | null>(null);
  private strokeStart: SeatLayout | null = null;

  readonly canUndo = computed(() => this.undoStack().length > 0);
  readonly canRedo = computed(() => this.redoStack().length > 0);
  readonly dirty = computed(() => this.layout() !== this.saved());

  /** Starts over from a layout, with empty history. */
  reset(layout: SeatLayout): void {
    this.layout.set(layout);
    this.saved.set(layout);
    this.undoStack.set([]);
    this.redoStack.set([]);
    this.strokeStart = null;
  }

  markSaved(): void { this.saved.set(this.layout()); }

  /** Applies one edit as one undo step. */
  commit(next: SeatLayout): void {
    const current = this.layout();
    if (next === current) return;
    this.push(current);
    this.layout.set(next);
  }

  /** A drag paints many cells; the whole drag is one undo step. */
  beginStroke(): void { this.strokeStart = this.layout(); }
  strokeTo(next: SeatLayout): void { this.layout.set(next); }
  endStroke(): void {
    const start = this.strokeStart;
    this.strokeStart = null;
    if (start && start !== this.layout()) this.push(start);
  }

  undo(): void {
    const stack = this.undoStack();
    if (!stack.length) return;
    this.redoStack.update((r) => [...r, this.layout()]);
    this.layout.set(stack[stack.length - 1]!);
    this.undoStack.set(stack.slice(0, -1));
  }

  redo(): void {
    const stack = this.redoStack();
    if (!stack.length) return;
    this.undoStack.update((u) => [...u, this.layout()]);
    this.layout.set(stack[stack.length - 1]!);
    this.redoStack.set(stack.slice(0, -1));
  }

  private push(snapshot: SeatLayout): void {
    this.undoStack.update((u) => [...u.slice(-(HISTORY_LIMIT - 1)), snapshot]);
    this.redoStack.set([]);
  }
}

// ---------------------------------------------------------------- Pure edits

export function key(r: number, c: number): string { return `${r},${c}`; }
export function parseKey(k: string): [number, number] {
  const [r, c] = k.split(',').map(Number);
  return [r!, c!];
}

function sameCell(a: SeatCell, b: SeatCell): boolean {
  return a.kind === b.kind && (a.categoryId ?? '') === (b.categoryId ?? '');
}

/** Replaces cells by key; returns the same layout when nothing changed. */
export function updateCells(layout: SeatLayout, keys: Iterable<string>, fn: (cell: SeatCell, r: number, c: number) => SeatCell): SeatLayout {
  let rows: SeatCell[][] | null = null;
  const copied = new Set<number>();
  for (const k of keys) {
    const [r, c] = parseKey(k);
    const cell = layout.cells[r]?.[c];
    if (!cell) continue;
    const next = fn(cell, r, c);
    if (sameCell(cell, next)) continue;
    rows ??= [...layout.cells];
    if (!copied.has(r)) { rows[r] = [...rows[r]!]; copied.add(r); }
    rows[r]![c] = next;
  }
  return rows ? { ...layout, cells: rows } : layout;
}

/** What a cell becomes when given a kind; seats take the category, blocked seats keep theirs. */
export function withKind(cell: SeatCell, kind: CellKind, categoryId: string | undefined): SeatCell {
  if (kind === 'aisle' || kind === 'empty') return { kind };
  if (kind === 'blocked') {
    const cat = cell.categoryId ?? categoryId;
    return cat ? { kind, categoryId: cat } : { kind };
  }
  return categoryId ? { kind, categoryId } : { kind };
}

/**
 * Paints one cell with a tool. A couple seat always takes a partner: the cell to its right, or
 * the one to its left when the right one is already part of a pair or off the grid.
 */
export function paint(layout: SeatLayout, r: number, c: number, kind: CellKind, categoryId: string | undefined): SeatLayout {
  if (kind !== 'couple') return updateCells(layout, [key(r, c)], (cell) => withKind(cell, kind, categoryId));
  const row = layout.cells[r];
  if (!row) return layout;
  if (row[c]?.kind === 'couple' && row[c]?.categoryId === categoryId) return layout;
  const rightFree = c + 1 < row.length && row[c + 1]!.kind !== 'couple';
  const partner = rightFree ? c + 1 : c - 1 >= 0 ? c - 1 : null;
  const keys = partner == null ? [key(r, c)] : [key(r, c), key(r, partner)];
  return updateCells(layout, keys, (cell) => withKind(cell, 'couple', categoryId));
}

/** Sets the category of every physical cell among the keys. */
export function setCategory(layout: SeatLayout, keys: Iterable<string>, categoryId: string): SeatLayout {
  return updateCells(layout, keys, (cell) => (PHYSICAL.has(cell.kind) ? { kind: cell.kind, categoryId } : cell));
}

export function rowKeys(layout: SeatLayout, r: number): string[] {
  return Array.from({ length: layout.cols }, (_, c) => key(r, c));
}

export function clearLayout(layout: SeatLayout): SeatLayout {
  return { ...layout, cells: layout.cells.map((row) => row.map(() => ({ kind: 'empty' as CellKind }))) };
}

/** Physical seats that fall outside a smaller grid. */
export function seatsLostByResize(layout: SeatLayout, rows: number, cols: number): number {
  let n = 0;
  layout.cells.forEach((row, r) => row.forEach((cell, c) => { if ((r >= rows || c >= cols) && PHYSICAL.has(cell.kind)) n++; }));
  return n;
}

export function resize(layout: SeatLayout, rows: number, cols: number): SeatLayout {
  if (rows === layout.rows && cols === layout.cols) return layout;
  return resizeLayout(layout, rows, cols);
}

/** Letters every row front to back, optionally skipping I and O (easily misread as 1 and 0). */
export function reletterRows(layout: SeatLayout, skipIO: boolean): SeatLayout {
  const labels: string[] = [];
  for (let i = 0; labels.length < layout.rows; i++) {
    const l = rowLabel(i);
    if (skipIO && (l.includes('I') || l.includes('O'))) continue;
    labels.push(l);
  }
  return labels.every((l, i) => l === layout.rowLabels[i]) ? layout : { ...layout, rowLabels: labels };
}

export function setRowLabel(layout: SeatLayout, r: number, label: string): SeatLayout {
  const clean = label.trim().toUpperCase().slice(0, 3);
  if (layout.rowLabels[r] === clean) return layout;
  const rowLabels = [...layout.rowLabels];
  rowLabels[r] = clean;
  return { ...layout, rowLabels };
}

// ---------------------------------------------------------------- Categories

export const CATEGORY_PRESETS: { name: string; price: number; rule?: string }[] = [
  { name: 'Regular', price: 180 },
  { name: 'Premium', price: 250 },
  { name: 'Recliner', price: 480, rule: 'Includes F&B voucher' },
  { name: 'Sofa', price: 600 },
  { name: 'Couple Seat', price: 460 },
  { name: 'VIP', price: 420 },
];

export function newCategory(layout: SeatLayout, name: string, price: number, rule?: string): SeatCategory {
  const used = new Set(layout.categories.map((c) => c.color));
  const color = CATEGORY_COLORS.find((c) => !used.has(c)) ?? CATEGORY_COLORS[layout.categories.length % CATEGORY_COLORS.length]!;
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'category';
  return { id: `cat-${slug}-${Date.now().toString(36)}`, name, color, basePrice: price, ...(rule ? { rule } : {}) };
}

export function addCategory(layout: SeatLayout, category: SeatCategory): SeatLayout {
  return { ...layout, categories: [...layout.categories, category] };
}

export function updateCategory(layout: SeatLayout, id: string, patch: Partial<Omit<SeatCategory, 'id'>>): SeatLayout {
  const before = layout.categories.find((c) => c.id === id);
  if (!before) return layout;
  const after = { ...before, ...patch };
  if (!after.rule) delete after.rule;
  if (JSON.stringify(after) === JSON.stringify(before)) return layout;
  return { ...layout, categories: layout.categories.map((c) => (c.id === id ? after : c)) };
}

/** Removes a category; its seats move to `moveTo`, or are left without a category. */
export function removeCategory(layout: SeatLayout, id: string, moveTo: string | null): SeatLayout {
  const cells = layout.cells.map((row) => row.map((cell) => {
    if (cell.categoryId !== id) return cell;
    return moveTo ? { kind: cell.kind, categoryId: moveTo } : { kind: cell.kind };
  }));
  return { ...layout, cells, categories: layout.categories.filter((c) => c.id !== id) };
}

/** A starting point for a screen with no layout: 10 rows of 16, two categories, two aisles. */
export function starterLayout(by: string): SeatLayout {
  const layout = buildLayout(16, [
    { rows: 4, category: { id: 'cat-regular', name: 'Regular', color: CATEGORY_COLORS[0]!, basePrice: 180 } },
    { rows: 6, category: { id: 'cat-premium', name: 'Premium', color: CATEGORY_COLORS[1]!, basePrice: 250 } },
  ], [3, 12], by, new Date());
  return { ...layout, version: 0 };
}
