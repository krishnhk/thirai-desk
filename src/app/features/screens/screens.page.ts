import { ChangeDetectionStrategy, Component, HostListener, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { ALL_THEATRES, AdminStore } from '../../core/admin-store';
import { formatNumber, formatRelative } from '../../core/format';
import { layoutStats } from '../../core/layout';
import { Screen, SCREEN_TYPES } from '../../core/models';
import { ConfirmService, ToastService } from '../../shared/feedback';
import { IconComponent } from '../../shared/icon.component';
import { tableState } from '../../shared/table';
import { EmptyStateComponent, PageHeaderComponent, PaginatorComponent, SkeletonComponent, SortHeaderComponent } from '../../shared/ui';
import { ScreenDeleteComponent } from './screen-delete.component';
import { ScreenFormComponent } from './screen-form.component';
import { configuredSeats, layoutState, LayoutState, toggleScreenStatus } from './screen-info';

interface ScreenRow {
  screen: Screen;
  theatre: string;
  capacity: number;
  configured: number;
  layout: LayoutState;
  upcoming: number;
  schedulable: boolean;
  updated: Date | null;
  updatedBy: string;
}

/** Every auditorium in scope: capacity, layout version, status, and the screen operations. */
@Component({
  selector: 'app-screens-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent, PageHeaderComponent, EmptyStateComponent, SkeletonComponent,
    PaginatorComponent, SortHeaderComponent, ScreenFormComponent, ScreenDeleteComponent],
  template: `
    <div class="page">
      @if (!embedded()) {
        <app-page-header title="Screens" [subtitle]="subtitle()" [crumbs]="[{ label: 'Operations' }, { label: 'Screens' }]">
          <button class="btn primary" type="button" (click)="formFor.set('new')"><app-icon name="plus" />New screen</button>
        </app-page-header>
      }

      @if (needsLayout().length) {
        <div class="callout warning attn" role="status">
          <app-icon name="alert" />
          <span>
            @if (needsLayout().length === 1) { <strong>{{ needsLayout()[0]!.screen.name }} cannot take shows yet.</strong> {{ needsLayout()[0]!.screen.draftLayout ? 'Its seat layout is still a draft.' : 'It has no published seat layout.' }} }
            @else { <strong>{{ needsLayout().length }} screens cannot take shows yet.</strong> They have no published seat layout. }
          </span>
          @if (needsLayout().length === 1) {
            <a class="btn sm" [routerLink]="['/seats', needsLayout()[0]!.screen.id]">{{ needsLayout()[0]!.screen.draftLayout ? 'Review draft' : 'Design layout' }}</a>
          } @else {
            <button class="btn sm" type="button" (click)="layoutFilter.set(layoutFilter() === 'none' ? '' : 'none')">{{ layoutFilter() === 'none' ? 'Show all' : 'Show them' }}</button>
          }
        </div>
      }

      <div class="head-row">
        <p class="stats" aria-label="Summary">
          <span><b>{{ kpis().total }}</b> {{ kpis().total === 1 ? 'screen' : 'screens' }}</span>
          <span><b>{{ kpis().active }}</b> active</span>
          <span><b>{{ kpis().schedulable }}</b> ready to schedule</span>
          <span><b>{{ formatNumber(kpis().capacity) }}</b> bookable seats</span>
        </p>
        @if (embedded()) { <button class="btn primary" type="button" (click)="formFor.set('new')"><app-icon name="plus" />New screen</button> }
      </div>

      <section class="card">
        @if (rows().length > 6) {
        <div class="filters">
          <div class="field grow">
            <label for="sc-q">Search</label>
            <div class="search-input"><app-icon name="search" /><input id="sc-q" class="input" type="search" placeholder="Screen or theatre name" [value]="q()" (input)="q.set($any($event.target).value)" /></div>
          </div>
          <div class="field narrow">
            <label for="sc-type">Type</label>
            <select id="sc-type" class="select" [value]="type()" (change)="type.set($any($event.target).value)">
              <option value="">All types</option>
              @for (t of types; track t) { <option [value]="t">{{ t }}</option> }
            </select>
          </div>
          <div class="field narrow">
            <label for="sc-status">Status</label>
            <select id="sc-status" class="select" [value]="status()" (change)="status.set($any($event.target).value)">
              <option value="">Any status</option><option value="active">Active</option><option value="inactive">Inactive</option>
            </select>
          </div>
          <div class="field narrow">
            <label for="sc-layout">Layout</label>
            <select id="sc-layout" class="select" [value]="layoutFilter()" (change)="layoutFilter.set($any($event.target).value)">
              <option value="">Any layout</option><option value="published">Published</option><option value="draft">Draft in progress</option><option value="none">No published layout</option>
            </select>
          </div>
          @if (filtered().length !== rows().length) {
            <button class="btn ghost sm" type="button" (click)="clearFilters()">Clear filters</button>
          }
        </div>
        }

        @if (store.loading()) {
          <app-skeleton [rows]="6" />
        } @else if (!table.total()) {
          @if (rows().length) {
            <app-empty-state icon="search" title="No screens match these filters" text="Change the search or filters to see more screens.">
              <button class="btn" type="button" (click)="clearFilters()">Clear filters</button>
            </app-empty-state>
          } @else {
            <app-empty-state icon="screen" title="No screens yet" text="Add the theatre's auditoriums, then design and publish their seat layouts.">
              <button class="btn primary" type="button" (click)="formFor.set('new')"><app-icon name="plus" />New screen</button>
            </app-empty-state>
          }
        } @else {
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th><app-sort-header [active]="table.isSorted('name')" [dir]="table.dir()" (toggle)="table.sortBy('name')">Screen</app-sort-header></th>
                  @if (allTheatres()) { <th class="col-theatre"><app-sort-header [active]="table.isSorted('theatre')" [dir]="table.dir()" (toggle)="table.sortBy('theatre')">Theatre</app-sort-header></th> }
                  <th><app-sort-header [active]="table.isSorted('type')" [dir]="table.dir()" (toggle)="table.sortBy('type')">Type</app-sort-header></th>
                  <th class="num"><app-sort-header [active]="table.isSorted('capacity')" [dir]="table.dir()" (toggle)="table.sortBy('capacity')">Seats</app-sort-header></th>
                  <th><app-sort-header [active]="table.isSorted('layout')" [dir]="table.dir()" (toggle)="table.sortBy('layout')">Layout</app-sort-header></th>
                  <th class="num col-upcoming"><app-sort-header [active]="table.isSorted('upcoming')" [dir]="table.dir()" (toggle)="table.sortBy('upcoming')">Upcoming</app-sort-header></th>
                  <th><app-sort-header [active]="table.isSorted('status')" [dir]="table.dir()" (toggle)="table.sortBy('status')">Status</app-sort-header></th>
                  <th class="actions-col" aria-label="Actions"></th>
                </tr>
              </thead>
              <tbody>
                @for (r of table.rows(); track r.screen.id) {
                  <tr class="clickable" (click)="open(r.screen, $event)">
                    <td>
                      <div class="cell-title">
                        <span class="num-chip" aria-hidden="true">{{ r.screen.number }}</span>
                        <span><a [routerLink]="['/screens', r.screen.id]"><strong>{{ r.screen.name }}</strong></a><small class="sub-proj">{{ r.screen.projection }}</small>@if (allTheatres()) { <small class="sub-theatre">{{ r.theatre }}</small> }</span>
                      </div>
                    </td>
                    @if (allTheatres()) { <td class="col-theatre"><span class="soft">{{ r.theatre }}</span></td> }
                    <td><span class="tag">{{ r.screen.type }}</span></td>
                    <td class="num">@if (r.capacity) { {{ formatNumber(r.capacity) }} } @else { <span class="muted">—</span> }</td>
                    <td>
                      <div class="layout-cell">
                        @switch (r.layout) {
                          @case ('none') { <span class="badge neutral">No layout</span> }
                          @case ('draft') { <span class="row"><span class="badge info">Draft only</span><span class="muted small">{{ formatNumber(r.configured) }} seats</span></span> }
                          @case ('published-draft') { <span class="row"><span class="tag">v{{ r.screen.layout!.version }}</span><span class="badge info">Draft on top</span></span> }
                          @default { <span class="tag">v{{ r.screen.layout!.version }}</span> }
                        }
                        @if (r.updated) { <small class="muted edited">{{ relative(r.updated) }} · {{ r.updatedBy }}</small> }
                      </div>
                    </td>
                    <td class="num col-upcoming">{{ r.upcoming }}</td>
                    <td>
                      @if (r.screen.status !== 'active') { <span class="badge neutral">Inactive</span> }
                      @else if (r.schedulable) { <span class="badge success">Ready</span> }
                      @else { <span class="badge warning" title="Cannot be scheduled: no published layout or inactive theatre">Needs layout</span> }
                    </td>
                    <td class="actions-col">
                      <div class="row-actions">
                        <div class="menu-wrap">
                          <button class="btn ghost sm icon" type="button" [attr.aria-label]="'More actions for ' + r.screen.name" [attr.aria-expanded]="menuFor() === r.screen.id" (click)="toggleMenu(r.screen.id, $event)"><app-icon name="more" /></button>
                          @if (menuFor() === r.screen.id) {
                            <div class="menu" role="menu" [style.top.px]="menuPos().top" [style.bottom.px]="menuPos().bottom" [style.right.px]="menuPos().right">
                              <button role="menuitem" type="button" (click)="menuFor.set(null); formFor.set(r.screen)"><app-icon name="edit" />Edit details…</button>
                              <button role="menuitem" type="button" (click)="toggleStatus(r.screen)"><app-icon [name]="r.screen.status === 'active' ? 'lock' : 'check'" />{{ r.screen.status === 'active' ? 'Deactivate' : 'Activate' }}</button>
                              <button role="menuitem" type="button" class="danger" (click)="menuFor.set(null); deleting.set(r.screen)"><app-icon name="trash" />Delete…</button>
                            </div>
                          }
                        </div>
                      </div>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          @if (table.total() > table.size()) { <app-paginator [(page)]="table.page" [(pageSize)]="table.size" [total]="table.total()" /> }
        }
      </section>
    </div>

    @if (formFor(); as f) {
      <app-screen-form [screen]="f === 'new' ? null : f" (closed)="formFor.set(null)" (saved)="afterSave($event, f === 'new')" />
    }
    @if (deleting(); as d) {
      <app-screen-delete [screen]="d" (closed)="deleting.set(null)" (deleted)="deleting.set(null)" />
    }
  `,
  styles: `
    :host { display: block; }
    .head-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px; }
    .attn { align-items: center; }
    .attn .btn { margin-left: auto; flex-shrink: 0; }
    .stats { display: flex; flex-wrap: wrap; gap: 4px 22px; margin: 0; padding: 0 4px; font-size: 0.86rem; color: var(--text-muted); }
    .stats b { color: var(--text); font-weight: 700; }
    .num-chip { display: grid; place-items: center; width: 28px; height: 28px; flex-shrink: 0; border-radius: var(--radius-sm); background: var(--surface-3); color: var(--text-soft); font-size: 0.78rem; font-weight: 700; }
    .cell-title a { color: inherit; white-space: nowrap; }
    .sub-theatre { display: none !important; }
    .filters .field.narrow { min-width: 130px; }
    td { white-space: nowrap; }
    .cell-title a:hover strong { color: var(--accent); }
    .layout-cell { display: flex; flex-direction: column; align-items: flex-start; gap: 3px; }
    .edited { font-size: 0.74rem; }
    .row-actions { display: inline-flex; align-items: center; gap: 6px; }
    .menu-wrap { position: relative; }
    .menu { position: fixed; z-index: 60; min-width: 210px; padding: 5px; border: 1px solid var(--border-strong); border-radius: var(--radius); background: var(--surface-2); box-shadow: var(--shadow); text-align: left; }
    .menu a, .menu button { display: flex; align-items: center; gap: 9px; width: 100%; padding: 7px 10px; border: 0; border-radius: var(--radius-sm); background: none; color: var(--text-soft); font-size: 0.84rem; font-weight: 600; text-decoration: none; }
    .menu a:hover, .menu button:hover { background: var(--surface-3); color: var(--text); }
    .menu app-icon { width: 15px; height: 15px; color: var(--text-muted); }
    .menu .danger, .menu .danger app-icon { color: var(--danger); }
    @media (max-width: 1100px) {
      .col-upcoming, .col-theatre { display: none; }
      .sub-proj { display: none !important; }
      .sub-theatre { display: block !important; }
      .data-table th, .data-table td { padding-left: 9px; padding-right: 9px; }
    }
  `,
})
export class ScreensPage {
  /** Shown inside the Theatre page: no page header, and only that theatre's screens. */
  readonly embedded = input(false);
  readonly theatreId = input('');

