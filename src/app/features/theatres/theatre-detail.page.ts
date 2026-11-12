import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { AdminStore } from '../../core/admin-store';
import { formatDate, formatDateTime, formatDay, formatMoneyShort, formatNumber, initials, sameDay } from '../../core/format';
import { IconComponent } from '../../shared/icon.component';
import { EmptyStateComponent, PageHeaderComponent, SkeletonComponent } from '../../shared/ui';
import { ScreensPage } from '../screens/screens.page';
import { TheatreFormComponent } from './theatre-form.component';
import { TheatreStatusActions } from './theatre-status';

/** One theatre: details, contact, screen inventory, staff and the day's numbers. */
@Component({
  selector: 'app-theatre-detail-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, PageHeaderComponent, EmptyStateComponent, SkeletonComponent, IconComponent, TheatreFormComponent, ScreensPage],
  template: `
    @if (theatre(); as t) {
      <div class="page">
        @if (store.theatres().length > 1) {
        <nav class="crumbs" aria-label="Breadcrumb">
          <a routerLink="/theatre">Theatres</a><app-icon name="chevronRight" /><span aria-current="page">{{ t.name }}</span>
        </nav>
        }

        @if (formOpen()) {
          <header class="edit-head">
            <div><p class="eyebrow">{{ t.name }} · {{ t.code }}</p><h1>{{ formSection() === 'staff' ? 'Edit staff' : 'Edit theatre details' }}</h1></div>
          </header>
        } @else {
        <div class="hero">
          <div class="cover-wrap">
            <section class="cover" [class.branded]="t.coverBranded" [class.photo]="!!t.coverUrl && !t.coverBranded" aria-label="Theatre cover">
              @if (t.coverUrl) { <img class="cover-img" [src]="t.coverUrl" alt="" /> } @else { <span class="cover-title">{{ t.name }}</span> }
            </section>
            <input #coverInput class="file" type="file" accept="image/*" aria-label="Choose a cover photo" (change)="pickCover($event)" />
            <button type="button" class="btn sm glass cover-edit" (click)="coverInput.click()"><app-icon name="upload" />{{ t.coverUrl ? 'Change cover' : 'Add cover photo' }}</button>
          </div>
          <div class="profile">
            <span class="c-logo">@if (t.logoUrl) { <img [src]="t.logoUrl" alt="" /> } @else { {{ initials(t.name) }} }</span>
            <div class="p-text">
              @if (t.coverBranded || !t.coverUrl) { <h1 class="sr-only">{{ t.name }}</h1> } @else { <h1>{{ t.name }}</h1> }
              <p>{{ t.area }}, {{ t.city }}<span class="dot"></span><span class="mono">{{ t.code }}</span>
                @if (t.status === 'active') { <span class="badge success">Active</span> } @else { <span class="badge neutral">Inactive</span> }
              </p>
            </div>
            <div class="p-actions">
              @if (!scoped()) { <button type="button" class="btn" (click)="useScope()"><app-icon name="eye" />Scope console here</button> }
              <button type="button" class="btn" (click)="editDetails()"><app-icon name="edit" />Edit details</button>
              <button type="button" class="btn" [class.danger-ghost]="t.status === 'active'" (click)="statusActions.toggle(t)">{{ t.status === 'active' ? 'Deactivate' : 'Activate' }}</button>
            </div>
          </div>
        </div>
        }

        @if (t.status === 'inactive') {
          <div class="callout warning"><app-icon name="alert" /><span><strong>This theatre is inactive.</strong> Its screens cannot be scheduled and it is left out of alerts. Activate it to resume operations.</span></div>
        }

        @if (store.loading()) {
          <section class="card"><app-skeleton [rows]="8" /></section>
        } @else if (formOpen()) {
          <app-theatre-form [theatre]="t" [section]="formSection()" (closed)="formOpen.set(false)" />
        } @else {
          <div class="tabs" role="tablist" aria-label="Theatre sections">
            <button class="tab" type="button" role="tab" [attr.aria-selected]="!screensTab() && !staffTab()" (click)="setTab(null)">Overview</button>
            <button class="tab" type="button" role="tab" [attr.aria-selected]="screensTab()" (click)="setTab('screens')">Screens<span class="count-pill">{{ screens().length }}</span></button>
            <button class="tab" type="button" role="tab" [attr.aria-selected]="staffTab()" (click)="setTab('staff')">Staff<span class="count-pill">{{ t.staff.length }}</span></button>
          </div>

          @if (screensTab()) {
            <app-screens-page [embedded]="true" [theatreId]="t.id" />
          } @else if (staffTab()) {
            <section class="card">
              <div class="card-head"><h2>Staff</h2><button type="button" class="btn sm" (click)="editStaff()"><app-icon name="edit" />Edit staff</button></div>
              @if (t.staff.length) {
                <ul class="staff">
                  @for (m of t.staff; track m.email + m.name) {
                    <li>
                      <span class="avatar">{{ initials(m.name) }}</span>
                      <span class="who"><strong>{{ m.name }}</strong><small class="muted">{{ m.role }}</small></span>
                      <span class="how"><a class="contact small" [href]="'tel:' + m.phone.replaceAll(' ', '')">{{ m.phone }}</a><a class="muted small" [href]="'mailto:' + m.email">{{ m.email }}</a></span>
                    </li>
                  }
                </ul>
              } @else {
                <app-empty-state icon="user" title="No staff listed" text="Add the general manager and duty managers so operations can reach them.">
                  <button type="button" class="btn" (click)="editStaff()">Add staff</button>
                </app-empty-state>
              }
            </section>
          } @else {
          <p class="stats" aria-label="The day at a glance">
            <span><b>{{ day().shows }}</b> {{ day().shows === 1 ? 'show' : 'shows' }} {{ isToday() ? 'today' : 'that day' }}@if (day().drafts) { <small>({{ day().drafts }} draft)</small> }</span>
            <span><b>{{ day().seats }}</b> seats sold<small>({{ day().occupancy }}% full)</small></span>
            <span><b>{{ day().gross }}</b> gross</span>
            @if (day().cancelled) { <span class="bad"><b>{{ day().cancelled }}</b> cancelled</span> }
          </p>

          <section class="card details">
            <dl class="facts cols">
              <dt>Address</dt><dd class="addr">{{ t.address }}, {{ t.area }}, {{ t.city }} {{ t.pincode }}</dd>
              <dt>Phone</dt><dd><a class="contact" [href]="'tel:' + t.phone.replaceAll(' ', '')">{{ t.phone }}</a></dd>
              <dt>Email</dt><dd class="addr"><a class="contact" [href]="'mailto:' + t.email">{{ t.email }}</a></dd>
            </dl>
            <dl class="facts cols">
              <dt>Screens</dt><dd>{{ screens().length }} <span class="muted">({{ activeScreens() }} active)</span></dd>
              <dt>Capacity</dt><dd>{{ formatNumber(capacity()) }} bookable seats</dd>
              <dt>Updated</dt><dd>{{ formatDateTime(t.updatedAt) }}</dd>
            </dl>
          </section>

          }
        }
      </div>

    } @else {
      <div class="page">
        <app-page-header title="Theatre not found" [crumbs]="[{ label: 'Theatres', link: '/theatre' }, { label: 'Not found' }]" />
        <section class="card">
          <app-empty-state icon="theatre" title="This theatre does not exist" text="It may have been removed, or the link is wrong.">
            <a class="btn" routerLink="/theatre">Back to theatres</a>
          </app-empty-state>
        </section>
      </div>
    }
  `,
  styles: `
    .stats { display: flex; flex-wrap: wrap; gap: 4px 22px; margin: 0; padding: 0 4px; font-size: 0.86rem; color: var(--text-muted); }
    .stats b { color: var(--text); font-weight: 700; }
    .stats small { margin-left: 5px; font-size: inherit; }
    .stats .bad b { color: var(--danger); }
    .state { margin-right: 4px; }
    .details { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr); align-items: center; gap: 0; padding: 4px 0; }
    .details > * { padding: 16px 22px; }
    .details > * + * { border-left: 1px solid var(--border-soft); }
    .cols { margin: 0; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; align-items: stretch; }
    @media (max-width: 1100px) {
      .details { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
    }
    @media (max-width: 900px) { .grid { grid-template-columns: minmax(0, 1fr); } }
    @media (max-width: 640px) {
      .details { grid-template-columns: minmax(0, 1fr); }
      .details > * + * { border-left: 0; border-top: 1px solid var(--border-soft); }
    }
    .staff { margin: 0; padding: 0; list-style: none; }
    .staff li { display: grid; grid-template-columns: 30px minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 11px 18px; }
    .staff li + li { border-top: 1px solid var(--border-soft); }
    .who, .how { display: flex; flex-direction: column; min-width: 0; }
    .how { align-items: flex-end; }
    .who small { font-size: 0.78rem; }
    .how a { overflow-wrap: anywhere; }
    @media (max-width: 520px) { .staff li { grid-template-columns: 30px minmax(0, 1fr); } .how { grid-column: 2; align-items: flex-start; } }
    .addr { font-weight: 500; overflow-wrap: anywhere; }
    .block { display: block; font-size: 0.74rem; }
    .contact { color: var(--text); text-decoration: underline; text-decoration-color: var(--border-strong); text-underline-offset: 3px; }
    .contact:hover { color: var(--text); text-decoration-color: var(--text-muted); }
    .plain { color: var(--text); }
    .plain:hover { text-decoration: underline; }
    .avatar { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50%; background: var(--surface-3); color: var(--text-soft); font-size: 0.68rem; font-weight: 700; }
    .crumbs { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-bottom: -8px; font-size: 0.78rem; color: var(--text-muted); }
    .crumbs a { color: var(--text-muted); }
    .crumbs a:hover { color: var(--text); }
    .crumbs app-icon { width: 12px; height: 12px; color: var(--text-faint); }
    .crumbs span[aria-current] { color: var(--text-soft); }

    .hero { display: flex; flex-direction: column; }
    .edit-head h1 { margin: 2px 0 0; font-size: 1.5rem; }
    .edit-head .eyebrow { margin: 0; }
    .cover-wrap { position: relative; }
    .cover { position: relative; display: grid; place-items: center; height: 260px; overflow: hidden; border: 1px solid var(--border); border-radius: var(--radius-lg);
      background:
        radial-gradient(760px 300px at 10% 125%, color-mix(in srgb, var(--accent) 55%, transparent), transparent 68%),
        radial-gradient(640px 280px at 92% -20%, rgba(120, 150, 255, 0.28), transparent 70%),
        linear-gradient(135deg, #12141a 0%, #1b1f2a 55%, #0e1015 100%); }
    /* A photo gets a wider, taller banner so a normal landscape picture is not cut to a sliver. */
    .cover-wrap { container-type: inline-size; }
    .cover.photo { width: 100%; height: clamp(260px, 36cqw, 420px); }
    .cover.branded { background: #fff; border-color: var(--border-strong); }
    .cover-img { position: absolute; inset: 0; display: block; width: 100%; height: 100%; object-fit: cover; }
    .cover.branded .cover-img { object-fit: contain; padding: 22px 0; }
    .cover-title { color: #fff; font-size: 2rem; font-weight: 800; letter-spacing: 0.02em; text-shadow: 0 2px 16px rgba(0, 0, 0, 0.5); }
    .file { display: none; }
    .cover-edit { position: absolute; top: 12px; right: 12px; }
    .btn.glass { border-color: rgba(20, 24, 32, 0.18); background: rgba(255, 255, 255, 0.92); color: #1b1e24; }
    .btn.glass:hover { background: #fff; border-color: rgba(20, 24, 32, 0.4); }

    .profile { position: relative; z-index: 2; display: flex; flex-wrap: wrap; align-items: flex-end; gap: 12px 18px; margin-top: -42px; padding: 0 22px; }
    .c-logo { display: grid; place-items: center; width: 96px; height: 96px; flex: none; padding: 10px; border-radius: var(--radius-lg); background: #fff; color: #1b1e24; font-size: 1.2rem; font-weight: 800; overflow: hidden; box-shadow: 0 0 0 4px var(--bg), 0 6px 18px rgba(0, 0, 0, 0.3); }
    .c-logo img { display: block; width: 100%; height: 100%; object-fit: contain; }
    .p-text { min-width: 0; padding-bottom: 2px; }
    .p-text h1 { margin: 0; font-size: 1.4rem; line-height: 1.15; letter-spacing: -0.01em; }
    .p-text p { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; margin: 2px 0 0; font-size: 0.9rem; color: var(--text-muted); }
    .dot { width: 4px; height: 4px; border-radius: 50%; background: var(--text-faint); }
    .p-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-left: auto; padding-bottom: 6px; }
    @media (max-width: 760px) {
      .cover { height: 170px; }
      .cover.photo { height: clamp(190px, 60cqw, 280px); }
      .profile { margin-top: -34px; padding: 0 14px; }
      .c-logo { width: 72px; height: 72px; padding: 8px; }
      .p-actions { margin-left: 0; width: 100%; }
    }
  `,
})
export class TheatreDetailPage {
  protected readonly store = inject(AdminStore);
  protected readonly router = inject(Router);
  protected readonly statusActions = inject(TheatreStatusActions);

