import { ChangeDetectionStrategy, Component, computed, inject, signal, WritableSignal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ALL_THEATRES, AdminStore } from '../../core/admin-store';
import { addDays, formatDate, formatDateTime, formatDay, formatRelative, formatTime, fromDateInput, sameDay } from '../../core/format';
import { AuditAction, AuditEntry } from '../../core/models';
import { ACTION_META, splitLink } from '../../shared/activity-timeline.component';
import { ToastService } from '../../shared/feedback';
import { IconComponent } from '../../shared/icon.component';
import { EmptyStateComponent, SkeletonComponent } from '../../shared/ui';

/** The kinds of activity people look for, as quick filters. */
const CATEGORIES: { id: string; label: string; match: (a: AuditAction) => boolean }[] = [
  { id: 'shows', label: 'Shows', match: (a) => a.startsWith('show.') },
  { id: 'refunds', label: 'Refunds', match: (a) => a.startsWith('refund.') },
  { id: 'box', label: 'Box office', match: (a) => a.startsWith('counter.') },
  { id: 'setup', label: 'Setup', match: (a) => /^(theatre|screen|layout|movie|settings)\./.test(a) },
];

const PAGE = 30;

interface DayGroup { key: string; label: string; entries: AuditEntry[]; }

/** The full audit trail: a compact list grouped by day, with category chips, filters and CSV export. */
@Component({
  selector: 'app-activity-log',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, EmptyStateComponent, SkeletonComponent, IconComponent],
  template: `
    <section class="card">
      <div class="bar">
        <div class="search-input grow">
          <app-icon name="search" />
          <input class="input" type="search" aria-label="Search activity" placeholder="Search summary, record or booking reference" [value]="query()" (input)="set(query, $event)" />
        </div>
        <select class="select" aria-label="User" [value]="user()" (change)="set(user, $event)">
          <option value="">All users</option>
          @for (u of users(); track u) { <option [value]="u" [selected]="u === user()">{{ u }}</option> }
        </select>
        @if (store.theatres().length > 1) {
          <select class="select" aria-label="Theatre" [value]="theatre()" (change)="set(theatre, $event)">
            <option value="">{{ allScope() ? 'All theatres' : 'This theatre and account-wide' }}</option>
            @if (allScope()) { @for (t of store.theatres(); track t.id) { <option [value]="t.id" [selected]="t.id === theatre()">{{ t.name }}</option> } }
            <option value="none">Account-wide only</option>
          </select>
        }
        <div class="range" role="group" aria-label="Date range">
          <input class="input" type="date" aria-label="From" [value]="from()" [max]="to() || null" (change)="set(from, $event)" />
          <span class="to" aria-hidden="true">–</span>
          <input class="input" type="date" aria-label="To" [value]="to()" [min]="from() || null" (change)="set(to, $event)" />
        </div>
        <button type="button" class="btn" [disabled]="!filtered().length" (click)="exportCsv()"><app-icon name="download" />Export</button>
      </div>

      <div class="chips" role="group" aria-label="Kind of activity">
        <button type="button" class="chip" [attr.aria-pressed]="!category()" (click)="setCategory('')">All<span class="n">{{ counts()['all'] }}</span></button>
        @for (c of categories; track c.id) {
          <button type="button" class="chip" [attr.aria-pressed]="category() === c.id" (click)="setCategory(c.id)">{{ c.label }}<span class="n">{{ counts()[c.id] ?? 0 }}</span></button>
        }
        @if (hasFilters()) { <button type="button" class="link-btn small reset" (click)="clear()">Reset filters</button> }
      </div>

      @if (store.loading()) {
        <app-skeleton [rows]="8" />
      } @else if (filtered().length) {
        @for (g of days(); track g.key) {
          <div class="day"><span>{{ g.label }}</span><small>{{ g.entries.length }}</small></div>
          <ul class="list">
            @for (e of g.entries; track e.id) {
              <li class="entry">
                <span class="mark tone-{{ meta(e).tone }}" [attr.title]="meta(e).label"><app-icon [name]="meta(e).icon" /></span>
                <div class="main">
                  <p class="summary">{{ e.summary }}</p>
                  <p class="target">
                    @if (e.link) { <a [routerLink]="link(e).path" [queryParams]="link(e).query">{{ e.target }}</a> } @else { <span>{{ e.target }}</span> }
                    @if (theatreName(e); as tn) { <span class="faint"> · {{ tn }}</span> }
                    @if (e.changes?.length) {
                      <button type="button" class="link-btn toggle" [attr.aria-expanded]="isOpen(e.id)" (click)="toggle(e.id)">{{ isOpen(e.id) ? 'Hide changes' : e.changes!.length === 1 ? 'Show 1 change' : 'Show ' + e.changes!.length + ' changes' }}</button>
                    }
                  </p>
                  @if (isOpen(e.id) && e.changes?.length) {
                    <table class="changes">
                      <thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead>
                      <tbody>
                        @for (c of e.changes!; track $index) { <tr><td>{{ fieldLabel(c.field) }}</td><td class="from">{{ c.from || '—' }}</td><td class="now">{{ c.to || '—' }}</td></tr> }
                      </tbody>
                    </table>
                  }
                </div>
                <div class="who"><strong>{{ e.user }}</strong><small>{{ e.role }}</small></div>
                <time class="at" [attr.datetime]="e.at.toISOString()" [attr.title]="absolute(e.at)">{{ clock(e.at) }}</time>
              </li>
            }
          </ul>
        }
        @if (filtered().length > limit()) {
          <div class="foot">
            <span class="muted small">Showing {{ visible().length }} of {{ filtered().length }}</span>
            <button type="button" class="btn sm" (click)="limit.set(limit() + page)">Load {{ Math.min(page, filtered().length - limit()) }} more</button>
          </div>
        }
      } @else {
        <app-empty-state icon="activity" title="No activity matches" text="Widen the date range or reset the filters.">
          <button type="button" class="btn" (click)="clear()">Reset filters</button>
        </app-empty-state>
      }
    </section>
  `,
  styles: `
    .bar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 14px 16px 10px; }
    .bar .grow { flex: 1 1 260px; min-width: 200px; }
    .bar .select { width: auto; min-width: 130px; max-width: 200px; }
    .bar .input, .bar .select, .bar .btn { height: 36px; min-height: 36px; }
    .bar .input, .bar .select { padding-top: 0; padding-bottom: 0; }
    .range { display: inline-flex; align-items: center; gap: 6px; }
    .range .input { width: 140px; }
    .to { color: var(--text-muted); }
    .chips { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 2px 16px 14px; border-bottom: 1px solid var(--border); }
    .chip { display: inline-flex; align-items: center; gap: 8px; min-height: 32px; padding: 0 12px; border: 1px solid var(--border); border-radius: 999px; background: none; color: var(--text-muted); font-size: 0.82rem; font-weight: 600; }
    .chip:hover { color: var(--text); border-color: var(--border-strong); }
    .chip[aria-pressed='true'] { background: var(--accent-soft); border-color: var(--accent-line); color: var(--accent); }
    .chip .n { min-width: 18px; padding: 0 6px; border-radius: 999px; background: var(--surface-3); color: var(--text-soft); font-size: 0.7rem; line-height: 18px; text-align: center; }
    .chip[aria-pressed='true'] .n { background: var(--accent-soft); color: var(--accent); }
    .reset { margin-left: auto; }

    .day { display: flex; align-items: baseline; gap: 8px; padding: 10px 20px; background: var(--surface-2); border-bottom: 1px solid var(--border-soft); font-size: 0.7rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted); }
    .day small { font-size: 0.7rem; font-weight: 600; letter-spacing: 0; color: var(--text-faint); }
    .list { margin: 0; padding: 0; list-style: none; }
    .entry { display: grid; grid-template-columns: 30px minmax(0, 1fr) 180px 74px; align-items: start; gap: 4px 16px; padding: 12px 20px; border-bottom: 1px solid var(--border-soft); }
    .entry:last-child { border-bottom: 0; }
    .entry:hover { background: var(--surface-hover); }
    .mark { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50%; background: var(--surface-2); color: var(--text-muted); }
    .mark app-icon { width: 15px; height: 15px; }
    .tone-success { color: var(--success); background: var(--success-soft); }
    .tone-danger { color: var(--danger); background: var(--danger-soft); }
    .tone-warning { color: var(--warning); background: var(--warning-soft); }
    .tone-info { color: var(--info); background: var(--info-soft); }
    .tone-violet { color: var(--violet); background: var(--violet-soft); }
    .main { min-width: 0; }
    .summary { margin: 0; font-size: 0.88rem; font-weight: 600; color: var(--text); overflow-wrap: anywhere; }
    .target { margin: 2px 0 0; font-size: 0.8rem; color: var(--text-muted); overflow-wrap: anywhere; }
    .target a { color: var(--text-soft); text-decoration: underline; text-decoration-color: var(--border-strong); text-underline-offset: 3px; }
    .target a:hover { color: var(--text); }
    .faint { color: var(--text-faint); }
    .toggle { margin-left: 10px; font-size: 0.78rem; }
    .who { display: flex; flex-direction: column; min-width: 0; line-height: 1.3; }
    .who strong { font-size: 0.84rem; font-weight: 600; }
    .who small { font-size: 0.74rem; color: var(--text-muted); }
    .at { justify-self: end; padding-top: 1px; font-size: 0.8rem; color: var(--text-muted); white-space: nowrap; cursor: default; }
    .changes { width: 100%; max-width: 640px; margin-top: 8px; border-collapse: collapse; font-size: 0.78rem; border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
    .changes th { padding: 5px 10px; text-align: left; font-size: 0.66rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted); background: var(--surface-2); }
    .changes td { padding: 6px 10px; border-top: 1px solid var(--border-soft); overflow-wrap: anywhere; }
    .changes td:first-child { color: var(--text-muted); width: 30%; }
    .from { color: var(--text-muted); text-decoration: line-through; text-decoration-color: var(--text-faint); }
    .now { color: var(--text); }
    .foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 20px; border-top: 1px solid var(--border); }
    @media (max-width: 900px) {
      .entry { grid-template-columns: 30px minmax(0, 1fr) auto; }
      .who { grid-column: 2; flex-direction: row; gap: 8px; align-items: baseline; }
      .at { grid-column: 3; grid-row: 1; }
      .range { flex: 1 1 100%; }
      .range .input { flex: 1; width: auto; }
      .bar .select { flex: 1 1 130px; max-width: none; }
    }
  `,
})
export class ActivityLogComponent {
  protected readonly store = inject(AdminStore);
  private readonly toast = inject(ToastService);

