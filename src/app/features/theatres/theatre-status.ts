import { inject, Injectable } from '@angular/core';

import { AdminStore } from '../../core/admin-store';
import { formatNumber } from '../../core/format';
import { Theatre } from '../../core/models';
import { ConfirmService, ToastService } from '../../shared/feedback';

/** Activating and deactivating a theatre, with the confirmation and the warning about upcoming shows. */
@Injectable({ providedIn: 'root' })
export class TheatreStatusActions {
  private readonly store = inject(AdminStore);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);

  /** Upcoming, not-cancelled shows of a theatre and the confirmed bookings on the published ones. */
  upcoming(theatreId: string) {
    const now = this.store.now();
    const shows = this.store.shows().filter((s) => s.theatreId === theatreId && !s.cancellation && s.start > now);
    const published = shows.filter((s) => s.publication === 'published');
    const bookings = published.reduce((n, s) => n + this.store.confirmedBookingsOf(s.id).length, 0);
    return { published: published.length, drafts: shows.length - published.length, bookings };
  }

  async toggle(t: Theatre): Promise<void> {
    if (t.status === 'inactive') {
      const ok = await this.confirm.ask({
        title: `Activate ${t.name}?`,
        message: 'The theatre and its active screens can be scheduled again. Screens marked inactive stay inactive.',
        details: [{ label: 'Code', value: t.code }, { label: 'Screens', value: String(this.store.screens().filter((s) => s.theatreId === t.id).length) }],
        confirmLabel: 'Activate theatre',
      });
      if (!ok) return;
      this.store.setTheatreStatus(t.id, 'active');
      this.toast.success('Theatre activated', `${t.name} can be scheduled again.`);
      return;
    }
    const u = this.upcoming(t.id);
    const consequences = ['No new shows can be created or published for this theatre.'];
    if (u.published) consequences.push(`${u.published} upcoming published shows with ${formatNumber(u.bookings)} bookings are not cancelled automatically. Cancel them in Cancellations so customers are refunded.`);
    if (u.drafts) consequences.push(`${u.drafts} draft shows stay as drafts and cannot be published.`);
    const ok = await this.confirm.ask({
      title: `Deactivate ${t.name}?`,
      message: 'Use this when the theatre is closed for renovation or has left the account. Its history and reports are kept.',
      details: [{ label: 'Code', value: t.code }, { label: 'Upcoming published shows', value: String(u.published) }, { label: 'Bookings on them', value: formatNumber(u.bookings) }],
      consequences,
      confirmLabel: 'Deactivate theatre',
      tone: 'danger',
      requireText: u.published ? t.code : undefined,
    });
    if (!ok) return;
    this.store.setTheatreStatus(t.id, 'inactive');
    this.toast.success('Theatre deactivated', u.published ? `${u.published} upcoming shows still need to be cancelled.` : `${t.name} is out of service.`);
  }
}
