import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';

import { AdminStore } from '../../core/admin-store';
import { formatDay, formatMoney, formatTime, sameDay } from '../../core/format';
import { CounterPaymentMethod } from '../../core/models';
import { IconComponent } from '../../shared/icon.component';
import { EmptyStateComponent, PageHeaderComponent } from '../../shared/ui';
import { PosConfirmationComponent } from './pos/pos-confirmation.component';
import { PosHeaderComponent } from './pos/pos-header.component';
import { METHOD_KEYS, PosPaymentComponent } from './pos/pos-payment.component';
import { PosSale } from './pos/pos-sale';
import { PosSeatChartComponent } from './pos/pos-seat-chart.component';
import { PosShowsComponent } from './pos/pos-shows.component';
import { PosSummaryComponent } from './pos/pos-summary.component';

const KEY_METHOD = Object.fromEntries(Object.entries(METHOD_KEYS).map(([m, k]) => [k, m])) as Record<string, CounterPaymentMethod>;
/** Typed seat numbers commit on their own after this pause. */
const TYPE_IDLE_MS = 1200;

/**
 * Counter Booking: the box-office POS for walk-in customers, for today and advance dates inside the
 * booking window. Three panels — show selection, the seat chart,
 * the order and payment — with keyboard shortcuts for speed. No customer details are taken; the
 * store links each sale to the show, seats, payment and the signed-in operator, and re-checks the
 * shared seat inventory on confirmation.
 */
