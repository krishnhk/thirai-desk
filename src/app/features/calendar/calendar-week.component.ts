import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { formatTime, sameDay, toDateInput } from '../../core/format';
import { IconComponent } from '../../shared/icon.component';
import { CalShow, CalendarState, ScreenLane } from './calendar.state';

interface DayCol { date: Date; key: string; weekday: string; num: number; month: string; label: string; total: number; drafts: number; cancelled: number; clashes: number; today: boolean; selected: boolean; }

/** The week view: seven day columns, one row per screen, compact chips per show. */
@Component({
  selector: 'app-calendar-week',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent],
  template: `
    <div class="scroll" #scroller [class.scrolled]="scrolled()" (scroll)="scrolled.set(scroller.scrollLeft > 2)">
      <div class="grid">
        <div class="cell corner">Screen</div>
        @for (d of cols(); track d.key) {
          <button type="button" class="cell day" [class.today]="d.today" [class.sel]="d.selected" (click)="state.openDay(d.date)" [attr.aria-label]="'Open ' + d.label + ' in the day view'">
            <span class="dhead"><span class="dnum">{{ d.num }}</span><span class="dwk">{{ d.weekday }}<small>{{ d.month }}</small></span></span>
            <span class="counts">
              <span class="n">{{ d.total }} {{ d.total === 1 ? 'show' : 'shows' }}</span>
              @if (d.drafts) { <span class="c-draft">{{ d.drafts }} draft</span> }
              @if (d.cancelled) { <span class="c-cancel">{{ d.cancelled }} cancelled</span> }
              @if (d.clashes) { <span class="c-cancel">{{ d.clashes }} in conflict</span> }
            </span>
          </button>
        }

        @for (g of state.groups(); track g.theatre.id) {
          @if (state.group() === 'theatre') {
            <div class="cell glabel"><strong class="truncate">{{ g.theatre.name }}</strong><span class="tiny muted">{{ g.lanes.length }} screens</span></div>
            @for (d of cols(); track d.key) { <div class="cell gsum">{{ groupCount(g.lanes, d.key) }} shows</div> }
          }
          @for (lane of g.lanes; track lane.screen.id) {
            <div class="cell label" [class.off]="!lane.schedulable">
              <span class="name truncate">{{ lane.screen.name }}</span>
              <span class="meta">
                @if (state.multiTheatre() && state.group() === 'screen') { <span class="nowrap">{{ lane.theatre.code }}</span> }
                <span class="tag">{{ lane.screen.type }}</span>
                @if (lane.note) { <span class="note">{{ lane.note }}</span> }
              </span>
            </div>
            @for (d of cols(); track d.key) {
              <div class="cell slot" [class.off]="!lane.schedulable" [class.sel]="d.selected">
                @for (c of shows(lane, d.key); track c.show.id) {
                  <a class="chip k-{{ c.kind }}" [class.running]="c.running" [class.clash]="c.conflicts.length" [routerLink]="['/shows', c.show.id]" [attr.title]="c.summary" [attr.aria-label]="c.summary">
                    @if (c.conflicts.length) { <app-icon name="alert" /> }
                    <span class="t">{{ time(c.start) }}</span><span class="f">{{ c.title }}</span>
                  </a>
                }
              </div>
            }
          }
        }
      </div>
    </div>
  `,
  styles: `
    :host { display: block; min-width: 0; }
    .scroll { overflow: auto; max-height: max(360px, calc(100vh - 330px)); }
    .grid { display: grid; grid-template-columns: 168px repeat(7, minmax(0, 1fr)); min-width: calc(176px + 7 * 130px); }
    .cell { min-width: 0; border-right: 1px solid var(--border-soft); border-bottom: 1px solid var(--border-soft); }
    .corner, .day { position: sticky; top: 0; z-index: 2; background: var(--surface-2); border-bottom-color: var(--border); }
    .corner { left: 0; z-index: 4; display: flex; align-items: center; padding: 0 14px; border-right-color: var(--border); font-size: 0.68rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted); }
    .day { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; border-top: 2px solid transparent; border-left: 0; text-align: left; color: var(--text-soft); }
    .day:hover { background: var(--surface-3); }
    .dhead { display: flex; align-items: center; gap: 8px; }
    .dnum { display: grid; place-items: center; min-width: 28px; height: 28px; padding: 0 4px; border-radius: 999px; font-size: 1rem; font-weight: 700; color: var(--text); }
    .dwk { display: flex; flex-direction: column; font-size: 0.74rem; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-muted); line-height: 1.2; }
    .dwk small { font-size: 0.68rem; font-weight: 500; letter-spacing: 0; text-transform: none; }
    .day.today .dnum { background: var(--accent); color: var(--on-accent); }
    .day.today { border-top-color: var(--accent); }
    .counts .n { color: var(--text-soft); font-weight: 600; }
    .counts { display: flex; flex-wrap: wrap; gap: 0 8px; font-size: 0.74rem; line-height: 1.45; color: var(--text-muted); }
    .c-draft { color: var(--violet); } .c-cancel { color: var(--danger); }
    .glabel, .gsum { background: var(--bg); border-bottom-color: var(--border); }
    .glabel { position: sticky; left: 0; z-index: 1; display: flex; flex-direction: column; justify-content: center; padding: 6px 14px; border-right-color: var(--border); font-size: 0.82rem; }
    .gsum { display: flex; align-items: center; padding: 6px 10px; font-size: 0.72rem; color: var(--text-muted); }
    .label { position: sticky; left: 0; z-index: 1; display: flex; flex-direction: column; justify-content: center; gap: 4px; padding: 10px 16px; background: var(--surface); border-right-color: var(--border); }
    .corner::after, .label::after { content: ''; position: absolute; top: 0; bottom: 0; left: 100%; width: 28px; pointer-events: none; opacity: 0; transition: opacity 160ms ease; }
    .corner::after { background: linear-gradient(to right, var(--surface-2), transparent); }
    .label::after { background: linear-gradient(to right, var(--surface), transparent); }
    .scrolled .corner::after, .scrolled .label::after { opacity: 1; }
    .name { font-size: 0.88rem; font-weight: 600; }
    .label.off .name { color: var(--text-muted); }
    .meta { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 6px; min-width: 0; font-size: 0.72rem; color: var(--text-muted); }
    .meta .tag { padding: 0 5px; font-size: 0.66rem; }
    .note { color: var(--warning); font-weight: 600; white-space: nowrap; }
    .slot { display: flex; flex-direction: column; gap: 4px; min-height: 72px; padding: 8px; }
    .slot.sel { background: var(--tint); }
    .slot.off { background-image: repeating-linear-gradient(135deg, transparent 0 8px, var(--tint) 8px 9px); }

    .chip { display: flex; align-items: center; gap: 7px; min-width: 0; min-height: 30px; padding: 4px 8px 4px 7px; border: 1px solid var(--border-strong); border-left-width: 3px; border-radius: 6px; background: var(--surface-3); color: var(--text); font-size: 0.8rem; line-height: 1.2; }
    .chip:hover { color: var(--text); filter: brightness(1.18); }
    .chip .t { flex: none; color: var(--text-soft); font-weight: 600; }
    .chip .f { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .chip app-icon { width: 12px; height: 12px; color: var(--danger); }
    .k-published { border-left-color: var(--success); }
    .k-published.running { border-left-color: var(--accent); }
    .k-draft { background: var(--violet-soft); border: 1px dashed var(--violet); border-left: 3px dashed var(--violet); }
    .k-completed { background: var(--surface-2); border-color: var(--border); border-left-color: var(--text-faint); color: var(--text-muted); }
    .k-completed .t { color: var(--text-muted); }
    .k-cancelled { background: var(--danger-soft); border-color: var(--danger-line); border-left-color: var(--danger); color: var(--text-muted); }
    .k-cancelled .f, .k-cancelled .t { text-decoration: line-through; color: var(--text-muted); }
    .chip.clash { box-shadow: 0 0 0 1px var(--danger); border-color: var(--danger); }
  `,
})
export class CalendarWeekComponent {
  readonly state = inject(CalendarState);
  /** True once the grid has moved sideways, so chips fade out under the screen column. */
  readonly scrolled = signal(false);

  readonly cols = computed<DayCol[]>(() => {
    const byDay = this.state.byDay();
    const sel = this.state.date();
    return this.state.days().map((date) => {
      const key = toDateInput(date);
      const list = byDay.get(key) ?? [];
      return {
        date, key,
        weekday: date.toLocaleDateString('en-IN', { weekday: 'short' }),
        label: date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
        num: date.getDate(),
        month: date.toLocaleDateString('en-IN', { month: 'short' }),
        total: list.length,
        drafts: list.filter((c) => c.kind === 'draft').length,
        cancelled: list.filter((c) => c.kind === 'cancelled').length,
        clashes: list.filter((c) => c.conflicts.length).length,
        today: this.state.isToday(date),
        selected: sameDay(date, sel),
      };
    });
  });

  shows(lane: ScreenLane, key: string): CalShow[] {
    return this.state.byScreenDay().get(`${lane.screen.id}|${key}`) ?? [];
  }

  groupCount(lanes: ScreenLane[], key: string): number {
    return lanes.reduce((n, l) => n + this.shows(l, key).length, 0);
  }

  time(d: Date): string { return formatTime(d); }
}
