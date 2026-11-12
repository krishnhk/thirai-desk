import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, output, signal, viewChild } from '@angular/core';

import { AdminStore, CounterSaleStatus } from '../../../core/admin-store';
import { formatDay, formatDuration, formatMoney, formatTime, sameDay } from '../../../core/format';
import { Movie, Show } from '../../../core/models';
import { EmptyStateComponent } from '../../../shared/ui';
import { IconComponent } from '../../../shared/icon.component';
import { PosDateBarComponent } from './pos-date-bar.component';
import { PosSale } from './pos-sale';
import { PosScreenSelectComponent, ScreenOption } from './pos-screen-select.component';

/** One badge per counter status: label and badge tone. */
const STATUS: Record<CounterSaleStatus, { label: string; tone: string }> = {
  'on-sale': { label: 'On sale', tone: 'success' },
  'filling-fast': { label: 'Filling fast', tone: 'warning' },
  'sold-out': { label: 'Sold out', tone: 'violet' },
  'not-open': { label: 'Sales not open', tone: 'info' },
  closed: { label: 'Sales closed', tone: 'neutral' },
  completed: { label: 'Completed', tone: 'neutral plain' },
  cancelled: { label: 'Cancelled', tone: 'danger' },
  unavailable: { label: 'Unavailable', tone: 'neutral plain' },
};
/** Statuses the "Available for booking" toggle hides. Sold-out shows stay, so the operator can say so. */
const HIDDEN_WHEN_BOOKABLE_ONLY = new Set<CounterSaleStatus>(['cancelled', 'completed', 'closed', 'not-open', 'unavailable']);

interface SlotView {
  show: Show;
  time: string;
  screen: string;
  meta: string;
  /** The screen's sound system, when it adds something beyond the format. */
  audio: string;
  available: number;
  open: boolean;
  status: CounterSaleStatus;
  badge: { label: string; tone: string };
  /** Availability for open shows, otherwise why it cannot be sold. */
  note: string;
  price: string;
  occupancy: number;
  label: string;
}
interface MovieGroup { movie: Movie | undefined; id: string; meta: string; slots: SlotView[]; }

/**
 * The left panel, "Select a Show": the date (today or an advance date inside the booking window),
 * screen, search and filters, then the day's published shows grouped by film. Only shows the box
 * office can sell are clickable; the rest stay visible, subdued, with the reason.
 */