@Component({
  selector: 'app-counter-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [PosSale],
  imports: [
    RouterLink, IconComponent, PageHeaderComponent, EmptyStateComponent,
    PosHeaderComponent, PosShowsComponent, PosSeatChartComponent, PosSummaryComponent, PosPaymentComponent,
    PosConfirmationComponent,
  ],
  host: { '(document:keydown)': 'onKey($event)', '[class.locked-out]': '!sale.canSell()' },
  template: `
    @if (!sale.canSell()) {
      <div class="page">
        <app-page-header title="Counter Booking" />
        <section class="card">
          <app-empty-state icon="lock" title="Your role cannot sell tickets" [text]="'Signed in as ' + store.currentUser().name + ' (' + store.currentUser().role + '). Ask a counter supervisor or the theatre administrator for counter access.'">
            @if (store.can('counter.history.all') || store.can('counter.history.own')) { <a class="btn" routerLink="/counter/history">Counter history</a> }
          </app-empty-state>
        </section>
      </div>
    } @else {
      <div class="panels" [class.browsing]="browsing()" [class.done]="!!sale.booking()" [class.in-show]="!!sale.show()">
        <app-pos-header class="hdr" [bare]="!!sale.show()" [(help)]="help" />
        <!-- The selector is only on screen while choosing; once a show is picked, booking gets the room. -->
        @if (browsing()) {
          <aside class="panel p-left" aria-label="Select a show">
            <app-pos-shows>
            </app-pos-shows>
          </aside>
        }

        <section class="panel p-center" aria-label="Seats">
          @if (sale.booking()) {
            <!-- After a sale the confirmation fills the screen; there is nothing to show here. -->
          } @else if (sale.show(); as show) {
            <div class="show" role="status">
              @if (sale.movie()?.posterUrl) { <img class="poster" [src]="sale.movie()!.posterUrl" alt="" /> } @else { <span class="poster"></span> }
              <div class="st">
                <h2>{{ sale.movie()?.title }}</h2>
                <span class="tags">
                  @if (sale.movie()?.certification) { <span class="tag">{{ sale.movie()?.certification }}</span> }
                  <span class="tag">{{ show.format }}</span>
                  <span class="tag plain">{{ show.language }}</span>
                  @if (sale.isAdvance()) { <span class="badge info">Advance booking</span> }
                </span>
              </div>
              <div class="when"><b>{{ ctxDay() }} · {{ railTime() }}</b><span>{{ sale.screen()?.name }} · {{ theatreLine() }}</span></div>
              <button type="button" class="btn sm change" title="Choose another show (↑ ↓ or /)" (click)="openChooser()"><app-icon name="shows" />Change show</button>
            </div>
            @if (!sale.saleState().open && sale.canSell()) {
              <div class="callout danger closed"><app-icon name="alert" /><span><strong>Not on sale.</strong> {{ sale.saleState().reason }}</span></div>
            }
            @if (sale.layout()) { <app-pos-seat-chart [typed]="typed()" /> } @else { <app-empty-state icon="seats" title="This screen has no seat layout" /> }
          } @else {
            <app-empty-state icon="seats" title="Choose a show to sell" text="Pick a show from the list. From the keyboard: ↓ to move to a show, Enter to open it, then type seat numbers such as F7." />
          }
        </section>

        <aside class="panel p-right" aria-label="Order and payment">
          @if (sale.booking()) {
            <app-pos-confirmation />
          } @else {
            <div class="scroll">
              <app-pos-summary />
              <app-pos-summary part="totals" />
              @if (sale.show() && sale.canSell()) { <app-pos-payment /> }
            </div>
            <footer class="foot">
              <div class="due"><span>Total payable</span><b class="money">{{ money(sale.total(), 2) }}</b></div>
              <button type="button" class="btn primary confirm" [disabled]="sale.blockers().length > 0" (click)="sale.confirm()">
                <app-icon name="check" />Confirm booking
              </button>
              <p class="why" [class.warn]="sale.blockers().length > 0" role="status">
                @if (sale.blockers()[0]; as why) { {{ why }} } @else { Press <kbd>Ctrl</kbd> + <kbd>Enter</kbd> to confirm }
              </p>
            </footer>
          }
        </aside>
      </div>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 10px; height: calc(100dvh - var(--header-h) - 48px); min-height: 600px; margin-bottom: -24px; }
    :host(.locked-out) { height: auto; min-height: 0; margin-bottom: 0; }
    /* The checkout column runs the full height beside the header and the seats, so it gets every spare pixel. */
    .panels { position: relative; flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 340px; grid-template-rows: auto minmax(0, 1fr); gap: 10px; }
    .hdr { grid-column: 1; grid-row: 1; min-width: 0; }
    .p-left, .p-center { grid-column: 1; grid-row: 2; }
    .p-right { grid-column: 2; grid-row: 1 / span 2; }
    /* While choosing a show the selector takes the seat chart's place, so there is room to browse. */
    .panels.browsing .p-center { display: none; }
    /* Until a show is chosen there is nothing to check out: the list takes the full width. */
    .panels.browsing { grid-template-columns: minmax(0, 1fr); }
    .panels.browsing .p-right { display: none; }
    /* Once the booking is confirmed its summary takes the whole width under the header. */
    .panels.done { grid-template-columns: minmax(0, 1fr); }
    .panels.done .p-center { display: none; }
    .panels.done .p-right { grid-column: 1; grid-row: 2; }
    /* Inside a show the header bar is not needed: the seats and the checkout take the full height. */
    .panels.in-show { grid-template-rows: minmax(0, 1fr); }
    .panels.in-show .hdr { position: absolute; top: 0; right: 0; width: 0; height: 0; }
    .panels.in-show .p-left, .panels.in-show .p-center, .panels.in-show .p-right { grid-row: 1; }
    .panel { display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); }
    .p-left { padding: 0; }
    app-pos-shows { flex: 1; min-height: 0; }
    .change { flex-shrink: 0; min-height: 28px; }
    /* The show at a glance: poster, film, format and when, with the way back to the list. */
    .show { display: flex; align-items: center; gap: 14px; min-width: 0; padding: 12px 16px; border-bottom: 1px solid var(--border); }
    .poster { flex-shrink: 0; width: 38px; aspect-ratio: 2 / 3; border-radius: 5px; object-fit: cover; background: var(--surface-3); }
    .st { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .st h2 { font-size: 1.1rem; letter-spacing: -0.02em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tags { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .tag { padding: 0 7px; border: 1px solid var(--border-strong); border-radius: 4px; font-size: 0.68rem; font-weight: 700; line-height: 18px; color: var(--text-soft); }
    .tag.plain { border-color: transparent; padding-left: 0; color: var(--text-muted); font-weight: 600; }
    .when { margin-left: auto; display: flex; flex-direction: column; align-items: flex-end; text-align: right; font-size: 0.8rem; color: var(--text-muted); line-height: 1.35; }
    .when b { color: var(--text); font-size: 0.9rem; }
    .closed { margin: 10px 12px 0; }
    .p-center app-empty-state { margin: auto; }
    .p-right { background: var(--surface); }
    .scroll { container: checkout / size; flex: 1; min-height: 0; overflow-y: auto; scrollbar-width: thin; display: flex; flex-direction: column; gap: 8px; padding: 10px; }
    .foot { display: flex; flex-direction: column; gap: 6px; padding: 10px 14px 10px; background: var(--surface-2); box-shadow: 0 -1px 0 var(--border), 0 -10px 24px var(--shadow-edge); }
    .due { display: flex; align-items: baseline; justify-content: space-between; }
    .due span { font-size: 0.86rem; font-weight: 600; color: var(--text-soft); }
    .due b { font-size: 1.45rem; line-height: 1.1; font-weight: 800; letter-spacing: -0.02em; color: var(--accent); }
    .confirm { min-height: 42px; font-size: 0.98rem; }
    .why { margin: 0; font-size: 0.72rem; line-height: 1.2; color: var(--text-muted); text-align: center; }
    .why.warn { color: var(--warning); }
    .why kbd { padding: 0 5px; border: 1px solid var(--border-strong); border-radius: 4px; font: 600 0.68rem var(--mono); color: var(--text-soft); }
    @media (max-width: 1280px) {
      .panels { grid-template-columns: minmax(0, 1fr) 310px; }
    }
    @media (max-width: 1100px), (max-height: 740px) {
      :host { height: auto; min-height: 0; margin-bottom: 0; }
      .panels { grid-template-columns: minmax(0, 1fr); grid-template-rows: none; }
      .hdr, .p-left, .p-center, .p-right { grid-column: 1; grid-row: auto; }
      .hdr { order: -1; }
      .panel { overflow: visible; }
      .scroll { container-type: normal; }
      .panels.browsing .p-right { display: none; }
      .show { flex-wrap: wrap; }
      .when { margin-left: 0; align-items: flex-start; text-align: left; flex-basis: 100%; order: 3; }
      .p-center { height: min(78vh, 720px); overflow: hidden; }
      .p-center:not(:has(app-pos-seat-chart)) { height: auto; }
      .scroll { overflow: visible; }
      .panels.done .p-right { order: 1; }
      .panels.done .p-center { order: 2; }
      .foot { position: sticky; bottom: 0; z-index: 5; border-radius: 0 0 var(--radius-lg) var(--radius-lg); box-shadow: 0 -8px 20px var(--shadow-edge); }
    }
  `,
})
export class CounterPage {
  readonly store = inject(AdminStore);
  readonly sale = inject(PosSale);
  private readonly shows = viewChild(PosShowsComponent);
  private readonly chart = viewChild(PosSeatChartComponent);

