import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { AdminStore, ShowInput } from '../../core/admin-store';
import {
  MINUTE, addMinutes, formatDate, formatDay, formatDuration, formatMoney, formatNumber, formatTime, fromDateInput, sameDay, startOfDay,
  toDateInput, toTimeInput, withTime,
} from '../../core/format';
import { layoutStats } from '../../core/layout';
import { Issue, Movie, ProjectionFormat, Screen, Show } from '../../core/models';
import { ConfirmService, ToastService } from '../../shared/feedback';
import { IconComponent } from '../../shared/icon.component';
import { EmptyStateComponent, PageHeaderComponent, StatusBadgeComponent } from '../../shared/ui';
import { editMode, errorsOf, priceRange, warningsOf } from './show-utils';

const STEPS = [
  { n: 1, label: 'Film' },
  { n: 2, label: 'Screen and schedule' },
  { n: 3, label: 'Pricing' },
  { n: 4, label: 'Review' },
] as const;

/** Which wizard step an issue belongs to. */
function stepOf(issue: Issue): number {
  const w = issue.where ?? '';
  if (w === 'movie' || w === 'format' || w === 'language') return 1;
  if (w.startsWith('price:')) return 3;
  return 2;
}

/** Projection formats that need a matching screen. Everything else plays on any screen. */
function formatFits(format: ProjectionFormat, screen: Screen): boolean {
  if (format.startsWith('IMAX')) return screen.type === 'IMAX';
  if (format === '4DX') return screen.type === '4DX';
  if (format === '3D') return screen.type !== '2D';
  if (format === 'Dolby Atmos') return screen.type === 'Dolby Atmos' || screen.type === 'IMAX';
  return true;
}

/** The format a film should default to on a screen: the screen's own format when the film has it, else 2D. */
function preferredFormat(movie: Movie, screen: Screen | undefined): ProjectionFormat | '' {
  const native: Partial<Record<Screen['type'], ProjectionFormat>> = { IMAX: 'IMAX 2D', 'Dolby Atmos': 'Dolby Atmos', '3D': '3D', '4DX': '4DX' };
  const want = screen ? native[screen.type] : undefined;
  if (want && movie.formats.includes(want)) return want;
  return movie.formats.includes('2D') ? '2D' : (movie.formats[0] ?? '');
}

interface TimelineBlock {
  id: string;
  label: string;
  left: number;
  width: number;
  buffer: number;
  kind: 'published' | 'draft' | 'new';
  conflict: boolean;
}

