import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';

import { AdminStore } from '../../../core/admin-store';
import { formatDate, formatMoney, formatTime } from '../../../core/format';
import { WALK_IN } from '../../../core/models';
import { IconComponent } from '../../../shared/icon.component';
import { PosSale } from './pos-sale';

/**
 * The order part of the right panel: the film and show, the customer (always a walk-in), the seats,
 * and the price breakdown. Read from the sale, never changed here except to remove seats.
 */
@Component({
  selector: 'app-pos-summary',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    @if (sale.show(); as show) {
      @if (part() === 'order') {
        <section class="sec movie" aria-label="Show">
          <div class="film">
            @if (sale.movie()?.posterUrl) { <img class="poster" [src]="sale.movie()!.posterUrl" alt="" /> } @else { <span class="poster"></span> }
            <div class="ft">
              <strong>{{ sale.movie()?.title }}</strong>
              <span class="tags">
                @if (sale.movie()?.certification) { <span class="tag">{{ sale.movie()?.certification }}</span> }
                <span class="tag">{{ show.format }}</span>
                <span class="tag plain">{{ show.language }}</span>
              </span>
              <span class="where">{{ theatre() }} · <b>{{ sale.screen()?.name }}</b></span>
              <span class="where"><b>{{ date(show.start) }}</b> · <b>{{ time(show.start) }}</b></span>
            </div>
          </div>
        </section>

        <section class="sec guest" aria-label="Customer">
          <app-icon name="user" />
          <span class="gt"><strong>{{ walkIn }}</strong><small>Customer details are not collected</small></span>
        </section>

        <section class="sec tickets" aria-label="Tickets">
          <div class="sh">
            <h3>Tickets</h3>
            <span class="wk">Walk-in guest</span>
            @if (sale.seats().length) {
              <span class="count"><b>{{ sale.seats().length }}</b> {{ sale.seats().length === 1 ? 'seat' : 'seats' }}</span>
              @if (!sale.locked()) { <button type="button" class="link-btn small" (click)="sale.clearSeats()">Clear <kbd>Esc</kbd></button> }
            }
          </div>
          @if (sale.lines().length) {
            <ul class="chips" aria-label="Selected seats">
              @for (l of sale.lines(); track l.seat) {
                <li class="chip" [style.--c]="l.color">
                  <span class="mono">{{ l.seat }}</span>
                  @if (!sale.locked()) { <button type="button" [attr.aria-label]="'Remove ' + l.seat" (click)="sale.removeSeat(l.seat)"><app-icon name="close" /></button> }
                </li>
              }
            </ul>
            <ul class="lines">
              @for (g of sale.groups(); track g.categoryId + g.price) {
                <li>
                  <span class="cls"><span class="dot" [style.background]="g.color"></span>{{ g.category }}</span>
                  <span class="calc">{{ g.seats.length }} × {{ money(g.price) }}</span>
                  <span class="amt money">{{ money(g.subtotal) }}</span>
                </li>
              }
            </ul>
          } @else {
            <p class="none"><strong>No seats selected.</strong> Choose seats from the seating chart.</p>
          }
        </section>
      } @else if (sale.seats().length) {
        <section class="sec totals" aria-label="Price breakdown">
          <dl class="pb">
            <div><dt>Ticket subtotal</dt><dd class="money">{{ money(sale.totals().base, 2) }}</dd></div>
            <div><dt>GST{{ gstRates() }}</dt><dd class="money">{{ money(gstAmount(), 2) }}</dd></div>
            <div><dt>Convenience fee</dt><dd class="money">{{ money(0, 2) }}</dd></div>
          </dl>
        </section>
      }
    } @else if (part() === 'order') {
      <section class="sec empty">
        <app-icon name="ticket" />
        <strong>Select a show to start booking.</strong>
        <p class="muted small">Seats, pricing and payment appear here once a show is chosen.</p>
      </section>
    }
  `,
  styles: `
    :host { display: contents; }
    .sec { padding: 10px 14px; border-radius: var(--radius-lg); background: var(--surface-2); }
    h3 { font-size: 0.7rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted); }

    .film { display: flex; align-items: center; gap: 12px; }
    .poster { flex-shrink: 0; width: 44px; aspect-ratio: 2 / 3; border-radius: 5px; object-fit: cover; background: var(--surface-3); }
    .ft { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
    .ft strong { font-size: 1rem; line-height: 1.2; letter-spacing: -0.01em; }
    .tags { display: flex; flex-wrap: wrap; gap: 4px; }
    .tag { padding: 0 7px; border: 1px solid var(--border-strong); border-radius: 4px; font-size: 0.68rem; font-weight: 700; line-height: 18px; color: var(--text-soft); }
    .tag.plain { border-color: transparent; padding-left: 2px; color: var(--text-muted); font-weight: 600; }
        .where { font-size: 0.76rem; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .where b { color: var(--text-soft); font-weight: 600; }

    .guest { display: flex; align-items: center; gap: 10px; padding: 7px 14px; }
    .guest > app-icon { width: 18px; height: 18px; color: var(--text-muted); }
    .gt { display: flex; flex-direction: column; line-height: 1.3; min-width: 0; }
    .gt strong { font-size: 0.88rem; }
    .gt small { font-size: 0.74rem; color: var(--text-muted); }

    .sh { display: flex; align-items: baseline; gap: 10px; margin-bottom: 6px; }
    .count { margin-left: auto; font-size: 0.8rem; color: var(--text-muted); }
    .count b { font-size: 1.2rem; font-weight: 800; letter-spacing: -0.02em; color: var(--accent); }
    .sh .link-btn { font-size: 0.76rem; }
    .wk { display: none; font-size: 0.72rem; color: var(--text-muted); }
    .sh kbd { margin-left: 2px; font: 600 0.62rem var(--mono); color: var(--text-faint); }
    .none { margin: 0; font-size: 0.82rem; color: var(--text-muted); line-height: 1.45; }
    .none strong { display: block; font-size: 0.88rem; color: var(--text-soft); }
    .chips { display: flex; flex-wrap: wrap; gap: 4px; margin: 0 0 6px; padding: 0; list-style: none; }
    .chip { display: inline-flex; align-items: center; gap: 2px; height: 24px; padding: 0 1px 0 8px; border-radius: var(--radius-sm); background: var(--surface-3); box-shadow: inset 3px 0 0 var(--c); color: var(--text); font-weight: 700; }
    .chip .mono { font-size: 0.78rem; }
    .chip button { display: grid; place-items: center; width: 22px; height: 22px; padding: 0; border: 0; border-radius: 4px; background: none; color: var(--text-muted); }
    .chip button:hover { color: var(--text); background: var(--border); }
    .chip button app-icon { width: 13px; height: 13px; }
    .lines { display: flex; flex-direction: column; gap: 2px; margin: 0; padding: 0; list-style: none; font-size: 0.82rem; }
    .lines li { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: baseline; gap: 12px; }
    .cls { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-soft); }
    .dot { display: inline-block; width: 8px; height: 8px; margin-right: 7px; border-radius: 2px; vertical-align: 1px; }
    .calc { color: var(--text-muted); white-space: nowrap; }
    .amt { min-width: 64px; text-align: right; font-weight: 600; }

    .totals { padding: 8px 14px; }
    .pb { display: flex; flex-direction: column; gap: 3px; margin: 0; font-size: 0.8rem; }
    .pb div { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
    .pb dt { color: var(--text-muted); }
    .pb dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; color: var(--text-soft); }
    
    /* The checkout column never scrolls: as it gets shorter, the content tightens in steps instead. */
    @container checkout (max-height: 640px) {
      .sec { padding: 8px 12px; }
      .guest { padding: 5px 12px; }
      .gt small { display: none; }
      .poster { width: 34px; }
      .ft { gap: 2px; }
      .chip { height: 22px; }
      .chip button { height: 20px; }
      .sh { margin-bottom: 4px; }
    }
    @container checkout (max-height: 540px) {
      .ft { flex-direction: row; flex-wrap: wrap; align-items: center; column-gap: 8px; }
      .ft .where { flex: 1 1 100%; }
      .calc { display: none; }
      .guest { display: none; }
      .wk { display: inline; }
      .pb { gap: 1px; font-size: 0.76rem; }
      .lines { font-size: 0.78rem; }
      .none strong { display: inline; }
    }
    .empty { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 36px 20px; text-align: center; }
    .empty app-icon { width: 26px; height: 26px; color: var(--text-muted); }
  `,
})
export class PosSummaryComponent {
  private readonly store = inject(AdminStore);
  readonly sale = inject(PosSale);
  /** The order (show, customer, tickets) or the price breakdown. */
  readonly part = input<'order' | 'totals'>('order');
  readonly walkIn = WALK_IN;
  readonly theatre = computed(() => {
    const s = this.sale.show();
    const t = s ? this.store.theatre(s.theatreId) : undefined;
    return t ? `${t.name}, ${t.area}` : '';
  });
  /** Total GST across the seats, and the rate or rates it was worked out at: " (18%)" or " (12% + 18%)". */
  readonly gstAmount = computed(() => this.sale.totals().gst.reduce((n, g) => n + g.amount, 0));
  readonly gstRates = computed(() => {
    const rates = this.sale.totals().gst.map((g) => `${Math.round(g.rate * 100)}%`);
    return rates.length ? ` (${rates.join(' + ')})` : '';
  });
  money = formatMoney;
  date = formatDate;
  time = formatTime;
}
