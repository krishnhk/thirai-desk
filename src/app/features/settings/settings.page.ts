import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal } from '@angular/core';
import { Router } from '@angular/router';

import { AdminStore, ROLE_PERMISSIONS } from '../../core/admin-store';
import { formatMoney } from '../../core/format';
import { COUNTER_PAYMENT_METHODS, CounterPaymentMethod, OperationalSettings, Permission as RolePermission, UserRole } from '../../core/models';
import { ToastService } from '../../shared/feedback';
import { IconComponent } from '../../shared/icon.component';
import { PageHeaderComponent } from '../../shared/ui';

type NumKey = 'bufferMinutes' | 'defaultIntermission' | 'convenienceFee' | 'salesCutoffMinutes' | 'counterCancellationCutoffMinutes' | 'counterCancellationFeePerTicket' | 'counterAdvanceBookingDays';

interface NumField { key: NumKey; label: string; unit: string; min: number; max: number; hint: string; }

const NUM_FIELDS: NumField[] = [
  { key: 'bufferMinutes', label: 'Cleaning buffer between shows', unit: 'min', min: 0, max: 60, hint: 'Minimum gap after a show ends before the next one on the same screen can start.' },
  { key: 'defaultIntermission', label: 'Default interval', unit: 'min', min: 0, max: 30, hint: 'Pre-filled on new shows. Set 0 for films shown without an interval.' },
  { key: 'convenienceFee', label: 'Convenience fee per ticket', unit: '₹', min: 0, max: 200, hint: 'Added to each ticket at checkout and included in booking amounts.' },
  { key: 'salesCutoffMinutes', label: 'Online sales cut-off', unit: 'min', min: 0, max: 120, hint: 'How long before the start online sales close. The box office can still sell.' },
];

const COUNTER_FIELDS: NumField[] = [
  { key: 'counterAdvanceBookingDays', label: 'Advance booking window', unit: 'days', min: 0, max: 30, hint: 'How many days ahead the box office can sell. 0 means today only.' },
  { key: 'counterCancellationCutoffMinutes', label: 'Counter cancellation cut-off', unit: 'min', min: 0, max: 240, hint: 'Counter tickets can be cancelled until this many minutes before the show starts.' },
  { key: 'counterCancellationFeePerTicket', label: 'Cancellation fee per ticket', unit: '₹', min: 0, max: 500, hint: 'Kept from the refund for each cancelled counter ticket. Not charged when the theatre cancels the show.' },
];

const METHOD_HINTS: Record<CounterPaymentMethod, string> = {
  Cash: 'Change is worked out at the counter; refunds are handed back in cash.',
  UPI: 'The operator records the UPI transaction reference.',
  Card: 'Card terminal; the operator records the terminal reference.',
  Other: 'Vouchers and gift cards, with their reference.',
};

const LABELS: Record<keyof OperationalSettings, string> = {
  bufferMinutes: 'Cleaning buffer', defaultIntermission: 'Default interval', convenienceFee: 'Convenience fee',
  salesCutoffMinutes: 'Sales cut-off', autoApproveShowRefunds: 'Auto-approve refunds', notifyCustomersByDefault: 'Notify customers',
  counterPaymentMethods: 'Counter payment methods', counterCancellationCutoffMinutes: 'Counter cancellation cut-off', counterCancellationFeePerTicket: 'Counter cancellation fee', counterAdvanceBookingDays: 'Counter advance booking window',
};

type Access = 'yes' | 'no' | 'limited';
type RoleKey = 'owner' | 'gm' | 'ops' | 'admin' | 'sup' | 'op';
type Permission = { area: string; note?: string } & Record<RoleKey, Access>;

const ROLE_COLUMNS: { key: RoleKey; label: UserRole }[] = [
  { key: 'owner', label: 'Owner' }, { key: 'gm', label: 'General Manager' }, { key: 'admin', label: 'Theatre Administrator' },
  { key: 'ops', label: 'Operations Staff' }, { key: 'sup', label: 'Counter Supervisor' }, { key: 'op', label: 'Counter Operator' },
];

