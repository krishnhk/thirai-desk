import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { AdminStore } from '../../core/admin-store';
import { formatDateTime, formatDay, formatMoney, formatRelative, formatTime } from '../../core/format';
import { Show } from '../../core/models';
import { IconComponent } from '../../shared/icon.component';
import { tableState } from '../../shared/table';
import { EmptyStateComponent, PaginatorComponent, SkeletonComponent, SortHeaderComponent } from '../../shared/ui';

interface CancelledRow {
  show: Show;
  film: string;
  screen: string;
  theatre: string;
  refundTotal: number;
  refunded: number;
  refundCount: number;
  failed: number;
}

/** Cancelled shows: why, who and when, and how far their refunds have got. */
@Component({
  selector: 'app-cancelled-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent, EmptyStateComponent, SkeletonComponent, PaginatorComponent, SortHeaderComponent],
  template: `
    <div class="bar">
      <div class="search-input grow">
        <app-icon name="search" />
        <input class="input" type="search" aria-label="Search cancelled shows" placeholder="Search film, screen or reason" [value]="query()" (input)="query.set($any($event.target).value)" />
      </div>
    </div>

    @if (store.loading()) {
      <app-skeleton [rows]="4" />
    } @else if (table.total()) {
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th><app-sort-header [active]="table.isSorted('film')" [dir]="table.dir()" (toggle)="table.sortBy('film')">Show</app-sort-header></th>
              <th><app-sort-header [active]="table.isSorted('start')" [dir]="table.dir()" (toggle)="table.sortBy('start')">Was scheduled</app-sort-header></th>
              <th>Reason</th>
              <th><app-sort-header [active]="table.isSorted('at')" [dir]="table.dir()" (toggle)="table.sortBy('at')">Cancelled</app-sort-header></th>
              <th><app-sort-header [active]="table.isSorted('refundTotal')" [dir]="table.dir()" (toggle)="table.sortBy('refundTotal')">Refunds</app-sort-header></th>
              <th><app-sort-header [active]="table.isSorted('progress')" [dir]="table.dir()" (toggle)="table.sortBy('progress')">Progress</app-sort-header></th>
              <th class="actions-col"><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            @for (row of table.rows(); track row.show.id) {
              @let c = row.show.cancellation!;
              <tr class="clickable" (click)="open($event, row.show.id)">
                <td><span class="two"><strong>{{ row.film }}</strong><small>{{ row.screen }}@if (multi()) { · {{ row.theatre }} }</small></span></td>
                <td><span class="two"><strong>{{ time(row.show.start) }}</strong><small>{{ day(row.show.start) }}</small></span></td>
                <td class="reason"><span class="two"><strong class="rs">{{ c.reason }}</strong>@if (c.notes) { <small class="truncate" [title]="c.notes">{{ c.notes }}</small> }</span></td>
                <td><span class="two"><strong>{{ c.by }}</strong><small [title]="dateTime(c.at)">{{ relative(c.at) }}</small></span></td>
                <td><span class="two"><strong>{{ money(row.refundTotal) }}</strong><small>{{ row.refundCount }} {{ row.refundCount === 1 ? 'refund' : 'refunds' }}</small></span></td>
                <td>
                  <span class="progress">
                    <span class="meter-track"><span class="meter-fill high" [style.width.%]="row.refundCount ? (row.refunded / row.refundCount) * 100 : 0"></span></span>
                    <span class="pt">{{ row.refunded }} of {{ row.refundCount }}</span>
                  </span>
                  @if (row.failed) { <small class="fail">{{ row.failed }} failed</small> }
                </td>
                <td class="actions-col">
                  @if (row.refundCount) { <a class="btn sm" routerLink="/refunds" [queryParams]="{ show: row.show.id }">Refunds</a> }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      @if (table.total() > table.size()) { <app-paginator [(page)]="table.page" [(pageSize)]="table.size" [total]="table.total()" /> }
    } @else {
      <app-empty-state icon="cancel" [title]="query() ? 'No cancelled shows match' : 'No shows have been cancelled'"
        text="Cancelled shows stay here as a record, with their reason and refund progress.">
        @if (query()) { <button type="button" class="btn" (click)="query.set('')">Clear search</button> }
      </app-empty-state>
    }
  `,
  styles: `
    :host { display: block; }
    .bar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 14px 16px; }
    .bar .grow { flex: 1 1 260px; min-width: 200px; }
    .bar .input { height: 36px; min-height: 36px; padding-top: 0; padding-bottom: 0; }
    .table-wrap { position: relative; border-top: 1px solid var(--border); }
    .data-table th, .data-table td { padding-left: 12px; padding-right: 12px; }
    .data-table td { white-space: nowrap; }
    .two { display: flex; flex-direction: column; gap: 1px; }
    .two small { color: var(--text-muted); font-size: 0.76rem; }
    .reason { white-space: normal; min-width: 170px; max-width: 260px; }
    .rs { font-weight: 600; }
    .fail { display: block; color: var(--danger); font-size: 0.76rem; }
    .progress { display: inline-flex; align-items: center; gap: 10px; }
    .progress .meter-track { display: block; flex: 0 0 64px; }
    .progress .meter-fill { display: block; }
    .pt { font-size: 0.8rem; color: var(--text-soft); white-space: nowrap; }
    @media (max-width: 1180px) {
      .data-table, .data-table tbody, .data-table tr, .data-table td { display: block; }
      .data-table thead { display: none; }
      .data-table tr { display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: 12px; row-gap: 4px; padding: 14px 16px; border-bottom: 1px solid var(--border-soft); }
      .data-table td { grid-column: 1; padding: 0; border: 0; white-space: normal; }
      .data-table td.actions-col { grid-column: 2; grid-row: 1 / span 2; align-self: start; justify-self: end; width: auto; }
      .reason { max-width: none; }
    }
  `,
})
export class CancelledPanelComponent {
  protected readonly store = inject(AdminStore);
  private readonly router = inject(Router);

