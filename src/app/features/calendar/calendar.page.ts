import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { formatDay, formatTime } from '../../core/format';
import { IconComponent } from '../../shared/icon.component';
import { EmptyStateComponent, SkeletonComponent } from '../../shared/ui';
import { CalendarDayComponent } from './calendar-day.component';
import { CalendarMonthComponent } from './calendar-month.component';
import { CalendarWeekComponent } from './calendar-week.component';
import { CalView, CalendarState, KIND_LABELS } from './calendar.state';

/**
 * The Timeline tab of Shows: the schedule as a day time grid, a week of chips or a month overview, by screen
 * or grouped by theatre. Overlaps and cleaning-buffer clashes are outlined in red and listed below.
 */
@Component({
  selector: 'app-calendar-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [CalendarState],
  imports: [RouterLink, IconComponent, EmptyStateComponent, SkeletonComponent, CalendarDayComponent, CalendarWeekComponent, CalendarMonthComponent],
  template: `
    <div class="page">
      <section class="card">
        <div class="bar">
          <div class="nav" role="group" aria-label="Period">
            <button class="btn sm icon" type="button" [attr.aria-label]="'Previous ' + s.view()" (click)="s.shift(-1)"><app-icon name="chevronLeft" /></button>
            <button class="btn sm icon" type="button" [attr.aria-label]="'Next ' + s.view()" (click)="s.shift(1)"><app-icon name="chevronRight" /></button>
            <button class="btn sm" type="button" [disabled]="showsToday()" (click)="s.goToday()">Today</button>
            <h2 class="period">{{ s.periodLabel() }}</h2>
          </div>
          <span class="spacer"></span>
          <div class="tools">
            <select class="select sm" aria-label="Film" [value]="s.filmId()" (change)="s.setParams({ film: $any($event.target).value || null })">
              <option value="">All films</option>
              @for (m of s.films(); track m.id) { <option [value]="m.id">{{ m.title }}</option> }
            </select>
            @if (s.multiTheatre()) {
              <div class="segmented" role="group" aria-label="Group by">
                <button type="button" [attr.aria-pressed]="s.group() === 'screen'" (click)="s.setGroup('screen')">By screen</button>
                <button type="button" [attr.aria-pressed]="s.group() === 'theatre'" (click)="s.setGroup('theatre')">By theatre</button>
              </div>
            }
            @if (s.view() === 'day') {
              <div class="zoom" role="group" aria-label="Zoom">
                <button class="btn sm icon" type="button" aria-label="Zoom out" [disabled]="s.hourWidth() <= 56" (click)="zoom(-24)"><app-icon name="zoomOut" /></button>
                <button class="btn sm icon" type="button" aria-label="Zoom in" [disabled]="s.hourWidth() >= 208" (click)="zoom(24)"><app-icon name="zoomIn" /></button>
              </div>
            }
            <div class="segmented" role="group" aria-label="Calendar view">
              @for (v of views; track v.id) { <button type="button" [attr.aria-pressed]="s.view() === v.id" (click)="s.setView(v.id)">{{ v.label }}</button> }
            </div>
          </div>
        </div>

        @if (store.loading()) {
          <app-skeleton [rows]="8" />
        } @else if (!s.lanes().length) {
          <app-empty-state icon="screen" title="No screens to show" [text]="emptyText()" />
        } @else {
          @switch (s.view()) {
            @case ('day') { <app-calendar-day /> }
            @case ('week') { <app-calendar-week /> }
            @case ('month') { <app-calendar-month /> }
          }
        }

        <div class="legend">
          <span class="lg"><span class="sw k-published"></span>Published</span>
          <span class="lg"><span class="sw k-published run"></span>Running now</span>
          <span class="lg"><span class="sw k-draft"></span>Draft</span>
          <span class="lg"><span class="sw k-completed"></span>Completed</span>
          <span class="lg"><span class="sw k-cancelled"></span>Cancelled</span>
          <span class="lg"><span class="sw clash"></span>Conflict</span>
          @if (s.view() === 'day') {
            <span class="lg"><span class="sw buffer"></span>{{ store.settings().bufferMinutes }}-minute cleaning buffer</span>
            @if (s.isToday(s.date())) { <span class="lg"><span class="sw now"></span>Now</span> }
          }
          <span class="spacer"></span>
          @if (hiddenNote()) { <span class="lg muted">{{ hiddenNote() }}</span> }
          @if (pairs().length) {
            <a class="clash-pill" href="#conflicts" (click)="jump($event)"><app-icon name="alert" />{{ pairs().length }} {{ pairs().length === 1 ? 'conflict' : 'conflicts' }}</a>
          } @else if (!store.loading()) {
            <span class="ok-pill"><app-icon name="check" />No conflicts</span>
          }
        </div>
      </section>

      @if (pairs().length) {
        <section class="card" id="conflicts">
          <div class="card-head">
            <h2>Scheduling conflicts</h2>
            <span class="muted small">Shows on the same screen within {{ store.settings().bufferMinutes }} minutes of each other. Move or cancel one of each pair.</span>
          </div>
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>Problem</th><th>Screen</th><th>First show</th><th>Second show</th><th class="actions-col"></th></tr></thead>
              <tbody>
                @for (p of pairs(); track p.first.show.id + p.second.show.id) {
                  <tr>
                    <td><span class="badge danger">{{ p.kind === 'overlap' ? 'Overlap' : 'Buffer too short' }}</span></td>
                    <td><strong>{{ p.first.screen.name }}</strong><div class="tiny muted">{{ store.theatre(p.first.show.theatreId)?.name }}</div></td>
                    @for (c of [p.first, p.second]; track c.show.id) {
                      <td>
                        <a [routerLink]="['/shows', c.show.id]">{{ c.title }}</a>
                        <div class="tiny muted">{{ day(c.start) }} · {{ time(c.start) }} – {{ time(c.end) }} · {{ kindLabels[c.kind] }}</div>
                      </td>
                    }
                    <td class="actions-col"><button class="btn sm" type="button" (click)="s.openDay(p.second.start)">View day</button></td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>
      }
    </div>
  `,
  styles: `
    :host { display: block; }
    .bar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 14px; padding: 12px 16px; border-bottom: 1px solid var(--border); }
    .nav { display: flex; align-items: center; gap: 6px; min-width: 0; }
    .period { margin-left: 6px; font-size: 1rem; white-space: nowrap; }
    .spacer { flex: 1; }
    .tools { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 10px; }
    .zoom { display: inline-flex; gap: 4px; }
    .filters-bar { padding-top: 10px; padding-bottom: 10px; }
    .kinds { display: flex; flex-wrap: wrap; gap: 6px; }
    .kind { display: inline-flex; align-items: center; gap: 7px; min-height: 36px; padding: 3px 12px; border: 1px solid var(--border); border-radius: 999px; background: none; color: var(--text-muted); font-size: 0.8rem; font-weight: 600; }
    .kind:hover { color: var(--text); border-color: var(--border-strong); }
    .kind[aria-pressed='true'] { background: var(--surface-3); border-color: var(--border-strong); color: var(--text); }
    .kind[aria-pressed='false'] .sw { opacity: 0.35; }
    .kind .n { min-width: 18px; padding: 0 5px; border-radius: 999px; background: var(--surface-2); color: var(--text-soft); font-size: 0.7rem; line-height: 17px; text-align: center; }
    .select.sm { width: auto; min-width: 150px; max-width: 220px; min-height: 36px; padding-top: 4px; padding-bottom: 4px; font-size: 0.84rem; }
    .bar .btn.sm { min-height: 36px; }
    .bar .btn.sm.icon { width: 36px; }
    .clash-pill, .ok-pill { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; font-size: 0.78rem; font-weight: 700; white-space: nowrap; }
    .clash-pill { background: var(--danger-soft); color: var(--danger); }
    .clash-pill:hover { color: var(--danger); text-decoration: underline; }
    .ok-pill { color: var(--text-muted); font-weight: 600; }
    .clash-pill app-icon, .ok-pill app-icon { width: 15px; height: 15px; }
    .ok-pill app-icon { color: var(--success); }

    .legend { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 18px; padding: 10px 16px; border-top: 1px solid var(--border); font-size: 0.76rem; color: var(--text-soft); }
    .lg { display: inline-flex; align-items: center; gap: 7px; }
    .sw { display: inline-block; width: 18px; height: 12px; flex: none; border: 1px solid var(--border-strong); border-left-width: 3px; border-radius: 3px; background: var(--surface-3); }
    .sw.k-published { border-left-color: var(--success); }
    .sw.k-published.run { border-left-color: var(--accent); }
    .sw.k-draft { background: var(--violet-soft); border: 1px dashed var(--violet); border-left: 3px dashed var(--violet); }
    .sw.k-completed { background: var(--surface-2); border-color: var(--border); border-left-color: var(--text-faint); }
    .sw.k-cancelled { background: var(--danger-soft); border-color: var(--danger-line); border-left-color: var(--danger); }
    .sw.clash { box-shadow: 0 0 0 2px var(--danger); border-left-width: 1px; }
    .sw.buffer { border: 0; background: repeating-linear-gradient(135deg, rgba(139, 147, 161, 0.35) 0 3px, transparent 3px 7px); }
    .sw.now { width: 2px; height: 14px; border: 0; border-radius: 0; background: var(--accent); }

    #conflicts { scroll-margin-top: 80px; }
    .data-table td .badge { white-space: nowrap; }
    @media (max-width: 1100px) { .select.sm { min-width: 130px; } }
    @media (max-width: 640px) { .zoom { display: none; } .tools { justify-content: flex-start; width: 100%; } .nav { flex-wrap: wrap; } .period { white-space: normal; margin-left: 0; flex-basis: 100%; } }
  `,
})
export class CalendarViewComponent {
  readonly s = inject(CalendarState);
  readonly store = this.s.store;
  readonly kindLabels = KIND_LABELS;
  readonly views: { id: CalView; label: string }[] = [{ id: 'day', label: 'Day' }, { id: 'week', label: 'Week' }, { id: 'month', label: 'Month' }];

  readonly pairs = this.s.conflictPairs;

  /** True when today is already inside the period on screen. */
  readonly showsToday = computed(() => this.s.view() === 'day' ? this.s.isToday(this.s.date()) : this.s.days().some((d) => this.s.isToday(d) && (this.s.view() === 'week' || d.getMonth() === this.s.date().getMonth())));

  readonly hiddenNote = computed(() => {
    const hidden = this.s.hiddenTheatres();
    if (!hidden.length) return '';
    return hidden.length === 1 ? `${hidden[0]!.name} is inactive and not shown.` : `${hidden.length} inactive theatres are not shown.`;
  });

  readonly emptyText = computed(() => this.s.hiddenTheatres().length
    ? `${this.s.hiddenTheatres()[0]!.name} is inactive. Choose another theatre in the header to see its schedule.`
    : 'No screen has a published seat layout yet. Publish one from Screens.');

  zoom(delta: number): void {
    this.s.hourWidth.update((w) => Math.min(208, Math.max(56, w + delta)));
  }

  jump(event: Event): void {
    event.preventDefault();
    document.getElementById('conflicts')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  day(d: Date): string { return formatDay(d); }
  time(d: Date): string { return formatTime(d); }
}