/** Counter capabilities, read from the permissions the console enforces. */
const COUNTER_CAPABILITIES: { area: string; perm: RolePermission; limitedBy?: RolePermission; note?: string }[] = [
  { area: 'Sell tickets at the box office', perm: 'counter.sell', note: 'View published shows, select seats, collect payment and print tickets.' },
  { area: 'View counter booking history', perm: 'counter.history.all', limitedBy: 'counter.history.own', note: 'Counter operators see their own sales only.' },
  { area: 'Cancel counter bookings', perm: 'counter.cancel', note: 'Within the counter cancellation cut-off.' },
  { area: 'Hand back cash refunds', perm: 'counter.refund' },
  { area: 'Counter reports and operator monitoring', perm: 'counter.reports', limitedBy: 'counter.sell', note: 'Counter operators see their own sales for the day.' },
  { area: 'Configure counter payment methods and policy', perm: 'counter.configure' },
  { area: 'Manage counter operators', perm: 'counter.operators' },
];

function roleAccess(role: UserRole, perm: RolePermission, limitedBy?: RolePermission): Access {
  const perms = ROLE_PERMISSIONS[role] ?? [];
  if (perms.includes('admin.all') || perms.includes(perm)) return 'yes';
  return limitedBy && perms.includes(limitedBy) ? 'limited' : 'no';
}

const PERMISSIONS: Permission[] = [
  { area: 'Add, edit and deactivate theatres', owner: 'yes', gm: 'limited', ops: 'no', admin: 'limited', sup: 'no', op: 'no', note: 'General managers edit details of their theatres; only owners add or deactivate.' },
  { area: 'Create, edit and delete screens', owner: 'yes', gm: 'yes', ops: 'no', admin: 'yes', sup: 'no', op: 'no' },
  { area: 'Design and publish seat layouts', owner: 'yes', gm: 'yes', ops: 'limited', admin: 'yes', sup: 'no', op: 'no', note: 'Operations staff can save drafts; publishing needs a manager.' },
  { area: 'Manage the film catalogue', owner: 'yes', gm: 'yes', ops: 'no', admin: 'yes', sup: 'no', op: 'no' },
  { area: 'Create and edit draft shows', owner: 'yes', gm: 'yes', ops: 'yes', admin: 'yes', sup: 'no', op: 'no' },
  { area: 'Publish shows', owner: 'yes', gm: 'yes', ops: 'limited', admin: 'yes', sup: 'no', op: 'no', note: 'Operations staff publish single shows; bulk publishing needs a manager.' },
  { area: 'Cancel published shows', owner: 'yes', gm: 'yes', ops: 'no', admin: 'yes', sup: 'no', op: 'no' },
  { area: 'Approve, reject and initiate refunds', owner: 'yes', gm: 'yes', ops: 'no', admin: 'yes', sup: 'limited', op: 'no', note: 'Counter supervisors approve counter cancellations and hand back cash refunds.' },
  { area: 'View reports and the activity log', owner: 'yes', gm: 'yes', ops: 'limited', admin: 'yes', sup: 'no', op: 'no', note: 'Operations staff see their own theatre only.' },
  { area: 'Change operational settings', owner: 'yes', gm: 'yes', ops: 'no', admin: 'yes', sup: 'no', op: 'no' },
  ...COUNTER_CAPABILITIES.map((c) => ({ area: c.area, note: c.note, ...Object.fromEntries(ROLE_COLUMNS.map((r) => [r.key, roleAccess(r.label, c.perm, c.limitedBy)])) }) as Permission),
];

