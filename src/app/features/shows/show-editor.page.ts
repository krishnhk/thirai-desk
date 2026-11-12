import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { AdminStore, ShowInput } from '../../core/admin-store';
import {
  addMinutes, formatDay, formatDuration, formatMoney, formatNumber, formatTime, fromDateInput, sameDay, toDateInput, toTimeInput, withTime,
} from '../../core/format';
import { findSeat, layoutStats } from '../../core/layout';
import { Issue, Movie, PROJECTION_FORMATS, ProjectionFormat, Screen, Show } from '../../core/models';
import { ConfirmService, ToastService } from '../../shared/feedback';
import { IconComponent } from '../../shared/icon.component';
import { SeatMapComponent } from '../../shared/seat-map.component';
import { EmptyStateComponent, StatusBadgeComponent } from '../../shared/ui';
import { editMode, errorsOf, priceRange, warningsOf } from './show-utils';

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

/** Create or edit a show on one page: film and screen, date and time, pricing, with a live seat inventory beside it. */
@Component({
  selector: 'app-show-editor-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent, EmptyStateComponent, StatusBadgeComponent, SeatMapComponent],
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

  protected readonly movieId = signal('');
  protected readonly format = signal<ProjectionFormat | ''>('');
  protected readonly language = signal('');
  protected readonly theatreId = signal('');
  protected readonly screenId = signal('');
  protected readonly day = signal('');
  protected readonly time = signal('');
  protected readonly intermission = signal(0);
  /** Ticket price of each seat category of the screen, by category id. */
  protected readonly prices = signal<Record<string, number>>({});
  /** Customers can buy seats once the show is published. */
  protected readonly bookingOpen = signal(true);

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
      return;
    }
    this.intermission.set(this.store.settings().defaultIntermission);
    this.day.set(this.date() && /^\d{4}-\d{2}-\d{2}$/.test(this.date()!) ? this.date()! : toDateInput(this.store.operationalDate()));
    const t = this.timeParam();
    if (t && /^\d{1,2}:\d{2}$/.test(t)) this.time.set(t.padStart(5, '0'));
    const pre = this.screen() ? this.store.screen(this.screen()!) : undefined;
    if (pre && this.store.inScope(pre.theatreId) && this.store.isSchedulable(pre)) this.chooseScreen(pre.id);
  }

  // ------------------------------------------------------------------ Film and screen

  protected readonly movie = computed<Movie | undefined>(() => this.store.movie(this.movieId()));
  protected readonly movieList = computed(() => [...this.store.movies()].sort((a, b) => b.releaseDate.getTime() - a.releaseDate.getTime()));

  protected chooseMovie(id: string): void {
    const m = this.store.movie(id);
    if (!m) return;
    this.movieId.set(m.id);
    if (!this.format() || !m.formats.includes(this.format() as ProjectionFormat)) this.format.set(preferredFormat(m, this.selectedScreen()));
    if (!m.languages.includes(this.language())) this.language.set(m.languages[0] ?? '');
  }

  protected readonly theatre = computed(() => this.store.theatre(this.theatreId()));
  protected readonly selectedScreen = computed(() => this.store.screen(this.screenId()));
  protected readonly multiTheatre = computed(() => this.store.scopedTheatres().length > 1);
  protected readonly screenOptions = computed(() => {
    const theatres = new Map(this.store.theatres().map((t) => [t.id, t]));
    return this.store.scopedScreens()
      .slice()
      .sort((a, b) => (theatres.get(a.theatreId)?.name ?? '').localeCompare(theatres.get(b.theatreId)?.name ?? '') || a.number - b.number)
      .map((s) => ({
        screen: s,
        ok: this.store.isSchedulable(s),
        reason: s.status !== 'active' ? 'inactive' : !s.layout ? 'no seat layout' : '',
        label: `${this.multiTheatre() ? (theatres.get(s.theatreId)?.name ?? '') + ' · ' : ''}${s.name} · ${PROJECTION_FORMATS.filter((f) => formatFits(f, s)).join(', ')}`,
      }));
  });

  protected chooseScreen(id: string): void {
    const screen = this.store.screen(id);
    this.screenId.set(id);
    if (screen) this.theatreId.set(screen.theatreId);
    this.resetPrices();
  }

  // ------------------------------------------------------------------ Date and time

  protected readonly start = computed<Date | null>(() => (this.day() && /^\d{1,2}:\d{2}$/.test(this.time()) ? withTime(fromDateInput(this.day()), this.time()) : null));
  protected readonly runtime = computed(() => this.movie()?.runtime ?? 0);
  protected readonly end = computed(() => { const s = this.start(); return s ? addMinutes(s, this.runtime() + this.intermission()) : null; });
  protected readonly readyAt = computed(() => { const e = this.end(); return e ? addMinutes(e, this.store.settings().bufferMinutes) : null; });

  /** Other shows on the chosen screen that day. */
  protected readonly dayShows = computed(() => {
    const id = this.screenId();
    if (!id || !this.day()) return [];
    const day = fromDateInput(this.day());
    return this.store.shows()
      .filter((x) => x.screenId === id && !x.cancellation && sameDay(x.start, day) && x.id !== this.existing()?.id)
      .sort((a, b) => a.start.getTime() - b.start.getTime());
  });

  /** Shows on the screen that clash with this one, cleaning buffer included. */
  protected readonly overlaps = computed(() => {
    const s = this.start();
    const ready = this.readyAt();
    if (!s || !ready) return [];
    return this.dayShows().filter((x) => s.getTime() < this.store.turnaroundEnd(x).getTime() && x.start.getTime() < ready.getTime());
  });
  protected isOverlap(x: Show): boolean { return this.overlaps().some((o) => o.id === x.id); }

  // ------------------------------------------------------------------ Pricing and seat inventory

  protected readonly layout = computed(() => this.selectedScreen()?.layout ?? null);
  /** Confirmed seats sold so far, by category (editing an existing show). */
  protected readonly sold = computed<Record<string, number>>(() => {
    const ex = this.existing();
    const layout = this.layout();
    const out: Record<string, number> = {};
    if (!ex || !layout) return out;
    for (const b of this.store.confirmedBookingsOf(ex.id)) {
      for (const id of b.seats) {
        const cat = findSeat(layout, id)?.cell.categoryId;
        if (cat) out[cat] = (out[cat] ?? 0) + 1;
      }
    }
    return out;
  });
  protected readonly priceRows = computed(() => {
    const layout = this.layout();
    if (!layout) return [];
    const counts = layoutStats(layout).byCategory;
    return layout.categories.map((c) => {
      const price = this.prices()[c.id] ?? 0;
      const seats = counts[c.id] ?? 0;
      return { cat: c, seats, sold: this.sold()[c.id] ?? 0, price, gross: seats * price };
    });
  });
  protected readonly totals = computed(() => {
    const rows = this.priceRows();
    return { seats: rows.reduce((n, r) => n + r.seats, 0), gross: rows.reduce((n, r) => n + r.gross, 0) };
  });
  protected readonly hasBlocked = computed(() => layoutStats(this.layout()).blocked > 0);
  protected readonly totalSold = computed(() => Object.values(this.sold()).reduce((n, v) => n + v, 0));
  /** Cell size that fits the seat map inside the side panel. */
  protected readonly cellSize = computed(() => Math.max(6, Math.min(20, Math.floor(340 / Math.max(1, this.layout()?.cols ?? 1)) - 3)));

  protected setPrice(catId: string, value: string): void {
    this.prices.update((p) => ({ ...p, [catId]: Math.max(0, Math.round(Number(value) || 0)) }));
  }

  /** Platform defaults: each category's own base price. */
  protected resetPrices(): void {
    this.prices.set(Object.fromEntries((this.layout()?.categories ?? []).map((c) => [c.id, c.basePrice])));
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
  /** Messages other than overlaps, which have their own panel. */
  protected readonly otherIssues = computed(() => this.issues().filter((i) => !(i.where === 'start' && this.overlaps().length)));
  protected readonly pricesOk = computed(() => this.priceRows().length > 0 && this.priceRows().every((r) => r.price > 0));

  // ------------------------------------------------------------------ Saving

  protected readonly title = computed(() => (this.existing() ? (this.existing()!.publication === 'draft' ? 'Edit draft show' : 'Edit show') : 'Schedule a show'));
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
    if (!input || this.errors().length || !this.bookingOpen()) return;
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
      if (!this.pricesOk()) return;
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

  protected issuesFor(kind: 'price'): Issue[] { return this.issues().filter((i) => (i.where ?? '').startsWith(kind)); }
  protected fmtDay(d: Date): string { return formatDay(d); }
  protected fmtTime(d: Date): string { return formatTime(d).toLowerCase(); }
  protected fmtMoney(n: number): string { return formatMoney(n); }
  protected fmtNumber(n: number): string { return formatNumber(n); }
  protected fmtDuration(n: number): string { return formatDuration(n); }
}
