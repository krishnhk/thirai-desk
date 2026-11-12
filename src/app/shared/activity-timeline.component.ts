import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { AdminStore } from '../core/admin-store';
import { formatDate, formatDateTime, formatDay, formatRelative, formatTime, sameDay, addDays } from '../core/format';
import { AuditAction, AuditEntry } from '../core/models';
import { IconComponent } from './icon.component';

export type ActionTone = 'success' | 'danger' | 'warning' | 'info' | 'violet' | 'neutral';

/** How each audit action is drawn: icon, colour and a short label for filters and exports. */
export const ACTION_META: Record<AuditAction, { icon: string; tone: ActionTone; label: string }> = {
  'theatre.created': { icon: 'theatre', tone: 'success', label: 'Theatre added' },
  'theatre.updated': { icon: 'edit', tone: 'info', label: 'Theatre updated' },
  'theatre.activated': { icon: 'check', tone: 'success', label: 'Theatre activated' },
  'theatre.deactivated': { icon: 'lock', tone: 'neutral', label: 'Theatre deactivated' },
  'screen.created': { icon: 'screen', tone: 'success', label: 'Screen created' },
  'screen.updated': { icon: 'edit', tone: 'info', label: 'Screen updated' },
  'screen.activated': { icon: 'check', tone: 'success', label: 'Screen activated' },
  'screen.deactivated': { icon: 'lock', tone: 'neutral', label: 'Screen deactivated' },
  'screen.deleted': { icon: 'trash', tone: 'danger', label: 'Screen deleted' },
  'layout.saved': { icon: 'seats', tone: 'violet', label: 'Layout draft saved' },
  'layout.published': { icon: 'seats', tone: 'success', label: 'Layout published' },
  'movie.created': { icon: 'movie', tone: 'success', label: 'Film added' },
  'movie.updated': { icon: 'edit', tone: 'info', label: 'Film updated' },
  'show.created': { icon: 'plus', tone: 'info', label: 'Show created' },
  'show.updated': { icon: 'edit', tone: 'violet', label: 'Show edited' },
  'show.duplicated': { icon: 'copy', tone: 'info', label: 'Show duplicated' },
  'show.deleted': { icon: 'trash', tone: 'danger', label: 'Draft deleted' },
  'show.published': { icon: 'upload', tone: 'success', label: 'Show published' },
  'show.cancelled': { icon: 'cancel', tone: 'danger', label: 'Show cancelled' },
  'refund.approved': { icon: 'check', tone: 'info', label: 'Refund approved' },
  'refund.initiated': { icon: 'refund', tone: 'warning', label: 'Refund initiated' },
  'refund.retried': { icon: 'refresh', tone: 'warning', label: 'Refund retried' },
  'refund.succeeded': { icon: 'check', tone: 'success', label: 'Refund completed' },
  'refund.failed': { icon: 'alert', tone: 'danger', label: 'Refund failed' },
  'refund.rejected': { icon: 'close', tone: 'neutral', label: 'Refund rejected' },
  'settings.updated': { icon: 'settings', tone: 'neutral', label: 'Settings updated' },
  'counter.booked': { icon: 'ticket', tone: 'success', label: 'Counter sale' },
  'counter.reprinted': { icon: 'copy', tone: 'neutral', label: 'Ticket reprinted' },
  'counter.cancelled': { icon: 'cancel', tone: 'danger', label: 'Counter booking cancelled' },
  'counter.cash-refunded': { icon: 'rupee', tone: 'success', label: 'Cash refunded' },
};

/** Splits "/refunds?status=pending" into a router path and query params. */
export function splitLink(link: string): { path: string; query: Record<string, string> | null } {
  const [path, q] = link.split('?');
  return { path: path ?? link, query: q ? Object.fromEntries(new URLSearchParams(q).entries()) : null };
}

interface DayGroup { key: string; label: string; entries: AuditEntry[]; }

/**
 * A timeline of audit entries, grouped by day: what was done, to what, by whom and when, with
 * the field-level changes behind a toggle. `compact` drops the changes and the theatre name.
 */
