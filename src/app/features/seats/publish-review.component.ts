import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';

import { AdminStore } from '../../core/admin-store';
import { formatDay, formatTime } from '../../core/format';
import { layoutStats, sellableSeatIds } from '../../core/layout';
import { Issue, Screen, SeatLayout } from '../../core/models';
import { IconComponent } from '../../shared/icon.component';
import { ModalComponent } from '../../shared/modal.component';
import { upcomingShows } from '../screens/screen-info';

interface CompareRow { label: string; before: number | null; after: number; color?: string; }

/**
 * The review step before publishing: blocking errors (publishing is disabled until they are
 * fixed), a before/after comparison, warnings, and the effect on upcoming shows and bookings.
 */
@Component({
  selector: 'app-publish-review',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ModalComponent, IconComponent],
  template: `
    <app-modal size="lg" [title]="errors().length ? 'Fix the layout before publishing' : 'Publish version ' + nextVersion()" [eyebrow]="screen().name + ' · ' + theatreName()" (closed)="closed.emit()">
      <div class="stack">
        @if (errors().length) {
          <div class="callout danger"><app-icon name="alert" /><span><strong>{{ errors().length }} {{ errors().length === 1 ? 'problem blocks' : 'problems block' }} publishing.</strong> Select one to find it in the grid.</span></div>
          <ul class="issues">
            @for (i of errors(); track $index) {
              <li><button type="button" class="issue" (click)="focus.emit(i)"><app-icon name="alert" /><span>{{ i.message }}</span><app-icon name="chevronRight" /></button></li>
            }
          </ul>
        } @else {
          <p class="soft">Customers book from the published layout. {{ screen().layout ? 'Publishing replaces version ' + screen().layout!.version : 'This is the first published layout for this screen' }}{{ screen().draftLayout ? ' and clears the saved draft' : '' }}.</p>
          <div class="table-wrap cmp">
            <table class="data-table">
              <thead><tr><th>Seats</th><th class="num">{{ screen().layout ? 'Now (v' + screen().layout!.version + ')' : 'Now' }}</th><th class="num">After (v{{ nextVersion() }})</th><th class="num">Change</th></tr></thead>
              <tbody>
                @for (r of compare(); track r.label) {
                  <tr>
                    <td>@if (r.color) { <span class="sw" [style.background]="r.color"></span> }{{ r.label }}</td>
                    <td class="num">{{ r.before ?? '—' }}</td>
                    <td class="num strong">{{ r.after }}</td>
                    <td class="num" [class.up]="r.after > (r.before ?? 0)" [class.down]="r.after < (r.before ?? 0)">{{ delta(r) }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>

          @if (impact().shows) {
            <div class="callout {{ impact().missing.length ? 'danger' : 'info' }}">
              <app-icon [name]="impact().missing.length ? 'alert' : 'info'" />
              <div>
                <strong>{{ impact().shows }} upcoming published shows</strong> on this screen will sell from the new layout{{ impact().first ? ', starting ' + impact().first : '' }}.
                @if (impact().missing.length) {
                  <p class="gap">{{ impact().missing.length }} booked seats do not exist in the new layout ({{ impact().missing.slice(0, 8).join(', ') }}{{ impact().missing.length > 8 ? '…' : '' }}). Contact those customers or keep those seats before publishing.</p>
                }
                @if (impact().unpriced.length) {
                  <p class="gap">{{ impact().unpriced.join(', ') }} {{ impact().unpriced.length === 1 ? 'has' : 'have' }} no ticket price on those shows yet. Edit the shows to price {{ impact().unpriced.length === 1 ? 'it' : 'them' }}.</p>
                }
              </div>
            </div>
          }

          @if (warnings().length) {
            <div class="callout warning">
              <app-icon name="alert" />
              <div><strong>Worth a look (does not block publishing)</strong><ul class="warn-list">@for (w of warnings(); track $index) { <li>{{ w.message }}</li> }</ul></div>
            </div>
          }
        }
      </div>
      <ng-container footer>
        <button class="btn" type="button" (click)="closed.emit()">{{ errors().length ? 'Back to designer' : 'Cancel' }}</button>
        @if (!errors().length) {
          <button class="btn primary" type="button" (click)="publish.emit()"><app-icon name="upload" />Publish version {{ nextVersion() }}</button>
        }
      </ng-container>
    </app-modal>
  `,
  styles: `
    .issues { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; }
    .issue { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface-2); color: var(--text); text-align: left; font-size: 0.85rem; }
    .issue:hover { border-color: var(--danger); }
    .issue span { flex: 1; }
    .issue app-icon:first-child { color: var(--danger); width: 16px; height: 16px; }
    .issue app-icon:last-child { color: var(--text-muted); width: 14px; height: 14px; }
    .cmp { border: 1px solid var(--border); border-radius: var(--radius); }
    .sw { display: inline-block; width: 10px; height: 10px; margin-right: 8px; border-radius: 3px; }
    .up { color: var(--success); } .down { color: var(--warning); }
    .gap { margin-top: 6px; }
    .warn-list { margin: 4px 0 0; padding-left: 18px; }
  `,
})
export class PublishReviewComponent {
  private readonly store = inject(AdminStore);