  readonly theatreId = computed(() => this.store.theatres()[0]?.id ?? '');

  protected readonly formatDateTime = formatDateTime;
  protected readonly formatDate = formatDate;
  protected readonly formatNumber = formatNumber;
  protected readonly initials = initials;

  readonly formOpen = signal(false);
  readonly formSection = signal<'details' | 'staff'>('details');
  protected editDetails(): void { this.formSection.set('details'); this.formOpen.set(true); }
  protected editStaff(): void { this.formSection.set('staff'); this.formOpen.set(true); }

  /** ?tab=screens opens the screens list. */
  readonly tab = input<string>();
  readonly screensTab = computed(() => this.tab() === 'screens');
  readonly staffTab = computed(() => this.tab() === 'staff');
  protected setTab(tab: 'screens' | 'staff' | null): void {
    void this.router.navigate([], { queryParams: { tab }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  readonly theatre = computed(() => this.store.theatre(this.theatreId()));
  readonly scoped = computed(() => this.store.selectedTheatreId() === this.theatreId());
  readonly screens = computed(() => this.store.screens().filter((s) => s.theatreId === this.theatreId()).sort((a, b) => a.number - b.number));
  readonly activeScreens = computed(() => this.screens().filter((s) => s.status === 'active').length);
  readonly capacity = computed(() => this.screens().reduce((n, s) => n + this.store.capacity(s.id), 0));
  readonly isToday = computed(() => sameDay(this.store.operationalDate(), this.store.now()));
  readonly dayWord = computed(() => (this.isToday() ? 'Today’s' : formatDay(this.store.operationalDate())));

  private readonly dayShows = computed(() => {
    const date = this.store.operationalDate();
    return this.store.shows().filter((s) => s.theatreId === this.theatreId() && sameDay(s.start, date));
  });

  readonly day = computed(() => {
    const shows = this.dayShows();
    const live = shows.filter((s) => !s.cancellation);
    const published = live.filter((s) => s.publication === 'published');
    const seats = published.reduce((n, s) => n + this.store.soldSeats(s.id), 0);
    const cap = published.reduce((n, s) => n + this.store.capacity(s.screenId), 0);
    return {
      shows: live.length,
      published: published.length,
      drafts: live.length - published.length,
      cancelled: shows.length - live.length,
      seats: formatNumber(seats),
      occupancy: cap ? Math.round((seats / cap) * 100) : 0,
      gross: formatMoneyShort(published.reduce((n, s) => n + this.store.revenue(s.id), 0)),
    };
  });

  /** Reads the chosen photo, shrinks it to a sensible size and saves it as the theatre's cover. */
  pickCover(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 1600 / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
        this.store.updateTheatre(this.theatreId(), { coverUrl: canvas.toDataURL('image/jpeg', 0.85), coverBranded: false });
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  }

  useScope(): void {
    this.store.selectedTheatreId.set(this.theatreId());
  }
}
