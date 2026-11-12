import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, computed, inject, signal, viewChild } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { addMinutes, formatTime, toDateInput } from '../../core/format';
import { ToastService } from '../../shared/feedback';
import { IconComponent } from '../../shared/icon.component';
import { CalShow, CalendarState, ScreenLane } from './calendar.state';
import { packRows } from './calendar.utils';

const ROW_H = 76;
const LABEL_W = 184;

interface Block { c: CalShow; left: number; width: number; tail: number; top: number; }
interface LaneRow { lane: ScreenLane; blocks: Block[]; height: number; count: number; }

/**
 * The day view: one lane per screen on a time axis. Blocks sit at their start time and are as
 * long as the film; the faint hatched tail is the cleaning buffer. Overlapping shows stack in
 * extra rows of the lane and are outlined in red.
 */
@Component({
  selector: 'app-calendar-day',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent],
  template: `
    <div class="scroll" #scroller [class.scrolled]="scrolled()" (scroll)="scrolled.set(scroller.scrollLeft > 2)">
      <div class="grid" [style.width.px]="labelW() + trackW()" [style.--lw.px]="labelW()">
        <div class="head">
          <div class="corner">Screen</div>
          <div class="hours" [style.width.px]="trackW()">
            @for (h of hours(); track h.left) { <span class="hour" [style.left.px]="h.left">{{ h.label }}</span> }
            @if (nowLeft() !== null) { <span class="now-tag" [style.left.px]="nowLeft()">{{ time(state.store.now()) }}</span> }
          </div>
        </div>

        @for (g of rows(); track g.theatreId) {
          @if (state.group() === 'theatre') {
            <div class="group-row">
              <div class="group-label">
                <strong class="truncate">{{ g.name }}</strong>
                <span class="tiny muted">{{ g.lanes.length }} screens · {{ g.count }} shows</span>
              </div>
            </div>
          }
          @for (r of g.lanes; track r.lane.screen.id) {
            <div class="lane" [class.off]="!r.lane.schedulable">
              <div class="lane-label">
                <span class="name truncate">{{ r.lane.screen.name }}</span>
                <span class="meta">
                  @if (state.multiTheatre() && state.group() === 'screen') { <span class="nowrap">{{ r.lane.theatre.code }}</span> }
                  <span class="tag">{{ r.lane.screen.type }}</span>
                  @if (r.lane.note) { <span class="note">{{ r.lane.note }}</span> }
                </span>
              </div>
              <div class="track" [style.height.px]="r.height" [style.background-size]="hourW() + 'px 100%'"
                [attr.title]="r.lane.schedulable ? 'Click an empty slot to create a show on ' + r.lane.screen.name : r.lane.screen.name + ': ' + (r.lane.note === 'Inactive' ? 'inactive, cannot be scheduled' : 'no published layout, cannot be scheduled')"
                (click)="create($event, r.lane)">
                @for (b of r.blocks; track b.c.show.id) {
                  @if (b.c.kind !== 'cancelled') { <span class="tail" [style.left.px]="b.left + b.width" [style.width.px]="b.tail" [style.top.px]="b.top"></span> }
                  <a class="block k-{{ b.c.kind }}" [class.running]="b.c.running" [class.clash]="b.c.conflicts.length" [routerLink]="['/shows', b.c.show.id]"
                    [style.left.px]="b.left" [style.width.px]="b.width" [style.top.px]="b.top" [attr.title]="b.c.summary" [attr.aria-label]="b.c.summary">
                    @if (b.width >= 150 && b.c.movie?.posterUrl) { <img class="poster" [src]="b.c.movie!.posterUrl" alt="" loading="lazy" /> }
                    <span class="txt">
                      <span class="title">@if (b.c.conflicts.length) { <app-icon name="alert" /> }{{ b.c.title }}</span>
                      <span class="time">{{ time(b.c.start) }} – {{ time(b.c.end) }}</span>
                      <span class="state">{{ b.c.running ? 'Running' : kindLabel[b.c.kind] }} · {{ b.c.show.format }}</span>
                    </span>
                  </a>
                }
              </div>
            </div>
          }
        }

        @if (nowLeft() !== null) { <div class="now" [style.left.px]="labelW() + nowLeft()!" aria-hidden="true"></div> }
      </div>
    </div>
  `,
  styles: `
    :host { display: block; min-width: 0; }
    .scroll { overflow: auto; max-height: max(360px, calc(100vh - 330px)); }
    .grid { position: relative; min-width: 100%; }
    .head { position: sticky; top: 0; z-index: 4; display: flex; height: 38px; background: var(--surface-2); border-bottom: 1px solid var(--border); }
    .corner { position: sticky; left: 0; z-index: 1; flex: 0 0 var(--lw, ${LABEL_W}px); display: flex; align-items: center; padding: 0 14px; background: var(--surface-2); border-right: 1px solid var(--border); font-size: 0.68rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted); }
    .hours { position: relative; flex: none; }
    .hour { position: absolute; top: 0; height: 100%; display: flex; align-items: flex-start; padding: 5px 0 0 6px; border-left: 1px solid var(--border); font-size: 0.72rem; color: var(--text-muted); white-space: nowrap; }
    .group-row { position: relative; height: 34px; background: var(--bg); border-bottom: 1px solid var(--border); }
    .group-label { position: sticky; left: 0; display: flex; align-items: baseline; gap: 10px; height: 100%; width: max-content; max-width: 560px; padding: 8px 14px; }
    .group-label strong { font-size: 0.84rem; }
    .lane { display: flex; border-bottom: 1px solid var(--border-soft); }
    .lane-label { position: sticky; left: 0; z-index: 3; flex: 0 0 var(--lw, ${LABEL_W}px); display: flex; flex-direction: column; justify-content: center; gap: 3px; min-width: 0; padding: 6px 14px; background: var(--surface); border-right: 1px solid var(--border); }
    .corner::after, .lane-label::after { content: ''; position: absolute; top: 0; bottom: 0; left: 100%; width: 28px; pointer-events: none; opacity: 0; transition: opacity 160ms ease; }
    .corner::after { background: linear-gradient(to right, var(--surface-2), transparent); }
    .lane-label::after { background: linear-gradient(to right, var(--surface), transparent); }
    .scrolled .corner::after, .scrolled .lane-label::after { opacity: 1; }
    .name { font-size: 0.84rem; font-weight: 600; color: var(--text); }
    .meta { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 6px; min-width: 0; font-size: 0.72rem; color: var(--text-muted); }
    .meta .tag { padding: 0 5px; font-size: 0.66rem; }
    .note { color: var(--warning); font-weight: 600; white-space: nowrap; }
    .track { position: relative; flex: 1; cursor: cell; background-image: linear-gradient(to right, var(--border-soft) 1px, transparent 1px); }
    .lane.off .track { cursor: not-allowed; background-color: var(--tint); background-image: repeating-linear-gradient(135deg, transparent 0 8px, var(--tint) 8px 9px); }
    .lane.off .name { color: var(--text-muted); }

    .tail { position: absolute; height: ${ROW_H - 14}px; border-radius: 0 4px 4px 0; pointer-events: none; background: repeating-linear-gradient(135deg, rgba(139, 147, 161, 0.18) 0 3px, transparent 3px 7px); }
    .block { position: absolute; z-index: 1; display: flex; align-items: center; gap: 10px; height: ${ROW_H - 14}px; padding: 6px 12px 6px 12px; overflow: hidden; border: 1px solid var(--border-strong); border-left-width: 3px; border-radius: var(--radius-sm); background: var(--surface-3); color: var(--text); text-decoration: none; }
    .block:hover { color: var(--text); filter: brightness(1.18); z-index: 2; }
    .block:focus-visible { outline-offset: 1px; z-index: 2; }
    .poster { width: 34px; height: 51px; flex: none; border-radius: 3px; object-fit: cover; background: var(--surface-2); }
    .txt { display: flex; flex-direction: column; min-width: 0; line-height: 1.25; }
    .txt > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .title { display: flex; align-items: center; gap: 4px; font-size: 0.88rem; font-weight: 700; }
    .title app-icon { width: 13px; height: 13px; color: var(--danger); flex: none; }
    .time { font-size: 0.78rem; color: var(--text-soft); }
    .state { font-size: 0.72rem; color: var(--text-muted); }

    .k-published { border-left-color: var(--success); }
    .k-published.running { border-left-color: var(--accent); }
    .k-published.running .state { color: var(--accent); font-weight: 700; }
    .k-draft { background: var(--violet-soft); border: 1px dashed var(--violet); border-left: 3px dashed var(--violet); }
    .k-draft .state { color: var(--violet); }
    .k-completed { background: var(--surface-2); border-color: var(--border); border-left-color: var(--text-faint); color: var(--text-muted); }
    .k-completed .time, .k-completed .title { color: var(--text-muted); }
    .k-completed .poster { opacity: 0.5; }
    .k-cancelled { background: var(--danger-soft); border-color: var(--danger-line); border-left-color: var(--danger); color: var(--text-muted); }
    .k-cancelled .title, .k-cancelled .time { text-decoration: line-through; color: var(--text-muted); }
    .k-cancelled .state { color: var(--danger); }
    .k-cancelled .poster { opacity: 0.4; filter: grayscale(1); }
    .block.clash { box-shadow: 0 0 0 2px var(--danger); }

    .now { position: absolute; top: 38px; bottom: 0; z-index: 2; width: 2px; margin-left: -1px; background: var(--accent); pointer-events: none; }
    .now-tag { position: absolute; top: 19px; transform: translateX(-50%); padding: 0 5px; border-radius: 4px; background: var(--accent); color: var(--on-accent); font-size: 0.66rem; font-weight: 700; line-height: 18px; white-space: nowrap; }
  `,
})
export class CalendarDayComponent {
  readonly state = inject(CalendarState);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly scroller = viewChild.required<ElementRef<HTMLElement>>('scroller');