@Component({
  selector: 'app-pos-shows',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, EmptyStateComponent, PosDateBarComponent, PosScreenSelectComponent],
  host: { '[class.expanded]': 'expanded()' },
  template: `
    <button type="button" class="drawer-toggle" [attr.aria-expanded]="expanded()" (click)="expanded.set(!expanded())">
      <app-icon name="shows" />
      @if (sale.show(); as s) {
        <span class="dt-text"><strong>{{ sale.movie()?.title }}</strong> · {{ day(s.start) }} · {{ time(s.start) }} · {{ sale.screen()?.name }}</span>
      } @else { <span class="dt-text"><strong>Select a Show</strong></span> }
      <span class="dt-act">{{ expanded() ? 'Hide shows' : 'Change show' }}</span>
      <app-icon name="chevronDown" class="chev" />
    </button>

    <div class="body">
      <div class="top">
        <!-- A: what is being sold, and for which day -->
        <header class="head">
          <div class="when" role="status" aria-live="polite">
            <strong class="wday">{{ longDay() }}<span class="yr">{{ year() }}</span>@if (sale.isToday()) { <span class="badge success">Today</span> } @else if (sale.dayInWindow()) { <span class="badge info">Advance</span> }</strong>
          </div>
          <div class="hact"><ng-content /></div>
        </header>

        <!-- B: which day -->
        <app-pos-date-bar />

        <!-- C: narrowing the list. Search takes the free width on the left; the screen and the bookable toggle sit on the right. -->
        <div class="tools">
          <div class="search-input search">
            <app-icon name="search" />
            <input #search class="input" type="search" placeholder="Search movies, languages or screens..." aria-label="Search movies, languages or screens" autocomplete="off" [value]="query()" (input)="query.set($any($event.target).value)" (keydown.escape)="clearSearch($event)" />
            @if (query()) {
              <button type="button" class="sx" aria-label="Clear search" title="Clear search" (click)="clearQuery()"><app-icon name="close" /></button>
            }
          </div>
          <div class="tools-end">
            <app-pos-screen-select class="screens" [screens]="screenOptions()" [(value)]="screenId" />
            <label class="switch" title="Only shows the counter can sell now">
              <input type="checkbox" role="switch" [checked]="bookableOnly()" (change)="bookableOnly.set($any($event.target).checked)" />
              <span class="track" aria-hidden="true"></span>
              <span class="sl">Available for booking</span>
            </label>
          </div>
        </div>
      </div>

      <div class="list" #list>
        @if (store.loading()) {
          <div class="films" aria-busy="true" aria-label="Loading shows">
            @for (g of [0, 1, 2]; track g) {
              <div class="film sk">
                <header><span class="skeleton poster"></span><span class="skl"><span class="skeleton l1"></span><span class="skeleton l2"></span></span></header>
                <div class="slots">@for (s of [0, 1, 2]; track s) { <span class="skeleton tile"></span> }</div>
              </div>
            }
          </div>
        } @else if (!hasScreens()) {
          <app-empty-state icon="screen" title="No screens available" text="No active screen with a published seat layout. Publish a seat layout on a screen to start selling." />
        } @else if (!sale.dayInWindow()) {
          <app-empty-state icon="calendar" [title]="outsideTitle()" [text]="outsideText()">
            <button type="button" class="btn sm primary" (click)="sale.goToday()">Go to today</button>
          </app-empty-state>
        } @else if (!listed().length) {
          <app-empty-state icon="calendar" [title]="'No shows on ' + day(sale.day())" text="Nothing is scheduled for this date yet.">
            @if (nextDay(); as d) { <button type="button" class="btn sm" (click)="sale.setDay(d)">Go to {{ day(d) }}<app-icon name="chevronRight" /></button> }
          </app-empty-state>
        } @else if (!groups().length) {
          @if (emptyReason() === 'search') {
            <app-empty-state icon="search" [title]="'No shows match “' + query().trim() + '”'" text="Search looks at movie titles, languages and screen names.">
              <button type="button" class="btn sm" (click)="query.set('')">Clear search</button>
            </app-empty-state>
          } @else if (emptyReason() === 'bookable') {
            <app-empty-state icon="clock" [title]="'Nothing left to book on ' + day(sale.day())" text="Every show on this date has finished, closed or been cancelled.">
              <button type="button" class="btn sm" (click)="bookableOnly.set(false)">Show all shows</button>
              @if (nextDay(); as d) { <button type="button" class="btn sm" (click)="sale.setDay(d)">Go to {{ day(d) }}<app-icon name="chevronRight" /></button> }
            </app-empty-state>
          } @else {
            <app-empty-state icon="screen" title="No shows on this screen" text="Nothing is scheduled on the selected screen for this date.">
              <button type="button" class="btn sm" (click)="clearFilters()">Show all screens</button>
            </app-empty-state>
          }
        } @else {
          @if (!openCount()) {
            <div class="callout info none-open" role="status">
              <app-icon name="info" />
              <span>{{ soldOutCount() ? 'All remaining shows on this date are sold out.' : 'No shows left to book on this date.' }}</span>
              @if (nextDay(); as d) { <button type="button" class="link-btn small" (click)="sale.setDay(d)">Go to {{ day(d) }}</button> }
            </div>
          }
          <div class="films">
            @for (g of groups(); track g.id) {
              <section class="film" [attr.aria-label]="g.movie?.title">
                <header>
                  @if (g.movie?.posterUrl) { <img class="poster" [src]="g.movie!.posterUrl" alt="" loading="lazy" /> } @else { <span class="poster"></span> }
                  <div class="mt">
                    <strong>{{ g.movie?.title ?? 'Film' }}</strong>
                    <small>{{ g.meta }}</small>
                  </div>
                </header>
                <div class="slots">
                  @for (s of g.slots; track s.show.id) {
                    <button type="button" class="slot st-{{ s.status }}" [attr.data-show]="s.show.id" [class.sel]="sale.showId() === s.show.id" [class.hl]="highlightId() === s.show.id"
                      [disabled]="!s.open" [attr.aria-pressed]="sale.showId() === s.show.id" [attr.aria-label]="s.label" (click)="open(s.show.id)">
                      <span class="c-top">
                        <span class="time">{{ s.time }}</span>
                        <span class="badge {{ s.badge.tone }}">{{ s.badge.label }}</span>
                      </span>
                      <span class="c-where"><span class="scr">{{ s.screen }}</span><span class="lang">{{ s.show.language }}</span></span>
                      <span class="c-tech">
                        <span class="fmt">{{ s.show.format }}</span>
                        @if (s.audio) { <span class="fmt aud">{{ s.audio }}</span> }
                      </span>
                      <span class="c-foot">
                        @if (s.open) {
                          <span class="avail"><b>{{ s.available }}</b> seats left <span class="pct">· {{ pct(s.occupancy) }}% full</span></span>
                        } @else {
                          <span class="note">{{ s.note }}</span>
                        }
                        <span class="price"><small>from</small> {{ s.price }}</span>
                      </span>
                      @if (s.open) { <span class="occ" aria-hidden="true"><span [style.width.%]="pct(s.occupancy)"></span></span> }
                    </button>
                  }
                </div>
              </section>
            }
          </div>
        }
      </div>
    </div>
  `,
  styles: `
    :host { display: flex; flex-direction: column; min-height: 0; container: shows / inline-size; }
    .drawer-toggle { display: none; }
    .body { display: flex; flex-direction: column; flex: 1; min-height: 0; }
    .top { display: flex; flex-direction: column; gap: 12px; padding: 12px 12px 10px; border-bottom: 1px solid var(--border); }

    /* A: title and the selected day. */
    .head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; min-width: 0; }
    .ht { flex: none; min-width: 0; }
    .ht h2 { font-size: 1rem; }
    .when { order: 3; flex: 1 1 100%; display: flex; flex-direction: column; gap: 1px; min-width: 0; line-height: 1.25; }
    .wday { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 1.12rem; font-weight: 800; letter-spacing: -0.01em; }
    .wday .badge { margin-left: 10px; vertical-align: 3px; }
    @container shows (max-width: 559px) { .wday .badge { display: none; } }
    .yr { margin-left: 6px; font-size: 0.86rem; font-weight: 600; color: var(--text-muted); }
    .hact { order: 2; margin-left: auto; }
    .hact:empty { display: none; }

    /* C: primary (screen, search) over secondary (filters, bookable toggle). */
    /* One line when there is room: screen, search, toggle. Narrower: screen and toggle, then search. */
    /* Search grows on the left; the right group keeps its size. When it does not fit, the right group wraps under the search. */
    .tools { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding-top: 12px; border-top: 1px solid var(--border-soft); }
    .search { flex: 1 1 280px; min-width: 0; }
    .tools-end { display: flex; align-items: center; gap: 8px 14px; flex: 0 0 auto; margin-left: auto; }
    .screens { flex: 0 0 200px; width: 200px; }
    .search .input { min-height: 38px; padding-right: 38px; font-size: 0.9rem; }
    .search .input::-webkit-search-cancel-button { -webkit-appearance: none; appearance: none; }
    .sx { position: absolute; right: 5px; top: 50%; display: grid; place-items: center; width: 26px; height: 26px; padding: 0; border: 0; border-radius: var(--radius-sm); background: none; color: var(--text-muted); transform: translateY(-50%); }
    .sx:hover { background: var(--surface-3); color: var(--text); }
    .sx app-icon { width: 14px; height: 14px; }

    .switch { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 8px; min-height: 32px; font-size: 0.82rem; font-weight: 600; color: var(--text-soft); white-space: nowrap; cursor: pointer; user-select: none; }
    .switch:hover { color: var(--text); }
    .switch input { position: absolute; opacity: 0; width: 1px; height: 1px; }
    .track { position: relative; flex: none; width: 30px; height: 17px; border-radius: 999px; background: var(--surface-3); box-shadow: inset 0 0 0 1px var(--border-strong); transition: background 120ms ease; }
    .track::after { content: ''; position: absolute; top: 2px; left: 2px; width: 13px; height: 13px; border-radius: 50%; background: var(--text-muted); transition: transform 120ms ease, background 120ms ease; }
    .switch input:checked + .track { background: var(--accent); box-shadow: none; }
    .switch input:checked + .track::after { transform: translateX(13px); background: var(--on-accent); }
    .switch input:focus-visible + .track { outline: 2px solid var(--accent); outline-offset: 2px; }

    /* Room for a row each: title beside the date; screens beside search; filters always out. */
    /* Room for a row: the title beside the date. */
    @container shows (min-width: 560px) {
      .when { order: 0; flex: 1 1 auto; }
      .hact { order: 0; }
    }
    /* Narrow panel: search on its own line; the screen takes what the toggle leaves. */
    @container shows (max-width: 519px) {
      .search { flex-basis: 100%; }
      .tools-end { flex: 1 1 100%; flex-wrap: wrap; min-width: 0; margin-left: 0; }
      .screens { flex: 1 1 160px; width: auto; min-width: 0; }
    }
    @container shows (min-width: 780px) {
      .top { gap: 14px; padding: 14px 16px 12px; }
      .tools { padding-top: 14px; }
    }

    .list { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 10px 14px; }
    .none-open { align-items: center; margin: 8px 2px 2px; padding: 8px 12px; font-size: 0.8rem; }
    .none-open span { flex: 1; }
    .films { display: flex; flex-direction: column; }
    .film { padding: 10px 2px 8px; }
    .film + .film { border-top: 1px solid var(--border-soft); }
    .film header { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; min-width: 0; }
    .poster { width: 32px; aspect-ratio: 2 / 3; border-radius: 4px; object-fit: cover; background: var(--surface-3); flex-shrink: 0; }
    .mt { display: flex; flex-direction: column; min-width: 0; line-height: 1.3; }
    .mt strong { font-size: 0.92rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .mt small { color: var(--text-muted); font-size: 0.74rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    .slots { display: grid; grid-template-columns: minmax(0, 1fr); gap: 6px; }
    .slot { position: relative; display: flex; flex-direction: column; gap: 6px; width: 100%; min-width: 0; padding: 10px 12px 12px; overflow: hidden; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface-2); color: var(--text); text-align: left; cursor: pointer; transition: border-color 120ms ease, background 120ms ease, box-shadow 120ms ease; }
    .slot:hover:not(:disabled) { border-color: var(--border-strong); background: var(--surface-3); }
    .slot:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .slot.hl:not(.sel) { border-color: var(--border-strong); background: var(--surface-3); }
    .slot.sel { border-color: var(--accent); background: var(--accent-soft); box-shadow: inset 3px 0 0 var(--accent); }
    .c-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .time { font-size: 1.22rem; font-weight: 800; letter-spacing: -0.02em; line-height: 1.15; white-space: nowrap; }
    .sel .time { color: var(--accent); }
    .c-top .badge { flex-shrink: 0; padding: 0 8px 0 7px; font-size: 0.68rem; }
    .c-where { display: flex; align-items: baseline; gap: 6px; min-width: 0; font-size: 0.82rem; white-space: nowrap; overflow: hidden; }
    .scr { font-weight: 700; color: var(--text); overflow: hidden; text-overflow: ellipsis; }
    .c-tech { display: flex; flex-wrap: wrap; gap: 4px; min-width: 0; }
    .fmt { padding: 0 6px; border: 1px solid var(--border-strong); border-radius: 4px; font-size: 0.68rem; font-weight: 700; line-height: 17px; color: var(--text-soft); }
    .fmt.aud { border-color: var(--border); color: var(--text-muted); font-weight: 600; }
    .lang { flex-shrink: 0; color: var(--text-muted); }
    .lang::before { content: '·'; margin-right: 6px; color: var(--text-faint); }
    .c-foot { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; min-width: 0; }
    .avail { min-width: 0; font-size: 0.8rem; color: var(--text-soft); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .avail b { font-size: 0.95rem; font-weight: 800; color: var(--text); }
    .pct { color: var(--text-muted); }
    .st-filling-fast .avail b, .st-filling-fast .pct { color: var(--warning); }
    .note { min-width: 0; font-size: 0.78rem; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .price { flex-shrink: 0; font-size: 1rem; font-weight: 800; color: var(--text); white-space: nowrap; }
    .price small { font-size: 0.7rem; font-weight: 600; color: var(--text-muted); margin-right: 2px; }
    .occ { position: absolute; left: 0; right: 0; bottom: 0; height: 3px; background: var(--surface-3); }
    .occ span { display: block; height: 100%; background: var(--success); }
    .st-filling-fast .occ span { background: var(--warning); }
    .sel .occ span { background: var(--accent); }
    /* Not bookable: flat, quiet, no hover, no pointer. */
    .slot:disabled { cursor: not-allowed; background: transparent; border-color: var(--border-soft); border-style: dashed; }
    .slot:disabled .time, .slot:disabled .scr, .slot:disabled .price { color: var(--text-muted); }
    .slot:disabled .fmt { border-color: var(--border); color: var(--text-muted); }
    .slot.st-sold-out { border-style: solid; }
    .slot.st-completed, .slot.st-cancelled, .slot.st-unavailable { opacity: 0.55; }
    .slot.st-cancelled .time { text-decoration: line-through; text-decoration-color: var(--danger); }
    .slot.st-cancelled .note { color: var(--danger); }

    .sk header { margin-bottom: 8px; }
    .sk .poster { display: block; height: 48px; }
    .skl { display: flex; flex-direction: column; gap: 6px; flex: 1; }
    .l1 { height: 12px; width: 55%; } .l2 { height: 10px; width: 80%; }
    .tile { display: block; height: 92px; border-radius: var(--radius); }
    app-empty-state { display: block; }

    /* Wider selector (tablet, browsing with no show chosen, wide monitors): film rows with time tiles. */
    @container shows (min-width: 520px) {
      .slots { grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); }
    }
    @container shows (min-width: 760px) {
      .list { padding: 4px 16px 16px; }
      .film { display: grid; grid-template-columns: 230px minmax(0, 1fr); gap: 16px; align-items: start; padding: 14px 0 12px; }
      .film header { margin: 0; align-items: flex-start; }
      .film .poster { width: 40px; }
      .mt small { white-space: normal; }
      .tile { height: 96px; }
    }

    @media (max-width: 1100px) {
      .drawer-toggle { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 48px; padding: 8px 14px; border: 0; background: none; color: var(--text); text-align: left; }
      .drawer-toggle > app-icon { color: var(--accent); }
      .dt-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.88rem; }
      .dt-act { font-size: 0.8rem; font-weight: 600; color: var(--accent); white-space: nowrap; }
      .chev { width: 16px; height: 16px; color: var(--text-muted); }
      :host(.expanded) .chev { transform: rotate(180deg); }
      .ht { display: none; }
      .when { padding-left: 0; border-left: 0; }
      .body { display: none; border-top: 1px solid var(--border); }
      :host(.expanded) .body { display: flex; }
      .list { max-height: 70vh; }
    }
  `,
})
export class PosShowsComponent {
  readonly store = inject(AdminStore);
  readonly sale = inject(PosSale);
  private readonly searchEl = viewChild<ElementRef<HTMLInputElement>>('search');
  private readonly listEl = viewChild<ElementRef<HTMLElement>>('list');
  private readonly dateBar = viewChild(PosDateBarComponent);
  /** A show was opened from the list (the page closes the drawer). */
  readonly picked = output<string>();

