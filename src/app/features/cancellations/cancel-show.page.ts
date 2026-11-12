import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { AdminStore } from '../../core/admin-store';
import { formatDateTime, formatDay, formatDuration, formatMoney, formatTime } from '../../core/format';
import { CANCELLATION_REASONS, CancellationReason, Refund } from '../../core/models';
import { ConfirmService, ToastService } from '../../shared/feedback';
import { IconComponent } from '../../shared/icon.component';
import { tableState } from '../../shared/table';
import { EmptyStateComponent, PageHeaderComponent, PaginatorComponent, SkeletonComponent, StatusBadgeComponent } from '../../shared/ui';

interface CancelResult {
  refunds: Refund[];
  total: number;
  autoApproved: boolean;
  notified: boolean;
}

@Component({
  selector: 'app-cancel-show-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent, PageHeaderComponent, StatusBadgeComponent, EmptyStateComponent, SkeletonComponent, PaginatorComponent],
  template: `
    <div class="page">
      <app-page-header title="Cancel show" [crumbs]="[{ label: 'Shows', link: '/shows' }, { label: info()?.film ?? 'Cancel show' }]"
        [subtitle]="info() ? info()!.film + ' · ' + info()!.screen + ' · ' + day(info()!.show.start) + ', ' + time(info()!.show.start) : ''" />

      @if (store.loading()) {
        <section class="card"><app-skeleton [rows]="8" /></section>
      } @else if (result(); as res) {
        <!-- Result: the show is cancelled; refunds are a separate step. -->
        <section class="card result">
          <div class="result-head">
            <span class="ok-mark"><app-icon name="check" /></span>
            <div>
              <h2>The show is cancelled</h2>
              <p class="soft">{{ info()?.film }} · {{ info()?.screen }} · {{ day(info()!.show.start) }}, {{ time(info()!.show.start) }} is off sale and its bookings are cancelled.</p>
            </div>
          </div>
          <dl class="facts panel">
            <dt>Refunds opened</dt><dd>{{ res.refunds.length }} totalling {{ money(res.total) }}</dd>
            <dt>Refund status</dt>
            <dd>@if (res.autoApproved) { <app-status-badge status="approved" /> <span class="soft small">approved automatically (operational setting)</span> } @else { <app-status-badge status="pending" /> <span class="soft small">waiting for approval</span> }</dd>
            <dt>Customers</dt><dd>{{ res.notified ? 'Notified by SMS and email' : 'Not notified; contact them from the box office' }}</dd>
          </dl>
          @if (res.refunds.length) {
            <div class="callout warning">
              <app-icon name="alert" />
              <span><strong>No money has been returned yet.</strong> Refunds are processed separately: open them in Refunds and send them to the payment gateway.</span>
            </div>
          }
          <div class="row-wrap">
            @if (res.refunds.length) { <a class="btn primary" routerLink="/refunds" [queryParams]="{ show: showId() }">Process {{ res.refunds.length }} refunds</a> }
            <a class="btn" routerLink="/shows" [queryParams]="{ tab: 'cancelled' }">Cancelled shows</a>
            <a class="btn ghost" [routerLink]="['/shows', showId()]">Open show</a>
          </div>
        </section>
      } @else if (!info()) {
        <section class="card">
          <app-empty-state icon="cancel" title="Show not found" [text]="'There is no show with the ID ' + showId() + ' in the selected theatre.'">
            <a class="btn" routerLink="/shows">Choose a show</a>
          </app-empty-state>
        </section>
      } @else if (blocked(); as why) {
        <section class="card">
          <app-empty-state icon="lock" [title]="why.title" [text]="why.text">
            @if (why.refunds) { <a class="btn" routerLink="/refunds" [queryParams]="{ show: showId() }">View refunds</a> }
            <a class="btn" [routerLink]="['/shows', showId()]">Open show</a>
            <a class="btn primary" routerLink="/shows">Choose another show</a>
          </app-empty-state>
        </section>
      } @else {
        @let i = info()!;
        <div class="callout info">
          <app-icon name="info" />
          <span><strong>This cancels the show for every customer</strong> and opens a refund for each booking. You send the refunds from <a routerLink="/refunds">Refunds</a>. To refund one customer only, use that page too.</span>
        </div>

        <div class="layout">
          <div class="steps">
            <!-- 1–2: the show -->
            <section class="card step">
              <div class="card-head"><h2><span class="step-no">1</span>Show details</h2><a class="small" routerLink="/shows">Choose a different show</a></div>
              <div class="card-body">
                @if (i.status === 'running') {
                  <div class="callout warning gap"><app-icon name="alert" /><span><strong>This show is running now.</strong> It started at {{ time(i.show.start) }}; customers may already be in the auditorium.</span></div>
                }
                <dl class="facts cols">
                  <dt>Film</dt><dd>{{ i.film }} <span class="muted">({{ i.certification }}, {{ duration(i.runtime) }})</span></dd>
                  <dt>Theatre</dt><dd>{{ i.theatre }}</dd>
                  <dt>Screen</dt><dd>{{ i.screen }}</dd>
                  <dt>Date</dt><dd>{{ day(i.show.start) }}</dd>
                  <dt>Time</dt><dd>{{ time(i.show.start) }} to {{ time(i.end) }}</dd>
                  <dt>Format</dt><dd>{{ i.show.format }} · {{ i.show.language }}</dd>
                  <dt>Status</dt><dd class="row-wrap"><app-status-badge status="published" /><app-status-badge [status]="i.status" /></dd>
                  <dt>Published</dt><dd>{{ i.show.publishedAt ? dateTime(i.show.publishedAt) : '—' }}</dd>
                </dl>
              </div>
            </section>

            <!-- 3–4: bookings -->
            <section class="card step">
              <div class="card-head">
                <h2><span class="step-no">2</span>Bookings affected</h2>
                <span class="soft small"><strong class="strong">{{ i.bookings.length }}</strong> bookings · <strong class="strong">{{ i.tickets }}</strong> tickets</span>
              </div>
              @if (i.bookings.length) {
                <div class="table-wrap">
                  <table class="data-table">
                    <thead><tr><th>Booking</th><th>Customer</th><th>Contact</th><th>Seats</th><th>Payment</th><th class="num">Paid</th><th>Booked</th></tr></thead>
                    <tbody>
                      @for (b of bookingTable.rows(); track b.id) {
                        <tr>
                          <td class="mono strong">{{ b.ref }}</td>
                          <td class="nowrap">{{ b.customerName }}</td>
                          <td class="nowrap">{{ b.customerPhone }}<small class="sub">{{ b.customerEmail }}</small></td>
                          <td>{{ b.seats.join(', ') }}</td>
                          <td class="nowrap">{{ b.paymentMethod }}<small class="sub mono">{{ b.paymentRef }}</small></td>
                          <td class="num money">{{ money(b.amount) }}</td>
                          <td class="nowrap">{{ dateTime(b.bookedAt) }}</td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
                <app-paginator [(page)]="bookingTable.page" [(pageSize)]="bookingTable.size" [total]="bookingTable.total()" />
              } @else {
                <p class="card-body muted small">No confirmed bookings. Cancelling takes the show off sale; no refunds are opened.</p>
              }
              @if (i.alreadyCancelled) {
                <p class="foot-note muted small">{{ i.alreadyCancelled }} bookings were already cancelled individually and are not affected.</p>
              }
            </section>

            <!-- 5–6: reason and notes -->
            <section class="card step">
              <div class="card-head"><h2><span class="step-no">3</span>Reason and internal notes</h2></div>
              <div class="card-body stack">
                <fieldset class="reasons" [class.invalid]="tried() && !reason()">
                  <legend class="field-label">Cancellation reason</legend>
                  @for (r of reasons; track r) {
                    <label class="reason-opt" [class.on]="reason() === r">
                      <input type="radio" name="reason" [value]="r" [checked]="reason() === r" (change)="reason.set(r)" />{{ r }}
                    </label>
                  }
                </fieldset>
                @if (tried() && !reason()) { <span class="error-text">Choose why the show is being cancelled.</span> }
                <div class="field">
                  <label for="cx-notes">Internal notes{{ reason() === 'Other' ? '' : ' (optional)' }}</label>
                  <textarea id="cx-notes" class="textarea" [class.invalid]="tried() && notesMissing()" [value]="notes()" (input)="notes.set($any($event.target).value)"
                    placeholder="What happened and what was done, for staff and the audit log"></textarea>
                  @if (tried() && notesMissing()) { <span class="error-text">Describe the reason when you choose Other.</span> }
                  @else { <span class="hint">Staff only. Customers never see these notes.</span> }
                </div>
              </div>
            </section>

            <!-- 7: communication -->
            <section class="card step">
              <div class="card-head"><h2><span class="step-no">4</span>Customer communication</h2></div>
              <div class="card-body stack">
                <label class="check"><input type="checkbox" [checked]="notify()" (change)="notify.set($any($event.target).checked)" />Notify customers by SMS and email</label>
                @if (notify()) {
                  <div class="reach">
                    <div><strong>{{ i.bookings.length }}</strong><span class="muted small">customers</span></div>
                    <div><strong>{{ i.phones }}</strong><span class="muted small">SMS to phone numbers</span></div>
                    <div><strong>{{ i.emails }}</strong><span class="muted small">emails</span></div>
                  </div>
                  @if (preview(); as p) {
                    <div class="previews">
                      <div class="panel">
                        <span class="eyebrow">SMS preview</span>
                        <p class="msg">{{ p.sms }}</p>
                        <span class="tiny muted">{{ p.sms.length }} characters · sample for {{ p.ref }}</span>
                      </div>
                      <div class="panel">
                        <span class="eyebrow">Email preview</span>
                        <p class="msg"><strong>Subject:</strong> {{ p.subject }}</p>
                        <p class="msg body">{{ p.body }}</p>
                      </div>
                    </div>
                  }
                } @else {
                  <div class="callout warning"><app-icon name="alert" /><span><strong>Customers will not be told.</strong> The box office must contact all {{ i.bookings.length }} customers before the show time. The decision is recorded in the audit log.</span></div>
                }
              </div>
            </section>
          </div>

          <!-- 8: summary and confirmation -->
          <aside class="card summary">
            <div class="card-head"><h2>Cancellation summary</h2></div>
            <div class="card-body">
              <dl class="ledger">
                <dt>Film</dt><dd>{{ i.film }}</dd>
                <dt>Screen</dt><dd>{{ i.screen }}</dd>
                <dt>Date</dt><dd>{{ day(i.show.start) }}</dd>
                <dt>Time</dt><dd>{{ time(i.show.start) }}</dd>
                <dt>Total bookings</dt><dd>{{ i.bookings.length }}</dd>
                <dt>Tickets sold</dt><dd>{{ i.tickets }}</dd>
                <dt>Amount collected</dt><dd>{{ money(i.collected) }}</dd>
                <dt class="big">Refunds to process</dt><dd class="big">{{ money(i.collected) }}</dd>
              </dl>
              <p class="tiny muted note">
                Full refunds, convenience fee included, to the original payment method.
                {{ store.settings().autoApproveShowRefunds ? 'They are approved automatically.' : 'They need approval before sending.' }}
              </p>
            </div>
            <div class="card-foot">
              <a class="btn" [routerLink]="['/shows', showId()]">Keep show</a>
              <button class="btn danger" type="button" (click)="submit()"><app-icon name="cancel" />Cancel show</button>
            </div>
          </aside>
        </div>
      }
    </div>
  `,
  styles: `
    .layout { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 16px; align-items: start; }
    @media (max-width: 1100px) { .layout { grid-template-columns: minmax(0, 1fr); } }
    .table-wrap { position: relative; }
    .steps { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
    .step-no { display: inline-grid; place-items: center; width: 22px; height: 22px; margin-right: 10px; border: 1px solid var(--border-strong); border-radius: 50%; font-size: 0.74rem; color: var(--text-soft); vertical-align: 1px; }
    .card-head h2 { display: flex; align-items: center; }
    .facts.cols { grid-template-columns: max-content minmax(0, 1fr) max-content minmax(0, 1fr); }
    @media (max-width: 1300px) { .facts.cols { grid-template-columns: max-content minmax(0, 1fr); } }
    .gap { margin-bottom: 14px; }
    .sub { display: block; color: var(--text-muted); font-size: 0.74rem; }
    .foot-note { padding: 10px 18px; border-top: 1px solid var(--border); }
    .reasons { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 8px; margin: 0; padding: 0; border: 0; }
    .reasons legend { margin-bottom: 8px; padding: 0; }
    .reason-opt { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface-2); font-size: 0.86rem; color: var(--text-soft); cursor: pointer; }
    .reason-opt:hover { border-color: var(--border-strong); }
    .reason-opt.on { border-color: var(--accent-line); background: var(--accent-soft); color: var(--text); }
    .reasons.invalid .reason-opt { border-color: var(--danger-line); }
    .reach { display: flex; flex-wrap: wrap; gap: 10px; }
    .reach > div { display: flex; align-items: baseline; gap: 6px; padding: 8px 12px; border: 1px solid var(--border); border-radius: var(--radius); }
    .previews { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; }
    .previews .panel { display: flex; flex-direction: column; gap: 8px; }
    .msg { font-size: 0.85rem; color: var(--text-soft); line-height: 1.5; }
    .msg.body { white-space: pre-line; }
    .summary { position: sticky; top: 16px; }
    .ledger { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px 16px; margin: 0; font-size: 0.86rem; }
    .ledger dt { color: var(--text-muted); }
    .ledger dd { margin: 0; text-align: right; font-weight: 600; }
    .ledger .big { padding-top: 10px; border-top: 1px solid var(--border); font-size: 1rem; font-weight: 700; color: var(--text); }
    .note { margin-top: 12px; }
    .result { display: flex; flex-direction: column; gap: 16px; padding: 22px; max-width: 760px; }
    .result-head { display: flex; gap: 14px; align-items: flex-start; }
    .result-head p { margin-top: 4px; }
    .ok-mark { display: grid; place-items: center; flex-shrink: 0; width: 40px; height: 40px; border-radius: 50%; background: var(--success-soft); color: var(--success); }
  `,
})
export class CancelShowPage {
  readonly showId = input.required<string>();