  readonly screen = input.required<Screen>();
  readonly layout = input.required<SeatLayout>();
  readonly issues = input.required<Issue[]>();
  readonly closed = output<void>();
  readonly publish = output<void>();
  readonly focus = output<Issue>();

  readonly errors = computed(() => this.issues().filter((i) => i.level === 'error'));
  readonly warnings = computed(() => this.issues().filter((i) => i.level === 'warning'));
  readonly nextVersion = computed(() => (this.screen().layout?.version ?? 0) + 1);
  readonly theatreName = computed(() => this.store.theatre(this.screen().theatreId)?.name ?? '');

  readonly compare = computed<CompareRow[]>(() => {
    const old = this.screen().layout;
    const b = layoutStats(old);
    const a = layoutStats(this.layout());
    const rows: CompareRow[] = [
      { label: 'Bookable seats', before: old ? b.sellable : null, after: a.sellable },
      { label: 'Configured seats', before: old ? b.physical : null, after: a.physical },
    ];
    for (const c of this.layout().categories) rows.push({ label: c.name, before: old ? b.byCategory[c.id] ?? 0 : null, after: a.byCategory[c.id] ?? 0, color: c.color });
    for (const c of old?.categories ?? []) {
      if (!this.layout().categories.some((x) => x.id === c.id)) rows.push({ label: `${c.name} (removed)`, before: b.byCategory[c.id] ?? 0, after: 0, color: c.color });
    }
    rows.push(
      { label: 'Couple pairs', before: old ? b.couplePairs : null, after: a.couplePairs },
      { label: 'Wheelchair spaces', before: old ? b.wheelchair : null, after: a.wheelchair },
      { label: 'Blocked seats', before: old ? b.blocked : null, after: a.blocked },
    );
    return rows;
  });

  /** What publishing does to shows already on sale: seats that vanish and categories without a price. */
  readonly impact = computed(() => {
    const shows = upcomingShows(this.store, this.screen().id).filter((s) => s.publication === 'published' && !s.cancellation);
    const seats = new Set(sellableSeatIds(this.layout()));
    const missing = new Set<string>();
    const unpriced = new Set<string>();
    for (const s of shows) {
      for (const b of this.store.confirmedBookingsOf(s.id)) for (const id of b.seats) if (!seats.has(id)) missing.add(id);
      for (const c of this.layout().categories) if (!(s.prices[c.id]! > 0)) unpriced.add(c.name);
    }
    const first = shows[0];
    return { shows: shows.length, first: first ? `${formatDay(first.start)} ${formatTime(first.start)}` : '', missing: [...missing].sort(), unpriced: [...unpriced] };
  });

  delta(r: CompareRow): string {
    const d = r.after - (r.before ?? 0);
    return r.before == null || d === 0 ? '—' : d > 0 ? `+${d}` : String(d);
  }
}
