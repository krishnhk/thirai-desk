import { ChangeDetectionStrategy, Component, computed, input, model, output } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';

import { IconComponent } from './icon.component';

/** Splits "/shows?tab=drafts" into the path and query params routerLink expects. */
export function linkPath(link: string): string {
  return link.split('?')[0]!;
}
export function linkQuery(link: string, extra?: Record<string, string> | null): Record<string, string> | null {
  const q = link.split('?')[1];
  const parsed = q ? Object.fromEntries(new URLSearchParams(q).entries()) : null;
  return parsed || extra ? { ...(parsed ?? {}), ...(extra ?? {}) } : null;
}

export interface Crumb {
  label: string;
  link?: string;
}

/** Page title with breadcrumbs, an optional description and actions on the right (projected). */
@Component({
  selector: 'app-page-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent],
  template: `
    <header class="page-header">
      <div class="titles">
        @if (crumbs().length) {
          <nav class="crumbs" aria-label="Breadcrumb">
            @for (c of crumbs(); track c.label; let last = $last) {
              @if (c.link && !last) { <a [routerLink]="path(c.link)" [queryParams]="params(c.link)">{{ c.label }}</a> } @else { <span [attr.aria-current]="last ? 'page' : null">{{ c.label }}</span> }
              @if (!last) { <app-icon name="chevronRight" /> }
            }
          </nav>
        }
        <h1>{{ title() }}</h1>
        @if (subtitle()) { <p class="subtitle">{{ subtitle() }}</p> }
      </div>
      <div class="actions"><ng-content /></div>
    </header>
  `,
  styles: `
    .page-header { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 12px 20px; }
    .titles { min-width: 0; }
    .crumbs { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-bottom: 6px; font-size: 0.78rem; color: var(--text-muted); }
    .crumbs a { color: var(--text-muted); }
    .crumbs a:hover { color: var(--text); }
    .crumbs app-icon { width: 12px; height: 12px; color: var(--text-faint); }
    .crumbs span[aria-current] { color: var(--text-soft); }
    .subtitle { margin-top: 4px; color: var(--text-muted); font-size: 0.88rem; }
    .actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .actions:empty { display: none; }
  `,
})
export class PageHeaderComponent {
  readonly title = input.required<string>();
  readonly subtitle = input('');
  readonly crumbs = input<Crumb[]>([]);
  readonly path = linkPath;
  readonly params = (link: string) => linkQuery(link);
}

/** A compact KPI: label, value and an optional hint or trend line. Link makes the whole card clickable. */
@Component({
  selector: 'app-kpi-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent, NgTemplateOutlet],
  template: `
    @if (link()) {
      <a class="kpi" [routerLink]="path()" [queryParams]="params()"><ng-container *ngTemplateOutlet="body" /></a>
    } @else {
      <div class="kpi"><ng-container *ngTemplateOutlet="body" /></div>
    }
    <ng-template #body>
      <span class="label">@if (icon()) { <app-icon [name]="icon()" /> }{{ label() }}</span>
      <span class="value tone-{{ tone() }}">{{ value() }}</span>
      @if (hint()) { <span class="hint">{{ hint() }}</span> }
    </ng-template>
  `,
  styles: `
    :host { display: block; min-width: 0; }
    .kpi { display: flex; flex-direction: column; gap: 4px; height: 100%; padding: 14px 16px; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); color: inherit; text-decoration: none; }
    a.kpi:hover { border-color: var(--border-strong); background: var(--surface-hover); }
    .label { display: flex; align-items: center; gap: 7px; font-size: 0.76rem; font-weight: 600; color: var(--text-muted); }
    .label app-icon { width: 15px; height: 15px; }
    .value { font-size: 1.55rem; font-weight: 700; letter-spacing: -0.02em; line-height: 1.2; }
    .tone-accent { color: var(--accent); } .tone-success { color: var(--success); } .tone-warning { color: var(--warning); }
    .tone-danger { color: var(--danger); } .tone-violet { color: var(--violet); } .tone-info { color: var(--info); }
    .hint { font-size: 0.76rem; color: var(--text-muted); }
  `,
})
export class KpiCardComponent {
  readonly label = input.required<string>();
  readonly value = input.required<string | number>();
  readonly hint = input('');
  readonly icon = input('');
  readonly tone = input<'default' | 'accent' | 'success' | 'warning' | 'danger' | 'violet' | 'info'>('default');
  readonly link = input<string | null>(null);
  readonly query = input<Record<string, string> | null>(null);
  readonly path = computed(() => linkPath(this.link() ?? ''));
  readonly params = computed(() => linkQuery(this.link() ?? '', this.query()));
}

/** One badge vocabulary for every status in the app. */
const STATUS_TONES: Record<string, { tone: string; label: string }> = {
  // publication
  draft: { tone: 'violet', label: 'Draft' },
  published: { tone: 'success', label: 'Published' },
  // show life
  scheduled: { tone: 'info', label: 'Scheduled' },
  running: { tone: 'accent', label: 'Running' },
  completed: { tone: 'neutral', label: 'Completed' },
  cancelled: { tone: 'danger', label: 'Cancelled' },
  // refunds
  pending: { tone: 'warning', label: 'Pending' },
  approved: { tone: 'info', label: 'Approved' },
  processing: { tone: 'accent', label: 'Processing' },
  successful: { tone: 'success', label: 'Successful' },
  failed: { tone: 'danger', label: 'Failed' },
  rejected: { tone: 'neutral', label: 'Rejected' },
  // records
  active: { tone: 'success', label: 'Active' },
  inactive: { tone: 'neutral', label: 'Inactive' },
  confirmed: { tone: 'success', label: 'Confirmed' },
  'no-layout': { tone: 'warning', label: 'No layout' },
};

