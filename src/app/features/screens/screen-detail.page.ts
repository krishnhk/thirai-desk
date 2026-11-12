import { ChangeDetectionStrategy, Component, HostListener, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { AdminStore } from '../../core/admin-store';
import { formatDateTime, formatMoney, formatNumber, formatRelative } from '../../core/format';
import { layoutStats } from '../../core/layout';
import { Screen } from '../../core/models';
import { ConfirmService, ToastService } from '../../shared/feedback';
import { IconComponent } from '../../shared/icon.component';
import { SeatMapComponent } from '../../shared/seat-map.component';
import { EmptyStateComponent, PageHeaderComponent, SkeletonComponent } from '../../shared/ui';
import { ScreenDeleteComponent } from './screen-delete.component';
import { ScreenFormComponent } from './screen-form.component';
import { scheduleBlockers, toggleScreenStatus } from './screen-info';

/** One auditorium: its published seat map, details, seat categories and readiness to schedule. */
@Component({
  selector: 'app-screen-detail-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent, PageHeaderComponent, EmptyStateComponent, SkeletonComponent,
    SeatMapComponent, ScreenFormComponent, ScreenDeleteComponent],
  template: `
    @if (screen(); as s) {
      <div class="page">
        <app-page-header [title]="s.name" [subtitle]="subtitleLine()"
          [crumbs]="[{ label: 'Theatre', link: '/theatre' }, { label: 'Screens', link: '/theatre?tab=screens' }, { label: s.name }]">
          @if (store.isSchedulable(s)) { <span class="badge success state">Ready to schedule</span> }
          @else if (s.status !== 'active') { <span class="badge neutral state">Inactive</span> }
          @else { <span class="badge warning state">Needs a layout</span> }
          <a class="btn primary" [routerLink]="['/seats', s.id]"><app-icon name="seats" />{{ s.layout || s.draftLayout ? 'Edit seat layout' : 'Design seat layout' }}</a>
          <button class="btn" type="button" (click)="editing.set(true)"><app-icon name="edit" />Edit details</button>
          <div class="menu-wrap">
            <button class="btn icon" type="button" aria-label="More actions" [attr.aria-expanded]="menuOpen()" (click)="menuOpen.set(!menuOpen())"><app-icon name="more" /></button>
            @if (menuOpen()) {
              <div class="menu" role="menu">
                <button role="menuitem" type="button" (click)="menuOpen.set(false); toggleStatus(s)"><app-icon [name]="s.status === 'active' ? 'lock' : 'check'" />{{ s.status === 'active' ? 'Deactivate' : 'Activate' }}</button>
                <button role="menuitem" type="button" class="danger" (click)="menuOpen.set(false); deleting.set(true)"><app-icon name="trash" />Delete…</button>
              </div>
            }
          </div>
        </app-page-header>

        @if (blockers().length) {
          <div class="callout warning">
            <app-icon name="alert" />
            <div class="grow">
              <strong>{{ s.name }} cannot be scheduled.</strong>
              <ul class="reasons">@for (b of blockers(); track b) { <li>{{ b }}</li> }</ul>
            </div>
            @if (!s.layout) { <a class="btn sm" [routerLink]="['/seats', s.id]">{{ s.draftLayout ? 'Review draft' : 'Design layout' }}</a> }
          </div>
        }
        @if (s.layout && s.draftLayout) {
          <div class="callout info">
            <app-icon name="info" />
            <span class="grow">A draft layout ({{ draftStats().sellable }} bookable seats) was saved by {{ s.draftLayout.updatedBy }} {{ relative(s.draftLayout.updatedAt) }}. Customers book from version {{ s.layout.version }} until it is published.</span>
            <a class="btn sm" [routerLink]="['/seats', s.id]">Open draft</a>
          </div>
        }

        <div class="split">
          <section class="card map-card">
            <div class="card-head">
              <h2>Seat map</h2>
              <span class="stats">
                <span><b>{{ formatNumber(stats().sellable) }}</b> bookable</span>
                <span><b>{{ stats().blocked }}</b> blocked</span>
                <span><b>{{ stats().couplePairs }}</b> couple pairs</span>
                <span><b>{{ stats().wheelchair }}</b> wheelchair</span>
              </span>
            </div>
            <div class="card-body map-body">
              @if (store.loading()) {
                <app-skeleton [rows]="8" />
              } @else if (s.layout) {
                <app-seat-map [layout]="s.layout" [cellSize]="mapCell()" [legend]="false" />
              } @else {
                <app-empty-state icon="seats" title="No published layout" [text]="s.draftLayout ? 'A draft is in progress. Review and publish it so this screen can be scheduled.' : 'Design the seating plan and publish it so this screen can be scheduled.'">
                  <a class="btn primary" [routerLink]="['/seats', s.id]">{{ s.draftLayout ? 'Open draft' : 'Design layout' }}</a>
                </app-empty-state>
              }
            </div>
            @if (s.layout) {
              <table class="data-table cats">
                <thead><tr><th>Category</th><th class="num">Seats</th><th class="num">Base price</th></tr></thead>
                <tbody>
                  @for (c of s.layout.categories; track c.id) {
                    <tr>
                      <td><span class="cat"><span class="sw" [style.background]="c.color"></span><span>{{ c.name }}@if (c.rule) { <small>{{ c.rule }}</small> }</span></span></td>
                      <td class="num">{{ stats().byCategory[c.id] ?? 0 }}</td>
                      <td class="num money">{{ money(c.basePrice) }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            }
          </section>

          <div class="stack">
            <section class="card">
              <div class="card-head"><h2>Details</h2></div>
              <div class="card-body">
                <dl class="facts">
                  <dt>Theatre</dt><dd><a routerLink="/theatre">{{ theatreName() }}</a></dd>
                  <dt>Screen number</dt><dd>{{ s.number }}</dd>
                  <dt>Type</dt><dd>{{ s.type }}</dd>
                  <dt>Sound</dt><dd>{{ s.sound || '—' }}</dd>
                  <dt>Projection</dt><dd>{{ s.projection || '—' }}</dd>
                  <dt>Status</dt><dd>{{ s.status === 'active' ? 'Active' : 'Inactive' }}</dd>
                </dl>
              </div>
            </section>
            <section class="card grow">
              <div class="card-head"><h2>Seat layout</h2></div>
              <div class="card-body">
                <dl class="facts">
                  <dt>Published</dt><dd>@if (s.layout) { Version {{ s.layout.version }} } @else { <span class="muted">None</span> }</dd>
                  @if (s.layout) {
                    <dt>Size</dt><dd>{{ s.layout.rows }} rows × {{ s.layout.cols }} columns</dd>
                    <dt>Numbering</dt><dd>{{ s.layout.numbering === 'left-to-right' ? 'Left to right' : 'Right to left' }}</dd>
                    <dt>Published on</dt><dd>{{ dateTime(s.layout.updatedAt) }}<span class="by">by {{ s.layout.updatedBy }}</span></dd>
                  }
                  <dt>Draft</dt><dd>@if (s.draftLayout) { {{ draftStats().sellable }} seats · saved {{ relative(s.draftLayout.updatedAt) }} } @else { <span class="muted">None</span> }</dd>
                  <dt>Last updated</dt><dd>{{ dateTime(s.updatedAt) }}</dd>
                </dl>
              </div>
            </section>
          </div>
        </div>
      </div>

      @if (editing()) { <app-screen-form [screen]="s" (closed)="editing.set(false)" (saved)="editing.set(false)" /> }
      @if (deleting()) { <app-screen-delete [screen]="s" (closed)="deleting.set(false)" (deleted)="afterDelete()" /> }
    } @else {
      <div class="page">
        <app-page-header title="Screen not found" [crumbs]="[{ label: 'Screens', link: '/screens' }, { label: 'Not found' }]" />
        <section class="card">
          <app-empty-state icon="screen" title="This screen does not exist" text="It may have been deleted. Pick a screen from the list.">
            <a class="btn" routerLink="/screens">All screens</a>
          </app-empty-state>
        </section>
      </div>
    }
  `,
  styles: `
    .split { display: grid; grid-template-columns: minmax(0, 1.7fr) minmax(280px, 1fr); gap: 16px; align-items: stretch; }
    .stack { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
    .stack .grow { flex: 1; }
    .map-card { display: flex; flex-direction: column; }
    .map-body { flex: 1; display: grid; align-content: center; justify-items: center; overflow-x: auto; }
    .stats { display: flex; flex-wrap: wrap; gap: 2px 16px; font-size: 0.8rem; color: var(--text-muted); }
    .stats b { color: var(--text); }
    .cats { border-top: 1px solid var(--border); }
    .state { margin-right: 4px; }
    /* One label column for both fact lists, so their values line up. */
    .facts { grid-template-columns: 7.5rem minmax(0, 1fr); }
    .menu-wrap { position: relative; }
    .menu { position: absolute; right: 0; top: calc(100% + 4px); z-index: 20; min-width: 170px; padding: 5px; border: 1px solid var(--border-strong); border-radius: var(--radius); background: var(--surface-2); box-shadow: var(--shadow); }
    .menu button { display: flex; align-items: center; gap: 9px; width: 100%; padding: 7px 10px; border: 0; border-radius: var(--radius-sm); background: none; color: var(--text-soft); font-size: 0.84rem; font-weight: 600; text-align: left; }
    .menu button:hover { background: var(--surface-3); color: var(--text); }
    .menu app-icon { width: 15px; height: 15px; color: var(--text-muted); }
    .menu .danger, .menu .danger app-icon { color: var(--danger); }
    .grow { flex: 1; min-width: 0; }
    .callout { align-items: center; }
    .reasons { margin: 2px 0 0; padding-left: 18px; }
    .by { display: block; font-weight: 400; font-size: 0.78rem; color: var(--text-muted); }
    .cat { display: inline-flex; align-items: center; gap: 9px; }
    .cat small { display: block; color: var(--text-muted); font-size: 0.74rem; }
    .sw { width: 12px; height: 12px; border-radius: 3px; flex-shrink: 0; }
    @media (max-width: 1200px) { .split { grid-template-columns: minmax(0, 1fr); } }
  `,
})
export class ScreenDetailPage {
  readonly store = inject(AdminStore);
  private readonly router = inject(Router);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);

  readonly screenId = input.required<string>();

  readonly editing = signal(false);
  readonly deleting = signal(false);
  readonly formatNumber = formatNumber;
  readonly money = (n: number) => formatMoney(n);
  readonly dateTime = formatDateTime;

  readonly screen = computed(() => this.store.screen(this.screenId()) ?? null);
  readonly theatreName = computed(() => this.store.theatre(this.screen()?.theatreId ?? '')?.name ?? '');
  readonly stats = computed(() => layoutStats(this.screen()?.layout ?? null));
  readonly draftStats = computed(() => layoutStats(this.screen()?.draftLayout ?? null));
  readonly blockers = computed(() => { const s = this.screen(); return s ? scheduleBlockers(this.store, s) : []; });
  /** Wide layouts get smaller seats so the map fits its card. */
  readonly mapCell = computed(() => { const c = this.screen()?.layout?.cols ?? 0; return c > 30 ? 14 : c > 22 ? 17 : 21; });
  readonly subtitleLine = computed(() => { const s = this.screen(); return s ? [s.type, s.projection, this.theatreName()].filter(Boolean).join(' · ') : ''; });
  readonly menuOpen = signal(false);

  @HostListener('document:click', ['$event'])
  onDocClick(event: MouseEvent): void {
    if (!(event.target as HTMLElement).closest('.menu-wrap')) this.menuOpen.set(false);
  }


  relative(d: Date): string { return formatRelative(d, this.store.now()); }

  toggleStatus(s: Screen): void {
    void toggleScreenStatus(this.store, this.confirm, this.toast, s);
  }

  afterDelete(): void {
    this.deleting.set(false);
    void this.router.navigate(['/screens']);
  }
}