@Component({
  selector: 'app-activity-timeline',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent],
  template: `
    @for (g of groups(); track g.key) {
      <section class="day">
        @if (!compact()) { <h3 class="day-label eyebrow">{{ g.label }}</h3> }
        <ol class="entries">
          @for (e of g.entries; track e.id) {
            <li class="entry" [class.compact]="compact()">
              <span class="mark tone-{{ meta(e).tone }}" [attr.title]="meta(e).label"><app-icon [name]="meta(e).icon" /></span>
              <div class="body">
                <p class="summary">{{ e.summary }}</p>
                <p class="target">
                  @if (e.link) { <a [routerLink]="link(e).path" [queryParams]="link(e).query">{{ e.target }}</a> } @else { <span class="soft">{{ e.target }}</span> }
                  @if (!compact() && theatreName(e); as tn) { <span class="faint"> · {{ tn }}</span> }
                </p>
                <p class="meta">
                  <span class="who">{{ e.user }}</span><span class="role">{{ e.role }}</span>
                  <time [attr.datetime]="e.at.toISOString()" [attr.title]="absolute(e.at)">{{ when(e.at) }}</time>
                  @if (!compact() && e.changes?.length) {
                    <button type="button" class="link-btn toggle" [attr.aria-expanded]="isOpen(e.id)" (click)="toggle(e.id)">
                      {{ isOpen(e.id) ? 'Hide changes' : e.changes!.length === 1 ? 'Show 1 change' : 'Show ' + e.changes!.length + ' changes' }}
                    </button>
                  }
                </p>
                @if (!compact() && isOpen(e.id) && e.changes?.length) {
                  <table class="changes">
                    <thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead>
                    <tbody>
                      @for (c of e.changes!; track $index) {
                        <tr><td>{{ fieldLabel(c.field) }}</td><td class="from">{{ c.from || '—' }}</td><td class="to">{{ c.to || '—' }}</td></tr>
                      }
                    </tbody>
                  </table>
                }
              </div>
            </li>
          }
        </ol>
      </section>
    } @empty {
      <p class="none muted small">{{ emptyText() }}</p>
    }
  `,
  styles: `
    :host { display: block; }
    .day + .day { margin-top: 14px; }
    .day-label { padding: 0 0 8px; }
    .entries { list-style: none; margin: 0; padding: 0; }
    .entry { position: relative; display: grid; grid-template-columns: 28px minmax(0, 1fr); gap: 12px; padding-bottom: 14px; }
    .entry::before { content: ''; position: absolute; left: 13.5px; top: 30px; bottom: 2px; width: 1px; background: var(--border); }
    .entry:last-child { padding-bottom: 0; }
    .entry:last-child::before { display: none; }
    .entry.compact { padding-bottom: 12px; }
    .mark { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; border: 1px solid var(--border); background: var(--surface-2); color: var(--text-muted); }
    .mark app-icon { width: 14px; height: 14px; }
    .tone-success { color: var(--success); background: var(--success-soft); border-color: transparent; }
    .tone-danger { color: var(--danger); background: var(--danger-soft); border-color: transparent; }
    .tone-warning { color: var(--warning); background: var(--warning-soft); border-color: transparent; }
    .tone-info { color: var(--info); background: var(--info-soft); border-color: transparent; }
    .tone-violet { color: var(--violet); background: var(--violet-soft); border-color: transparent; }
    .body { min-width: 0; padding-top: 3px; }
    .summary { font-size: 0.85rem; color: var(--text); overflow-wrap: anywhere; }
    .target { font-size: 0.8rem; margin-top: 1px; overflow-wrap: anywhere; }
    .target a { color: var(--text-soft); text-decoration: underline; text-decoration-color: var(--border-strong); text-underline-offset: 3px; }
    .target a:hover { color: var(--text); text-decoration-color: var(--text-muted); }
    .faint { color: var(--text-faint); }
    .meta { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; margin-top: 3px; font-size: 0.75rem; color: var(--text-muted); }
    .who { color: var(--text-soft); font-weight: 600; }
    .role { padding: 0 6px; border: 1px solid var(--border); border-radius: var(--radius-sm); font-size: 0.7rem; }
    time { cursor: default; }
    .toggle { font-size: 0.75rem; }
    .changes { width: 100%; max-width: 640px; margin-top: 8px; border-collapse: collapse; font-size: 0.78rem; border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
    .changes th { padding: 5px 10px; text-align: left; font-size: 0.66rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted); background: var(--surface-2); }
    .changes td { padding: 6px 10px; border-top: 1px solid var(--border-soft); overflow-wrap: anywhere; }
    .changes td:first-child { color: var(--text-muted); width: 30%; }
    .from { color: var(--text-muted); text-decoration: line-through; text-decoration-color: var(--text-faint); }
    .to { color: var(--text); }
    .none { padding: 8px 0; }
  `,
})
export class ActivityTimelineComponent {
  private readonly store = inject(AdminStore);

  readonly entries = input.required<AuditEntry[]>();
  readonly compact = input(false);
  readonly emptyText = input('No activity recorded.');

  private readonly open = signal<ReadonlySet<string>>(new Set());

  readonly groups = computed<DayGroup[]>(() => {
    const now = this.store.now();
    const out: DayGroup[] = [];
    for (const e of this.entries()) {
      const key = e.at.toDateString();
      let g = out[out.length - 1];
      if (!g || g.key !== key) {
        const label = sameDay(e.at, now) ? 'Today' : sameDay(e.at, addDays(now, -1)) ? 'Yesterday'
          : e.at.getFullYear() === now.getFullYear() ? formatDay(e.at) : formatDate(e.at);
        g = { key, label, entries: [] };
        out.push(g);
      }
      g.entries.push(e);
    }
    return out;
  });

  meta(e: AuditEntry) { return ACTION_META[e.action] ?? { icon: 'activity', tone: 'neutral', label: e.action }; }
  link(e: AuditEntry) { return splitLink(e.link ?? ''); }
  theatreName(e: AuditEntry): string {
    if (!e.theatreId) return '';
    const name = this.store.theatre(e.theatreId)?.name ?? '';
    return e.target.includes(name) ? '' : name;
  }
  when(d: Date): string {
    const now = this.store.now();
    return now.getTime() - d.getTime() < 86_400_000 ? formatRelative(d, now) : formatTime(d);
  }
  absolute(d: Date): string { return formatDateTime(d); }
  /** "bufferMinutes" reads as "Buffer minutes"; labels that are already words pass through. */
  fieldLabel(f: string): string {
    if (!/^[a-z]+[A-Z]/.test(f) && !/^[a-z]+$/.test(f)) return f;
    const words = f.replace(/([A-Z])/g, ' $1').toLowerCase();
    return words.charAt(0).toUpperCase() + words.slice(1);
  }
  isOpen(id: string): boolean { return this.open().has(id); }
  toggle(id: string): void {
    this.open.update((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
}
