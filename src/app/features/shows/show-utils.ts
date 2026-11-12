import { Injectable, inject } from '@angular/core';

import { AdminStore, ShowInput } from '../../core/admin-store';
import { formatDay, formatMoney, formatTime } from '../../core/format';
import { Issue, Show } from '../../core/models';
import { ConfirmService, ToastService } from '../../shared/feedback';

/** The editable part of a show, as the store's show operations take it. */
export function showInput(s: Show): ShowInput {
  return {
    theatreId: s.theatreId, screenId: s.screenId, movieId: s.movieId, format: s.format, language: s.language,
    start: s.start, intermission: s.intermission, prices: { ...s.prices },
  };
}

/** "₹180–₹420", or one price when every category costs the same. */
export function priceRange(prices: Record<string, number>): string {
  const values = Object.values(prices).filter((p) => p > 0);
  if (!values.length) return '—';
  const min = Math.min(...values);
  const max = Math.max(...values);
  return min === max ? formatMoney(min) : `${formatMoney(min)}–${formatMoney(max)}`;
}

export function minPrice(prices: Record<string, number>): number {
  const values = Object.values(prices).filter((p) => p > 0);
  return values.length ? Math.min(...values) : 0;
}

export function errorsOf(issues: Issue[]): Issue[] { return issues.filter((i) => i.level === 'error'); }
export function warningsOf(issues: Issue[]): Issue[] { return issues.filter((i) => i.level === 'warning'); }

/** How far a show can be edited, and why. */
export type EditMode = 'full' | 'prices' | 'locked';

export function editMode(store: AdminStore, show: Show): { mode: EditMode; reason: string } {
  const status = store.showStatus(show);
  if (status === 'cancelled') return { mode: 'locked', reason: 'Cancelled shows are kept as a historical record and cannot be edited.' };
  if (status === 'completed') return { mode: 'locked', reason: 'This show has finished. Completed shows are kept as a historical record and cannot be edited.' };
  if (status === 'running') return { mode: 'locked', reason: 'This show is running now and cannot be edited.' };
  const booked = show.publication === 'published' ? store.confirmedBookingsOf(show.id).length : 0;
  if (booked) {
    return {
      mode: 'prices',
      reason: `This show has ${booked} confirmed ${booked === 1 ? 'booking' : 'bookings'}, so the film, format, language, screen and time are locked. ` +
        'Price changes apply to new bookings only; existing tickets keep what customers paid. To move the show, cancel it and create a new one.',
    };
  }
  return { mode: 'full', reason: '' };
}

/** The confirm-and-act steps every show screen shares: publish, delete and duplicate a draft. */
@Injectable({ providedIn: 'root' })
export class ShowActions {
  private readonly store = inject(AdminStore);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);

  issues(show: Show): Issue[] {
    return this.store.validateShow(showInput(show), show.id);
  }

  details(show: Show): { label: string; value: string }[] {
    const screen = this.store.screen(show.screenId);
    return [
      { label: 'Film', value: `${this.store.movie(show.movieId)?.title ?? 'Film'} · ${show.format} · ${show.language}` },
      { label: 'Screen', value: `${screen?.name ?? 'Screen'} · ${this.store.theatre(show.theatreId)?.name ?? ''}` },
      { label: 'Starts', value: `${formatDay(show.start)}, ${formatTime(show.start)} (ends ${formatTime(this.store.showEnd(show))})` },
      { label: 'Prices', value: priceRange(show.prices) },
    ];
  }

  /** Publishes one draft after confirmation. Returns true when it went on sale. */
  async publish(show: Show): Promise<boolean> {
    const issues = this.issues(show);
    const errors = errorsOf(issues);
    if (errors.length) {
      this.toast.error('This draft cannot be published yet', errors.map((e) => e.message).join(' '));
      return false;
    }
    const ok = await this.confirm.ask({
      title: 'Publish this show?',
      message: 'Customers can book it as soon as it is published.',
      details: this.details(show),
      consequences: warningsOf(issues).map((w) => w.message),
      confirmLabel: 'Publish show',
    });
    if (!ok) return false;
    const result = this.store.publishShows([show.id]);
    if (result.published.length) {
      this.toast.success('Show published', `${this.store.showLabel(show)} is now on sale.`);
      return true;
    }
    this.toast.error('The show was not published', result.failed[0]?.issues.map((i) => i.message).join(' ') ?? 'It is no longer a draft.');
    return false;
  }

  async deleteDraft(show: Show): Promise<boolean> {
    if (show.publication !== 'draft') return false;
    const ok = await this.confirm.ask({
      title: 'Delete this draft?',
      message: 'The draft is removed for good. Drafts were never on sale, so no customer is affected.',
      details: this.details(show),
      confirmLabel: 'Delete draft',
      tone: 'danger',
    });
    if (!ok) return false;
    const done = this.store.deleteDraft(show.id);
    if (done) this.toast.success('Draft deleted', this.store.showLabel(show));
    return done;
  }

  /** Copies a show as a draft one day later. */
  duplicate(show: Show): Show | null {
    const copy = this.store.duplicateShow(show.id);
    if (copy) this.toast.success('Draft copy created', `${this.store.showLabel(copy)} on ${formatDay(copy.start)}. Review it under Drafts.`);
    return copy;
  }
}
