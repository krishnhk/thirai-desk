import { Signal, computed, signal } from '@angular/core';

export type SortDir = 'asc' | 'desc';

/**
 * Sorting and paging for a table, as signals:
 *
 *   readonly table = tableState(this.filtered, { name: (s) => s.name, start: (s) => s.start }, 'start');
 *   // template: table.rows(), table.sortBy('name'), table.isSorted('name'), table.dir(), <app-paginator [(page)]="table.page" ...>
 */
export function tableState<T>(source: Signal<T[]>, keys: Record<string, (row: T) => string | number | Date | null | undefined>, initialKey: string, initialDir: SortDir = 'asc', pageSize = 10) {
  const key = signal(initialKey);
  const dir = signal<SortDir>(initialDir);
  const page = signal(1);
  const size = signal(pageSize);

  const sorted = computed(() => {
    const get = keys[key()];
    const list = [...source()];
    if (!get) return list;
    const sign = dir() === 'asc' ? 1 : -1;
    return list.sort((a, b) => {
      const x = get(a);
      const y = get(b);
      const vx = x instanceof Date ? x.getTime() : x ?? '';
      const vy = y instanceof Date ? y.getTime() : y ?? '';
      if (typeof vx === 'number' && typeof vy === 'number') return (vx - vy) * sign;
      return String(vx).localeCompare(String(vy), 'en', { numeric: true }) * sign;
    });
  });

  const pages = computed(() => Math.max(1, Math.ceil(sorted().length / size())));
  const rows = computed(() => {
    const p = Math.min(page(), pages());
    return sorted().slice((p - 1) * size(), p * size());
  });

  return {
    key, dir, page, size, sorted, rows, pages,
    total: computed(() => sorted().length),
    isSorted: (k: string) => key() === k,
    sortBy(k: string): void {
      if (key() === k) dir.set(dir() === 'asc' ? 'desc' : 'asc');
      else { key.set(k); dir.set('asc'); }
      page.set(1);
    },
    /** Call when filters change so the user is not left on an empty page. */
    reset(): void { page.set(1); },
  };
}

/** Selection of rows by id, for bulk actions. */
export function selectionState() {
  const ids = signal<ReadonlySet<string>>(new Set());
  return {
    ids,
    count: computed(() => ids().size),
    has: (id: string) => ids().has(id),
    toggle(id: string, on?: boolean): void {
      ids.update((set) => {
        const next = new Set(set);
        if (on ?? !next.has(id)) next.add(id); else next.delete(id);
        return next;
      });
    },
    setAll(list: string[], on: boolean): void {
      ids.update((set) => {
        const next = new Set(set);
        list.forEach((id) => (on ? next.add(id) : next.delete(id)));
        return next;
      });
    },
    allOf: (list: string[]) => list.length > 0 && list.every((id) => ids().has(id)),
    clear(): void { ids.set(new Set()); },
  };
}
