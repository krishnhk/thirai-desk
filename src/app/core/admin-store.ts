import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';

import { addDays, addMinutes, formatDay, formatMoney, formatTime, MINUTE, sameDay, startOfDay } from './format';
import { copyLayout, couplePartner, findSeat, layoutStats, SELLABLE, validateLayout } from './layout';
import { buildMockData, STAFF_USERS, USERS } from './mock-data';
import {
  ActiveStatus, AuditEntry, Booking, CancellationReason, CounterPaymentMethod, CurrentUser, Issue, Movie, OperationalSettings, Permission, ProjectionFormat,
  StaffUser, UserRole, WALK_IN,
  Refund, RefundStatus, Screen, SeatLayout, Show, ShowStatus, Theatre,
} from './models';

/** What the show form produces; the store fills in ids, timestamps and publication. */
export interface ShowInput {
  theatreId: string;
  screenId: string;
  movieId: string;
  format: ProjectionFormat;
  language: string;
  start: Date;
  intermission: number;
  prices: Record<string, number>;
}

export interface CancelInput {
  reason: CancellationReason;
  notes: string;
  notifyCustomers: boolean;
}

export interface Alert {
  id: string;
  level: 'danger' | 'warning' | 'info';
  title: string;
  detail: string;
  link: string;
  theatreId: string | null;
}

/** Everything that blocks deleting a screen. */
export interface ScreenDependencies {
  upcomingPublished: Show[];
  upcomingDrafts: Show[];
  activeBookings: number;
  canDelete: boolean;
}

/** Readable names for fields in audit entries. */
const FIELD_LABELS: Record<string, string> = {
  bufferMinutes: 'Buffer between shows (min)', defaultIntermission: 'Default interval (min)', convenienceFee: 'Convenience fee (₹)',
  salesCutoffMinutes: 'Sales cut-off (min)', autoApproveShowRefunds: 'Auto-approve show refunds', notifyCustomersByDefault: 'Notify customers by default',
  counterPaymentMethods: 'Counter payment methods', counterCancellationCutoffMinutes: 'Counter cancellation cut-off (min)',
  counterCancellationFeePerTicket: 'Counter cancellation fee per ticket (₹)', counterAdvanceBookingDays: 'Counter advance booking window (days)',
  name: 'Name', code: 'Code', brand: 'Brand', city: 'City', area: 'Area', address: 'Address', pincode: 'PIN code', phone: 'Phone',
  email: 'Email', logoUrl: 'Logo', status: 'Status', type: 'Screen type', sound: 'Sound', projection: 'Projection',
};
const label = (key: string) => FIELD_LABELS[key] ?? key;

/** What each role may do. Admin-level roles may do everything. */
export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  Owner: ['admin.all'],
  'General Manager': ['admin.all'],
  'Theatre Administrator': ['admin.all'],
  'Operations Staff': ['counter.sell', 'counter.history.all', 'counter.reports'],
  'Counter Supervisor': ['counter.sell', 'counter.history.all', 'counter.cancel', 'counter.refund', 'counter.reports'],
  'Counter Operator': ['counter.sell', 'counter.history.own'],
};

/** A counter sale as the box office submits it. No customer details: every counter customer is a walk-in. */
export interface CounterSaleInput {
  showId: string;
  seats: string[];
  method: CounterPaymentMethod;
  /** Cash: the amount handed over. Others: the amount charged (must equal the total). */
  amountCollected: number;
  /** Required for UPI, card and other methods. */
  txnRef: string | null;
}

/** What a counter cancellation would refund under the policy. */
export interface CounterRefundQuote {
  eligible: boolean;
  /** Why not, when not eligible. */
  reason: string;
  paid: number;
  deduction: number;
  refundable: number;
}

/**
 * Where a show stands for the box office. Only 'on-sale' and 'filling-fast' can be sold.
 * Drafts never reach the counter at all.
 */
export type CounterSaleStatus = 'on-sale' | 'filling-fast' | 'sold-out' | 'not-open' | 'closed' | 'completed' | 'cancelled' | 'unavailable';

/** Occupancy from which a show counts as filling fast. */
export const FILLING_FAST = 0.8;

/** Minutes after the start during which the box office can still sell a show. */
export const COUNTER_SALES_GRACE_MINUTES = 15;

/** The "all theatres" choice of the theatre selector. */
export const ALL_THEATRES = 'all';

/**
 * The single source of truth for the console: all records as signals, the derived numbers every
 * screen needs, and every operation with its business rules and audit entry. Pages read signals
 * and call methods; they never change records themselves.
 */
@Injectable({ providedIn: 'root' })
export class AdminStore {
  private readonly seed = buildMockData();

  readonly theatres = signal<Theatre[]>(this.seed.theatres);
  readonly screens = signal<Screen[]>(this.seed.screens);
  readonly movies = signal<Movie[]>(this.seed.movies);
  readonly shows = signal<Show[]>(this.seed.shows);
  readonly bookings = signal<Booking[]>(this.seed.bookings);
  readonly refunds = signal<Refund[]>(this.seed.refunds);
  readonly audit = signal<AuditEntry[]>(this.seed.audit);
  readonly settings = signal<OperationalSettings>(this.seed.settings);

  /** Everyone who can sign in; the profile menu can switch between them to try each role. */
  readonly staffUsers = signal<StaffUser[]>(STAFF_USERS);
  readonly currentUser = signal<CurrentUser>({ name: USERS.gm.name, role: USERS.gm.role, email: 'mukesh@hayatcinemas.example', initials: 'M' });

  /** Switches the signed-in user (prototype only; there is no real sign-in). */
  signInAs(userId: string): void {
    const u = this.staffUsers().find((x) => x.id === userId);
    if (u) this.currentUser.set({ name: u.name, role: u.role, email: u.email, initials: u.initials });
  }

  /** Whether the signed-in user may do something. */
  can(permission: Permission): boolean {
    const perms = ROLE_PERMISSIONS[this.currentUser().role] ?? [];
    return perms.includes('admin.all') || perms.includes(permission);
  }
  /** The theatre the console is scoped to, or ALL_THEATRES. */
  readonly selectedTheatreId = signal<string>(this.seed.theatres.length === 1 ? this.seed.theatres[0]!.id : ALL_THEATRES);
  /** The day operations are looking at; defaults to today. */
  readonly operationalDate = signal<Date>(startOfDay(new Date()));
  /** The clock, ticking every 30 seconds so statuses move on their own. */
  readonly now = signal(new Date());
  /** True briefly on start, so pages can show their skeletons as a real API would. */
  readonly loading = signal(true);