  readonly query = signal('');
  readonly screenId = signal('');
  readonly bookableOnly = signal(false);
  /** Stacked layout: whether the show list is open. */
  readonly expanded = signal(true);
  /** The show the arrow keys are on. */
  readonly highlightId = signal<string | null>(null);

  /** The theatre's active screens; ones without a published layout show but cannot be picked. */
  readonly screens = computed(() => this.store.scopedScreens()
    .filter((s) => s.status === 'active' && this.store.theatre(s.theatreId)?.status === 'active')
    .sort((a, b) => a.theatreId.localeCompare(b.theatreId) || a.number - b.number)
    .map((s) => ({ id: s.id, name: s.name, ok: this.store.isSchedulable(s) })));
  readonly hasScreens = computed(() => this.screens().some((s) => s.ok));
  /** The dropdown's options: loaded from the theatre's screens, with the day's show count for each. */
  readonly screenOptions = computed<ScreenOption[]>(() => {
    const counts = new Map<string, number>();
    for (const show of this.listed()) counts.set(show.screenId, (counts.get(show.screenId) ?? 0) + 1);
    return this.screens().map((sc) => {
      const screen = this.store.screen(sc.id);
      return { id: sc.id, name: sc.name, number: screen?.number ?? 0, type: screen?.type ?? '', ok: sc.ok, shows: counts.get(sc.id) ?? 0 };
    });
  });