  readonly labelW = signal(LABEL_W);
  /** True once the grid has moved sideways, so shows fade out under the screen column. */
  readonly scrolled = signal(false);
  readonly kindLabel = { published: 'Published', draft: 'Draft', completed: 'Completed', cancelled: 'Cancelled' } as const;
  readonly hourW = this.state.hourWidth;
  readonly day = computed(() => this.state.days()[0]!);

  /** The axis runs 8 AM to 2 AM, stretched if a show falls outside it. Values are minutes after midnight. */
  readonly axis = computed(() => {
    const base = this.day().getTime();
    let from = 9 * 60, to = 22 * 60;
    for (const c of this.state.visible()) {
      from = Math.min(from, Math.floor((c.start.getTime() - base) / 3_600_000) * 60);
      to = Math.max(to, (Math.ceil((c.ready.getTime() - base) / 3_600_000) + 1) * 60);
    }
    return { from, to };
  });

  private fitted = false;
  readonly trackW = computed(() => ((this.axis().to - this.axis().from) / 60) * this.hourW());

  readonly hours = computed(() => {
    const { from, to } = this.axis();
    const out: { left: number; label: string }[] = [];
    for (let m = from; m < to; m += 60) {
      out.push({ left: ((m - from) / 60) * this.hourW(), label: formatTime(addMinutes(this.day(), m)).replace(':00', '') });
    }
    return out;
  });

