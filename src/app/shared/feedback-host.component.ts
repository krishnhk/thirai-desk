import { ChangeDetectionStrategy, Component, ElementRef, effect, inject, signal, viewChild } from '@angular/core';

import { ConfirmService, ToastService } from './feedback';
import { IconComponent } from './icon.component';

/** Renders toasts and the confirmation dialog once, at the root of the app. */
@Component({
  selector: 'app-feedback-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <div class="toasts" aria-live="polite">
      @for (t of toasts.toasts(); track t.id) {
        <div class="toast {{ t.kind }}" role="status">
          <app-icon [name]="t.kind === 'success' ? 'check' : t.kind === 'error' ? 'alert' : 'info'" />
          <div class="toast-text">
            <strong>{{ t.title }}</strong>
            @if (t.detail) { <span>{{ t.detail }}</span> }
          </div>
          <button class="btn ghost sm icon" type="button" aria-label="Dismiss" (click)="toasts.dismiss(t.id)"><app-icon name="close" /></button>
        </div>
      }
    </div>

    @if (confirm.pending(); as c) {
      <div class="scrim" (click)="confirm.close(false)"></div>
      <div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-message" (keydown.escape)="confirm.close(false)">
        <div class="dialog-head">
          @if (c.tone === 'danger') { <span class="danger-mark"><app-icon name="alert" /></span> }
          <h2 id="confirm-title">{{ c.title }}</h2>
        </div>
        <p id="confirm-message" class="soft">{{ c.message }}</p>
        @if (c.details?.length) {
          <dl class="facts panel">
            @for (d of c.details; track d.label) { <dt>{{ d.label }}</dt><dd>{{ d.value }}</dd> }
          </dl>
        }
        @if (c.consequences?.length) {
          <div class="callout {{ c.tone === 'danger' ? 'danger' : 'warning' }}">
            <app-icon name="alert" />
            <ul>@for (x of c.consequences; track x) { <li>{{ x }}</li> }</ul>
          </div>
        }
        @if (c.requireText) {
          <div class="field">
            <label for="confirm-type">Type <strong class="mono">{{ c.requireText }}</strong> to confirm</label>
            <input #typed id="confirm-type" class="input" autocomplete="off" [value]="typedText()" (input)="typedText.set($any($event.target).value)" />
          </div>
        }
        <div class="dialog-actions">
          <button class="btn" type="button" (click)="confirm.close(false)">{{ c.cancelLabel ?? 'Cancel' }}</button>
          <button #ok class="btn {{ c.tone === 'danger' ? 'danger' : 'primary' }}" type="button" [disabled]="!!c.requireText && typedText().trim() !== c.requireText" (click)="confirm.close(true)">{{ c.confirmLabel ?? 'Confirm' }}</button>
        </div>
      </div>
    }
  `,
  styles: `
    .toasts { position: fixed; right: 20px; bottom: 20px; z-index: 90; display: flex; flex-direction: column; gap: 8px; width: min(380px, calc(100vw - 32px)); }
    .toast { display: flex; align-items: flex-start; gap: 10px; padding: 12px 10px 12px 14px; border: 1px solid var(--border-strong); border-left-width: 3px; border-radius: var(--radius); background: var(--surface-3); box-shadow: var(--shadow-lg); animation: rise 160ms ease-out; }
    .toast.success { border-left-color: var(--success); } .toast.success app-icon { color: var(--success); }
    .toast.error { border-left-color: var(--danger); } .toast.error app-icon { color: var(--danger); }
    .toast.info { border-left-color: var(--info); } .toast.info app-icon { color: var(--info); }
    .toast-text { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; font-size: 0.85rem; }
    .toast-text span { color: var(--text-soft); font-size: 0.8rem; }
    .scrim { position: fixed; inset: 0; z-index: 80; background: var(--scrim); }
    .dialog { position: fixed; z-index: 81; top: 50%; left: 50%; transform: translate(-50%, -50%); width: min(500px, calc(100vw - 32px)); max-height: calc(100vh - 48px); overflow-y: auto; display: flex; flex-direction: column; gap: 14px; padding: 22px; border: 1px solid var(--border-strong); border-radius: var(--radius-lg); background: var(--surface); box-shadow: var(--shadow-lg); animation: rise 160ms ease-out; }
    .dialog-head { display: flex; align-items: center; gap: 10px; }
    .danger-mark { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 50%; background: var(--danger-soft); color: var(--danger); }
    .callout ul { margin: 0; padding-left: 18px; display: grid; gap: 4px; }
    .dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
    @keyframes rise { from { opacity: 0; transform: translate(var(--tx, 0), calc(var(--ty, 0px) + 6px)); } }
    .dialog { --tx: -50%; --ty: -50%; }
  `,
})
export class FeedbackHostComponent {
  readonly toasts = inject(ToastService);
  readonly confirm = inject(ConfirmService);
  readonly typedText = signal('');
  private readonly ok = viewChild<ElementRef<HTMLButtonElement>>('ok');
  private readonly typed = viewChild<ElementRef<HTMLInputElement>>('typed');

  constructor() {
    // Each new dialog starts with an empty confirmation text and focus on its first control.
    effect(() => {
      if (this.confirm.pending()) {
        this.typedText.set('');
        queueMicrotask(() => (this.typed() ?? this.ok())?.nativeElement.focus());
      }
    });
  }
}
