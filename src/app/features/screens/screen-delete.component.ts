import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { AdminStore } from '../../core/admin-store';
import { formatDay, formatNumber, formatTime } from '../../core/format';
import { layoutStats } from '../../core/layout';
import { Screen } from '../../core/models';
import { ToastService } from '../../shared/feedback';
import { IconComponent } from '../../shared/icon.component';
import { ModalComponent } from '../../shared/modal.component';
import { StatusBadgeComponent } from '../../shared/ui';
import { layoutLabel } from './screen-info';

/**
 * The screen deletion workflow: what the screen holds, what depends on it, and a typed
 * confirmation. Deletion is blocked while upcoming published shows remain on the screen.
 */
@Component({
  selector: 'app-screen-delete',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ModalComponent, RouterLink, IconComponent, StatusBadgeComponent],
  template: `
    <app-modal size="lg" [title]="'Delete ' + screen().name" [eyebrow]="theatreName()" (closed)="closed.emit()">
      <div class="stack">
        <div class="grid-2">
          <section class="panel">
            <h3 class="eyebrow">Screen</h3>
            <dl class="facts">
              <dt>Name</dt><dd>{{ screen().name }} (screen {{ screen().number }})</dd>
              <dt>Theatre</dt><dd>{{ theatreName() }}</dd>
              <dt>Type</dt><dd>{{ screen().type }}</dd>
              <dt>Status</dt><dd><app-status-badge [status]="screen().status" /></dd>
            </dl>
          </section>
          <section class="panel">
            <h3 class="eyebrow">Seat configuration</h3>
            <dl class="facts">
              <dt>Layout</dt><dd>{{ layoutText() }}</dd>
              <dt>Bookable seats</dt><dd>{{ stats().sellable }}</dd>
              <dt>Categories</dt><dd>{{ categoryText() || '—' }}</dd>
              @if (screen().draftLayout) { <dt>Draft</dt><dd>Unpublished draft will be lost</dd> }
            </dl>
          </section>
        </div>

        <section>
          <div class="row sec-head">
            <h3>Upcoming published shows</h3>
            <span class="count-pill">{{ deps().upcomingPublished.length }}</span>
            <span class="spacer"></span>
            @if (deps().activeBookings) { <span class="small soft">{{ formatNumber(deps().activeBookings) }} active bookings</span> }
          </div>
          @if (deps().upcomingPublished.length) {
            <div class="table-wrap dep-list">
              <table class="data-table">
                <thead><tr><th>Show</th><th>When</th><th class="num">Sold</th><th class="actions-col">Resolve</th></tr></thead>
                <tbody>
                  @for (s of deps().upcomingPublished; track s.id) {
                    <tr>
                      <td><a [routerLink]="['/shows', s.id]">{{ store.movie(s.movieId)?.title }}</a>&ngsp;<span class="muted small">{{ s.format }} · {{ s.language }}</span></td>
                      <td class="nowrap">{{ day(s.start) }}, {{ time(s.start) }}@if (store.showStatus(s) === 'running') { &ngsp;<app-status-badge status="running" /> }</td>
                      <td class="num">{{ store.soldSeats(s.id) }}</td>
                      <td class="actions-col">
                        <div class="resolve">
                          <a class="btn sm" [routerLink]="['/shows', s.id, 'edit']">Reassign</a>
                          <a class="btn sm danger-ghost" [routerLink]="['/shows', s.id, 'cancel']">Cancel show</a>
                        </div>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          } @else {
            <p class="small muted">No upcoming published shows.</p>
          }
        </section>

        @if (deps().upcomingDrafts.length) {
          <div class="callout warning"><app-icon name="alert" /><span><strong>{{ deps().upcomingDrafts.length }} draft shows</strong> on this screen will be deleted with it. Drafts are not on sale and have no bookings.</span></div>
        }

        @if (!deps().canDelete) {
          <div class="callout danger">
            <app-icon name="lock" />
            <span><strong>This screen cannot be deleted yet.</strong> Cancel each upcoming published show (customers are refunded) or reassign it to another screen, then delete the screen.</span>
          </div>
        } @else {
          <div class="callout info"><app-icon name="info" /><span>Past shows, bookings and refunds stay in reports and the activity log. This cannot be undone.</span></div>
          <div class="field confirm">
            <label for="del-confirm">Type <strong class="mono">{{ screen().name }}</strong> to confirm</label>
            <input id="del-confirm" class="input" autocomplete="off" [value]="typed()" (input)="typed.set($any($event.target).value)" />
          </div>
        }
      </div>
      <ng-container footer>
        <button class="btn" type="button" (click)="closed.emit()">{{ deps().canDelete ? 'Cancel' : 'Close' }}</button>
        <button class="btn danger" type="button" [disabled]="!deps().canDelete || typed().trim() !== screen().name" (click)="remove()"><app-icon name="trash" />Delete screen</button>
      </ng-container>
    </app-modal>
  `,
  styles: `
    h3.eyebrow { margin-bottom: 10px; }
    .sec-head { margin-bottom: 8px; }
    .dep-list { max-height: 260px; overflow-y: auto; border: 1px solid var(--border); border-radius: var(--radius); }
    .resolve { display: flex; gap: 6px; justify-content: flex-end; }
    .confirm { max-width: 360px; }
  `,
})
export class ScreenDeleteComponent {
  readonly store = inject(AdminStore);
  private readonly toast = inject(ToastService);

  readonly screen = input.required<Screen>();
  readonly closed = output<void>();
  readonly deleted = output<void>();

  readonly typed = signal('');
  readonly formatNumber = formatNumber;
  readonly day = formatDay;
  readonly time = formatTime;

  readonly deps = computed(() => this.store.screenDependencies(this.screen().id));
  readonly theatreName = computed(() => this.store.theatre(this.screen().theatreId)?.name ?? '');
  readonly stats = computed(() => layoutStats(this.screen().layout));
  readonly layoutText = computed(() => {
    const s = this.screen();
    return s.layout ? `Version ${s.layout.version}, ${s.layout.rows} rows × ${s.layout.cols} columns` : layoutLabel(s);
  });
  readonly categoryText = computed(() => (this.screen().layout?.categories ?? []).map((c) => c.name).join(', '));

  remove(): void {
    const s = this.screen();
    const drafts = this.deps().upcomingDrafts.length;
    if (!this.store.deleteScreen(s.id)) {
      this.toast.error('Screen not deleted', 'It still has upcoming published shows. Cancel or reassign them first.');
      return;
    }
    this.toast.success('Screen deleted', `${s.name} · ${this.theatreName()}${drafts ? ` and ${drafts} draft shows` : ''}`);
    this.deleted.emit();
  }
}