  constructor() {
    const timer = setInterval(() => this.now.set(new Date()), 30_000);
    const ready = setTimeout(() => this.loading.set(false), 450);
    // Refunds that were already with the gateway when the console opened get their answer a little later.
    const pending = this.refunds().filter((r) => r.status === 'processing').map((r, i) => setTimeout(() => this.resolveRefund(r.id), 5000 + i * 700));
    inject(DestroyRef).onDestroy(() => { clearInterval(timer); clearTimeout(ready); pending.forEach(clearTimeout); });
  }

  // ------------------------------------------------------------------ Lookups (indexed)

  private readonly theatreById = computed(() => new Map(this.theatres().map((x) => [x.id, x])));
  private readonly screenById = computed(() => new Map(this.screens().map((x) => [x.id, x])));
  private readonly movieById = computed(() => new Map(this.movies().map((x) => [x.id, x])));
  private readonly showById = computed(() => new Map(this.shows().map((x) => [x.id, x])));
  private readonly bookingById = computed(() => new Map(this.bookings().map((x) => [x.id, x])));
  private readonly refundById = computed(() => new Map(this.refunds().map((x) => [x.id, x])));
  private readonly bookingsByShow = computed(() => {
    const map = new Map<string, Booking[]>();
    for (const b of this.bookings()) {
      const list = map.get(b.showId);
      if (list) list.push(b); else map.set(b.showId, [b]);
    }
    return map;
  });
  private readonly refundsByShow = computed(() => {
    const map = new Map<string, Refund[]>();
    for (const r of this.refunds()) {
      const list = map.get(r.showId);
      if (list) list.push(r); else map.set(r.showId, [r]);
    }
    return map;
  });
  /** Seats already sold for each show, across online and counter: the shared inventory. */
  private readonly takenByShow = computed(() => {
    const map = new Map<string, Set<string>>();
    for (const b of this.bookings()) {
      if (b.status !== 'confirmed') continue;
      let set = map.get(b.showId);
      if (!set) map.set(b.showId, (set = new Set()));
      for (const seat of b.seats) set.add(seat);
    }
    return map;
  });
  private readonly capacityByScreen = computed(() => new Map(this.screens().map((s) => [s.id, layoutStats(s.layout).sellable])));

  theatre(id: string): Theatre | undefined { return this.theatreById().get(id); }
  screen(id: string): Screen | undefined { return this.screenById().get(id); }
  movie(id: string): Movie | undefined { return this.movieById().get(id); }
  show(id: string): Show | undefined { return this.showById().get(id); }
  booking(id: string): Booking | undefined { return this.bookingById().get(id); }
  refund(id: string): Refund | undefined { return this.refundById().get(id); }

  /** Every booking of a show, confirmed and cancelled. */
  bookingsOf(showId: string): Booking[] { return this.bookingsByShow().get(showId) ?? []; }
  confirmedBookingsOf(showId: string): Booking[] { return this.bookingsOf(showId).filter((b) => b.status === 'confirmed'); }
  refundsOf(showId: string): Refund[] { return this.refundsByShow().get(showId) ?? []; }

  /** Seat ids already sold for a show, online or at the counter. */
  seatsTaken(showId: string): ReadonlySet<string> { return this.takenByShow().get(showId) ?? new Set(); }

  /** Bookable seats on the screen's published layout. */
  capacity(screenId: string): number { return this.capacityByScreen().get(screenId) ?? 0; }
  soldSeats(showId: string): number { return this.confirmedBookingsOf(showId).reduce((n, b) => n + b.seats.length, 0); }
  availableSeats(show: Show): number { return Math.max(0, this.capacity(show.screenId) - this.soldSeats(show.id)); }
  occupancy(show: Show): number {
    const cap = this.capacity(show.screenId);
    return cap ? this.soldSeats(show.id) / cap : 0;
  }
  /** Money taken for a show's confirmed bookings, fees included. */
  revenue(showId: string): number { return this.confirmedBookingsOf(showId).reduce((n, b) => n + b.amount, 0); }

  /** When the film (and its interval) ends. */
  showEnd(show: Pick<Show, 'start' | 'movieId' | 'intermission'>): Date {
    const runtime = this.movie(show.movieId)?.runtime ?? 0;
    return addMinutes(show.start, runtime + show.intermission);
  }
  /** When the screen is ready for the next show: the end plus the cleaning buffer. */
  turnaroundEnd(show: Pick<Show, 'start' | 'movieId' | 'intermission'>): Date {
    return addMinutes(this.showEnd(show), this.settings().bufferMinutes);
  }

  showStatus(show: Show): ShowStatus {
    if (show.cancellation) return 'cancelled';
    const now = this.now();
    if (now >= this.showEnd(show)) return 'completed';
    if (now >= show.start) return 'running';
    return 'scheduled';
  }

  /** A label for lists: "Scene · Audi 2 · 7:45 PM". */
  showLabel(show: Show): string {
    return `${this.movie(show.movieId)?.title ?? 'Film'} · ${this.screen(show.screenId)?.name ?? 'Screen'} · ${formatTime(show.start)}`;
  }

  // ------------------------------------------------------------------ Scope (theatre selector)

  inScope(theatreId: string | null): boolean {
    const sel = this.selectedTheatreId();
    return sel === ALL_THEATRES || theatreId === sel;
  }
  readonly scopedTheatres = computed(() => this.theatres().filter((t) => this.inScope(t.id)));
  readonly scopedScreens = computed(() => this.screens().filter((s) => this.inScope(s.theatreId)));
  readonly scopedShows = computed(() => this.shows().filter((s) => this.inScope(s.theatreId)));
  readonly scopedRefunds = computed(() => {
    const shows = this.showById();
    return this.refunds().filter((r) => this.inScope(shows.get(r.showId)?.theatreId ?? null));
  });
  readonly scopedAudit = computed(() => this.audit().filter((a) => a.theatreId === null || this.inScope(a.theatreId)));
  /** Shows on the operational date, in start order. */
  readonly dayShows = computed(() => {
    const day = this.operationalDate();
    return this.scopedShows().filter((s) => sameDay(s.start, day)).sort((a, b) => a.start.getTime() - b.start.getTime());
  });

  /** Screens that can take shows: active, in an active theatre, with a published layout. */
  isSchedulable(screen: Screen): boolean {
    return screen.status === 'active' && !!screen.layout && this.theatre(screen.theatreId)?.status === 'active';
  }

  // ------------------------------------------------------------------ Alerts and notifications