  readonly rows = computed(() => {
    const key = toDateInput(this.day());
    const byScreen = this.state.byScreenDay();
    return this.state.groups().map((g) => {
      const lanes: LaneRow[] = g.lanes.map((lane) => {
        const list = byScreen.get(`${lane.screen.id}|${key}`) ?? [];
        const packed = packRows(list.map((c) => ({ start: c.start.getTime(), end: (c.kind === 'cancelled' ? c.end : c.ready).getTime() })));
        const blocks = list.map((c, i) => ({
          c,
          left: this.x(c.start),
          width: Math.max(6, this.x(c.end) - this.x(c.start)),
          tail: Math.max(0, this.x(c.ready) - this.x(c.end)),
          top: 7 + packed.rows[i]! * ROW_H,
        }));
        return { lane, blocks, height: packed.count * ROW_H, count: list.length };
      });
      return { theatreId: g.theatre.id, name: g.theatre.name, lanes, count: lanes.reduce((n, l) => n + l.count, 0) };
    });
  });

  readonly nowLeft = computed(() => {
    const now = this.state.store.now();
    const x = this.x(now);
    return x >= 0 && x <= this.trackW() ? x : null;
  });

  constructor() {
    // Open on the current time when viewing today.
    afterNextRender(() => {
      const el = this.scroller().nativeElement;
      if (el.clientWidth < 640) this.labelW.set(112);
      // A comfortable hour width; the day scrolls. Zoom changes it from there.
      if (!this.fitted) { this.fitted = true; this.hourW.set(el.clientWidth < 640 ? 96 : 128); }
      // Open with the current time in view, snapped to an hour so no show is cut at the edge more than needed.
      const left = this.nowLeft();
      if (el.clientWidth >= 640 && left !== null && left + this.labelW() > el.clientWidth - 120) {
        el.scrollLeft = Math.max(0, Math.floor((left - 2.5 * this.hourW()) / this.hourW()) * this.hourW());
      }
    });
  }

  time(d: Date): string { return formatTime(d); }

  private x(d: Date): number {
    return ((d.getTime() - this.day().getTime()) / 60_000 - this.axis().from) / 60 * this.hourW();
  }

  /** A click on empty space in a lane opens the show form for that screen, date and time. */
  create(event: MouseEvent, lane: ScreenLane): void {
    if (event.target !== event.currentTarget || !lane.schedulable) return;
    const minutes = this.axis().from + (event.offsetX / this.hourW()) * 60;
    const at = addMinutes(this.day(), Math.floor(minutes / 15) * 15);
    if (at < this.state.store.now()) {
      this.toast.info('That time has passed', 'Click a slot later than now to create a show.');
      return;
    }
    void this.router.navigate(['/shows/new'], { queryParams: this.state.createLink(lane.screen.id, at) });
  }
}