  readonly store = inject(AdminStore);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);

  readonly reasons = CANCELLATION_REASONS;
  readonly reason = signal<CancellationReason | null>(null);
  readonly notes = signal('');
  readonly notify = linkedSignal(() => this.store.settings().notifyCustomersByDefault);
  readonly tried = signal(false);
  readonly result = signal<CancelResult | null>(null);

  readonly money = formatMoney;
  readonly day = formatDay;
  readonly time = formatTime;
  readonly dateTime = formatDateTime;
  readonly duration = formatDuration;

  readonly notesMissing = computed(() => this.reason() === 'Other' && this.notes().trim().length < 5);

  readonly info = computed(() => {
    const show = this.store.show(this.showId());
    if (!show || !this.store.inScope(show.theatreId)) return null;
    const movie = this.store.movie(show.movieId);
    const all = this.store.bookingsOf(show.id);
    const bookings = all.filter((b) => b.status === 'confirmed');
    return {
      show,
      film: movie?.title ?? 'Film',
      certification: movie?.certification ?? '',
      runtime: movie?.runtime ?? 0,
      screen: this.store.screen(show.screenId)?.name ?? 'Screen',
      theatre: this.store.theatre(show.theatreId)?.name ?? '',
      end: this.store.showEnd(show),
      status: this.store.showStatus(show),
      bookings,
      alreadyCancelled: all.length - bookings.length,
      tickets: bookings.reduce((n, b) => n + b.seats.length, 0),
      collected: bookings.reduce((n, b) => n + b.amount, 0),
      phones: new Set(bookings.map((b) => b.customerPhone)).size,
      emails: new Set(bookings.map((b) => b.customerEmail)).size,
    };
  });

  /** Why this show cannot be cancelled, if it cannot. */
  readonly blocked = computed(() => {
    const i = this.info();
    if (!i) return null;
    if (i.show.cancellation) {
      const c = i.show.cancellation;
      return { title: 'This show is already cancelled', text: `${c.by} cancelled it on ${formatDateTime(c.at)} (${c.reason}). Its refunds are handled in Refunds.`, refunds: true };
    }
    if (i.show.publication === 'draft') {
      return { title: 'Draft shows cannot be cancelled', text: 'This show was never published, so nobody could book it. Delete the draft in Shows instead.', refunds: false };
    }
    if (i.status === 'completed') {
      return { title: 'This show has already finished', text: `It ended at ${formatTime(i.end)} on ${formatDay(i.end)}. Completed shows stay as historical records and cannot be cancelled. Refund individual customers in Refunds.`, refunds: false };
    }
    return null;
  });

  readonly bookingTable = tableState(computed(() => this.info()?.bookings ?? []), { booked: (b) => b.bookedAt }, 'booked', 'asc', 10);

  readonly preview = computed(() => {
    const i = this.info();
    const b = i?.bookings[0];
    if (!i || !b) return null;
    const when = `${formatDay(i.show.start)}, ${formatTime(i.show.start)}`;
    const reason = this.reason() && this.reason() !== 'Other' ? ` due to ${this.reason()!.toLowerCase()}` : '';
    return {
      ref: b.ref,
      sms: `ThiraiHub: ${i.film} at ${i.theatre}, ${i.screen}, ${when} is cancelled${reason}. Booking ${b.ref}: ${formatMoney(b.amount)} will be refunded to your ${b.paymentMethod} in 5-7 working days.`,
      subject: `Show cancelled: ${i.film}, ${when}`,
      body: `Dear ${b.customerName},\nWe are sorry: the ${when} show of ${i.film} at ${i.theatre} (${i.screen}) has been cancelled${reason}.\nYour booking ${b.ref} for seats ${b.seats.join(', ')} is cancelled, and the full amount of ${formatMoney(b.amount)}, convenience fee included, will be refunded to your original payment method (${b.paymentMethod}) within 5-7 working days.`,
    };
  });

  async submit(): Promise<void> {
    this.tried.set(true);
    const i = this.info();
    const reason = this.reason();
    if (!i || this.blocked()) return;
    if (!reason || this.notesMissing()) {
      this.toast.error('Complete the cancellation details', !reason ? 'Choose a cancellation reason.' : 'Describe the reason when you choose Other.');
      return;
    }
    const auto = this.store.settings().autoApproveShowRefunds;
    const n = i.bookings.length;
    const ok = await this.confirm.ask({
      title: `Cancel ${i.film} at ${formatTime(i.show.start)}?`,
      message: 'This cancels the show for every customer and cannot be undone.',
      tone: 'danger',
      requireText: 'CANCEL',
      details: [
        { label: 'Show', value: `${i.screen} · ${formatDay(i.show.start)}, ${formatTime(i.show.start)}` },
        { label: 'Reason', value: reason },
        { label: 'Bookings', value: `${n} (${i.tickets} tickets)` },
        { label: 'Refunds', value: formatMoney(i.collected) },
      ],
      consequences: [
        `The show goes off sale and all ${n} bookings are cancelled.`,
        n ? `${n} refunds totalling ${formatMoney(i.collected)} are opened${auto ? ' and approved automatically' : ', waiting for approval'}. No money moves until you process them.` : 'No refunds are needed; the show has no bookings.',
        this.notify() ? `Customers are notified by SMS (${i.phones}) and email (${i.emails}).` : 'Customers are not notified; the box office must contact them.',
      ],
      confirmLabel: 'Cancel show',
      cancelLabel: 'Keep show',
    });
    if (!ok) return;
    const refunds = this.store.cancelShow(i.show.id, { reason, notes: this.notes().trim(), notifyCustomers: this.notify() });
    if (!this.store.show(i.show.id)?.cancellation) {
      this.toast.error('The show could not be cancelled', 'It may have been changed by someone else. Reload the page and try again.');
      return;
    }
    const total = refunds.reduce((sum, r) => sum + r.amount, 0);
    this.result.set({ refunds, total, autoApproved: auto, notified: this.notify() });
    this.toast.success('Show cancelled', n ? `${refunds.length} refunds opened (${formatMoney(total)}).` : 'No bookings were affected.');
  }
}