  protected readonly Math = Math;
  readonly categories = CATEGORIES;
  readonly page = PAGE;

  readonly query = signal('');
  readonly category = signal('');
  readonly user = signal('');
  readonly theatre = signal('');
  readonly from = signal('');
  readonly to = signal('');
  readonly limit = signal(PAGE);
  private readonly open = signal<ReadonlySet<string>>(new Set());

  readonly allScope = computed(() => this.store.selectedTheatreId() === ALL_THEATRES);
  readonly source = computed(() => this.store.scopedAudit());
  readonly users = computed(() => [...new Set(this.store.audit().map((a) => a.user))].sort());

  /** Everything except the category chips, so the chip counts follow the other filters. */
  private readonly beforeCategory = computed<AuditEntry[]>(() => {
    const q = this.query().trim().toLowerCase();
    const user = this.user();
    const th = this.theatre();
    const from = this.from() ? fromDateInput(this.from()).getTime() : -Infinity;
    const to = this.to() ? addDays(fromDateInput(this.to()), 1).getTime() : Infinity;
    return this.source().filter((a) =>
      (!user || a.user === user) &&
      (!th || (th === 'none' ? a.theatreId === null : a.theatreId === th)) &&
      a.at.getTime() >= from && a.at.getTime() < to &&
      (!q || `${a.summary} ${a.target} ${a.user} ${ACTION_META[a.action]?.label ?? ''}`.toLowerCase().includes(q)));
  });