/** Operational settings, the signed-in account and what each role can do. */
@Component({
  selector: 'app-settings-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeaderComponent, IconComponent],
  template: `
    <div class="page">
      <app-page-header title="Settings" />

      <div class="tabs" role="tablist" aria-label="Settings sections">
        <button class="tab" type="button" role="tab" [attr.aria-selected]="current() === 'general'" (click)="setTab('general')">General</button>
        <button class="tab" type="button" role="tab" [attr.aria-selected]="current() === 'box'" (click)="setTab('box')">Box office</button>
        <button class="tab" type="button" role="tab" [attr.aria-selected]="current() === 'roles'" (click)="setTab('roles')">Roles and permissions</button>
      </div>

      @if (current() === 'general' || current() === 'box') {
        <form class="card" novalidate (submit)="$event.preventDefault(); save()">
          @if (current() === 'general') {
            <h2 class="group">Shows and sales</h2>
            @for (f of fields; track f.key) {
              <div class="row">
                <div class="text"><label [for]="'set-' + f.key">{{ f.label }}</label><p>{{ f.hint }}</p></div>
                <div class="control">
                  <div class="numfield" [class.bad]="errors()[f.key]">
                    @if (f.unit === '₹') { <span class="u">₹</span> }
                    <input class="input" type="number" [id]="'set-' + f.key" [min]="f.min" [max]="f.max" step="1" [value]="draft()[f.key]" (input)="setNum(f.key, $event)" [attr.aria-invalid]="!!errors()[f.key]" />
                    @if (f.unit !== '₹') { <span class="u">{{ f.unit }}</span> }
                  </div>
                  @if (errors()[f.key]) { <span class="error-text">{{ errors()[f.key] }}</span> } @else if (changed().includes(f.key)) { <span class="was">Was {{ f.unit === '₹' ? formatMoney(saved()[f.key]) : saved()[f.key] + ' ' + f.unit }}</span> }
                </div>
              </div>
            }
            <h2 class="group">Refunds and notifications</h2>
            <div class="row">
              <div class="text"><label for="set-auto">Auto-approve refunds for cancelled shows</label><p>Refunds for a cancelled show start approved, so you only need to send them. Customer cancellations still need review.</p></div>
              <div class="control"><label class="switch"><input id="set-auto" type="checkbox" [checked]="draft().autoApproveShowRefunds" (change)="setBool('autoApproveShowRefunds', $event)" /><span>{{ draft().autoApproveShowRefunds ? 'On' : 'Off' }}</span></label></div>
            </div>
            <div class="row">
              <div class="text"><label for="set-notify">Notify customers by default</label><p>Send an SMS and email to customers when a show is cancelled. You can still turn it off on the cancel form.</p></div>
              <div class="control"><label class="switch"><input id="set-notify" type="checkbox" [checked]="draft().notifyCustomersByDefault" (change)="setBool('notifyCustomersByDefault', $event)" /><span>{{ draft().notifyCustomersByDefault ? 'On' : 'Off' }}</span></label></div>
            </div>
          } @else {
            <div class="group with-note">
              <h2>Box office</h2>
              @if (!canConfigure()) { <span class="badge neutral plain"><app-icon name="lock" />Theatre administrators only</span> }
            </div>
            <fieldset class="row plain" [disabled]="!canConfigure()">
              <div class="text"><legend>Counter payment methods</legend><p>What the box office accepts. Turning a method off hides it on the sale screen; past sales keep their payment record.</p></div>
              <div class="control methods">
                @for (m of counterMethods; track m) {
                  <label class="pill" [title]="methodHints[m]"><input type="checkbox" [checked]="draft().counterPaymentMethods.includes(m)" (change)="toggleMethod(m, $event)" /><span>{{ m }}</span></label>
                }
                @if (methodsError()) { <span class="error-text">{{ methodsError() }}</span> } @else if (changed().includes('counterPaymentMethods')) { <span class="was">Was {{ saved().counterPaymentMethods.join(', ') }}</span> }
              </div>
            </fieldset>
            @for (f of counterFields; track f.key) {
              <fieldset class="row plain" [disabled]="!canConfigure()">
                <div class="text"><label [for]="'set-' + f.key">{{ f.label }}</label><p>{{ f.hint }}</p></div>
                <div class="control">
                  <div class="numfield" [class.bad]="errors()[f.key]">
                    @if (f.unit === '₹') { <span class="u">₹</span> }
                    <input class="input" type="number" [id]="'set-' + f.key" [min]="f.min" [max]="f.max" step="1" [value]="draft()[f.key]" (input)="setNum(f.key, $event)" [attr.aria-invalid]="!!errors()[f.key]" />
                    @if (f.unit !== '₹') { <span class="u">{{ f.unit }}</span> }
                  </div>
                  @if (errors()[f.key]) { <span class="error-text">{{ errors()[f.key] }}</span> } @else if (changed().includes(f.key)) { <span class="was">Was {{ f.unit === '₹' ? formatMoney(saved()[f.key]) : saved()[f.key] + ' ' + f.unit }}</span> }
                </div>
              </fieldset>
            }
          }
          <div class="savebar">
            <span class="muted small">@if (changed().length) { {{ changed().length }} unsaved {{ changed().length === 1 ? 'change' : 'changes' }} } @else { All changes saved }</span>
            <div class="actions">
              <button type="button" class="btn" [disabled]="!changed().length" (click)="reset()">Discard</button>
              <button type="submit" class="btn primary" [disabled]="!changed().length || !valid()">Save settings</button>
            </div>
          </div>
        </form>
      }

      @if (current() === 'roles') {
        <section class="card">
          <p class="note">What each role can do. Box office permissions are enforced in this prototype; the others are shown for reference.</p>
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>Capability</th>@for (r of roles; track r.key) { <th class="c" [class.me]="r.label === store.currentUser().role">{{ r.label }}</th> }</tr></thead>
              <tbody>
                @for (p of permissions; track p.area) {
                  @if (p.area === firstCounterArea) { <tr class="group-row"><td [attr.colspan]="roles.length + 1">Box office</td></tr> }
                  <tr>
                    <td><span class="soft">{{ p.area }}</span>@if (p.note) { <small class="block muted">{{ p.note }}</small> }</td>
                    @for (r of roles; track r.key) {
                      <td class="c" [class.me]="r.label === store.currentUser().role">
                        @switch (p[r.key]) {
                          @case ('yes') { <span class="acc yes" title="Allowed"><app-icon name="check" /><span class="sr-only">Allowed</span></span> }
                          @case ('limited') { <span class="acc limited">Limited</span> }
                          @default { <span class="acc no" title="Not allowed">—<span class="sr-only">Not allowed</span></span> }
                        }
                      </td>
                    }
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>
      }

    </div>
  `,
  styles: `
    .group { margin: 0; padding: 16px 22px 10px; font-size: 0.74rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted); }
    .group.with-note { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
    .group.with-note h2 { margin: 0; font: inherit; letter-spacing: inherit; text-transform: inherit; color: inherit; }
    .group .badge { letter-spacing: 0; text-transform: none; }
    .group .badge app-icon { width: 12px; height: 12px; }
    .row { display: grid; grid-template-columns: minmax(0, 1fr) 210px; gap: 8px 28px; align-items: center; padding: 15px 22px; border-top: 1px solid var(--border-soft); }
    .group + .row { border-top-color: var(--border-soft); }
    .text label, .text legend { display: block; padding: 0; font-size: 0.92rem; font-weight: 600; color: var(--text); }
    .text p { margin: 3px 0 0; max-width: 62ch; font-size: 0.82rem; line-height: 1.45; color: var(--text-muted); }
    .control { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
    .numfield { display: flex; align-items: center; width: 150px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface-2); }
    .numfield:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
    .numfield.bad { border-color: var(--danger); }
    .numfield .input { flex: 1; min-width: 0; height: 36px; border: 0; background: none; box-shadow: none; text-align: right; font-variant-numeric: tabular-nums; }
    .numfield .u { padding: 0 11px; font-size: 0.82rem; color: var(--text-muted); }
    .numfield .u:first-child { padding: 0 0 0 11px; }
    .was { font-size: 0.76rem; color: var(--text-muted); }
    .switch { display: inline-flex; align-items: center; gap: 10px; cursor: pointer; font-size: 0.85rem; font-weight: 600; color: var(--text-soft); }
    .switch input { appearance: none; position: relative; width: 38px; height: 22px; margin: 0; border-radius: 999px; background: var(--surface-3); border: 1px solid var(--border-strong); cursor: pointer; transition: background 120ms ease; }
    .switch input::after { content: ''; position: absolute; top: 3px; left: 3px; width: 14px; height: 14px; border-radius: 50%; background: var(--text-muted); transition: transform 120ms ease; }
    .switch input:checked { background: var(--accent); border-color: var(--accent); }
    .switch input:checked::after { transform: translateX(16px); background: var(--on-accent); }
    fieldset.plain { margin: 0; min-width: 0; border-width: 1px 0 0; }
    fieldset:disabled { opacity: 0.6; }
    .methods { flex-direction: row; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
    .methods .error-text, .methods .was { flex-basis: 100%; text-align: right; }
    .pill { cursor: pointer; }
    .pill input { position: absolute; opacity: 0; width: 1px; height: 1px; }
    .pill span { display: inline-flex; align-items: center; min-height: 32px; padding: 0 14px; border: 1px solid var(--border); border-radius: 999px; background: none; font-size: 0.84rem; font-weight: 600; color: var(--text-muted); }
    .pill:hover span { color: var(--text); border-color: var(--border-strong); }
    .pill input:checked + span { background: var(--accent-soft); border-color: var(--accent-line); color: var(--accent); }
    .pill input:focus-visible + span { outline: 2px solid var(--accent); outline-offset: 2px; }
    .savebar { position: sticky; bottom: 0; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 22px; border-top: 1px solid var(--border); border-radius: 0 0 var(--radius-lg) var(--radius-lg); background: var(--surface); }
    .actions { display: flex; gap: 8px; }
    .note { margin: 0; padding: 13px 20px; border-bottom: 1px solid var(--border); font-size: 0.84rem; color: var(--text-muted); }
    .note.with-action { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
    .block { display: block; font-size: 0.74rem; }
    .c { text-align: center; width: 112px; white-space: normal; }
    th.me { color: var(--text); }
    td.me { background: var(--tint); }
    .acc { display: inline-flex; align-items: center; justify-content: center; }
    .acc.yes { color: var(--success); }
    .acc.yes app-icon { width: 16px; height: 16px; }
    .acc.no { color: var(--text-faint); }
    .acc.limited { padding: 1px 8px; border-radius: 999px; background: var(--warning-soft); color: var(--warning); font-size: 0.72rem; font-weight: 700; }
    tr.group-row td { padding-top: 14px; font-size: 0.68rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted); background: var(--surface-2); }
    @media (max-width: 700px) {
      .row { grid-template-columns: minmax(0, 1fr); }
      .control, .methods { align-items: flex-start; justify-content: flex-start; }
      .methods .error-text, .methods .was { text-align: left; }
    }
  `,
})
export class SettingsPage {
  protected readonly store = inject(AdminStore);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  /** ?tab=box | roles; General when absent. */
  readonly tab = input<string>();
  readonly current = computed<'general' | 'box' | 'roles'>(() => {
    const t = this.tab();
    return t === 'box' || t === 'roles' ? t : 'general';
  });
  setTab(tab: 'general' | 'box' | 'roles'): void {
    void this.router.navigate([], { queryParams: { tab: tab === 'general' ? null : tab }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  protected readonly formatMoney = formatMoney;
  readonly fields = NUM_FIELDS;
  readonly counterFields = COUNTER_FIELDS;
  readonly counterMethods = COUNTER_PAYMENT_METHODS;
  readonly methodHints = METHOD_HINTS;
  readonly permissions = PERMISSIONS;
  readonly firstCounterArea = COUNTER_CAPABILITIES[0]!.area;
  readonly roles = ROLE_COLUMNS;

  readonly canConfigure = computed(() => this.store.can('counter.configure'));
  readonly saved = computed(() => this.store.settings());
  /** The form's working copy; raw strings for numbers so half-typed values can be validated. */
  readonly draft = linkedSignal<OperationalSettings, Record<NumKey, string> & Pick<OperationalSettings, 'autoApproveShowRefunds' | 'notifyCustomersByDefault' | 'counterPaymentMethods'>>({
    source: this.saved,
    computation: (s) => this.toDraft(s),
  });

  readonly errors = computed<Partial<Record<NumKey, string>>>(() => {
    const d = this.draft();
    const e: Partial<Record<NumKey, string>> = {};
    for (const f of [...NUM_FIELDS, ...COUNTER_FIELDS]) {
      const raw = d[f.key].trim();
      const n = Number(raw);
      if (raw === '' || !Number.isInteger(n)) e[f.key] = 'Enter a whole number.';
      else if (n < f.min || n > f.max) e[f.key] = `Enter a value from ${f.min} to ${f.max}.`;
    }
    return e;
  });
  readonly methodsError = computed(() => (this.draft().counterPaymentMethods.length ? '' : 'Keep at least one payment method.'));
  readonly valid = computed(() => Object.keys(this.errors()).length === 0 && !this.methodsError());

  private readonly parsed = computed<OperationalSettings>(() => {
    const d = this.draft();
    return {
      ...this.store.settings(),
      bufferMinutes: Number(d.bufferMinutes), defaultIntermission: Number(d.defaultIntermission), convenienceFee: Number(d.convenienceFee),
      salesCutoffMinutes: Number(d.salesCutoffMinutes), autoApproveShowRefunds: d.autoApproveShowRefunds, notifyCustomersByDefault: d.notifyCustomersByDefault,
      counterPaymentMethods: d.counterPaymentMethods, counterCancellationCutoffMinutes: Number(d.counterCancellationCutoffMinutes),
      counterCancellationFeePerTicket: Number(d.counterCancellationFeePerTicket),
      counterAdvanceBookingDays: Number(d.counterAdvanceBookingDays),
    };
  });

  readonly changed = computed(() => {
    const p = this.parsed();
    const s = this.saved();
    const same = (a: unknown, b: unknown) => (Array.isArray(a) && Array.isArray(b) ? a.join() === b.join() : a === b);
    return (Object.keys(s) as (keyof OperationalSettings)[]).filter((k) => !same(p[k], s[k]));
  });

  setNum(key: NumKey, ev: Event): void {
    const value = (ev.target as HTMLInputElement).value;
    this.draft.update((d) => ({ ...d, [key]: value }));
  }
  setBool(key: 'autoApproveShowRefunds' | 'notifyCustomersByDefault', ev: Event): void {
    const value = (ev.target as HTMLInputElement).checked;
    this.draft.update((d) => ({ ...d, [key]: value }));
  }

  toggleMethod(method: CounterPaymentMethod, ev: Event): void {
    const on = (ev.target as HTMLInputElement).checked;
    this.draft.update((d) => {
      const set = new Set(d.counterPaymentMethods);
      if (on) set.add(method); else set.delete(method);
      // Keep the canonical order so the diff and the audit entry read the same way every time.
      return { ...d, counterPaymentMethods: COUNTER_PAYMENT_METHODS.filter((m) => set.has(m)) };
    });
  }

  reset(): void {
    this.draft.set(this.toDraft(this.saved()));
  }

  private toDraft(s: OperationalSettings) {
    return {
      bufferMinutes: String(s.bufferMinutes), defaultIntermission: String(s.defaultIntermission), convenienceFee: String(s.convenienceFee),
      salesCutoffMinutes: String(s.salesCutoffMinutes), autoApproveShowRefunds: s.autoApproveShowRefunds, notifyCustomersByDefault: s.notifyCustomersByDefault,
      counterPaymentMethods: [...s.counterPaymentMethods], counterCancellationCutoffMinutes: String(s.counterCancellationCutoffMinutes),
      counterCancellationFeePerTicket: String(s.counterCancellationFeePerTicket),
      counterAdvanceBookingDays: String(s.counterAdvanceBookingDays),
    };
  }

  save(): void {
    if (!this.valid() || !this.changed().length) return;
    const changed = this.changed();
    const p = this.parsed();
    const patch: Partial<OperationalSettings> = {};
    for (const k of changed) {
      // Box office settings change only for those allowed to configure the counter.
      if (k.startsWith('counter') && !this.canConfigure()) continue;
      (patch as Record<string, unknown>)[k] = p[k];
    }
    this.store.updateSettings(patch);
    this.toast.success('Settings saved', `Updated ${changed.map((k) => LABELS[k].toLowerCase()).join(', ')}.`);
  }
}
