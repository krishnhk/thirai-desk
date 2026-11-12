import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { AdminStore } from '../../core/admin-store';
import { IconComponent } from '../../shared/icon.component';
import { PageHeaderComponent } from '../../shared/ui';
import { ActivityLogComponent } from './activity-log.component';
import { PerformanceReportComponent } from './performance.component';

/** Reports: performance for a date range, and the full activity log (`?tab=activity`). */
@Component({
  selector: 'app-reports-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, PageHeaderComponent, IconComponent, PerformanceReportComponent, ActivityLogComponent],
  template: `
    <div class="page">
      <app-page-header title="Reports" />

      <nav class="tabs" aria-label="Report">
        <a class="tab" routerLink="/reports" [class.active]="active() === 'performance'" [attr.aria-current]="active() === 'performance' ? 'page' : null"><app-icon name="reports" />Performance</a>
        <a class="tab" routerLink="/reports" [queryParams]="{ tab: 'activity' }" [class.active]="active() === 'activity'" [attr.aria-current]="active() === 'activity' ? 'page' : null"><app-icon name="activity" />Activity log <span class="count-pill">{{ store.scopedAudit().length }}</span></a>
      </nav>

      @if (active() === 'activity') { <app-activity-log /> } @else { <app-performance-report /> }
    </div>
  `,
  styles: `.tab app-icon { width: 16px; height: 16px; }`,
})
export class ReportsPage {
  protected readonly store = inject(AdminStore);
  readonly tab = input<string>();
  readonly active = computed(() => (this.tab() === 'activity' ? 'activity' : 'performance'));
}