  readonly query = signal('');
  readonly money = formatMoney;
  readonly day = formatDay;
  readonly time = formatTime;
  readonly dateTime = formatDateTime;
  readonly relative = (d: Date) => formatRelative(d, this.store.now());
  readonly multi = computed(() => this.store.scopedTheatres().length > 1);

  readonly rows = computed<CancelledRow[]>(() => {
    const q = this.query().trim().toLowerCase();
    return this.store.scopedShows()
      .filter((s) => !!s.cancellation)
      .map((s) => {
        const refunds = this.store.refundsOf(s.id).filter((r) => r.reason === 'Show cancelled' && r.status !== 'rejected');
        return {
          show: s,
          film: this.store.movie(s.movieId)?.title ?? 'Film',
          screen: this.store.screen(s.screenId)?.name ?? 'Screen',
          theatre: this.store.theatre(s.theatreId)?.name ?? '',
          refundTotal: refunds.reduce((n, r) => n + r.amount, 0),
          refunded: refunds.filter((r) => r.status === 'successful').length,
          refundCount: refunds.length,
          failed: refunds.filter((r) => r.status === 'failed').length,
        };
      })
      .filter((r) => !q || `${r.film} ${r.screen} ${r.show.cancellation!.reason}`.toLowerCase().includes(q));
  });

  readonly table = tableState(this.rows, {
    film: (r) => r.film, start: (r) => r.show.start, at: (r) => r.show.cancellation!.at,
    refundTotal: (r) => r.refundTotal, progress: (r) => (r.refundCount ? r.refunded / r.refundCount : 1),
  }, 'at', 'desc', 10);

  constructor() {
    effect(() => { this.query(); untracked(() => this.table.reset()); });
  }

  open(event: MouseEvent, showId: string): void {
    if ((event.target as HTMLElement).closest('a, button')) return;
    void this.router.navigate(['/shows', showId]);
  }
}