/** Create or edit a show in four steps: film, screen and time, prices, review. */
@Component({
  selector: 'app-show-editor-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent, PageHeaderComponent, EmptyStateComponent, StatusBadgeComponent],
  templateUrl: './show-editor.page.html',
  styleUrl: './show-editor.page.css',
})
export class ShowEditorPage implements OnInit {
  protected readonly store = inject(AdminStore);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);

  /** Route parameter when editing. */
  readonly showId = input<string>();
  /** `?screen=<id>` preselects a screen. */
  readonly screen = input<string>();
  /** `?date=yyyy-mm-dd` preselects the day. */
  readonly date = input<string>();
  /** `?time=HH:mm` (24 h) preselects the start time, as the calendar links do. */
  readonly timeParam = input<string | undefined>(undefined, { alias: 'time' });

  protected readonly steps = STEPS;
  protected readonly step = signal(1);

  protected readonly movieId = signal('');
  protected readonly format = signal<ProjectionFormat | ''>('');
  protected readonly language = signal('');
  protected readonly theatreId = signal('');
  protected readonly screenId = signal('');
  protected readonly day = signal('');
  protected readonly time = signal('');
  protected readonly intermission = signal(0);
  protected readonly prices = signal<Record<string, number>>({});
  protected readonly movieQuery = signal('');
  protected readonly saving = signal(false);

  protected readonly existing = computed<Show | undefined>(() => {
    const id = this.showId();
    return id ? this.store.show(id) : undefined;
  });
  protected readonly notFound = computed(() => !!this.showId() && !this.existing());
  protected readonly access = computed(() => {
    const s = this.existing();
    return s ? editMode(this.store, s) : { mode: 'full' as const, reason: '' };
  });
  /** Film, screen and time cannot change (the show has bookings). */
  protected readonly structureLocked = computed(() => this.access().mode !== 'full');
  protected readonly isPublished = computed(() => this.existing()?.publication === 'published');

  ngOnInit(): void {
    const s = this.existing();
    if (s) {
      this.movieId.set(s.movieId);
      this.format.set(s.format);
      this.language.set(s.language);
      this.theatreId.set(s.theatreId);
      this.screenId.set(s.screenId);
      this.day.set(toDateInput(s.start));
      this.time.set(toTimeInput(s.start));
      this.intermission.set(s.intermission);
      this.prices.set({ ...s.prices });
      if (this.access().mode === 'prices') this.step.set(3);
      return;
    }
    this.intermission.set(this.store.settings().defaultIntermission);
    this.day.set(this.date() && /^\d{4}-\d{2}-\d{2}$/.test(this.date()!) ? this.date()! : toDateInput(this.store.operationalDate()));
    const t = this.timeParam();
    if (t && /^\d{1,2}:\d{2}$/.test(t)) this.time.set(t.padStart(5, '0'));
    const pre = this.screen() ? this.store.screen(this.screen()!) : undefined;
    if (pre && this.store.inScope(pre.theatreId)) {
      this.theatreId.set(pre.theatreId);
      if (this.store.isSchedulable(pre)) this.chooseScreen(pre.id);
    } else {
      const active = this.store.scopedTheatres().filter((t) => t.status === 'active');
      if (active.length === 1) this.theatreId.set(active[0]!.id);
    }
  }

  // ------------------------------------------------------------------ Step 1: film

  protected readonly movie = computed<Movie | undefined>(() => this.store.movie(this.movieId()));
  protected readonly movieList = computed(() => {
    const q = this.movieQuery().trim().toLowerCase();
    return this.store.movies()
      .filter((m) => !q || m.title.toLowerCase().includes(q) || m.languages.some((l) => l.toLowerCase().includes(q)) || m.genres.some((g) => g.toLowerCase().includes(q)))
      .sort((a, b) => b.releaseDate.getTime() - a.releaseDate.getTime());
  });

  protected chooseMovie(m: Movie): void {
    this.movieId.set(m.id);
    const scr = this.selectedScreen();
    if (!this.format() || !m.formats.includes(this.format() as ProjectionFormat)) {
      this.format.set(preferredFormat(m, scr));
    }
    if (!m.languages.includes(this.language())) this.language.set(m.languages[0] ?? '');
  }

  // ------------------------------------------------------------------ Step 2: screen and time

  protected readonly theatre = computed(() => this.store.theatre(this.theatreId()));
  protected readonly theatreOptions = computed(() => this.store.scopedTheatres());
  protected readonly selectedScreen = computed(() => this.store.screen(this.screenId()));
  protected readonly screenOptions = computed(() => {
    const day = this.day() ? fromDateInput(this.day()) : null;
    return this.store.screens()
      .filter((s) => s.theatreId === this.theatreId())
      .sort((a, b) => a.number - b.number)
      .map((s) => ({
        screen: s,
        ok: this.store.isSchedulable(s),
        reason: s.status !== 'active' ? 'Inactive: out of service' : !s.layout ? 'No published seat layout' : '',
        seats: this.store.capacity(s.id),
        showsThatDay: day ? this.store.shows().filter((x) => x.screenId === s.id && !x.cancellation && sameDay(x.start, day) && x.id !== this.existing()?.id).length : 0,
      }));
  });

  protected chooseTheatre(id: string): void {
    if (id === this.theatreId()) return;
    this.theatreId.set(id);
    this.screenId.set('');
  }

  protected chooseScreen(id: string): void {
    const screen = this.store.screen(id);
    this.screenId.set(id);
    // Prices follow the screen's seat categories; keep any the new screen shares.
    const next: Record<string, number> = {};
    for (const c of screen?.layout?.categories ?? []) next[c.id] = this.prices()[c.id] ?? c.basePrice;
    this.prices.set(next);
  }

  protected readonly start = computed<Date | null>(() => (this.day() && /^\d{1,2}:\d{2}$/.test(this.time()) ? withTime(fromDateInput(this.day()), this.time()) : null));
  protected readonly runtime = computed(() => this.movie()?.runtime ?? 0);
  protected readonly end = computed(() => { const s = this.start(); return s ? addMinutes(s, this.runtime() + this.intermission()) : null; });
  protected readonly readyAt = computed(() => { const e = this.end(); return e ? addMinutes(e, this.store.settings().bufferMinutes) : null; });

  /** Other shows on the chosen screen that day, for the conflict timeline. */
  protected readonly dayShows = computed(() => {
    const id = this.screenId();
    if (!id || !this.day()) return [];
    const day = fromDateInput(this.day());
    return this.store.shows()
      .filter((x) => x.screenId === id && !x.cancellation && sameDay(x.start, day) && x.id !== this.existing()?.id)
      .sort((a, b) => a.start.getTime() - b.start.getTime());
  });

  protected readonly timeline = computed(() => {
    const day = this.day() ? fromDateInput(this.day()) : startOfDay(this.store.now());
    const base = startOfDay(day).getTime();
    const shows = this.dayShows();
    const s = this.start();
    const starts = [...shows.map((x) => x.start.getTime()), ...(s ? [s.getTime()] : [])];
    const ends = [...shows.map((x) => this.store.turnaroundEnd(x).getTime()), ...(this.readyAt() ? [this.readyAt()!.getTime()] : [])];
    const hour = 60 * MINUTE;
    const from = Math.min(base + 8 * hour, ...starts.map((t) => Math.floor((t - base) / hour) * hour + base));
    const to = Math.max(base + 24 * hour, ...ends.map((t) => Math.ceil((t - base) / hour) * hour + base));
    const span = to - from;
    const pct = (t: number) => ((t - from) / span) * 100;
    const startIssues = this.issues().filter((i) => i.where === 'start');
    const blocks: TimelineBlock[] = shows.map((x) => {
      const e = this.store.showEnd(x).getTime();
      const title = this.store.movie(x.movieId)?.title ?? 'Film';
      return {
        id: x.id, label: `${formatTime(x.start)} ${title}`, left: pct(x.start.getTime()), width: pct(e) - pct(x.start.getTime()),
        buffer: pct(this.store.turnaroundEnd(x).getTime()) - pct(e), kind: x.publication === 'draft' ? 'draft' : 'published',
        conflict: startIssues.some((i) => i.message.includes(`${title} at ${formatTime(x.start)}`)),
      };
    });
    if (s && this.end()) {
      blocks.push({
        id: 'new', label: `${formatTime(s)} ${this.movie()?.title ?? 'This show'}`, left: pct(s.getTime()), width: pct(this.end()!.getTime()) - pct(s.getTime()),
        buffer: pct(this.readyAt()!.getTime()) - pct(this.end()!.getTime()), kind: 'new', conflict: startIssues.some((i) => i.level === 'error'),
      });
    }
    const ticks: { left: number; label: string }[] = [];
    for (let t = from; t <= to; t += 2 * hour) ticks.push({ left: pct(t), label: formatTime(new Date(t)).replace(':00', '') });
    return { blocks, ticks };
  });

  /** The earliest start on this screen and day that fits the film, interval and buffer. */
  protected readonly suggestedTime = computed<string | null>(() => {
    if (!this.movie() || !this.screenId() || !this.day()) return null;
    const day = fromDateInput(this.day());
    const roundUp = (t: number, step: number) => Math.ceil(t / (step * MINUTE)) * step * MINUTE;
    const need = (this.runtime() + this.intermission() + this.store.settings().bufferMinutes) * MINUTE;
    let t = Math.max(day.getTime() + 9 * 60 * MINUTE, roundUp(this.store.now().getTime() + 15 * MINUTE, 15));
    for (const o of this.dayShows()) {
      if (t + need <= o.start.getTime()) break;
      t = Math.max(t, roundUp(this.store.turnaroundEnd(o).getTime(), 5));
    }
    const latest = day.getTime() + 23 * 60 * MINUTE;
    return t <= latest && sameDay(new Date(t), day) ? toTimeInput(new Date(t)) : null;
  });

  // ------------------------------------------------------------------ Step 3: prices

  protected readonly layout = computed(() => this.selectedScreen()?.layout ?? null);
  protected readonly priceRows = computed(() => {
    const layout = this.layout();
    if (!layout) return [];
    const counts = layoutStats(layout).byCategory;
    return layout.categories.map((c) => {
      const price = this.prices()[c.id] ?? 0;
      const seats = counts[c.id] ?? 0;
      return { cat: c, seats, price, gross: seats * price, diff: price - c.basePrice };
    });
  });
  protected readonly totals = computed(() => {
    const rows = this.priceRows();
    return { seats: rows.reduce((n, r) => n + r.seats, 0), gross: rows.reduce((n, r) => n + r.gross, 0) };
  });

  protected setPrice(catId: string, value: string): void {
    const n = Math.max(0, Math.round(Number(value) || 0));
    this.prices.update((p) => ({ ...p, [catId]: n }));
  }

  protected resetPrices(): void {
    const next: Record<string, number> = {};
    for (const c of this.layout()?.categories ?? []) next[c.id] = c.basePrice;
    this.prices.set(next);
  }

  // ------------------------------------------------------------------ Validation

  protected readonly input = computed<ShowInput | null>(() => {
    const start = this.start();
    if (!this.movieId() || !this.theatreId() || !this.screenId() || !this.format() || !this.language() || !start) return null;
    return {
      theatreId: this.theatreId(), screenId: this.screenId(), movieId: this.movieId(), format: this.format() as ProjectionFormat,
      language: this.language(), start, intermission: this.intermission(), prices: this.prices(),
    };
  });

  protected readonly issues = computed<Issue[]>(() => {
    const input = this.input();
    if (!input) return [];
    const list = this.store.validateShow(input, this.existing()?.id);
    const scr = this.selectedScreen();
    if (scr && !formatFits(input.format, scr)) list.push({ level: 'warning', message: `${input.format} usually needs a matching screen; ${scr.name} is a ${scr.type} screen.`, where: 'format' });
    if (input.intermission < 0 || input.intermission > 30) list.push({ level: 'error', message: 'Set an interval between 0 and 30 minutes.', where: 'start' });
    return list;
  });
  protected readonly errors = computed(() => errorsOf(this.issues()));
  protected readonly warnings = computed(() => warningsOf(this.issues()));

  protected readonly stepDone = computed(() => {
    const scr = this.selectedScreen();
    return {
      1: !!this.movie() && !!this.format() && !!this.language(),
      2: !!scr && this.store.isSchedulable(scr) && !!this.start(),
      3: this.priceRows().length > 0 && this.priceRows().every((r) => r.price > 0),
      4: !!this.input() && !this.errors().length,
    } as Record<number, boolean>;
  });

  protected stepIssues(n: number): Issue[] { return this.issues().filter((i) => stepOf(i) === n); }

  /** Why "Next" is disabled on the current step. */
  protected readonly blocker = computed(() => {
    switch (this.step()) {
      case 1: return !this.movie() ? 'Choose a film to continue.' : !this.format() || !this.language() ? 'Choose a format and language.' : '';
      case 2: return !this.selectedScreen() ? 'Choose a screen to continue.' : !this.start() ? 'Set the date and start time.' : '';
      case 3: return this.stepDone()[3] ? '' : 'Set a price above zero for every seat category.';
      default: return '';
    }
  });

  protected canOpen(n: number): boolean {
    for (let i = 1; i < n; i++) if (!this.stepDone()[i]) return false;
    return true;
  }

  protected go(n: number): void {
    if (n <= this.step() || this.canOpen(n)) this.step.set(n);
  }

  // ------------------------------------------------------------------ Saving

  protected readonly title = computed(() => (this.existing() ? (this.existing()!.publication === 'draft' ? 'Edit draft show' : 'Edit show') : 'Create show'));
  protected readonly canSaveDraft = computed(() => !!this.input() && !this.isPublished());

  protected async saveDraft(): Promise<void> {
    const input = this.input();
    if (!input || this.isPublished()) return;
    const ex = this.existing();
    let id: string;
    if (ex) { this.store.updateShow(ex.id, input); id = ex.id; } else { id = this.store.createShow(input, false).id; }
    this.toast.success('Draft saved', this.errors().length ? `It has ${this.errors().length} ${this.errors().length === 1 ? 'error' : 'errors'} to fix before it can be published.` : 'It is ready to publish when you are.');
    await this.router.navigate(['/shows', id]);
  }

  protected async publish(): Promise<void> {
    const input = this.input();
    if (!input || this.errors().length) return;
    const ok = await this.confirm.ask({
      title: 'Publish this show?',
      message: 'Customers can book it as soon as it is published.',
      details: this.summary(),
      consequences: this.warnings().map((w) => w.message),
      confirmLabel: 'Publish show',
    });
    if (!ok) return;
    const ex = this.existing();
    let id: string;
    if (ex) {
      this.store.updateShow(ex.id, input);
      const result = this.store.publishShows([ex.id]);
      id = ex.id;
      if (!result.published.length) {
        this.toast.error('Saved as a draft, not published', result.failed[0]?.issues.map((i) => i.message).join(' ') ?? '');
        await this.router.navigate(['/shows', id]);
        return;
      }
    } else {
      id = this.store.createShow(input, true).id;
    }
    this.toast.success('Show published', `${this.movie()?.title} on ${formatDay(input.start)} at ${formatTime(input.start)} is now on sale.`);
    await this.router.navigate(['/shows', id]);
  }

  /** Saves changes to a published show. */
  protected async saveChanges(): Promise<void> {
    const input = this.input();
    const ex = this.existing();
    if (!input || !ex) return;
    if (this.access().mode === 'prices') {
      if (!this.stepDone()[3]) return;
      const ok = await this.confirm.ask({
        title: 'Update ticket prices?',
        message: 'New prices apply to bookings made from now on. Customers who have already booked keep the price they paid.',
        details: this.priceRows().map((r) => ({ label: r.cat.name, value: `${formatMoney(ex.prices[r.cat.id] ?? 0)} → ${formatMoney(r.price)}` })),
        confirmLabel: 'Update prices',
      });
      if (!ok) return;
      // Only the prices change; the locked fields keep the show's saved values.
      this.store.updateShow(ex.id, { ...input, movieId: ex.movieId, screenId: ex.screenId, theatreId: ex.theatreId, start: ex.start, format: ex.format, language: ex.language, intermission: ex.intermission });
    } else {
      if (this.errors().length) return;
      this.store.updateShow(ex.id, input);
    }
    this.toast.success('Show updated', this.store.showLabel(this.store.show(ex.id) ?? ex));
    await this.router.navigate(['/shows', ex.id]);
  }

  protected summary(): { label: string; value: string }[] {
    const s = this.start();
    return [
      { label: 'Film', value: `${this.movie()?.title ?? '—'} · ${this.format()} · ${this.language()}` },
      { label: 'Screen', value: `${this.selectedScreen()?.name ?? '—'} · ${this.theatre()?.name ?? ''}` },
      { label: 'Starts', value: s ? `${formatDay(s)}, ${formatTime(s)} (ends ${formatTime(this.end()!)})` : '—' },
      { label: 'Prices', value: priceRange(this.prices()) },
    ];
  }

  // ------------------------------------------------------------------ Template helpers

  protected fmtDate(d: Date): string { return formatDate(d); }
  protected fmtDay(d: Date): string { return formatDay(d); }
  protected fmtTime(d: Date): string { return formatTime(d); }
  protected fmtMoney(n: number): string { return formatMoney(n); }
  protected fmtNumber(n: number): string { return formatNumber(n); }
  protected fmtDuration(n: number): string { return formatDuration(n); }
  protected range(p: Record<string, number>): string { return priceRange(p); }
  protected isFuture(d: Date): boolean { return d.getTime() > this.store.now().getTime(); }
  protected fmtHhmm(t: string): string { return formatTime(withTime(new Date(), t)); }
  protected stepFor(i: Issue): number { return stepOf(i); }
  protected fits(f: ProjectionFormat): boolean { const s = this.selectedScreen(); return !s || formatFits(f, s); }
}