  readonly store = inject(AdminStore);
  private readonly router = inject(Router);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);

  readonly types = SCREEN_TYPES;
  readonly formatNumber = formatNumber;

  readonly q = signal('');
  readonly type = signal('');
  readonly status = signal('');
  readonly layoutFilter = signal('');
  readonly formFor = signal<Screen | 'new' | null>(null);
  readonly deleting = signal<Screen | null>(null);
  readonly menuFor = signal<string | null>(null);

  readonly allTheatres = computed(() => this.store.selectedTheatreId() === ALL_THEATRES);
  readonly subtitle = computed(() => {
    const t = this.store.theatre(this.store.selectedTheatreId());
    return t ? `Auditoriums at ${t.name}` : `Auditoriums across ${this.store.scopedTheatres().length} theatres`;
  });

  /** Upcoming (not yet finished, not cancelled) shows per screen. */
  private readonly upcomingByScreen = computed(() => {
    const now = this.store.now();
    const map = new Map<string, number>();
    for (const s of this.store.shows()) {
      if (s.cancellation || this.store.showEnd(s) <= now) continue;
      map.set(s.screenId, (map.get(s.screenId) ?? 0) + 1);
    }
    return map;
  });

  readonly rows = computed<ScreenRow[]>(() => {
    const upcoming = this.upcomingByScreen();
    const only = this.theatreId();
    return this.store.scopedScreens().filter((s) => !only || s.theatreId === only).map((screen) => ({
      updated: (screen.draftLayout ?? screen.layout)?.updatedAt ?? null,
      updatedBy: (screen.draftLayout ?? screen.layout)?.updatedBy ?? '',
      screen,
      theatre: this.store.theatre(screen.theatreId)?.name ?? '',
      capacity: layoutStats(screen.layout).sellable,
      configured: configuredSeats(screen),
      layout: layoutState(screen),
      upcoming: upcoming.get(screen.id) ?? 0,
      schedulable: this.store.isSchedulable(screen),
    }));
  });

  readonly filtered = computed(() => {
    const q = this.q().trim().toLowerCase();
    const type = this.type();
    const status = this.status();
    const lf = this.layoutFilter();
    return this.rows().filter((r) => {
      if (q && !r.screen.name.toLowerCase().includes(q) && !r.theatre.toLowerCase().includes(q)) return false;
      if (type && r.screen.type !== type) return false;
      if (status && r.screen.status !== status) return false;
      if (lf === 'published' && !r.screen.layout) return false;
      if (lf === 'draft' && !r.screen.draftLayout) return false;
      if (lf === 'none' && r.screen.layout) return false;
      return true;
    });
  });

  readonly table = tableState(this.filtered, {
    name: (r) => `${r.theatre} ${String(r.screen.number).padStart(2, '0')}`,
    theatre: (r) => r.theatre,
    type: (r) => r.screen.type,
    capacity: (r) => r.capacity,
    configured: (r) => r.configured,
    layout: (r) => r.screen.layout?.version ?? -1,
    upcoming: (r) => r.upcoming,
    status: (r) => r.screen.status,
  }, 'name');

  relative(d: Date): string { return formatRelative(d, this.store.now()); }

  /** Screens that cannot take shows because no layout is published. */
  readonly needsLayout = computed(() => this.rows().filter((r) => !r.screen.layout));

  readonly kpis = computed(() => {
    const rows = this.rows();
    return {
      total: rows.length,
      active: rows.filter((r) => r.screen.status === 'active').length,
      schedulable: rows.filter((r) => r.schedulable).length,
      capacity: rows.reduce((n, r) => n + r.capacity, 0),
      noLayout: rows.filter((r) => !r.screen.layout).length,
    };
  });

  constructor() {
    // Back to the first page whenever the filters or scope change.
    effect(() => {
      this.q(); this.type(); this.status(); this.layoutFilter(); this.store.selectedTheatreId();
      untracked(() => this.table.reset());
    });
  }

  @HostListener('document:click', ['$event'])
  onDocClick(event: MouseEvent): void {
    if (!(event.target as HTMLElement).closest('.menu-wrap')) this.menuFor.set(null);
  }

  @HostListener('window:scroll')
  @HostListener('window:resize')
  onViewportChange(): void { this.menuFor.set(null); }

  @HostListener('document:keydown.escape')
  onEscape(): void { this.menuFor.set(null); }

  /** The menu floats over the page (fixed), so the table's scroll area never clips it. */
  readonly menuPos = signal<{ top: number | null; bottom: number | null; right: number }>({ top: 0, bottom: null, right: 0 });

  toggleMenu(id: string, event: Event): void {
    if (this.menuFor() === id) { this.menuFor.set(null); return; }
    const r = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const right = Math.max(8, window.innerWidth - r.right);
    this.menuPos.set(r.bottom + 170 > window.innerHeight ? { top: null, bottom: window.innerHeight - r.top + 4, right } : { top: r.bottom + 4, bottom: null, right });
    this.menuFor.set(id);
  }

  open(screen: Screen, event: MouseEvent): void {
    if ((event.target as HTMLElement).closest('a, button, .menu')) return;
    void this.router.navigate(['/screens', screen.id]);
  }

  clearFilters(): void {
    this.q.set(''); this.type.set(''); this.status.set(''); this.layoutFilter.set('');
  }

  toggleStatus(screen: Screen): void {
    this.menuFor.set(null);
    void toggleScreenStatus(this.store, this.confirm, this.toast, screen);
  }

  afterSave(screen: Screen, created: boolean): void {
    this.formFor.set(null);
    if (created) void this.router.navigate(['/screens', screen.id]);
  }
}