  readonly help = signal(false);
  /** What the operator is typing: a seat id ("F7") or a quantity ("4"). */
  readonly typed = signal('');
  /** The selector is on screen whenever no show is open; leaving a show clears the sale. */
  readonly browsing = computed(() => !this.sale.show() && !this.sale.booking());
  private typeTimer: ReturnType<typeof setTimeout> | undefined;

  readonly railTime = computed(() => {
    const s = this.sale.show();
    return s ? formatTime(s.start) : '';
  });
  /** The show's own date: "Today, Tue, 10 Nov" or "Wed, 11 Nov". */
  readonly ctxDay = computed(() => {
    const s = this.sale.show();
    if (!s) return '';
    return sameDay(s.start, this.sale.today()) ? `Today, ${formatDay(s.start)}` : formatDay(s.start);
  });
  readonly theatreLine = computed(() => {
    const s = this.sale.show();
    const t = s ? this.store.theatre(s.theatreId) : undefined;
    return t ? `${t.name}, ${t.area}` : '';
  });
  money = formatMoney;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.typeTimer));
  }

  /** Back to the show list: the open show and its sale are cleared, so the next show starts fresh. */
  openChooser(then?: () => void): void {
    if (this.sale.show() && !this.sale.booking() && !this.sale.leaveShow()) return;
    if (then) setTimeout(then);
  }

  // ------------------------------------------------------------------ Keyboard

  onKey(e: KeyboardEvent): void {
    if (e.defaultPrevented || !this.sale.canSell()) return;
    if (document.querySelector('[aria-modal="true"]')) return;
    const target = e.target as HTMLElement | null;
    const inField = !!target?.closest('input, textarea, select, [contenteditable="true"]');

    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      if (this.sale.booking()) this.sale.newSale(); else this.sale.confirm();
      return;
    }
    const method = KEY_METHOD[e.key];
    if (method && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      if (this.sale.booking() || !this.sale.show()) return;
      if (this.sale.methods().includes(method)) this.sale.setMethod(method);
      else this.sale.say('warning', `${method} is not accepted at this box office.`);
      return;
    }
    // Esc closes the calendar, then the show drawer, before it touches the sale.
    if (e.key === 'Escape') {
      if (this.shows()?.dismiss()) { e.preventDefault(); return; }
    }
    if (inField) {
      if (e.key === 'Escape') target!.blur();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    if (e.key === '[' || e.key === ']') {
      e.preventDefault();
      if (!this.sale.shiftDay(e.key === ']' ? 1 : -1)) this.sale.say('info', e.key === ']' ? 'That is the last day the box office sells for.' : 'Counter sales start from today.');
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      if (this.browsing()) this.shows()?.move(step); else this.openChooser(() => this.shows()?.move(step));
      return;
    }
    if (e.key === '?') { e.preventDefault(); this.help.update((v) => !v); return; }
    if (e.key === '/') { e.preventDefault(); if (this.browsing()) this.shows()?.focusSearch(); else this.openChooser(() => this.shows()?.focusSearch()); return; }

    if (this.sale.booking()) {
      const k = e.key.toLowerCase();
      if (k === 'p') { e.preventDefault(); this.sale.print(); }
      else if (k === 'r' && this.sale.printed()) { e.preventDefault(); this.sale.reprint(); }
      else if (k === 'n') { e.preventDefault(); this.sale.newSale(); }
      return;
    }

    if (e.key === 'Escape') {
      if (this.help()) { this.help.set(false); return; }
      if (this.typed()) this.clearTyped(); else this.sale.clearSeats();
      return;
    }
    if (e.key === 'Enter') {
      if (this.typed()) { e.preventDefault(); this.commitTyped(); }
      return;
    }
    if (e.key === 'Backspace' && this.typed()) {
      e.preventDefault();
      this.typed.update((t) => t.slice(0, -1));
      this.armTimer();
      return;
    }
    if (e.key.length === 1 && /[a-z0-9]/i.test(e.key) && this.sale.layout()) {
      e.preventDefault();
      const ch = e.key.toUpperCase();
      const cur = this.typed();
      // A row letter after digits starts the next seat: "F7G8" sells F7, then G8.
      if (/[A-Z]/.test(ch) && /\d$/.test(cur)) { this.commitTyped(); this.typed.set(ch); }
      else if (cur.length < 6) this.typed.set(cur + ch);
      this.armTimer();
    }
  }

  private armTimer(): void {
    clearTimeout(this.typeTimer);
    if (this.typed()) this.typeTimer = setTimeout(() => this.commitTyped(), TYPE_IDLE_MS);
  }

  private clearTyped(): void {
    clearTimeout(this.typeTimer);
    this.typed.set('');
  }

  private commitTyped(): void {
    const t = this.typed();
    this.clearTyped();
    if (!t) return;
    if (/^\d+$/.test(t)) this.chart()?.pickBest(Number(t));
    else if (/^[A-Z]+\d+$/.test(t)) this.sale.toggleSeat(t);
    else this.sale.say('info', `Type the seat number after the row letter, such as ${t}7.`);
  }
}
