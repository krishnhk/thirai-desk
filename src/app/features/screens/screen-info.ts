import { AdminStore } from '../../core/admin-store';
import { layoutStats } from '../../core/layout';
import { Screen, Show } from '../../core/models';
import { ConfirmService, ToastService } from '../../shared/feedback';

/** Where a screen's seat layout stands: published (maybe with a draft on top), draft only, or none. */
export type LayoutState = 'published' | 'published-draft' | 'draft' | 'none';

export function layoutState(screen: Screen): LayoutState {
  if (screen.layout) return screen.draftLayout ? 'published-draft' : 'published';
  return screen.draftLayout ? 'draft' : 'none';
}

/** "v3", "v3 + draft", "Draft only", "No layout". */
export function layoutLabel(screen: Screen): string {
  switch (layoutState(screen)) {
    case 'published': return `v${screen.layout!.version}`;
    case 'published-draft': return `v${screen.layout!.version} + draft`;
    case 'draft': return 'Draft only';
    default: return 'No layout';
  }
}

/** Physical seats in the layout being worked on (the draft when there is one). */
export function configuredSeats(screen: Screen): number {
  return layoutStats(screen.draftLayout ?? screen.layout).physical;
}

/** Why a screen cannot take new shows; empty when it can. */
export function scheduleBlockers(store: AdminStore, screen: Screen): string[] {
  const out: string[] = [];
  const theatre = store.theatre(screen.theatreId);
  if (theatre?.status !== 'active') out.push(`${theatre?.name ?? 'The theatre'} is inactive.`);
  if (screen.status !== 'active') out.push('The screen is inactive.');
  if (!screen.layout) out.push(screen.draftLayout ? 'The seat layout is still a draft. Publish it from the seat layout page.' : 'The screen has no seat layout. Design and publish one from the seat layout page.');
  return out;
}

/** Shows on the screen that have not finished yet, cancelled ones included, in start order. */
export function upcomingShows(store: AdminStore, screenId: string): Show[] {
  const now = store.now();
  return store.shows()
    .filter((s) => s.screenId === screenId && store.showEnd(s) > now)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** Activates or deactivates a screen after a confirmation that names what is affected. */
export async function toggleScreenStatus(store: AdminStore, confirm: ConfirmService, toast: ToastService, screen: Screen): Promise<void> {
  const theatre = store.theatre(screen.theatreId)?.name ?? '';
  if (screen.status === 'active') {
    const deps = store.screenDependencies(screen.id);
    const consequences = ['No new shows can be scheduled on this screen while it is inactive.'];
    if (deps.upcomingPublished.length) consequences.push(`${deps.upcomingPublished.length} upcoming published shows stay on sale. Cancel or reassign them separately.`);
    const ok = await confirm.ask({
      title: `Deactivate ${screen.name}?`,
      message: 'The screen is taken out of service. Its layout and history are kept.',
      details: [{ label: 'Theatre', value: theatre }, { label: 'Type', value: screen.type }],
      consequences,
      confirmLabel: 'Deactivate',
      tone: 'danger',
    });
    if (!ok) return;
    store.setScreenStatus(screen.id, 'inactive');
    toast.success('Screen deactivated', `${screen.name} · ${theatre}`);
  } else {
    const ok = await confirm.ask({
      title: `Activate ${screen.name}?`,
      message: screen.layout ? 'The screen goes back into service and can be scheduled.' : 'The screen goes back into service. It still needs a published seat layout before shows can be scheduled.',
      details: [{ label: 'Theatre', value: theatre }, { label: 'Type', value: screen.type }],
      confirmLabel: 'Activate',
    });
    if (!ok) return;
    store.setScreenStatus(screen.id, 'active');
    toast.success('Screen activated', `${screen.name} · ${theatre}`);
  }
}
