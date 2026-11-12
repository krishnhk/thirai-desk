import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

import { IconComponent } from './icon.component';

/**
 * A dialog shell: title, scrollable body, footer. Content and footer are projected:
 *
 *   @if (open()) {
 *     <app-modal title="Edit screen" (closed)="open.set(false)">
 *       …body…
 *       <ng-container footer><button class="btn">Cancel</button>…</ng-container>
 *     </app-modal>
 *   }
 */
@Component({
  selector: 'app-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <div class="scrim" (click)="closed.emit()"></div>
    <section class="modal size-{{ size() }}" role="dialog" aria-modal="true" [attr.aria-label]="title()" (keydown.escape)="closed.emit()">
      <header class="modal-head">
        <div>
          @if (eyebrow()) { <p class="eyebrow">{{ eyebrow() }}</p> }
          <h2>{{ title() }}</h2>
        </div>
        <button class="btn ghost icon" type="button" aria-label="Close" (click)="closed.emit()"><app-icon name="close" /></button>
      </header>
      <div class="modal-body"><ng-content /></div>
      <footer class="modal-foot"><ng-content select="[footer]" /></footer>
    </section>
  `,
  styles: `
    .scrim { position: fixed; inset: 0; z-index: 70; background: var(--scrim); }
    .modal { position: fixed; z-index: 71; top: 50%; left: 50%; transform: translate(-50%, -50%); display: flex; flex-direction: column; max-height: calc(100vh - 48px); border: 1px solid var(--border-strong); border-radius: var(--radius-lg); background: var(--surface); box-shadow: var(--shadow-lg); }
    .size-sm { width: min(440px, calc(100vw - 32px)); }
    .size-md { width: min(600px, calc(100vw - 32px)); }
    .size-lg { width: min(860px, calc(100vw - 32px)); }
    .modal-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 16px 20px; border-bottom: 1px solid var(--border); }
    .modal-body { flex: 1; overflow-y: auto; padding: 18px 20px; }
    .modal-foot { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; padding: 12px 20px; border-top: 1px solid var(--border); }
    .modal-foot:empty { display: none; }
  `,
})
export class ModalComponent {
  readonly title = input.required<string>();
  readonly eyebrow = input('');
  readonly size = input<'sm' | 'md' | 'lg'>('md');
  readonly closed = output<void>();
}