export function statusTone(status: string): string {
  return STATUS_TONES[status]?.tone ?? 'neutral';
}

@Component({
  selector: 'app-status-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="badge {{ info().tone }}">{{ label() || info().label }}</span>`,
})
export class StatusBadgeComponent {
  readonly status = input.required<string>();
  /** Overrides the default label, such as "Processing (retry 2)". */
  readonly label = input('');
  readonly info = computed(() => STATUS_TONES[this.status()] ?? { tone: 'neutral', label: this.status() });
}

/** A friendly empty state with an icon, a line of explanation and an optional action (projected). */
@Component({
  selector: 'app-empty-state',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <div class="empty">
      <span class="mark"><app-icon [name]="icon()" /></span>
      <strong>{{ title() }}</strong>
      @if (text()) { <p>{{ text() }}</p> }
      <div class="act"><ng-content /></div>
    </div>
  `,
  styles: `
    .empty { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 44px 20px; text-align: center; }
    .mark { display: grid; place-items: center; width: 48px; height: 48px; margin-bottom: 6px; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface-2); color: var(--text-muted); }
    .mark app-icon { width: 22px; height: 22px; }
    p { max-width: 46ch; color: var(--text-muted); font-size: 0.86rem; }
    .act { margin-top: 10px; display: flex; gap: 8px; }
    .act:empty { display: none; }
  `,
})
export class EmptyStateComponent {
  readonly icon = input('info');
  readonly title = input.required<string>();
  readonly text = input('');
}

/** Placeholder rows while data loads. */
@Component({
  selector: 'app-skeleton',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="sk" aria-busy="true" aria-label="Loading">
      @for (r of rowsArray(); track $index) { <div class="skeleton line" [style.width.%]="90 - ($index % 3) * 15"></div> }
    </div>
  `,
  styles: `.sk { display: flex; flex-direction: column; gap: 12px; padding: 18px; } .line { height: 14px; }`,
})
export class SkeletonComponent {
  readonly rows = input(5);
  readonly rowsArray = computed(() => Array.from({ length: this.rows() }));
}

/** Page navigation under a table. */
@Component({
  selector: 'app-paginator',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <div class="pager">
      <span class="muted small">
        @if (total()) { {{ from() }}–{{ to() }} of {{ total() }} } @else { No results }
      </span>
      <div class="row">
        <select class="select size" aria-label="Rows per page" [value]="pageSize()" (change)="setSize(+$any($event.target).value)">
          @for (s of sizes; track s) { <option [value]="s" [selected]="s === pageSize()">{{ s }} / page</option> }
        </select>
        <button class="btn sm icon" type="button" aria-label="Previous page" [disabled]="page() <= 1" (click)="page.set(page() - 1)"><app-icon name="chevronLeft" /></button>
        <span class="small soft">{{ page() }} / {{ pages() }}</span>
        <button class="btn sm icon" type="button" aria-label="Next page" [disabled]="page() >= pages()" (click)="page.set(page() + 1)"><app-icon name="chevronRight" /></button>
      </div>
    </div>
  `,
  styles: `
    .pager { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 16px; border-top: 1px solid var(--border); }
    .size { width: auto; min-height: 28px; padding: 3px 8px; font-size: 0.8rem; }
  `,
})
export class PaginatorComponent {
  readonly page = model(1);
  readonly pageSize = model(10);
  readonly total = input.required<number>();
  readonly sizes = [10, 25, 50];
  readonly pages = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));
  readonly from = computed(() => (this.page() - 1) * this.pageSize() + 1);
  readonly to = computed(() => Math.min(this.total(), this.page() * this.pageSize()));

  setSize(size: number): void {
    this.pageSize.set(size);
    this.page.set(1);
  }
}

/** A thin occupancy bar with its percentage. */
@Component({
  selector: 'app-meter',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="meter" [attr.aria-label]="pct() + '% occupied'">
      <div class="meter-track"><div class="meter-fill" [class.high]="value() >= 0.75" [class.low]="value() < 0.25" [style.width.%]="pct()"></div></div>
      <span>{{ pct() }}%</span>
    </div>
  `,
})
export class MeterComponent {
  readonly value = input.required<number>();
  readonly pct = computed(() => Math.round(Math.min(1, Math.max(0, this.value())) * 100));
}

/** A sortable column header button. */
@Component({
  selector: 'app-sort-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" class="sort-btn" [class.active]="active()" (click)="toggle.emit()">
      <ng-content /><span class="arrow">{{ active() && dir() === 'desc' ? '▼' : '▲' }}</span>
    </button>
  `,
})
export class SortHeaderComponent {
  readonly active = input(false);
  readonly dir = input<'asc' | 'desc'>('asc');
  readonly toggle = output<void>();
}