  readonly alerts = computed<Alert[]>(() => {
    const out: Alert[] = [];
    const now = this.now();
    const day = this.operationalDate();
    const shows = this.scopedShows();
    for (const screen of this.scopedScreens()) {
      const t = this.theatre(screen.theatreId);
      if (t?.status !== 'active') continue;
      if (screen.status === 'inactive') {
        out.push({ id: `inactive-${screen.id}`, level: 'info', title: `${screen.name} is inactive`, detail: `${t.name} · out of service`, link: `/screens/${screen.id}`, theatreId: t.id });
        continue;
      }
      if (!screen.layout) {
        out.push({ id: `nolayout-${screen.id}`, level: 'warning', title: `${screen.name} has no published layout`, detail: `${t.name} · cannot be scheduled until a layout is published`, link: `/seats/${screen.id}`, theatreId: t.id });
        continue;
      }
      for (let d = 0; d < 3; d++) {
        const target = addDays(day, d);
        if (!shows.some((s) => s.screenId === screen.id && !s.cancellation && sameDay(s.start, target))) {
          out.push({ id: `empty-${screen.id}-${d}`, level: 'warning', title: `${screen.name} has no shows ${d === 0 ? 'today' : d === 1 ? 'tomorrow' : 'in two days'}`, detail: `${t.name}`, link: `/shows/new?screen=${screen.id}`, theatreId: t.id });
          break;
        }
      }
    }
    const drafts = shows.filter((s) => s.publication === 'draft' && s.start > now);
    if (drafts.length) {
      const soon = drafts.filter((s) => s.start < addDays(now, 2)).length;
      out.push({ id: 'drafts', level: soon ? 'warning' : 'info', title: `${drafts.length} draft shows awaiting publication`, detail: soon ? `${soon} start within 48 hours and are not on sale` : 'Review and publish when ready', link: '/shows?tab=drafts', theatreId: null });
    }
    const pending = this.scopedRefunds().filter((r) => r.status === 'pending' || r.status === 'approved');
    if (pending.length) out.push({ id: 'refunds', level: 'warning', title: `${pending.length} refunds waiting to be processed`, detail: `${formatMoney(pending.reduce((n, r) => n + r.amount, 0))} to return to customers`, link: '/refunds?status=pending', theatreId: null });
    const failed = this.scopedRefunds().filter((r) => r.status === 'failed');
    if (failed.length) out.push({ id: 'refunds-failed', level: 'danger', title: `${failed.length} refunds failed`, detail: 'Retry or contact the customer', link: '/refunds?status=failed', theatreId: null });
    const startingSoon = shows.filter((s) => !s.cancellation && s.publication === 'published' && s.start > now && s.start.getTime() - now.getTime() < 45 * MINUTE);
    for (const s of startingSoon) out.push({ id: `soon-${s.id}`, level: 'info', title: `${this.movie(s.movieId)?.title} starts at ${formatTime(s.start)}`, detail: `${this.screen(s.screenId)?.name} · ${this.soldSeats(s.id)} seats sold`, link: `/shows/${s.id}`, theatreId: s.theatreId });
    const rank = { danger: 0, warning: 1, info: 2 };
    return out.sort((a, b) => rank[a.level] - rank[b.level]);
  });

  // ------------------------------------------------------------------ Audit

