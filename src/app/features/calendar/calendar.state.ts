import { Injectable, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';

import { AdminStore } from '../../core/admin-store';
import { addDays, formatDate, formatDuration, formatTime, sameDay, startOfDay, toDateInput, toTimeInput } from '../../core/format';
import { Movie, Screen, Show, Theatre } from '../../core/models';
import { ConflictKind, ScheduleSlot, addMonths, findConflicts, monthGridDays, startOfWeek } from './calendar.utils';

export type CalView = 'day' | 'week' | 'month';
export type CalGroup = 'screen' | 'theatre';
/** How a show is drawn on the calendar. */
export type CalKind = 'published' | 'draft' | 'completed' | 'cancelled';
export const CAL_KINDS: readonly CalKind[] = ['published', 'draft', 'completed', 'cancelled'];
export const KIND_LABELS: Record<CalKind, string> = { published: 'Published', draft: 'Draft', completed: 'Completed', cancelled: 'Cancelled' };

export interface CalConflict { other: Show; kind: ConflictKind; }

export interface CalShow {
  show: Show;
  movie: Movie | undefined;
  title: string;
  screen: Screen;
  kind: CalKind;
  running: boolean;
  start: Date;
  end: Date;
  ready: Date;
  dayKey: string;
  conflicts: CalConflict[];
  /** A one-line description for tooltips and screen readers. */
  summary: string;
}

export interface ScreenLane {
  screen: Screen;
  theatre: Theatre;
  /** Active screen with a published layout, so shows can be created on it. */
  schedulable: boolean;
  /** Why the lane is greyed out, if it is. */
  note: string;
}

export interface LaneGroup { theatre: Theatre; lanes: ScreenLane[]; }

export interface ConflictPair { kind: ConflictKind; first: CalShow; second: CalShow; }

/**
 * The state of the calendar page, shared by its views. View, grouping and filters live in the URL
 * (?view=week&group=theatre&status=draft,published&film=m-x&screen=s-x); the date is the store's
 * operational date, so the header date control and the calendar move together.
 */
@Injectable()
export class CalendarState {
  readonly store = inject(AdminStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly params = toSignal(this.route.queryParamMap, { requireSync: true });

  readonly view = computed<CalView>(() => {
    const v = this.params().get('view');
    return v === 'week' || v === 'month' ? v : 'day';
  });
  readonly group = computed<CalGroup>(() => (this.multiTheatre() && this.params().get('group') === 'theatre' ? 'theatre' : 'screen'));
  readonly kinds = computed<ReadonlySet<CalKind>>(() => {
    const raw = (this.params().get('status') ?? '').split(',').filter((k): k is CalKind => (CAL_KINDS as readonly string[]).includes(k));
    return new Set(raw.length ? raw : CAL_KINDS);
  });
  readonly filmId = computed(() => this.params().get('film') ?? '');
  readonly screenId = computed(() => this.params().get('screen') ?? '');
  /** Pixels per hour on the day grid. */
  readonly hourWidth = signal(112);

  readonly date = this.store.operationalDate;
  readonly todayKey = computed(() => toDateInput(this.store.now()));

  /** The days the current view covers (the month view covers whole weeks). */
  readonly days = computed<Date[]>(() => {
    const d = this.date();
    if (this.view() === 'day') return [startOfDay(d)];
    if (this.view() === 'week') { const s = startOfWeek(d); return Array.from({ length: 7 }, (_, i) => addDays(s, i)); }
    return monthGridDays(d);
  });
  readonly rangeStart = computed(() => this.days()[0]!);
  readonly rangeEnd = computed(() => addDays(this.days()[this.days().length - 1]!, 1));

  readonly periodLabel = computed(() => {
    const days = this.days();
    const d = this.date();
    if (this.view() === 'day') return d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    if (this.view() === 'month') return d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    const a = days[0]!, b = days[6]!;
    return a.getMonth() === b.getMonth() ? `${a.getDate()} – ${formatDate(b)}` : `${formatDate(a).replace(/ \d{4}$/, '')} – ${formatDate(b)}`;
  });

  // ------------------------------------------------------------ Lanes

  /** Theatres in scope that are inactive; their screens get no lanes. */
  readonly hiddenTheatres = computed(() => this.store.scopedTheatres().filter((t) => t.status !== 'active'));

  /** Every lane the scope allows, before the screen filter. Screens without a published layout are left out. */
  readonly allLanes = computed<ScreenLane[]>(() => {
    const order = new Map(this.store.theatres().map((t, i) => [t.id, i]));
    return this.store.scopedScreens()
      .map((screen) => ({ screen, theatre: this.store.theatre(screen.theatreId)! }))
      .filter((x) => x.theatre?.status === 'active' && !!x.screen.layout)
      .sort((a, b) => order.get(a.theatre.id)! - order.get(b.theatre.id)! || a.screen.number - b.screen.number)
      .map(({ screen, theatre }) => ({
        screen, theatre,
        schedulable: this.store.isSchedulable(screen),
        note: screen.status !== 'active' ? 'Inactive' : !screen.layout ? 'No layout' : '',
      }));
  });

  readonly lanes = computed(() => {
    const id = this.screenId();
    const all = this.allLanes();
    return id && all.some((l) => l.screen.id === id) ? all.filter((l) => l.screen.id === id) : all;
  });

  readonly groups = computed<LaneGroup[]>(() => {
    const out: LaneGroup[] = [];
    for (const lane of this.lanes()) {
      const last = out[out.length - 1];
      if (last && last.theatre.id === lane.theatre.id) last.lanes.push(lane); else out.push({ theatre: lane.theatre, lanes: [lane] });
    }
    return out;
  });

  /** True when lanes from more than one theatre are on screen, so lanes name their theatre. */
  readonly multiTheatre = computed(() => this.groups().length > 1);

  // ------------------------------------------------------------ Shows and conflicts

  /** Shows on visible screens in the period, with a day either side so cross-midnight clashes are caught. */
  private readonly nearShows = computed(() => {
    const ids = new Set(this.lanes().map((l) => l.screen.id));
    const from = addDays(this.rangeStart(), -1).getTime();
    const to = addDays(this.rangeEnd(), 1).getTime();
    return this.store.scopedShows().filter((s) => ids.has(s.screenId) && s.start.getTime() >= from && s.start.getTime() < to);
  });

  /** Conflicts between shows that occupy a screen. Cancelled shows do not; drafts do. */
  private readonly conflictsByShow = computed(() => {
    const slots: ScheduleSlot[] = this.nearShows().filter((s) => !s.cancellation).map((s) => ({
      id: s.id, screenId: s.screenId, start: s.start.getTime(), filmEnd: this.store.showEnd(s).getTime(), readyAt: this.store.turnaroundEnd(s).getTime(),
    }));
    const map = new Map<string, CalConflict[]>();
    const add = (id: string, c: CalConflict) => { const l = map.get(id); if (l) l.push(c); else map.set(id, [c]); };
    for (const c of findConflicts(slots)) {
      const a = this.store.show(c.first), b = this.store.show(c.second);
      if (!a || !b) continue;
      add(a.id, { other: b, kind: c.kind });
      add(b.id, { other: a, kind: c.kind });
    }
    return map;
  });

  /** Every show in the period, before the status and film filters. */
  readonly periodShows = computed<CalShow[]>(() => {
    const from = this.rangeStart().getTime(), to = this.rangeEnd().getTime();
    const conflicts = this.conflictsByShow();
    return this.nearShows()
      .filter((s) => s.start.getTime() >= from && s.start.getTime() < to)
      .sort((a, b) => a.start.getTime() - b.start.getTime())
      .map((s) => this.toCalShow(s, conflicts.get(s.id) ?? []));
  });

  /** The shows drawn on the calendar. */
  readonly visible = computed(() => {
    const kinds = this.kinds(), film = this.filmId();
    return this.periodShows().filter((c) => kinds.has(c.kind) && (!film || c.show.movieId === film));
  });

  /** Visible shows by `screenId|yyyy-mm-dd`. */
  readonly byScreenDay = computed(() => {
    const map = new Map<string, CalShow[]>();
    for (const c of this.visible()) {
      const key = `${c.show.screenId}|${c.dayKey}`;
      const l = map.get(key);
      if (l) l.push(c); else map.set(key, [c]);
    }
    return map;
  });

  /** Visible shows by yyyy-mm-dd. */
  readonly byDay = computed(() => {
    const map = new Map<string, CalShow[]>();
    for (const c of this.visible()) {
      const l = map.get(c.dayKey);
      if (l) l.push(c); else map.set(c.dayKey, [c]);
    }
    return map;
  });

  readonly kindCounts = computed(() => {
    const film = this.filmId();
    const counts: Record<CalKind, number> = { published: 0, draft: 0, completed: 0, cancelled: 0 };
    for (const c of this.periodShows()) if (!film || c.show.movieId === film) counts[c.kind]++;
    return counts;
  });

  /** Conflicting pairs with at least one show in the period, earliest first. */
  readonly conflictPairs = computed<ConflictPair[]>(() => {
    const inPeriod = new Map(this.periodShows().map((c) => [c.show.id, c]));
    const conflicts = this.conflictsByShow();
    const seen = new Set<string>();
    const out: ConflictPair[] = [];
    for (const c of this.periodShows()) {
      for (const x of c.conflicts) {
        const [a, b] = c.show.start <= x.other.start ? [c.show, x.other] : [x.other, c.show];
        const key = `${a.id}|${b.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const first = inPeriod.get(a.id) ?? this.toCalShow(a, conflicts.get(a.id) ?? []);
        const second = inPeriod.get(b.id) ?? this.toCalShow(b, conflicts.get(b.id) ?? []);
        out.push({ kind: x.kind, first, second });
      }
    }
    return out.sort((p, q) => p.second.start.getTime() - q.second.start.getTime());
  });

  readonly films = computed(() => {
    const ids = new Set(this.store.scopedShows().map((s) => s.movieId));
    return this.store.movies().filter((m) => ids.has(m.id)).sort((a, b) => a.title.localeCompare(b.title));
  });

  readonly filtered = computed(() => this.kinds().size < CAL_KINDS.length || !!this.filmId() || !!this.screenId());

  private toCalShow(s: Show, conflicts: CalConflict[]): CalShow {
    const store = this.store;
    const movie = store.movie(s.movieId);
    const status = store.showStatus(s);
    const kind: CalKind = s.cancellation ? 'cancelled' : s.publication === 'draft' ? 'draft' : status === 'completed' ? 'completed' : 'published';
    const end = store.showEnd(s);
    const screen = store.screen(s.screenId)!;
    const title = movie?.title ?? 'Film';
    const clash = conflicts.map((c) => `${c.kind === 'overlap' ? 'Overlaps' : `Inside the ${store.settings().bufferMinutes}-minute cleaning buffer of`} ${store.movie(c.other.movieId)?.title ?? 'a show'} at ${formatTime(c.other.start)}`);
    const summary = [
      `${title} · ${screen?.name ?? ''}`,
      `${formatTime(s.start)} – ${formatTime(end)} (${formatDuration((movie?.runtime ?? 0) + s.intermission)})`,
      `${s.format} · ${s.language} · ${s.cancellation ? 'Cancelled' : s.publication === 'draft' ? 'Draft, not on sale' : status === 'running' ? 'Running now' : status === 'completed' ? 'Completed' : 'Published'}`,
      ...clash,
    ].join('\n');
    return {
      show: s, movie, title, screen, kind, running: kind === 'published' && status === 'running',
      start: s.start, end, ready: store.turnaroundEnd(s), dayKey: toDateInput(s.start), conflicts, summary,
    };
  }

  // ------------------------------------------------------------ Actions

  setParams(patch: Record<string, string | null>): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: patch, queryParamsHandling: 'merge', replaceUrl: true });
  }

  setView(view: CalView): void { this.setParams({ view: view === 'day' ? null : view }); }
  setGroup(group: CalGroup): void { this.setParams({ group: group === 'screen' ? null : group }); }

  toggleKind(kind: CalKind): void {
    const next = new Set(this.kinds());
    if (next.has(kind)) next.delete(kind); else next.add(kind);
    if (!next.size) return;
    this.setParams({ status: next.size === CAL_KINDS.length ? null : CAL_KINDS.filter((k) => next.has(k)).join(',') });
  }

  clearFilters(): void { this.setParams({ status: null, film: null, screen: null }); }

  shift(dir: -1 | 1): void {
    const d = this.date();
    const v = this.view();
    this.date.set(v === 'day' ? addDays(d, dir) : v === 'week' ? addDays(d, 7 * dir) : addMonths(d, dir));
  }

  goToday(): void { this.date.set(startOfDay(this.store.now())); }

  isToday(d: Date): boolean { return sameDay(d, this.store.now()); }

  /** Opens one day in the day view. */
  openDay(d: Date): void {
    this.date.set(startOfDay(d));
    this.setView('day');
  }

  createLink(screenId: string, at: Date): { screen: string; date: string; time: string } {
    return { screen: screenId, date: toDateInput(at), time: toTimeInput(at) };
  }
}