  /** The selected day's published shows. Drafts never reach the counter. */
  readonly listed = computed(() => {
    const day = this.sale.day();
    return this.store.scopedShows()
      .filter((s) => s.publication === 'published' && sameDay(s.start, day))
      .sort((a, b) => a.start.getTime() - b.start.getTime());
  });

  private readonly all = computed<SlotView[]>(() => {
    const now = this.store.now();
    return this.listed().map((show) => {
      const state = this.store.counterSaleState(show);
      const screen = this.store.screen(show.screenId)?.name ?? 'Screen';
      const movie = this.store.movie(show.movieId);
      const available = this.store.availableSeats(show);
      const occupancy = this.store.occupancy(show);
      const time = formatTime(show.start);
      let note: string;
      switch (state.status) {
        case 'on-sale': case 'filling-fast':
          note = `${now >= show.start ? 'Started · ' : ''}${available} left · ${Math.round(occupancy * 100)}% full`; break;
        case 'sold-out': note = 'No seats left'; break;
        case 'closed': note = `Closed at ${formatTime(this.store.counterSalesWindow(show).closes)}`; break;
        case 'completed': note = `Ended at ${formatTime(this.store.showEnd(show))}`; break;
        case 'cancelled': note = show.cancellation?.reason ?? 'Show cancelled'; break;
        case 'not-open': note = `Opens ${formatDay(this.store.counterSalesWindow(show).opens)}`; break;
        default: note = state.reason;
      }
      const badge = STATUS[state.status];
      return {
        show, time, screen, meta: `${show.format} · ${show.language}`, open: state.open, status: state.status, badge, note, available,
        audio: (() => { const sound = this.store.screen(show.screenId)?.sound ?? ''; return sound && sound !== show.format ? sound : ''; })(),
        price: formatMoney(this.store.startingPrice(show)), occupancy,
        label: `${movie?.title ?? 'Film'}, ${formatDay(show.start)} ${time}, ${screen}, ${show.format}, ${show.language}, ${badge.label}, ${note}, from ${formatMoney(this.store.startingPrice(show))}`,
      };
    });
  });
  readonly openCount = computed(() => this.all().filter((s) => s.open).length);
  readonly soldOutCount = computed(() => this.all().filter((s) => s.status === 'sold-out').length);

