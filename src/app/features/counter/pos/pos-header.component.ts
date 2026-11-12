import { ChangeDetectionStrategy, Component, computed, inject, input, model } from '@angular/core';
import { RouterLink } from '@angular/router';

import { AdminStore } from '../../../core/admin-store';
import { IconComponent } from '../../../shared/icon.component';
import { PageHeaderComponent } from '../../../shared/ui';
import { PosSale } from './pos-sale';

export const SHORTCUTS: { keys: string[]; what: string }[] = [
  { keys: ['[', ']'], what: 'Previous or next day' },
  { keys: ['↑', '↓'], what: 'Move through shows' },
  { keys: ['Enter'], what: 'Open the show' },
  { keys: ['/'], what: 'Search movies or screens' },
  { keys: ['F', '7', 'Enter'], what: 'Add or remove seat F7' },
  { keys: ['4', 'Enter'], what: 'Best 4 seats together' },
  { keys: ['Esc'], what: 'Clear typing, then the seats' },
  { keys: ['F2', 'F3', 'F4', 'F8'], what: 'Cash, UPI, Card, Other' },
  { keys: ['Ctrl', 'Enter'], what: 'Confirm booking' },
  { keys: ['P', 'R', 'N'], what: 'After a sale: print, reprint, new sale' },
  { keys: ['?'], what: 'Show or hide this list' },
];

/** The POS header: theatre, business date, what is on sale, the signed-in operator and their counter. */
@Component({
  selector: 'app-pos-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, RouterLink, PageHeaderComponent],
  template: `
    @if (!bare()) {
    <app-page-header title="Counter Booking" [subtitle]="subtitle()">
      @if (canHistory()) { <a class="btn" routerLink="/counter/history"><app-icon name="list" />History</a> }
      @if (store.can('counter.reports')) { <a class="btn" routerLink="/counter/dashboard"><app-icon name="reports" />Dashboard</a> }
      <button type="button" class="btn" [attr.aria-expanded]="help()" title="Keyboard shortcuts (?)" (click)="help.set(!help())"><kbd>?</kbd>Shortcuts</button>
    </app-page-header>
    }
    @if (help()) {
        <div class="help" role="dialog" aria-label="Keyboard shortcuts">
          <div class="hh"><strong>Keyboard shortcuts</strong><button type="button" class="btn ghost sm icon" aria-label="Close" (click)="help.set(false)"><app-icon name="close" /></button></div>
          <dl>
            @for (s of shortcuts; track s.what) {
              <dt>@for (k of s.keys; track $index) { <kbd>{{ k }}</kbd> }</dt><dd>{{ s.what }}</dd>
            }
          </dl>
        </div>
    }
  `,
  styles: `
    :host { display: block; position: relative; }
    kbd { padding: 0 5px; border: 1px solid var(--border-strong); border-radius: 4px; background: var(--surface-3); font: 600 0.7rem/1.5 var(--mono); color: var(--text-soft); }
    .help { position: absolute; z-index: 20; right: 8px; top: calc(100% + 6px); width: min(360px, calc(100vw - 32px)); padding: 12px 14px; border: 1px solid var(--border-strong); border-radius: var(--radius-lg); background: var(--surface-2); box-shadow: var(--shadow-lg); }
    .hh { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
    dl { display: grid; grid-template-columns: max-content 1fr; gap: 7px 12px; margin: 0; font-size: 0.82rem; }
    dt { display: flex; flex-wrap: wrap; gap: 3px; }
    dd { margin: 0; color: var(--text-soft); }
  `,
})
export class PosHeaderComponent {
  readonly store = inject(AdminStore);
  readonly sale = inject(PosSale);
  readonly help = model(false);
  /** Inside a show the bar is hidden; the shortcuts list still opens from the keyboard. */
  readonly bare = input(false);
  readonly shortcuts = SHORTCUTS;

  readonly user = this.store.currentUser;
  readonly counter = computed(() => this.store.staffUsers().find((u) => u.name === this.user().name)?.counter ?? '');
  /** Theatre, how many of the day's shows are open, and the operator's counter when there is one. */
  readonly subtitle = computed(() => [`${this.onSale()} of ${this.listed().length} shows on sale`, this.counter()].filter(Boolean).join(' · '));
  readonly theatre = computed(() => {
    const t = this.store.scopedTheatres();
    if (t.length === 1) return `${t[0]!.name} · ${t[0]!.area}`;
    return `${t.length} theatres`;
  });
  /** The day's shows the counter lists: drafts never reach the box office. */
  readonly listed = computed(() => this.store.dayShows().filter((s) => s.publication === 'published'));
  readonly onSale = computed(() => this.listed().filter((s) => this.store.counterSaleState(s).open).length);
  readonly canHistory = computed(() => this.store.can('counter.history.own') || this.store.can('counter.history.all'));
}
