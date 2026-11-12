import { ChangeDetectionStrategy, Component, HostListener, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';

import { AdminStore } from '../../core/admin-store';
import { DAY, formatDay, formatTime } from '../../core/format';
import { Issue, Movie, Screen, Show, Theatre } from '../../core/models';
import { IconComponent } from '../../shared/icon.component';
import { ToastService } from '../../shared/feedback';
import { ModalComponent } from '../../shared/modal.component';
import { selectionState, tableState } from '../../shared/table';
import { EmptyStateComponent, PaginatorComponent, SkeletonComponent, SortHeaderComponent, StatusBadgeComponent } from '../../shared/ui';
import { ShowActions, errorsOf, minPrice, priceRange, warningsOf } from './show-utils';

interface DraftRow {
  show: Show;
  movie: Movie | undefined;
  theatre: Theatre | undefined;
  screen: Screen | undefined;
  end: Date;
  errors: Issue[];
  warnings: Issue[];
  ready: boolean;
  soon: boolean;
}

/** The drafts workspace: validation state for every draft, a schedule preview and bulk publishing. */
@Component({
  selector: 'app-drafts-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent, ModalComponent, EmptyStateComponent, SkeletonComponent, PaginatorComponent, SortHeaderComponent, StatusBadgeComponent],
  template: `
    <div class="toolbar">
      <div class="search-input grow">
        <app-icon name="search" />
        <input class="input" type="search" aria-label="Search drafts" placeholder="Search film, screen or theatre" [value]="query()" (input)="query.set($any($event.target).value); table.reset()" />
      </div>
      @if (store.scopedTheatres().length > 1) {
        <select class="select" aria-label="Theatre" (change)="theatreId.set($any($event.target).value); table.reset()">
          <option value="" [selected]="!theatreId()">All theatres</option>
          @for (t of store.scopedTheatres(); track t.id) { <option [value]="t.id" [selected]="t.id === theatreId()">{{ t.name }}</option> }
        </select>
      }
      <div class="segmented" role="group" aria-label="Validation">
        <button type="button" [attr.aria-pressed]="readiness() === 'all'" (click)="readiness.set('all'); table.reset()">All</button>
        <button type="button" [attr.aria-pressed]="readiness() === 'ready'" (click)="readiness.set('ready'); table.reset()">Ready</button>
        <button type="button" [attr.aria-pressed]="readiness() === 'blocked'" (click)="readiness.set('blocked'); table.reset()">Has errors</button>
      </div>
    </div>

    <div class="selbar" [class.on]="selection.count()">
      @if (selection.count()) {
        <span class="sel"><b>{{ selection.count() }}</b> selected</span>
        <button class="btn ghost sm" type="button" (click)="selection.clear()">Clear</button>
        <span class="grow"></span>
        <button class="btn primary sm" type="button" (click)="reviewOpen.set(true)"><app-icon name="upload" />Review and publish</button>
      } @else {
        <p class="stats">
          <span><b>{{ stats().total }}</b> {{ stats().total === 1 ? 'draft' : 'drafts' }}</span>
          <span class="ok"><b>{{ stats().ready }}</b> ready to publish</span>
          @if (stats().blocked) { <span class="bad"><b>{{ stats().blocked }}</b> with errors</span> }
          @if (stats().soon) { <span class="warn"><b>{{ stats().soon }}</b> start within 48 hours</span> }
        </p>
        <span class="grow"></span>
        @if (stats().ready) { <button class="btn sm" type="button" (click)="selectReady()">Select all ready ({{ stats().ready }})</button> }
      }
    </div>

    @if (store.loading()) {
      <app-skeleton [rows]="6" />
    } @else if (!filtered().length) {
      <app-empty-state icon="shows" [title]="all().length ? 'No drafts match these filters' : 'No draft shows'"
        [text]="all().length ? 'Clear the search or validation filter to see every draft.' : 'Drafts let you plan shows before they go on sale. Create a show and save it as a draft.'">
        <a class="btn primary" routerLink="/shows/new"><app-icon name="plus" />Create show</a>
      </app-empty-state>
    } @else {
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th class="check-col"><input type="checkbox" aria-label="Select all drafts on this page" [checked]="selection.allOf(pageIds())" (change)="selection.setAll(pageIds(), $any($event.target).checked)" /></th>
              <th><app-sort-header [active]="table.isSorted('film')" [dir]="table.dir()" (toggle)="table.sortBy('film')">Film</app-sort-header></th>
              <th><app-sort-header [active]="table.isSorted('screen')" [dir]="table.dir()" (toggle)="table.sortBy('screen')">Screen</app-sort-header></th>
              <th><app-sort-header [active]="table.isSorted('start')" [dir]="table.dir()" (toggle)="table.sortBy('start')">When</app-sort-header></th>
              <th><app-sort-header [active]="table.isSorted('ready')" [dir]="table.dir()" (toggle)="table.sortBy('ready')">Validation</app-sort-header></th>
              <th class="num col-price"><app-sort-header [active]="table.isSorted('price')" [dir]="table.dir()" (toggle)="table.sortBy('price')">Price</app-sort-header></th>
              <th class="actions-col"><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            @for (r of table.rows(); track r.show.id) {
              <tr [class.selected]="selection.has(r.show.id)">
                <td class="check-col"><input type="checkbox" [attr.aria-label]="'Select ' + store.showLabel(r.show)" [checked]="selection.has(r.show.id)" (change)="selection.toggle(r.show.id, $any($event.target).checked)" /></td>
                <td>
                  <div class="cell-title">
                    <img class="poster-thumb" [src]="r.movie?.posterUrl ?? ''" alt="" loading="lazy" />
                    <span class="min0"><a class="title-link" [routerLink]="['/shows', r.show.id]"><strong class="truncate">{{ r.movie?.title }}</strong></a><small class="truncate">{{ r.show.format }} · {{ r.show.language }}</small></span>
                  </div>
                </td>
                <td><span class="two"><strong>{{ r.screen?.name }}</strong>@if (store.scopedTheatres().length > 1) { <small>{{ r.theatre?.name }}</small> }</span></td>
                <td>
                  <span class="two"><strong>{{ time(r.show.start) }} <span class="muted dash">– {{ time(r.end) }}</span></strong><small>{{ day(r.show.start) }}@if (r.soon) { <span class="soon">· within 48 h</span> }</small></span>
                </td>
                <td class="validation">
                  @if (r.ready) { <span class="badge success">Ready</span> }
                  @else { <span class="badge danger">{{ r.errors.length }} {{ r.errors.length === 1 ? 'error' : 'errors' }}</span> }
                  @if (r.warnings.length) { <span class="badge warning">{{ r.warnings.length }} {{ r.warnings.length === 1 ? 'warning' : 'warnings' }}</span> }
                  @if (r.errors.length || r.warnings.length) {
                    <ul class="issues">
                      @for (i of r.errors; track $index) { <li class="err">{{ i.message }}</li> }
                      @for (i of r.warnings; track $index) { <li class="wrn">{{ i.message }}</li> }
                    </ul>
                  }
                </td>
                <td class="num col-price">{{ price(r.show) }}</td>
                <td class="actions-col">
                  <div class="row-actions">
                    <button class="btn sm primary" type="button" [disabled]="!r.ready" [attr.title]="r.ready ? null : 'Fix the errors before publishing'" (click)="publishOne(r.show)">Publish</button>
                    <button class="btn ghost sm icon" type="button" [attr.aria-label]="'More actions for ' + (r.movie?.title ?? 'draft')" [attr.aria-expanded]="menuFor() === r.show.id" (click)="toggleMenu(r.show.id, $event)"><app-icon name="more" /></button>
                    @if (menuFor() === r.show.id) {
                      <div class="menu" role="menu" [style.top.px]="menuPos().top" [style.bottom.px]="menuPos().bottom" [style.right.px]="menuPos().right">
                        <a role="menuitem" [routerLink]="['/shows', r.show.id, 'edit']"><app-icon name="edit" />Edit draft</a>
                        <button role="menuitem" type="button" (click)="menuFor.set(null); actions.duplicate(r.show)"><app-icon name="copy" />Duplicate</button>
                        <button role="menuitem" type="button" class="danger" (click)="menuFor.set(null); remove(r.show)"><app-icon name="trash" />Delete draft…</button>
                      </div>
                    }
                  </div>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      @if (table.total() > table.size()) { <app-paginator [(page)]="table.page" [(pageSize)]="table.size" [total]="table.total()" /> }
    }

    @if (reviewOpen()) {
      <app-modal title="Review and publish" eyebrow="Bulk publish" size="lg" (closed)="reviewOpen.set(false)">
        <div class="stack">
          <p class="soft">Ready drafts go on sale immediately. Drafts with errors stay as drafts; fix them and publish again.</p>
          @if (review().ready.length) {
            <div>
              <h3 class="list-title"><app-status-badge status="published" label="Will be published" /> <span class="muted small">{{ review().ready.length }}</span></h3>
              <ul class="review-list">
                @for (r of review().ready; track r.show.id) {
                  <li>
                    <span class="when">{{ day(r.show.start) }}, {{ time(r.show.start) }}</span>
                    <span class="what"><strong>{{ r.movie?.title }}</strong> · {{ r.screen?.name }}, {{ r.theatre?.name }}</span>
                    @if (r.warnings.length) { <span class="wrn small">{{ r.warnings[0]!.message }}</span> }
                  </li>
                }
              </ul>
            </div>
          }
          @if (review().blocked.length) {
            <div>
              <h3 class="list-title"><span class="badge danger">Blocked</span> <span class="muted small">{{ review().blocked.length }}</span></h3>
              <ul class="review-list">
                @for (r of review().blocked; track r.show.id) {
                  <li>
                    <span class="when">{{ day(r.show.start) }}, {{ time(r.show.start) }}</span>
                    <span class="what"><strong>{{ r.movie?.title }}</strong> · {{ r.screen?.name }}, {{ r.theatre?.name }}</span>
                    @for (e of r.errors; track $index) { <span class="err small">{{ e.message }}</span> }
                  </li>
                }
              </ul>
            </div>
          }
          @if (review().ready.length > 1) {
            <div class="callout info"><app-icon name="info" /><span>Shows are published one by one. If two selected drafts overlap on the same screen, the second is blocked once the first is on sale.</span></div>
          }
        </div>
        <ng-container footer>
          <button class="btn" type="button" (click)="reviewOpen.set(false)">Cancel</button>
          <button class="btn primary" type="button" [disabled]="!review().ready.length" (click)="publishSelected()">
            Publish {{ review().ready.length }} {{ review().ready.length === 1 ? 'show' : 'shows' }}
          </button>
        </ng-container>
      </app-modal>
    }
  `,
  styles: `
    .table-wrap { position: relative; }
    .toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 14px 16px; }
    .toolbar .grow { flex: 1 1 240px; min-width: 200px; }
    .toolbar .select { width: auto; min-width: 140px; max-width: 200px; }
    .toolbar .input, .toolbar .select { height: 36px; min-height: 36px; padding-top: 0; padding-bottom: 0; }
    .toolbar .segmented { min-height: 36px; }
    .selbar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 12px; min-height: 48px; padding: 8px 18px; border-bottom: 1px solid var(--border); }
    .selbar.on { background: var(--accent-soft); }
    .selbar .grow { flex: 1; }
    .sel { font-size: 0.86rem; color: var(--text-soft); }
    .sel b { color: var(--text); }
    .stats { display: flex; flex-wrap: wrap; gap: 4px 20px; margin: 0; font-size: 0.84rem; color: var(--text-muted); }
    .stats b { color: var(--text); font-weight: 700; }
    .stats .ok b { color: var(--success); } .stats .bad b { color: var(--danger); } .stats .warn b { color: var(--warning); }
    .data-table td, .data-table th { padding-left: 12px; padding-right: 12px; }
    .data-table td.validation { white-space: normal; }
    .cell-title { min-width: 200px; }
    .min0 { min-width: 0; }
    .cell-title .truncate { display: block; max-width: 210px; }
    .title-link { color: inherit; }
    .title-link:hover strong { color: var(--accent); }
    .two { display: flex; flex-direction: column; gap: 1px; white-space: nowrap; }
    .two small, .cell-title small { color: var(--text-muted); font-size: 0.76rem; }
    .dash { font-weight: 500; }
    .soon { color: var(--warning); font-weight: 600; margin-left: 4px; }
    .validation { min-width: 220px; max-width: 360px; }
    .validation .badge + .badge { margin-left: 4px; }
    .issues { margin: 6px 0 0; padding: 0; list-style: none; font-size: 0.76rem; line-height: 1.4; }
    .issues li + li { margin-top: 2px; }
    .err { color: var(--danger-text); } .wrn { color: var(--warning-text); }
    .row-actions { display: inline-flex; align-items: center; justify-content: flex-end; gap: 6px; }
    .menu { position: fixed; z-index: 60; min-width: 180px; padding: 5px; border: 1px solid var(--border-strong); border-radius: var(--radius); background: var(--surface-2); box-shadow: var(--shadow); text-align: left; }
    .menu a, .menu button { display: flex; align-items: center; gap: 9px; width: 100%; padding: 7px 10px; border: 0; border-radius: var(--radius-sm); background: none; color: var(--text-soft); font-size: 0.84rem; font-weight: 600; text-decoration: none; }
    .menu a:hover, .menu button:hover { background: var(--surface-3); color: var(--text); }
    .menu app-icon { width: 15px; height: 15px; color: var(--text-muted); }
    .menu .danger, .menu .danger app-icon { color: var(--danger); }
    @media (max-width: 1180px) { .col-price { display: none; } }

    /* Narrower than the table needs: each draft becomes a card, with its actions in reach. */
    @media (max-width: 1180px) {
      .data-table, .data-table tbody, .data-table tr, .data-table td { display: block; }
      .data-table thead, .data-table td.col-price { display: none; }
      .data-table tr { display: grid; grid-template-columns: 28px minmax(0, 1fr) auto; column-gap: 12px; row-gap: 4px; padding: 14px 16px; border-bottom: 1px solid var(--border-soft); }
      .data-table td { padding: 0; border: 0; white-space: normal; }
      .data-table td.check-col { grid-column: 1; grid-row: 1 / span 4; padding-top: 4px; width: auto; }
      .data-table td:nth-child(2) { grid-column: 2; grid-row: 1; }
      .data-table td:nth-child(3) { grid-column: 2; grid-row: 2; }
      .data-table td:nth-child(4) { grid-column: 2; grid-row: 3; }
      .data-table td.validation { grid-column: 2 / 4; grid-row: 4; min-width: 0; max-width: none; }
      .data-table td.actions-col { grid-column: 3; grid-row: 1 / span 3; align-self: start; width: auto; }
      .data-table td:nth-child(3) .two { flex-direction: row; align-items: baseline; gap: 8px; }
      .cell-title { min-width: 0; }
      .cell-title .truncate { max-width: none; }
    }

    .list-title { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .review-list { margin: 0; padding: 0; list-style: none; border: 1px solid var(--border); border-radius: var(--radius); max-height: 260px; overflow-y: auto; }
    .review-list li { display: grid; grid-template-columns: 150px minmax(0, 1fr); gap: 2px 12px; padding: 8px 12px; border-bottom: 1px solid var(--border-soft); font-size: 0.84rem; }
    .review-list li:last-child { border-bottom: 0; }
    .review-list .when { color: var(--text-muted); white-space: nowrap; }
    .review-list .err, .review-list .wrn { grid-column: 2; }
    @media (max-width: 760px) { .review-list li { grid-template-columns: minmax(0, 1fr); } .review-list .err, .review-list .wrn { grid-column: 1; } }
  `,
})
export class DraftsPanelComponent {
  protected readonly store = inject(AdminStore);
  protected readonly actions = inject(ShowActions);
  private readonly toast = inject(ToastService);

  protected readonly query = signal('');
  protected readonly theatreId = signal('');
  protected readonly readiness = signal<'all' | 'ready' | 'blocked'>('all');
  protected readonly menuFor = signal<string | null>(null);
  protected readonly menuPos = signal<{ top: number | null; bottom: number | null; right: number }>({ top: 0, bottom: null, right: 0 });
  protected readonly reviewOpen = signal(false);
  protected readonly selection = selectionState();

  constructor() {
    effect(() => {
      const scoped = this.store.scopedTheatres();
      untracked(() => {
        const only = scoped.length === 1 ? scoped[0]!.id : '';
        if (only || !scoped.some((t) => t.id === this.theatreId())) this.theatreId.set(only);
      });
    });
  }

  /** Every draft in scope, validated. */
  protected readonly all = computed<DraftRow[]>(() => {
    const soonLimit = this.store.now().getTime() + 2 * DAY;
    return this.store.scopedShows()
      .filter((s) => s.publication === 'draft' && !s.cancellation)
      .sort((a, b) => a.start.getTime() - b.start.getTime())
      .map((show) => {
        const issues = this.actions.issues(show);
        const errors = errorsOf(issues);
        return {
          show, errors, warnings: warningsOf(issues), ready: !errors.length,
          movie: this.store.movie(show.movieId), theatre: this.store.theatre(show.theatreId), screen: this.store.screen(show.screenId),
          end: this.store.showEnd(show), soon: show.start.getTime() < soonLimit,
        };
      });
  });

  protected readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    const t = this.theatreId();
    const r = this.readiness();
    return this.all().filter((d) =>
      (!t || d.show.theatreId === t) &&
      (r === 'all' || (r === 'ready') === d.ready) &&
      (!q || [d.movie?.title, d.screen?.name, d.theatre?.name].some((x) => x?.toLowerCase().includes(q))));
  });

  protected readonly table = tableState(this.filtered, {
    film: (r) => r.movie?.title,
    screen: (r) => `${r.theatre?.name} ${r.screen?.number}`,
    start: (r) => r.show.start,
    price: (r) => minPrice(r.show.prices),
    ready: (r) => (r.ready ? 1 : 0),
  }, 'start', 'asc', 25);

  protected readonly pageIds = computed(() => this.table.rows().map((r) => r.show.id));

  protected readonly stats = computed(() => {
    const list = this.filtered();
    const ready = list.filter((d) => d.ready).length;
    return { total: list.length, ready, blocked: list.length - ready, soon: list.filter((d) => d.soon).length };
  });

  /** The selected drafts that still exist, split by whether they can be published. */
  protected readonly review = computed(() => {
    const picked = this.all().filter((d) => this.selection.has(d.show.id));
    return { ready: picked.filter((d) => d.ready), blocked: picked.filter((d) => !d.ready) };
  });

  protected toggleMenu(id: string, event: Event): void {
    event.stopPropagation();
    if (this.menuFor() === id) { this.menuFor.set(null); return; }
    const r = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const right = Math.max(8, window.innerWidth - r.right);
    this.menuPos.set(r.bottom + 130 > window.innerHeight ? { top: null, bottom: window.innerHeight - r.top + 4, right } : { top: r.bottom + 4, bottom: null, right });
    this.menuFor.set(id);
  }

  @HostListener('document:click')
  @HostListener('window:resize')
  @HostListener('document:keydown.escape')
  closeMenu(): void { this.menuFor.set(null); }

  protected selectReady(): void {
    this.selection.setAll(this.filtered().filter((d) => d.ready).map((d) => d.show.id), true);
  }

  protected publishSelected(): void {
    const ids = this.review().ready.map((d) => d.show.id);
    const blocked = this.review().blocked.length;
    const result = this.store.publishShows(ids);
    this.reviewOpen.set(false);
    this.selection.setAll(result.published, false);
    if (result.published.length) {
      const n = result.published.length;
      this.toast.success(`${n} ${n === 1 ? 'show' : 'shows'} published`, 'They are now on sale to customers.');
    }
    if (result.failed.length || blocked) {
      const first = result.failed[0];
      const notPublished = result.failed.length + blocked;
      this.toast.error(`${notPublished} ${notPublished === 1 ? 'draft was' : 'drafts were'} not published`,
        first ? `${this.label(first.id)}: ${first.issues[0]?.message ?? ''}` : 'Fix their errors and publish again.');
    }
  }

  protected async publishOne(show: Show): Promise<void> {
    if (await this.actions.publish(show)) this.selection.toggle(show.id, false);
  }

  protected async remove(show: Show): Promise<void> {
    if (await this.actions.deleteDraft(show)) this.selection.toggle(show.id, false);
  }

  private label(id: string): string {
    const s = this.store.show(id);
    return s ? this.store.showLabel(s) : id;
  }

  protected day(d: Date): string { return formatDay(d); }
  protected time(d: Date): string { return formatTime(d); }
  protected price(s: Show): string { return priceRange(s.prices); }
}
