import { Injectable, effect, inject, signal, untracked } from '@angular/core';

import { AdminStore } from '../../core/admin-store';
import { formatMoney } from '../../core/format';
import { Booking, BookingChannel, Refund, Show, WALK_IN } from '../../core/models';
import { ConfirmService, ToastService } from '../../shared/feedback';

/** A refund joined with what it is traceable to: the booking, its payment and the show. */
export interface RefundRow {
  refund: Refund;
  booking: Booking | undefined;
  show: Show | undefined;
  ref: string;
  customer: string;
  /** Online or box office; counter customers are always walk-ins. */
  channel: BookingChannel;
  /** Counter bookings: who sold the tickets. */
  operator: string | null;
  film: string;
  screen: string;
  theatre: string;
  tickets: number;
  paid: number;
}

export function refundRow(store: AdminStore, refund: Refund): RefundRow {
  const booking = store.booking(refund.bookingId);
  const show = store.show(refund.showId);
  return {
    refund, booking, show,
    ref: booking?.ref ?? refund.bookingId,
    customer: refund.channel === 'counter' ? WALK_IN : booking?.customerName ?? 'Unknown customer',
    channel: refund.channel,
    operator: booking?.operator ?? null,
    film: show ? store.movie(show.movieId)?.title ?? 'Film' : 'Show removed',
    screen: show ? store.screen(show.screenId)?.name ?? 'Screen' : '',
    theatre: show ? store.theatre(show.theatreId)?.name ?? '' : '',
    tickets: booking?.seats.length ?? 0,
    paid: booking?.amount ?? refund.amount,
  };
}

const sum = (list: Refund[]) => list.reduce((n, r) => n + r.amount, 0);
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

/**
 * Refund workflow actions shared by the list and the detail page: confirmation first, then the
 * store operation, then feedback. Refunds sent to the gateway are watched so the user hears how
 * the batch ended once the gateway has answered for every one of them.
 */
@Injectable({ providedIn: 'root' })
export class RefundActions {
  private readonly store = inject(AdminStore);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  private readonly watching = signal<ReadonlySet<string>>(new Set());

  constructor() {
    effect(() => {
      const ids = [...this.watching()];
      if (!ids.length) return;
      const list = ids.map((id) => this.store.refund(id)).filter((r): r is Refund => !!r);
      if (list.some((r) => r.status === 'processing')) return;
      const ok = list.filter((r) => r.status === 'successful');
      const failed = list.filter((r) => r.status === 'failed');
      untracked(() => {
        this.watching.set(new Set());
        if (failed.length) {
          this.toast.error(
            `${plural(failed.length, 'refund')} failed at the gateway`,
            `${ok.length ? `${plural(ok.length, 'refund')} credited (${formatMoney(sum(ok))}). ` : ''}Open the failed ones to see why and retry.`,
          );
        } else if (ok.length) {
          this.toast.success(`${plural(ok.length, 'refund')} credited`, `${formatMoney(sum(ok))} confirmed by the payment gateway.`);
        }
      });
    });
  }

  canApprove(r: Refund): boolean { return r.status === 'pending' && this.store.canActOnRefund(r); }
  /** Cash refunds never go to the gateway; they are handed back at the counter. */
  canInitiate(r: Refund): boolean { return r.method !== 'Cash' && (r.status === 'pending' || r.status === 'approved') && this.store.canActOnRefund(r); }
  canRetry(r: Refund): boolean { return r.method !== 'Cash' && r.status === 'failed' && this.store.canActOnRefund(r); }
  /** A cash refund waiting to be handed back at the box office. */
  canHandBackCash(r: Refund): boolean { return r.method === 'Cash' && (r.status === 'pending' || r.status === 'approved'); }
  canReject(r: Refund): boolean { return (r.status === 'pending' || r.status === 'approved') && this.store.canActOnRefund(r); }

  async approve(refunds: Refund[]): Promise<number> {
    const list = refunds.filter((r) => this.canApprove(r));
    if (!list.length) { this.toast.info('Nothing to approve', 'Only pending refunds can be approved.'); return 0; }
    const ok = await this.confirm.ask({
      title: list.length === 1 ? 'Approve this refund?' : `Approve ${list.length} refunds?`,
      message: 'Approved refunds are ready to send to the payment gateway. No money moves until a refund is initiated.',
      details: [{ label: 'Refunds', value: String(list.length) }, { label: 'Total', value: formatMoney(sum(list)) }],
      confirmLabel: list.length === 1 ? 'Approve refund' : `Approve ${list.length} refunds`,
    });
    if (!ok) return 0;
    const n = this.store.approveRefunds(list.map((r) => r.id));
    this.toast.success(`${plural(n, 'refund')} approved`, `${formatMoney(sum(list))} ready to send to the payment gateway.`);
    return n;
  }

  /** Initiates pending or approved refunds, or retries failed ones, after a confirmation. */
  async initiate(refunds: Refund[], mode: 'initiate' | 'retry' = 'initiate'): Promise<number> {
    const list = refunds.filter((r) => (mode === 'retry' ? this.canRetry(r) : this.canInitiate(r)));
    if (!list.length) {
      this.toast.info(mode === 'retry' ? 'Nothing to retry' : 'Nothing to initiate', mode === 'retry' ? 'Only failed refunds can be retried.' : 'Only pending and approved refunds can be sent to the gateway.');
      return 0;
    }
    const methods = new Map<string, number>();
    list.forEach((r) => methods.set(r.method, (methods.get(r.method) ?? 0) + 1));
    const pending = list.filter((r) => r.status === 'pending').length;
    const retry = mode === 'retry';
    const ok = await this.confirm.ask({
      title: retry
        ? (list.length === 1 ? 'Retry this refund?' : `Retry ${list.length} failed refunds?`)
        : (list.length === 1 ? 'Send this refund to the payment gateway?' : `Send ${list.length} refunds to the payment gateway?`),
      message: 'The money goes back to each customer’s original payment method. A refund shows as successful only once the gateway confirms it.',
      details: [
        { label: 'Refunds', value: String(list.length) },
        { label: 'Total', value: formatMoney(sum(list)) },
        { label: 'Methods', value: [...methods].map(([m, n]) => `${m} (${n})`).join(', ') },
      ],
      consequences: pending ? [`${plural(pending, 'pending refund is', 'pending refunds are')} approved as part of this step.`] : undefined,
      confirmLabel: retry ? (list.length === 1 ? 'Retry refund' : `Retry ${list.length} refunds`) : (list.length === 1 ? 'Initiate refund' : `Initiate ${list.length} refunds`),
    });
    if (!ok) return 0;
    const n = this.store.initiateRefunds(list.map((r) => r.id));
    this.watching.update((set) => new Set([...set, ...list.map((r) => r.id)]));
    this.toast.info(`${plural(n, 'refund')} sent to the payment gateway`, 'Statuses update here as the gateway responds.');
    return n;
  }

  reject(refunds: Refund[], note: string): number {
    const list = refunds.filter((r) => this.canReject(r));
    list.forEach((r) => this.store.rejectRefund(r.id, note));
    if (list.length) this.toast.success(`${plural(list.length, 'refund')} rejected`, note);
    return list.length;
  }
}
