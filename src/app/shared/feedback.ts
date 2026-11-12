import { Injectable, signal } from '@angular/core';

export interface Toast {
  id: number;
  kind: 'success' | 'error' | 'info';
  title: string;
  detail?: string;
}

/** Short messages after an action: "Show published", "Refund failed". */
@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly toasts = signal<Toast[]>([]);
  private seq = 0;

  success(title: string, detail?: string): void { this.push('success', title, detail); }
  error(title: string, detail?: string): void { this.push('error', title, detail, 7000); }
  info(title: string, detail?: string): void { this.push('info', title, detail); }

  dismiss(id: number): void {
    this.toasts.update((list) => list.filter((t) => t.id !== id));
  }

  private push(kind: Toast['kind'], title: string, detail?: string, ms = 4500): void {
    const id = ++this.seq;
    this.toasts.update((list) => [...list.slice(-3), { id, kind, title, detail }]);
    setTimeout(() => this.dismiss(id), ms);
  }
}

export interface ConfirmOptions {
  title: string;
  message: string;
  /** Label/value pairs listed in the dialog, such as the show being cancelled. */
  details?: { label: string; value: string }[];
  /** Bullet points of consequences, shown as a warning. */
  consequences?: string[];
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
  /** When set, the confirm button stays disabled until this exact text is typed. */
  requireText?: string;
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

/**
 * Confirmation dialogs for destructive and important actions:
 * `if (await confirm.ask({...})) doIt();`
 */
@Injectable({ providedIn: 'root' })
export class ConfirmService {
  readonly pending = signal<PendingConfirm | null>(null);

  ask(options: ConfirmOptions): Promise<boolean> {
    this.pending()?.resolve(false);
    return new Promise((resolve) => this.pending.set({ ...options, resolve }));
  }

  close(ok: boolean): void {
    const p = this.pending();
    this.pending.set(null);
    p?.resolve(ok);
  }
}