  readonly counts = computed<Record<string, number>>(() => {
    const list = this.beforeCategory();
    const out: Record<string, number> = { all: list.length };
    for (const c of CATEGORIES) out[c.id] = list.filter((a) => c.match(a.action)).length;
    return out;
  });

  readonly filtered = computed<AuditEntry[]>(() => {
    const cat = CATEGORIES.find((c) => c.id === this.category());
    return cat ? this.beforeCategory().filter((a) => cat.match(a.action)) : this.beforeCategory();
  });

  readonly visible = computed(() => this.filtered().slice(0, this.limit()));
  readonly hasFilters = computed(() => !!(this.query() || this.category() || this.user() || this.theatre() || this.from() || this.to()));

  readonly days = computed<DayGroup[]>(() => {
    const now = this.store.now();
    const out: DayGroup[] = [];
    for (const e of this.visible()) {
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
  /** The theatre's name, only when several theatres exist and the target does not already say it. */
  theatreName(e: AuditEntry): string {
    if (this.store.theatres().length < 2 || !e.theatreId) return '';
    const name = this.store.theatre(e.theatreId)?.name ?? '';
    return e.target.includes(name) ? '' : name;
  }
  clock(d: Date): string { return formatTime(d); }
  absolute(d: Date): string { return `${formatDateTime(d)} · ${formatRelative(d, this.store.now())}`; }
  /** "bufferMinutes" reads as "Buffer minutes"; labels that are already words pass through. */
  fieldLabel(f: string): string {
    if (!/^[a-z]+[A-Z]/.test(f) && !/^[a-z]+$/.test(f)) return f;
    const words = f.replace(/([A-Z])/g, ' $1').toLowerCase();
    return words.charAt(0).toUpperCase() + words.slice(1);
  }
  isOpen(id: string): boolean { return this.open().has(id); }
  toggle(id: string): void {
    this.open.update((s) => { const next = new Set(s); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  set(sig: WritableSignal<string>, ev: Event): void {
    sig.set((ev.target as HTMLInputElement).value);
    this.limit.set(PAGE);
  }

  setCategory(id: string): void {
    this.category.set(id);
    this.limit.set(PAGE);
  }

  clear(): void {
    for (const s of [this.query, this.category, this.user, this.theatre, this.from, this.to]) s.set('');
    this.limit.set(PAGE);
  }

  exportCsv(): void {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const rows = [['Time', 'User', 'Role', 'Action', 'Theatre', 'Target', 'Summary', 'Changes']];
    for (const a of this.filtered()) {
      rows.push([
        formatDateTime(a.at), a.user, a.role, ACTION_META[a.action]?.label ?? a.action, a.theatreId ? this.store.theatre(a.theatreId)?.name ?? a.theatreId : 'Account-wide',
        a.target, a.summary, (a.changes ?? []).map((c) => `${c.field}: ${c.from} → ${c.to}`).join('; '),
      ]);
    }
    const blob = new Blob(['﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `activity-log-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    this.toast.success('Activity log exported', `${this.filtered().length} entries downloaded as CSV.`);
  }
}