  private matches(s: SlotView, opts: { query: boolean; filters: boolean; bookable: boolean }): boolean {
    if (opts.query) {
      const q = this.query().trim().toLowerCase();
      if (q) {
        const title = this.store.movie(s.show.movieId)?.title.toLowerCase() ?? '';
        if (!title.includes(q) && !s.show.language.toLowerCase().includes(q) && !s.screen.toLowerCase().includes(q)) return false;
      }
    }
    if (opts.filters) {
      if (this.screenId() && s.show.screenId !== this.screenId()) return false;
    }
    if (opts.bookable && this.bookableOnly() && HIDDEN_WHEN_BOOKABLE_ONLY.has(s.status)) return false;
    return true;
  }

  readonly groups = computed<MovieGroup[]>(() => {
    const map = new Map<string, MovieGroup>();
    for (const s of this.all()) {
      if (!this.matches(s, { query: true, filters: true, bookable: true })) continue;
      const g = map.get(s.show.movieId);
      if (g) { g.slots.push(s); continue; }
      const movie = this.store.movie(s.show.movieId);
      const meta = movie ? [movie.certification, formatDuration(movie.runtime), movie.genres.join(', ')].join(' · ') : '';
      map.set(s.show.movieId, { movie, id: s.show.movieId, meta, slots: [s] });
    }
    // Films with something to sell first, by their next sellable show.
    const next = (g: MovieGroup) => g.slots.find((s) => s.open)?.show.start.getTime() ?? Number.MAX_SAFE_INTEGER;
    return [...map.values()].sort((a, b) => next(a) - next(b) || a.slots[0]!.show.start.getTime() - b.slots[0]!.show.start.getTime());
  });