  log(entry: Omit<AuditEntry, 'id' | 'at' | 'user' | 'role'>): void {
    const user = this.currentUser();
    const full: AuditEntry = { id: `a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, at: new Date(), user: user.name, role: user.role, ...entry };
    this.audit.update((list) => [full, ...list]);
  }

  private screenTarget(screenId: string): string {
    const s = this.screen(screenId);
    return s ? `${s.name} · ${this.theatre(s.theatreId)?.name ?? ''}` : 'Screen';
  }
  private showTarget(show: Pick<Show, 'movieId' | 'screenId'>): string {
    return `${this.movie(show.movieId)?.title ?? 'Film'} · ${this.screenTarget(show.screenId)}`;
  }

  // ------------------------------------------------------------------ Theatres

  addTheatre(input: Omit<Theatre, 'id' | 'updatedAt' | 'status'>): Theatre {
    const theatre: Theatre = { ...input, id: `t-${input.code.toLowerCase()}`, status: 'active', updatedAt: new Date() };
    this.theatres.update((list) => [...list, theatre]);
    this.log({ action: 'theatre.created', theatreId: theatre.id, target: theatre.name, summary: `Added ${theatre.name}, ${theatre.area}.`, link: '/theatre' });
    return theatre;
  }

  updateTheatre(id: string, patch: Partial<Omit<Theatre, 'id'>>): void {
    const before = this.theatre(id);
    if (!before) return;
    const p = patch as Partial<Theatre>;
    const changes = (Object.keys(p) as (keyof Theatre)[])
      .filter((k) => k !== 'staff' && k !== 'updatedAt' && k !== 'coverBranded' && String(before[k] ?? '') !== String(p[k] ?? ''))
      .map((k) => (k === 'coverUrl'
        ? { field: 'Cover photo', from: before.coverUrl ? 'Photo' : 'None', to: p.coverUrl ? 'New photo' : 'None' }
        : { field: label(String(k)), from: String(before[k] ?? ''), to: String(p[k] ?? '') }));
    this.theatres.update((list) => list.map((t) => (t.id === id ? { ...t, ...patch, updatedAt: new Date() } : t)));
    this.log({ action: 'theatre.updated', theatreId: id, target: before.name, summary: `Updated theatre details${changes.length ? ` (${changes.map((c) => c.field).join(', ')})` : ''}.`, changes, link: '/theatre' });
  }

  setTheatreStatus(id: string, status: ActiveStatus): void {
    const t = this.theatre(id);
    if (!t || t.status === status) return;
    this.theatres.update((list) => list.map((x) => (x.id === id ? { ...x, status, updatedAt: new Date() } : x)));
    this.log({ action: status === 'active' ? 'theatre.activated' : 'theatre.deactivated', theatreId: id, target: t.name, summary: status === 'active' ? 'Activated the theatre.' : 'Deactivated the theatre.', changes: [{ field: 'Status', from: t.status, to: status }], link: '/theatre' });
  }

  // ------------------------------------------------------------------ Screens

  addScreen(input: Pick<Screen, 'theatreId' | 'name' | 'type' | 'sound' | 'projection'>): Screen {
    const number = Math.max(0, ...this.screens().filter((s) => s.theatreId === input.theatreId).map((s) => s.number)) + 1;
    const screen: Screen = { ...input, id: `s-${input.theatreId.slice(2)}-${number}-${Date.now().toString(36)}`, number, status: 'active', layout: null, draftLayout: null, updatedAt: new Date() };
    this.screens.update((list) => [...list, screen]);
    this.log({ action: 'screen.created', theatreId: input.theatreId, target: this.screenTarget(screen.id), summary: `Created ${screen.name} (${screen.type}).`, link: `/screens/${screen.id}` });
    return screen;
  }

  updateScreen(id: string, patch: Partial<Pick<Screen, 'name' | 'type' | 'sound' | 'projection'>>): void {
    const before = this.screen(id);
    if (!before) return;
    const changes = (Object.keys(patch) as (keyof typeof patch)[])
      .filter((k) => before[k] !== patch[k])
      .map((k) => ({ field: label(String(k)), from: String(before[k]), to: String(patch[k]) }));
    this.screens.update((list) => list.map((s) => (s.id === id ? { ...s, ...patch, updatedAt: new Date() } : s)));
    this.log({ action: 'screen.updated', theatreId: before.theatreId, target: this.screenTarget(id), summary: 'Updated screen details.', changes, link: `/screens/${id}` });
  }

  setScreenStatus(id: string, status: ActiveStatus): void {
    const s = this.screen(id);
    if (!s || s.status === status) return;
    this.screens.update((list) => list.map((x) => (x.id === id ? { ...x, status, updatedAt: new Date() } : x)));
    this.log({ action: status === 'active' ? 'screen.activated' : 'screen.deactivated', theatreId: s.theatreId, target: this.screenTarget(id), summary: status === 'active' ? 'Put the screen back in service.' : 'Took the screen out of service.', changes: [{ field: 'Status', from: s.status, to: status }], link: `/screens/${id}` });
  }

  screenDependencies(id: string): ScreenDependencies {
    const now = this.now();
    const future = this.shows().filter((s) => s.screenId === id && !s.cancellation && this.showEnd(s) > now);
    const upcomingPublished = future.filter((s) => s.publication === 'published');
    const upcomingDrafts = future.filter((s) => s.publication === 'draft');
    const activeBookings = upcomingPublished.reduce((n, s) => n + this.confirmedBookingsOf(s.id).length, 0);
    return { upcomingPublished, upcomingDrafts, activeBookings, canDelete: upcomingPublished.length === 0 };
  }

  /** Deletes a screen with no upcoming published shows; its drafts go with it. History stays. */
  deleteScreen(id: string): boolean {
    const s = this.screen(id);
    const deps = this.screenDependencies(id);
    if (!s || !deps.canDelete) return false;
    const draftIds = new Set(deps.upcomingDrafts.map((d) => d.id));
    this.shows.update((list) => list.filter((x) => !draftIds.has(x.id)));
    this.screens.update((list) => list.filter((x) => x.id !== id));
    this.log({ action: 'screen.deleted', theatreId: s.theatreId, target: `${s.name} · ${this.theatre(s.theatreId)?.name ?? ''}`, summary: `Deleted the screen${draftIds.size ? ` and ${draftIds.size} draft shows` : ''}.` });
    return true;
  }

  // ------------------------------------------------------------------ Seat layouts

  saveLayoutDraft(screenId: string, layout: SeatLayout): void {
    const s = this.screen(screenId);
    if (!s) return;
    const draft = { ...copyLayout(layout), updatedAt: new Date(), updatedBy: this.currentUser().name };
    this.screens.update((list) => list.map((x) => (x.id === screenId ? { ...x, draftLayout: draft, updatedAt: new Date() } : x)));
    this.log({ action: 'layout.saved', theatreId: s.theatreId, target: this.screenTarget(screenId), summary: `Saved a draft layout (${layoutStats(draft).sellable} bookable seats).`, link: `/seats/${screenId}` });
  }

  discardLayoutDraft(screenId: string): void {
    const s = this.screen(screenId);
    if (!s?.draftLayout) return;
    this.screens.update((list) => list.map((x) => (x.id === screenId ? { ...x, draftLayout: null } : x)));
    this.log({ action: 'layout.saved', theatreId: s.theatreId, target: this.screenTarget(screenId), summary: `Discarded the draft layout${s.layout ? `; version ${s.layout.version} stays published` : ''}.`, link: `/seats/${screenId}` });
  }

  /** Publishes a layout after validation. Returns the issues; an empty list means it was published. */
  publishLayout(screenId: string, layout: SeatLayout): Issue[] {
    const s = this.screen(screenId);
    if (!s) return [{ level: 'error', message: 'The screen no longer exists.' }];
    const errors = validateLayout(layout).filter((i) => i.level === 'error');
    if (errors.length) return errors;
    const before = layoutStats(s.layout);
    const version = (s.layout?.version ?? 0) + 1;
    const published = { ...copyLayout(layout), version, updatedAt: new Date(), updatedBy: this.currentUser().name };
    const after = layoutStats(published);
    this.screens.update((list) => list.map((x) => (x.id === screenId ? { ...x, layout: published, draftLayout: null, updatedAt: new Date() } : x)));
    this.log({
      action: 'layout.published', theatreId: s.theatreId, target: this.screenTarget(screenId),
      summary: `Published layout version ${version} with ${after.sellable} bookable seats.`,
      changes: [{ field: 'Bookable seats', from: String(before.sellable), to: String(after.sellable) }, { field: 'Version', from: String(s.layout?.version ?? '—'), to: String(version) }],
      link: `/seats/${screenId}`,
    });
    return [];
  }

  // ------------------------------------------------------------------ Shows

  /**
   * Validates a show against the business rules. Errors block saving as published; warnings
   * (and errors about other drafts) can still be saved as a draft.
   */
  validateShow(input: ShowInput, ignoreShowId?: string): Issue[] {
    const issues: Issue[] = [];
    const theatre = this.theatre(input.theatreId);
    const screen = this.screen(input.screenId);
    const movie = this.movie(input.movieId);
    if (!movie) issues.push({ level: 'error', message: 'Choose a film.', where: 'movie' });
    if (!theatre) issues.push({ level: 'error', message: 'Choose a theatre.', where: 'theatre' });
    else if (theatre.status !== 'active') issues.push({ level: 'error', message: `${theatre.name} is inactive.`, where: 'theatre' });
    if (!screen) { issues.push({ level: 'error', message: 'Choose a screen.', where: 'screen' }); return issues; }
    if (screen.status !== 'active') issues.push({ level: 'error', message: `${screen.name} is inactive and cannot be scheduled.`, where: 'screen' });
    if (!screen.layout) issues.push({ level: 'error', message: `${screen.name} has no published seat layout. Publish one from the seat layout page first.`, where: 'screen' });
    if (movie && !movie.formats.includes(input.format)) issues.push({ level: 'error', message: `${movie.title} is not available in ${input.format}.`, where: 'format' });
    if (movie && !movie.languages.includes(input.language)) issues.push({ level: 'error', message: `${movie.title} has no ${input.language} version.`, where: 'language' });
    if (input.start.getTime() < this.now().getTime()) issues.push({ level: 'error', message: 'The start time is in the past.', where: 'start' });
    if (movie && input.start.getTime() < startOfDay(movie.releaseDate).getTime()) issues.push({ level: 'error', message: `${movie.title} releases on ${movie.releaseDate.toDateString()}.`, where: 'start' });
    if (screen.layout) {
      for (const c of screen.layout.categories) {
        const p = input.prices[c.id];
        if (!(p! > 0)) issues.push({ level: 'error', message: `Set a ticket price for ${c.name}.`, where: `price:${c.id}` });
        else if (p! < c.basePrice * 0.5) issues.push({ level: 'warning', message: `${c.name} at ${formatMoney(p!)} is less than half its base price of ${formatMoney(c.basePrice)}.`, where: `price:${c.id}` });
      }
    }
    if (movie) {
      const start = input.start.getTime();
      const end = this.turnaroundEnd(input).getTime();
      const buffer = this.settings().bufferMinutes;
      for (const other of this.shows()) {
        if (other.id === ignoreShowId || other.screenId === undefined || other.screenId !== input.screenId || other.cancellation) continue;
        const oStart = other.start.getTime();
        const oEnd = this.turnaroundEnd(other).getTime();
        if (start < oEnd && oStart < end) {
          const what = `${this.movie(other.movieId)?.title} at ${formatTime(other.start)}`;
          const overlapsFilm = start < this.showEnd(other).getTime() && oStart < this.showEnd(input).getTime();
          const msg = overlapsFilm
            ? `Overlaps ${other.publication === 'draft' ? 'the draft' : 'the published show'} ${what} on ${screen.name}.`
            : `Leaves less than the ${buffer}-minute cleaning buffer next to ${what}.`;
          issues.push({ level: other.publication === 'published' ? 'error' : 'warning', message: msg, where: 'start' });
        }
      }
    }
    return issues;
  }

  createShow(input: ShowInput, publish: boolean): Show {
    const now = new Date();
    const show: Show = {
      ...input, prices: { ...input.prices }, id: `sh-${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
      publication: publish ? 'published' : 'draft', cancellation: null, createdAt: now, createdBy: this.currentUser().name,
      updatedAt: now, publishedAt: publish ? now : null,
    };
    this.shows.update((list) => [...list, show]);
    this.log({ action: 'show.created', theatreId: show.theatreId, target: this.showTarget(show), summary: `Created a ${publish ? 'published' : 'draft'} show for ${formatTime(show.start)}, ${show.start.toDateString()}.`, link: `/shows/${show.id}` });
    if (publish) this.log({ action: 'show.published', theatreId: show.theatreId, target: this.showTarget(show), summary: 'Published the show; it is now on sale.', link: `/shows/${show.id}` });
    return show;
  }

  updateShow(id: string, input: ShowInput): void {
    const before = this.show(id);
    if (!before) return;
    const changes: { field: string; from: string; to: string }[] = [];
    if (before.movieId !== input.movieId) changes.push({ field: 'Film', from: this.movie(before.movieId)?.title ?? '', to: this.movie(input.movieId)?.title ?? '' });
    if (before.screenId !== input.screenId) changes.push({ field: 'Screen', from: this.screen(before.screenId)?.name ?? '', to: this.screen(input.screenId)?.name ?? '' });
    if (before.start.getTime() !== input.start.getTime()) changes.push({ field: 'Start', from: before.start.toLocaleString('en-IN'), to: input.start.toLocaleString('en-IN') });
    if (before.format !== input.format) changes.push({ field: 'Format', from: before.format, to: input.format });
    if (before.language !== input.language) changes.push({ field: 'Language', from: before.language, to: input.language });
    const categoryName = (id: string) => this.screen(input.screenId)?.layout?.categories.find((c) => c.id === id)?.name ?? id;
    for (const k of Object.keys(input.prices)) if (before.prices[k] !== input.prices[k]) changes.push({ field: `${categoryName(k)} price`, from: before.prices[k] != null ? formatMoney(before.prices[k]!) : '—', to: formatMoney(input.prices[k]!) });
    this.shows.update((list) => list.map((s) => (s.id === id ? { ...s, ...input, prices: { ...input.prices }, updatedAt: new Date() } : s)));
    this.log({ action: 'show.updated', theatreId: input.theatreId, target: this.showTarget(input), summary: `Edited the ${before.publication === 'draft' ? 'draft ' : ''}show.`, changes, link: `/shows/${id}` });
  }

  /** Copies a show as a new draft, by default one day later at the same time. */
  duplicateShow(id: string, start?: Date): Show | null {
    const src = this.show(id);
    if (!src) return null;
    const now = new Date();
    const copy: Show = {
      ...src, prices: { ...src.prices }, id: `sh-${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
      start: start ?? addDays(src.start, 1), publication: 'draft', cancellation: null, createdAt: now,
      createdBy: this.currentUser().name, updatedAt: now, publishedAt: null,
    };
    this.shows.update((list) => [...list, copy]);
    this.log({ action: 'show.duplicated', theatreId: copy.theatreId, target: this.showTarget(copy), summary: `Duplicated a show as a draft for ${copy.start.toDateString()}, ${formatTime(copy.start)}.`, link: `/shows/${copy.id}` });
    return copy;
  }

  /** Deletes a draft. Published shows are never deleted; they are cancelled. */
  deleteDraft(id: string): boolean {
    const s = this.show(id);
    if (!s || s.publication !== 'draft') return false;
    this.shows.update((list) => list.filter((x) => x.id !== id));
    this.log({ action: 'show.deleted', theatreId: s.theatreId, target: this.showTarget(s), summary: `Deleted the draft for ${s.start.toDateString()}, ${formatTime(s.start)}.` });
    return true;
  }

  /** Publishes drafts that pass validation; returns what was published and why the rest were not. */
  publishShows(ids: string[]): { published: string[]; failed: { id: string; issues: Issue[] }[] } {
    const published: string[] = [];
    const failed: { id: string; issues: Issue[] }[] = [];
    for (const id of ids) {
      const s = this.show(id);
      if (!s || s.publication !== 'draft') continue;
      const errors = this.validateShow(s, s.id).filter((i) => i.level === 'error');
      if (errors.length) { failed.push({ id, issues: errors }); continue; }
      const now = new Date();
      this.shows.update((list) => list.map((x) => (x.id === id ? { ...x, publication: 'published', publishedAt: now, updatedAt: now } : x)));
      published.push(id);
    }
    if (published.length === 1) {
      const s = this.show(published[0]!)!;
      this.log({ action: 'show.published', theatreId: s.theatreId, target: this.showTarget(s), summary: 'Published the show; it is now on sale.', link: `/shows/${s.id}` });
    } else if (published.length > 1) {
      const theatres = new Set(published.map((id) => this.show(id)!.theatreId));
      this.log({ action: 'show.published', theatreId: theatres.size === 1 ? [...theatres][0]! : null, target: `${published.length} shows`, summary: `Bulk-published ${published.length} draft shows.`, link: '/shows' });
    }
    return { published, failed };
  }

  /**
   * Cancels a published show: marks it cancelled, cancels its bookings and opens one refund per
   * booking. Refunds are processed separately in Refunds.
   */
  cancelShow(id: string, input: CancelInput): Refund[] {
    const s = this.show(id);
    if (!s || s.cancellation || s.publication !== 'published') return [];
    const now = new Date();
    const by = this.currentUser().name;
    const affected = this.confirmedBookingsOf(id);
    const autoApprove = this.settings().autoApproveShowRefunds;
    this.shows.update((list) => list.map((x) => (x.id === id ? { ...x, cancellation: { at: now, by, ...input }, updatedAt: now } : x)));
    const ids = new Set(affected.map((b) => b.id));
    this.bookings.update((list) => list.map((b) => (ids.has(b.id) ? { ...b, status: 'cancelled', cancelledAt: now } : b)));
    let seq = this.refunds().length + 1;
    const created: Refund[] = affected.map((b) => {
      const history = [{ status: 'pending' as RefundStatus, at: now, by: 'System', note: 'Created when the show was cancelled.' }];
      if (autoApprove) history.push({ status: 'approved', at: now, by, note: 'Approved automatically for a cancelled show.' });
      return {
        id: `rf-${String(seq++).padStart(5, '0')}`, bookingId: b.id, showId: id, reason: 'Show cancelled', amount: b.amount,
        method: b.paymentMethod, status: autoApprove ? 'approved' : 'pending', requestedAt: now, updatedAt: now,
        gatewayRef: null, failureReason: null, attempts: 0, history, channel: b.channel, cashRefundRef: null,
      };
    });
    this.refunds.update((list) => [...created, ...list]);
    const total = created.reduce((n, r) => n + r.amount, 0);
    this.log({
      action: 'show.cancelled', theatreId: s.theatreId, target: this.showTarget(s),
      summary: `Cancelled the ${formatTime(s.start)} show (${input.reason}). ${affected.length} bookings cancelled; ${formatMoney(total)} in refunds opened.`,
      changes: [{ field: 'Status', from: 'Published', to: 'Cancelled' }, { field: 'Customers notified', from: '—', to: input.notifyCustomers ? 'Yes' : 'No' }],
      link: `/shows/${id}`,
    });
    return created;
  }

  // ------------------------------------------------------------------ Refunds

  private setRefund(id: string, status: RefundStatus, note: string, by: string, patch: Partial<Refund> = {}): void {
    const at = new Date();
    this.refunds.update((list) => list.map((r) => (r.id === id ? { ...r, ...patch, status, updatedAt: at, history: [...r.history, { status, at, by, note }] } : r)));
  }

  /** Whether the signed-in user may approve, send or reject this refund. */
  canActOnRefund(r: Refund): boolean {
    return this.can('admin.all') || (r.channel === 'counter' && this.can('counter.refund'));
  }

  private refundTarget(r: Refund): string {
    return `Booking ${this.booking(r.bookingId)?.ref ?? r.bookingId}`;
  }

  approveRefunds(ids: string[]): number {
    const user = this.currentUser().name;
    const list = ids.map((id) => this.refund(id)).filter((r): r is Refund => r?.status === 'pending' && this.canActOnRefund(r));
    list.forEach((r) => this.setRefund(r.id, 'approved', 'Approved for refund.', user));
    if (list.length) this.log({ action: 'refund.approved', theatreId: this.show(list[0]!.showId)?.theatreId ?? null, target: list.length === 1 ? this.refundTarget(list[0]!) : `${list.length} refunds`, summary: `Approved ${list.length === 1 ? 'a refund' : `${list.length} refunds`} of ${formatMoney(list.reduce((n, r) => n + r.amount, 0))}.`, link: list.length === 1 ? `/refunds/${list[0]!.id}` : '/refunds' });
    return list.length;
  }

  rejectRefund(id: string, note: string): void {
    const r = this.refund(id);
    if (!r || !(r.status === 'pending' || r.status === 'approved') || !this.canActOnRefund(r)) return;
    this.setRefund(id, 'rejected', note || 'Rejected.', this.currentUser().name);
    this.log({ action: 'refund.rejected', theatreId: this.show(r.showId)?.theatreId ?? null, target: this.refundTarget(r), summary: `Rejected a refund of ${formatMoney(r.amount)}: ${note || 'no reason given'}.`, link: `/refunds/${id}` });
  }

  /**
   * Sends approved (or failed, for a retry) refunds to the payment gateway. They show as
   * processing and resolve a few seconds later: most succeed, some fail, as a real gateway would.
   * Nothing is shown as successful until the simulated gateway confirms it.
   */
  initiateRefunds(ids: string[]): number {
    const user = this.currentUser().name;
    const list = ids.map((id) => this.refund(id)).filter((r): r is Refund => !!r && r.method !== 'Cash' && this.canActOnRefund(r) && (r.status === 'approved' || r.status === 'failed' || r.status === 'pending'));
    for (const r of list) {
      const retry = r.status === 'failed';
      if (r.status === 'pending') this.setRefund(r.id, 'approved', 'Approved for refund.', user);
      this.setRefund(r.id, 'processing', retry ? `Retry ${r.attempts + 1} sent to the payment gateway.` : `Sent to the payment gateway (${r.method}).`, user, { attempts: r.attempts + 1, failureReason: null });
      const delay = 1800 + Math.floor(Math.random() * 2200);
      setTimeout(() => this.resolveRefund(r.id), delay);
    }
    if (list.length) {
      const retries = list.filter((r) => r.status === 'failed').length;
      this.log({ action: retries === list.length ? 'refund.retried' : 'refund.initiated', theatreId: this.show(list[0]!.showId)?.theatreId ?? null, target: list.length === 1 ? this.refundTarget(list[0]!) : `${list.length} refunds`, summary: `${retries === list.length ? 'Retried' : 'Initiated'} ${list.length === 1 ? 'a refund' : `${list.length} refunds`} of ${formatMoney(list.reduce((n, r) => n + r.amount, 0))}.`, link: list.length === 1 ? `/refunds/${list[0]!.id}` : '/refunds' });
    }
    return list.length;
  }

  private resolveRefund(id: string): void {
    const r = this.refund(id);
    if (!r || r.status !== 'processing') return;
    const b = this.booking(r.bookingId);
    // A first attempt to a wallet, and roughly one in eight others, fails; retries succeed.
    const fails = r.attempts === 1 && (r.method === 'Wallet' || (parseInt(r.id.replace(/\D/g, ''), 10) % 8 === 3));
    const target = this.refundTarget(r);
    const theatreId = this.show(r.showId)?.theatreId ?? null;
    if (fails) {
      const reason = r.method === 'Wallet' ? 'Wallet provider timed out (code W504).' : 'Issuing bank declined the reversal (code 51).';
      this.setRefund(id, 'failed', reason, 'Payment gateway', { failureReason: reason });
      this.log({ action: 'refund.failed', theatreId, target, summary: `Refund of ${formatMoney(r.amount)} failed: ${reason}`, link: `/refunds/${id}` });
    } else {
      const gatewayRef = 'RFN' + Math.floor(1e9 + Math.random() * 9e9);
      this.setRefund(id, 'successful', `Credited to the customer${b ? ` (${b.customerName})` : ''}. Gateway reference ${gatewayRef}.`, 'Payment gateway', { gatewayRef });
      this.log({ action: 'refund.succeeded', theatreId, target, summary: `Refund of ${formatMoney(r.amount)} credited by ${r.method}.`, link: `/refunds/${id}` });
    }
  }

  // ------------------------------------------------------------------ Counter (box office)

  /** Whether the box office can sell a show now, and if not, why. */
  counterSaleState(show: Show): { open: boolean; reason: string; status: CounterSaleStatus } {
    const screen = this.screen(show.screenId);
    const theatre = this.theatre(show.theatreId);
    const now = this.now();
    const no = (status: CounterSaleStatus, reason: string) => ({ open: false, reason, status });
    if (show.publication !== 'published') return no('unavailable', 'Draft shows are not on sale.');
    if (show.cancellation) return no('cancelled', 'The show was cancelled.');
    if (now >= this.showEnd(show)) return no('completed', 'The show has finished.');
    if (theatre?.status !== 'active') return no('unavailable', 'The theatre is inactive.');
    if (!screen || screen.status !== 'active' || !screen.layout) return no('unavailable', 'The screen is not available.');
    const window = this.counterSalesWindow(show);
    if (now < window.opens) return no('not-open', `Counter sales open on ${formatDay(window.opens)}.`);
    if (now >= window.closes) return no('closed', `Counter sales closed at ${formatTime(window.closes)}.`);
    if (this.availableSeats(show) === 0) return no('sold-out', 'Sold out.');
    const status: CounterSaleStatus = this.occupancy(show) >= FILLING_FAST ? 'filling-fast' : 'on-sale';
    return { open: true, reason: '', status };
  }

  /**
   * When the box office can sell a show: from the start of the day that falls inside the advance
   * booking window (and not before the show was published) until a few minutes after it starts.
   */
  counterSalesWindow(show: Show): { opens: Date; closes: Date } {
    const days = this.settings().counterAdvanceBookingDays;
    const windowOpens = addDays(startOfDay(show.start), -days);
    const published = show.publishedAt ?? show.start;
    return { opens: new Date(Math.max(windowOpens.getTime(), published.getTime())), closes: addMinutes(show.start, COUNTER_SALES_GRACE_MINUTES) };
  }

  /** The last day the box office can sell for today: today plus the advance booking window. */
  counterLastBookableDay(): Date {
    return addDays(startOfDay(this.now()), this.settings().counterAdvanceBookingDays);
  }

  /** The lowest ticket price of a show across its seat categories. */
  startingPrice(show: Show): number {
    const prices = Object.values(show.prices).filter((p) => p > 0);
    return prices.length ? Math.min(...prices) : 0;
  }

  /** The price of one seat of a show, by the seat's category. */
  seatPrice(show: Show, seat: string): number | null {
    const layout = this.screen(show.screenId)?.layout;
    const found = layout ? findSeat(layout, seat) : null;
    if (!found?.cell.categoryId) return null;
    return show.prices[found.cell.categoryId] ?? null;
  }

  /** Checks a counter sale; an empty list means it can be confirmed. */
  validateCounterSale(input: CounterSaleInput): string[] {
    const errors: string[] = [];
    if (!this.can('counter.sell')) errors.push('Your role cannot sell tickets.');
    const show = this.show(input.showId);
    if (!show) return [...errors, 'The show no longer exists.'];
    const state = this.counterSaleState(show);
    if (!state.open) errors.push(state.reason);
    const layout = this.screen(show.screenId)?.layout;
    if (!layout) return [...errors, 'The screen has no seat layout.'];
    if (!input.seats.length) errors.push('Select at least one seat.');
    if (new Set(input.seats).size !== input.seats.length) errors.push('A seat is selected twice.');
    const taken = this.seatsTaken(show.id);
    for (const seat of input.seats) {
      const found = findSeat(layout, seat);
      if (!found || !SELLABLE.has(found.cell.kind)) { errors.push(`Seat ${seat} cannot be sold.`); continue; }
      if (taken.has(seat)) errors.push(`Seat ${seat} was just sold. Choose another seat.`);
      const partner = couplePartner(layout, seat);
      if (partner && !input.seats.includes(partner)) errors.push(`Couple seat ${seat} must be sold with ${partner}.`);
    }
    if (!this.settings().counterPaymentMethods.includes(input.method)) errors.push(`${input.method} is not accepted at the counter.`);
    const total = input.seats.reduce((n, s) => n + (this.seatPrice(show, s) ?? 0), 0);
    if (input.method === 'Cash' && input.amountCollected < total) errors.push(`Collect at least ${formatMoney(total)} in cash.`);
    if (input.method !== 'Cash' && !input.txnRef?.trim()) errors.push(`Enter the ${input.method} transaction reference.`);
    return errors;
  }

  /**
   * Confirms a counter sale: re-checks the seats against the shared inventory (so a seat sold
   * online a moment ago cannot be sold again), records the payment and issues the tickets.
   */
  createCounterBooking(input: CounterSaleInput): { booking: Booking | null; errors: string[] } {
    const errors = this.validateCounterSale(input);
    if (errors.length) return { booking: null, errors };
    const show = this.show(input.showId)!;
    const total = input.seats.reduce((n, s) => n + (this.seatPrice(show, s) ?? 0), 0);
    const now = new Date();
    let ref = '';
    do ref = 'TC' + Math.floor(Math.random() * 36 ** 6).toString(36).toUpperCase().padStart(6, '0');
    while (this.bookings().some((b) => b.ref === ref));
    const seats = [...input.seats];
    const booking: Booking = {
      id: `b-c${now.getTime().toString(36)}`, ref, showId: show.id,
      customerName: WALK_IN, customerPhone: '', customerEmail: '',
      seats, amount: total, convenienceFee: 0, paymentMethod: input.method,
      paymentRef: input.method === 'Cash' ? `CASH-${ref}` : input.txnRef!.trim(),
      bookedAt: now, status: 'confirmed', cancelledAt: null,
      channel: 'counter', operator: this.currentUser().name,
      ticketRefs: seats.map((_, i) => `${ref}-${i + 1}`),
      counterPayment: {
        method: input.method,
        amountCollected: input.method === 'Cash' ? input.amountCollected : total,
        change: input.method === 'Cash' ? input.amountCollected - total : 0,
        txnRef: input.method === 'Cash' ? null : input.txnRef!.trim(),
        confirmedAt: now,
      },
      printCount: 1,
    };
    this.bookings.update((list) => [...list, booking]);
    this.log({
      action: 'counter.booked', theatreId: show.theatreId, target: `Booking ${ref}`,
      summary: `Sold ${seats.length} ticket${seats.length === 1 ? '' : 's'} (${seats.join(', ')}) for ${this.showLabel(show)} · ${formatMoney(total)} by ${input.method}.`,
      link: `/counter/history?ref=${ref}`,
    });
    return { booking, errors: [] };
  }

  /** Records a reprint of a counter ticket. Printing is only possible for confirmed bookings. */
  recordReprint(bookingId: string): boolean {
    const b = this.booking(bookingId);
    if (!b || b.status !== 'confirmed') return false;
    this.bookings.update((list) => list.map((x) => (x.id === bookingId ? { ...x, printCount: x.printCount + 1 } : x)));
    if (b.printCount >= 1) this.log({ action: 'counter.reprinted', theatreId: this.show(b.showId)?.theatreId ?? null, target: `Booking ${b.ref}`, summary: `Reprinted the tickets (print ${b.printCount + 1}).`, link: `/counter/history?ref=${b.ref}` });
    return true;
  }

  /** What cancelling a counter booking would refund under the counter policy. */
  counterRefundQuote(bookingId: string): CounterRefundQuote {
    const b = this.booking(bookingId);
    const show = b ? this.show(b.showId) : undefined;
    const none = (reason: string): CounterRefundQuote => ({ eligible: false, reason, paid: b?.amount ?? 0, deduction: 0, refundable: 0 });
    if (!b || !show) return none('Booking not found.');
    if (b.channel !== 'counter') return none('This is an online booking. Online refunds are handled in Refunds.');
    if (b.status !== 'confirmed') return none('This booking is already cancelled.');
    if (show.cancellation) return { eligible: true, reason: '', paid: b.amount, deduction: 0, refundable: b.amount };
    const cutoff = addMinutes(show.start, -this.settings().counterCancellationCutoffMinutes);
    if (this.now() >= cutoff) return none(`Counter tickets can be cancelled until ${formatTime(cutoff)}, ${this.settings().counterCancellationCutoffMinutes} minutes before the show.`);
    const deduction = Math.min(b.amount, this.settings().counterCancellationFeePerTicket * b.seats.length);
    return { eligible: true, reason: '', paid: b.amount, deduction, refundable: b.amount - deduction };
  }

  /**
   * Cancels an eligible counter booking: frees its seats and opens a refund. Nothing is refunded
   * yet: cash is handed back with confirmCashRefund; digital payments go back through the gateway.
   */
  cancelCounterBooking(bookingId: string, reason: string, note: string): Refund | null {
    if (!this.can('counter.cancel')) return null;
    const quote = this.counterRefundQuote(bookingId);
    const b = this.booking(bookingId);
    if (!b || !quote.eligible) return null;
    const now = new Date();
    const by = this.currentUser().name;
    this.bookings.update((list) => list.map((x) => (x.id === bookingId ? { ...x, status: 'cancelled', cancelledAt: now } : x)));
    const refund: Refund = {
      id: `rf-c${now.getTime().toString(36)}`, bookingId, showId: b.showId, reason: 'Customer cancellation', amount: quote.refundable,
      method: b.paymentMethod, status: 'approved', requestedAt: now, updatedAt: now, gatewayRef: null, failureReason: null, attempts: 0,
      channel: 'counter', cashRefundRef: null,
      history: [
        { status: 'pending', at: now, by, note: `Counter cancellation: ${reason}${note ? ` (${note})` : ''}.` },
        { status: 'approved', at: now, by, note: b.paymentMethod === 'Cash' ? `Approved. ${formatMoney(quote.refundable)} to be handed back in cash.` : `Approved. ${formatMoney(quote.refundable)} to go back to the original ${b.paymentMethod} payment ${b.paymentRef}.` },
      ],
    };
    this.refunds.update((list) => [refund, ...list]);
    this.log({
      action: 'counter.cancelled', theatreId: this.show(b.showId)?.theatreId ?? null, target: `Booking ${b.ref}`,
      summary: `Cancelled ${b.seats.length} counter ticket${b.seats.length === 1 ? '' : 's'} (${reason}). Refund of ${formatMoney(quote.refundable)} opened; ${formatMoney(quote.deduction)} kept under the cancellation policy.`,
      changes: [{ field: 'Seats released', from: '—', to: b.seats.join(', ') }],
      link: `/refunds/${refund.id}`,
    });
    return refund;
  }

  /** Records that refund cash was handed back at the counter. Only then is a cash refund successful. */
  confirmCashRefund(refundId: string, cashRef: string): boolean {
    const r = this.refund(refundId);
    if (!r || r.method !== 'Cash' || !(r.status === 'approved' || r.status === 'pending') || !cashRef.trim() || !this.can('counter.refund')) return false;
    const ref = cashRef.trim();
    this.setRefund(refundId, 'successful', `Cash handed back at the counter. Cash refund reference ${ref}.`, this.currentUser().name, { cashRefundRef: ref });
    this.log({ action: 'counter.cash-refunded', theatreId: this.show(r.showId)?.theatreId ?? null, target: this.refundTarget(r), summary: `Handed back ${formatMoney(r.amount)} in cash (reference ${ref}).`, link: `/refunds/${refundId}` });
    return true;
  }

  // ------------------------------------------------------------------ Settings

  updateSettings(patch: Partial<OperationalSettings>): void {
    const before = this.settings();
    const show = (v: unknown) => (Array.isArray(v) ? v.join(', ') || '—' : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v));
    const changes = (Object.keys(patch) as (keyof OperationalSettings)[])
      .filter((k) => show(before[k]) !== show(patch[k]))
      .map((k) => ({ field: label(String(k)), from: show(before[k]), to: show(patch[k]) }));
    this.settings.update((s) => ({ ...s, ...patch }));
    if (changes.length) this.log({ action: 'settings.updated', theatreId: null, target: 'Operational settings', summary: 'Updated operational settings.', changes, link: '/settings' });
  }
}
