import { ChangeDetectionStrategy, Component, ElementRef, HostListener, computed, inject, input, model, signal, viewChild } from '@angular/core';

import { IconComponent } from '../../../shared/icon.component';

/** One screen the box office can filter by. */
export interface ScreenOption {
  id: string;
  name: string;
  number: number;
  type: string;
  /** False when the screen cannot be sold (no published layout); it is listed but not selectable. */
  ok: boolean;
  /** Shows on the selected day. */
  shows: number;
}

/**
 * A compact single-select for the screen filter that stays the same size for 3 or 30+ screens:
 * a button with the current choice and a searchable, scrolling list. '' means All Screens.
 */
@Component({
  selector: 'app-pos-screen-select',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <button #trigger type="button" class="trigger" [class.set]="!!value()" aria-haspopup="listbox" [attr.aria-expanded]="open()" (click)="toggle()" (keydown)="onTriggerKey($event)">
      <app-icon name="screen" />
      <span class="label">{{ selectedLabel() }}</span>
      @if (selected(); as s) { <span class="sub">{{ s.type }}</span> }
      <app-icon name="chevronDown" class="chev" />
    </button>

    @if (open()) {
      <div class="pop" role="dialog" aria-label="Choose a screen">
        <div class="find">
          <app-icon name="search" />
          <input #find class="input" type="search" autocomplete="off" placeholder="Screen name or number" aria-label="Search screens"
            [value]="query()" (input)="query.set($any($event.target).value); active.set(0)" (keydown)="onListKey($event)" />
        </div>
        <ul class="list" role="listbox" aria-label="Screens" [attr.aria-activedescendant]="'scr-opt-' + active()">
          @for (o of items(); track o.id; let i = $index) {
            <li [id]="'scr-opt-' + i" role="option" [attr.aria-selected]="value() === o.id" [attr.aria-disabled]="!o.ok"
              [class.active]="i === active()" [class.off]="!o.ok" (mouseenter)="active.set(i)" (mousedown)="$event.preventDefault(); pick(o)">
              <span class="name">{{ o.name }}</span>
              <span class="meta">
                @if (o.id === '') { {{ total() }} shows }
                @else if (!o.ok) { No seat layout }
                @else { {{ o.type }} · {{ o.shows }} {{ o.shows === 1 ? 'show' : 'shows' }} }
              </span>
              @if (value() === o.id) { <app-icon name="check" class="tick" /> }
            </li>
          } @empty {
            <li class="none" role="presentation">No screen matches “{{ query().trim() }}”.</li>
          }
        </ul>
      </div>
    }
  `,
  styles: `
    :host { position: relative; display: block; min-width: 0; text-align: left; }
    .trigger { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 36px; padding: 6px 10px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface-2); color: var(--text); text-align: left; }
    .trigger:hover { border-color: var(--border-strong); }
    .trigger[aria-expanded='true'] { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
    .trigger > app-icon { width: 16px; height: 16px; color: var(--text-muted); }
    .trigger.set > app-icon:first-child, .trigger.set .label { color: var(--accent); }
    .label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.86rem; font-weight: 600; }
    .sub { flex-shrink: 0; font-size: 0.74rem; color: var(--text-muted); }
    .chev { margin-left: auto; }
    .pop { position: absolute; z-index: 40; top: calc(100% + 6px); left: 0; width: max(100%, 280px); max-width: calc(100vw - 32px); padding: 6px; border: 1px solid var(--border-strong); border-radius: var(--radius-lg); background: var(--surface-2); box-shadow: var(--shadow-lg); }
    .find { position: relative; margin-bottom: 4px; }
    .find > app-icon { position: absolute; left: 10px; top: 50%; width: 15px; height: 15px; transform: translateY(-50%); color: var(--text-muted); pointer-events: none; }
    .find .input { min-height: 34px; padding-left: 32px; background: var(--surface); }
    .list { max-height: 280px; overflow-y: auto; margin: 0; padding: 0; list-style: none; }
    li { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: var(--radius); cursor: pointer; }
    li.active { background: var(--surface-3); }
    li[aria-selected='true'] .name { color: var(--accent); }
    li.off { cursor: not-allowed; opacity: 0.5; }
    .name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.86rem; font-weight: 600; }
    .meta { flex-shrink: 0; font-size: 0.74rem; color: var(--text-muted); }
    .tick { width: 16px; height: 16px; color: var(--accent); }
    li.none { justify-content: center; padding: 18px 10px; color: var(--text-muted); font-size: 0.84rem; cursor: default; }
  `,
})
export class PosScreenSelectComponent {
  private readonly host = inject(ElementRef<HTMLElement>);
  /** The screens to choose from, loaded from the theatre; never a fixed count. */
  readonly screens = input.required<ScreenOption[]>();
  /** The chosen screen id; '' is All Screens. */
  readonly value = model('');

  readonly open = signal(false);
  readonly query = signal('');
  readonly active = signal(0);
  private readonly findInput = viewChild<ElementRef<HTMLInputElement>>('find');
  private readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');

  readonly total = computed(() => this.screens().reduce((n, s) => n + s.shows, 0));
  readonly selected = computed(() => this.screens().find((s) => s.id === this.value()) ?? null);
  readonly selectedLabel = computed(() => this.selected()?.name ?? 'All Screens');

  /** All Screens, then the screens matching the search by name or number. */
  readonly items = computed<ScreenOption[]>(() => {
    const q = this.query().trim().toLowerCase();
    const all: ScreenOption = { id: '', name: 'All Screens', number: 0, type: '', ok: true, shows: this.total() };
    // A number on its own finds that screen number ("2" is Screen 2, not Screen 12 or a 2D screen); words match name or type.
    const num = /^\d+$/.test(q) ? Number(q) : null;
    const byNumber = (s: ScreenOption) => s.number === num || new RegExp(`\\b${num}\\b`).test(s.name);
    const byText = (s: ScreenOption) => s.name.toLowerCase().includes(q) || s.type.toLowerCase().includes(q);
    const matches = this.screens().filter((s) => !q || (num !== null ? byNumber(s) : byText(s)));
    return q ? matches : [all, ...matches];
  });

  toggle(): void {
    if (this.open()) { this.close(); return; }
    this.query.set('');
    this.open.set(true);
    // Start on the current choice so Enter keeps it.
    this.active.set(Math.max(0, this.items().findIndex((o) => o.id === this.value())));
    setTimeout(() => this.findInput()?.nativeElement.focus());
  }

  close(focusTrigger = false): void {
    this.open.set(false);
    if (focusTrigger) this.trigger().nativeElement.focus();
  }

  pick(o: ScreenOption): void {
    if (!o.ok) return;
    this.value.set(o.id);
    this.close(true);
  }

  onTriggerKey(e: KeyboardEvent): void {
    if ((e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') && !this.open()) {
      e.preventDefault();
      e.stopPropagation();
      this.toggle();
    }
  }

  onListKey(e: KeyboardEvent): void {
    const items = this.items();
    // Keep the POS shortcuts (arrows for shows, Esc for the cart) out while the list is open.
    e.stopPropagation();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!items.length) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      let i = this.active();
      for (let n = 0; n < items.length; n++) {
        i = (i + step + items.length) % items.length;
        if (items[i]!.ok) break;
      }
      this.active.set(i);
      document.getElementById('scr-opt-' + i)?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const o = items[this.active()];
      if (o) this.pick(o);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (this.query()) this.query.set(''); else this.close(true);
    } else if (e.key === 'Tab') {
      this.close();
    }
  }

  @HostListener('document:mousedown', ['$event'])
  onDocDown(e: MouseEvent): void {
    if (this.open() && !this.host.nativeElement.contains(e.target as Node)) this.close();
  }
}