  /** Why the list is empty: the search alone, the bookable toggle alone, or the filters. */
  readonly emptyReason = computed<'search' | 'bookable' | 'filters'>(() => {
    const all = this.all();
    if (this.query().trim() && all.some((s) => this.matches(s, { query: false, filters: true, bookable: true }))) return 'search';
    if (this.bookableOnly() && !all.some((s) => this.matches(s, { query: false, filters: false, bookable: true }))) return 'bookable';
    return 'filters';
  });

  /** The shows on screen now, and how many of them can be sold. */
  private readonly shown = computed(() => this.groups().flatMap((g) => g.slots));
  readonly shownCount = computed(() => this.shown().length);
  readonly shownOpen = computed(() => this.shown().filter((s) => s.open).length);
  /** Bookable shows that match the search and filters (the toggle's count). */

  /** The selected day, written out: "Tuesday, 10 November". */
  readonly longDay = computed(() => this.sale.day().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }));
  readonly year = computed(() => String(this.sale.day().getFullYear()));

  readonly nextDay = computed(() => this.sale.nextDayWithShows());
  readonly outsideTitle = computed(() => (this.sale.day() < this.sale.today() ? `${formatDay(this.sale.day())} is in the past` : `${formatDay(this.sale.day())} is outside the booking window`));
  readonly outsideText = computed(() => `The box office sells from today up to ${formatDay(this.sale.lastDay())}. Pick a date in that range to book.`);

  /** Sellable shows in on-screen order, for the arrow keys. */
  private readonly navigable = computed(() => this.groups().flatMap((g) => g.slots.filter((s) => s.open).map((s) => s.show.id)));

  time = formatTime;
  day = formatDay;
  pct = (r: number) => Math.round(r * 100);

  open(id: string): void {
    if (this.sale.selectShow(id)) {
      this.highlightId.set(id);
      this.expanded.set(false);
      this.picked.emit(id);
    }
  }

  /** Arrow keys: moves focus through the sellable shows, so Enter opens the focused one. */
  move(delta: number): void {
    const ids = this.navigable();
    if (!ids.length) return;
    const cur = this.highlightId() ?? this.sale.showId();
    const i = cur ? ids.indexOf(cur) : -1;
    let at = (i + delta + ids.length) % ids.length;
    if (i < 0) at = delta > 0 ? 0 : ids.length - 1;
    const next = ids[at]!;
    this.highlightId.set(next);
    this.expanded.set(true);
    // Wait for the list to be visible (it may have just unfolded) before focusing.
    setTimeout(() => {
      const el = this.listEl()?.nativeElement.querySelector<HTMLElement>(`[data-show="${next}"]`);
      el?.focus();
      el?.scrollIntoView({ block: 'nearest' });
    }, 30);
  }

  focusSearch(): void {
    this.expanded.set(true);
    setTimeout(() => this.searchEl()?.nativeElement.focus(), 30);
  }

  /** Closes the calendar; true when something was closed (so Esc does nothing else). */
  dismiss(): boolean {
    return this.dateBar()?.dismiss() ?? false;
  }

  clearSearch(e: Event): void {
    if (this.query()) { this.query.set(''); e.stopPropagation(); }
    (e.target as HTMLInputElement).blur();
  }

  /** The search box's clear button: empties it and keeps the focus there for the next search. */
  clearQuery(): void {
    this.query.set('');
    this.searchEl()?.nativeElement.focus();
  }

  clearFilters(): void {
    this.screenId.set('');
  }
}
