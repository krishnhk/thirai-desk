import { ChangeDetectionStrategy, Component, ElementRef, HostListener, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';

import { ALL_THEATRES, AdminStore } from '../core/admin-store';
import { formatRelative, initials } from '../core/format';
import { IconComponent } from '../shared/icon.component';
import { AuthService } from '../core/auth.service';
import { ThemeService } from '../core/theme';

interface NavItem { label: string; icon: string; link: string; /** Starts a new group: a thin divider above it. */ gap?: boolean; }

/**
 * The frame of every page: a sidebar with the eleven sections and a header with the theatre
 * selector, notifications, the theme switch and the user.
 * On narrow screens the sidebar slides in over the page.
 */
@Component({
  selector: 'app-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, IconComponent],
  template: `
    <div class="app" [class.collapsed]="collapsed()" [class.drawer-open]="drawerOpen()">
      <aside class="sidebar" aria-label="Main navigation">
        <!-- Theatre -->
        <div class="pop-wrap theatre-wrap">
          <button class="theatre-btn" type="button" [class.single]="!multiTheatre() && !collapsed()" [attr.aria-expanded]="multiTheatre() ? openMenu() === 'theatre' : null" [attr.aria-haspopup]="multiTheatre() ? 'listbox' : null" [attr.title]="collapsed() ? 'Expand sidebar' : null" (click)="collapsed() ? collapsed.set(false) : multiTheatre() && toggle('theatre')">
            @if (selectedTheatre(); as t) {
              <span class="t-logo" [class.mono]="!t.logoUrl">@if (t.logoUrl) { <img [src]="t.logoUrl" alt="" /> } @else { {{ initialsOf(t.name) }} }</span>
              <span class="t-text"><strong>{{ t.name }}</strong><small>ThiraiDesk</small></span>
            } @else {
              <span class="t-logo all"><app-icon name="theatre" /></span>
              <span class="t-text"><strong>All theatres</strong><small>ThiraiDesk</small></span>
            }
            @if (multiTheatre()) { <app-icon name="chevronDown" /> }
          </button>
          <button class="collapse" type="button" [attr.title]="collapsed() ? 'Expand sidebar' : 'Collapse sidebar'" [attr.aria-label]="collapsed() ? 'Expand sidebar' : 'Collapse sidebar'" (click)="collapsed.set(!collapsed())">
            <app-icon [name]="collapsed() ? 'chevronRight' : 'chevronLeft'" />
          </button>
          @if (openMenu() === 'theatre') {
            <div class="pop theatre-pop" role="listbox" aria-label="Choose a theatre">
              @if (store.theatres().length > 1) {
              <button type="button" role="option" class="pop-item" [attr.aria-selected]="store.selectedTheatreId() === all" (click)="chooseTheatre(all)">
                <span class="t-logo all"><app-icon name="theatre" /></span>
                <span class="grow"><strong>All theatres</strong><small>{{ store.theatres().length }} theatres · {{ store.screens().length }} screens</small></span>
                @if (store.selectedTheatreId() === all) { <app-icon name="check" /> }
              </button>
              }
              @for (t of store.theatres(); track t.id) {
                <button type="button" role="option" class="pop-item" [attr.aria-selected]="store.selectedTheatreId() === t.id" (click)="chooseTheatre(t.id)">
                  <span class="t-logo" [class.mono]="!t.logoUrl">@if (t.logoUrl) { <img [src]="t.logoUrl" alt="" /> } @else { {{ initialsOf(t.name) }} }</span>
                  <span class="grow"><strong>{{ t.name }}</strong><small>{{ t.area }} · {{ t.code }}@if (t.status === 'inactive') { · Inactive }</small></span>
                  @if (store.selectedTheatreId() === t.id) { <app-icon name="check" /> }
                </button>
              }
            </div>
          }
        </div>

        <nav class="nav">
          @for (item of navItems(); track item.link) {
            @if (item.gap) { <span class="nav-gap" aria-hidden="true"></span> }
            <a class="nav-link" [routerLink]="item.link" routerLinkActive="active" [attr.data-tip]="item.label" (click)="drawerOpen.set(false)">
              <app-icon [name]="item.icon" />
              <span>{{ item.label }}</span>
              @if (item.link === '/refunds' && pendingRefunds()) { <span class="nav-count">{{ pendingRefunds() }}</span> }
              @if (item.link === '/shows' && draftCount()) { <span class="nav-count violet">{{ draftCount() }}</span> }
            </a>
          }
        </nav>

        <div class="dock">
          <div class="pop-wrap">
            <button class="nav-link bell-link" type="button" data-tip="Notifications" [attr.aria-expanded]="openMenu() === 'bell'" (click)="toggle('bell')">
              <app-icon name="bell" />
              <span>Notifications</span>
              @if (store.alerts().length) { <span class="nav-count alert">{{ store.alerts().length }}</span> }
            </button>
            @if (openMenu() === 'bell') {
              <div class="pop bell-pop">
                <div class="pop-head"><strong>Notifications</strong><span class="muted small">{{ store.alerts().length }} open</span></div>
                @for (a of store.alerts().slice(0, 8); track a.id) {
                  <a class="pop-item alert-item" [routerLink]="a.link.split('?')[0]" [queryParams]="queryOf(a.link)" (click)="openMenu.set(null); drawerOpen.set(false)">
                    <span class="lvl {{ a.level }}"></span>
                    <span class="grow"><strong>{{ a.title }}</strong><small>{{ a.detail }}</small></span>
                  </a>
                } @empty {
                  <p class="pop-empty">Nothing needs attention.</p>
                }
              </div>
            }
          </div>

          <button class="nav-link" type="button" [attr.data-tip]="nextTheme() === 'light' ? 'Light theme' : 'Dark theme'" (click)="themes.set(nextTheme())">
            <app-icon [name]="nextTheme() === 'light' ? 'sun' : 'moon'" />
            <span>{{ nextTheme() === 'light' ? 'Light theme' : 'Dark theme' }}</span>
          </button>

          <div class="pop-wrap">
            <button class="profile" type="button" [attr.data-tip]="store.currentUser().name" [attr.aria-expanded]="openMenu() === 'user'" (click)="toggle('user')">
              <span class="avatar">{{ store.currentUser().initials }}</span>
              <span class="who"><strong>{{ store.currentUser().name }}</strong><small>{{ store.currentUser().role }}</small></span>
              <app-icon class="chev" name="chevronUp" />
            </button>
            @if (openMenu() === 'user') {
              <div class="pop user-pop">
                <div class="who-card">
                  <strong>{{ store.currentUser().name }}</strong>
                  <span>{{ store.currentUser().role }}</span>
                  <small>{{ store.currentUser().email }}</small>
                </div>
                <button type="button" class="signout-btn" (click)="signOut()"><app-icon name="logout" />Sign out</button>
              </div>
            }
          </div>

        </div>
      </aside>
      <div class="drawer-scrim" (click)="drawerOpen.set(false)"></div>

      <div class="main">
        <header class="topbar">
          <button class="btn ghost icon menu-btn" type="button" aria-label="Open navigation" (click)="drawerOpen.set(true)"><app-icon name="sidebar" /></button>
          @if (selectedTheatre(); as t) {
            <span class="t-logo" [class.mono]="!t.logoUrl">@if (t.logoUrl) { <img [src]="t.logoUrl" alt="" /> } @else { {{ initialsOf(t.name) }} }</span>
            <span class="t-text"><strong>{{ t.name }}</strong><small>{{ t.area }}</small></span>
          }
        </header>

        <main class="content">
          <router-outlet />
        </main>
      </div>
    </div>
  `,
  styles: `
    .app { display: grid; grid-template-columns: var(--sidebar-w) minmax(0, 1fr); min-height: 100vh; }
    .app.collapsed { grid-template-columns: 68px minmax(0, 1fr); }
    /* Flush with the window edges; only its right side lifts off the page with a shadow. */
    .sidebar { position: sticky; top: 0; height: 100vh; display: flex; flex-direction: column; gap: 14px; padding: 16px 12px; background: var(--sidebar-bg); border-right: 1px solid var(--border-soft); box-shadow: var(--shadow-side); z-index: 40; }
    .nav { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; gap: 2px; overflow-y: auto; scrollbar-width: none; }
    .nav::-webkit-scrollbar { display: none; }
    .nav-gap { height: 1px; margin: 8px 10px; background: var(--border-soft); }
    button.nav-link { width: 100%; border: 0; background: none; text-align: left; }
    .nav-link { position: relative; display: flex; align-items: center; gap: 11px; min-height: 36px; padding: 6px 10px; border-radius: var(--radius); color: var(--text-muted); font-size: 0.86rem; font-weight: 600; text-decoration: none; white-space: nowrap; }
    .nav-link:hover { background: var(--surface-2); color: var(--text); }
    .nav-link.active { background: var(--accent-soft); color: var(--accent); }
    .nav-link.active::before { content: ''; position: absolute; left: -12px; top: 8px; bottom: 8px; width: 3px; border-radius: 0 3px 3px 0; background: var(--accent); }
    .nav-count { margin-left: auto; min-width: 20px; padding: 0 6px; border-radius: 999px; background: var(--warning-soft); color: var(--warning); font-size: 0.7rem; font-weight: 700; line-height: 18px; text-align: center; }
    .nav-count.violet { background: var(--violet-soft); color: var(--violet); }
    .nav-count.alert { background: var(--danger); color: #fff; }
    .dock { position: relative; display: flex; flex-direction: column; gap: 2px; padding-top: 10px; border-top: 1px solid var(--border-soft); }
    .dock .pop-wrap { position: static; }
    .theatre-wrap { position: static; display: flex; align-items: center; gap: 2px; padding-bottom: 12px; border-bottom: 1px solid var(--border-soft); }
    .dock .pop, .theatre-wrap .pop { right: auto; left: calc(100% + 22px); }
    .dock .pop { top: auto; bottom: 0; }
    .theatre-wrap .pop { top: 70px; left: calc(100% + 10px); }
    .collapse { flex: none; display: grid; place-items: center; width: 30px; height: 30px; padding: 0; border: 0; border-radius: var(--radius-sm); background: none; color: var(--text-muted); }
    .collapse:hover { background: var(--surface-2); color: var(--text); }
    .collapsed .nav-link span { display: none; }
    .collapsed .collapse { display: none; }
    .collapsed .theatre-btn { flex: none; width: 100%; }
    .collapsed .theatre-btn { border-color: transparent; background: none; cursor: pointer; }
    .collapsed .theatre-btn:hover { background: var(--surface-2); border-color: transparent; }
    .collapsed .theatre-btn { height: 44px; padding: 0; border-radius: var(--radius); overflow: hidden; }
    .collapsed .t-logo { width: 44px; height: 44px; padding: 5px; border-radius: var(--radius); }
    .collapsed .theatre-btn:hover .t-logo { filter: brightness(0.94); }
    .collapsed .nav-link { justify-content: center; padding: 6px 0; }
    .collapsed .nav { overflow: visible; }
    .collapsed .theatre-btn { justify-content: center; padding: 4px 0; }
    .collapsed .t-text, .collapsed .theatre-btn > app-icon, .collapsed .who, .collapsed .profile .chev { display: none; }
    .collapsed .profile { justify-content: center; padding: 0; }
    .collapsed .bell-link .nav-count { display: block; position: absolute; top: 5px; right: 14px; width: 8px; height: 8px; min-width: 0; padding: 0; font-size: 0; line-height: 0; }
    .collapsed .nav-link:hover::after, .collapsed .profile:hover::after { z-index: 80; }
    .collapsed .profile:hover::after { content: attr(data-tip); position: absolute; left: calc(100% + 10px); top: 50%; transform: translateY(-50%); padding: 5px 9px; border-radius: var(--radius-sm); background: var(--surface-3); border: 1px solid var(--border-strong); color: var(--text); font-size: 0.78rem; font-weight: 600; white-space: nowrap; box-shadow: var(--shadow); pointer-events: none; }
    .collapsed .dock { overflow: visible; }
    .collapsed .nav-link:hover::after, .collapsed .nav-link:focus-visible::after { content: attr(data-tip); position: absolute; left: calc(100% + 10px); top: 50%; transform: translateY(-50%); padding: 5px 9px; border-radius: var(--radius-sm); background: var(--surface-3); border: 1px solid var(--border-strong); color: var(--text); font-size: 0.78rem; font-weight: 600; white-space: nowrap; box-shadow: var(--shadow); pointer-events: none; z-index: 50; }
    .drawer-scrim { display: none; }

    .main { min-width: 0; display: flex; flex-direction: column; }
    .topbar { display: none; }
    .menu-btn { display: none; }
    .content { flex: 1; min-width: 0; padding: 24px 28px 48px; }

    .pop-wrap { position: relative; }
    .pop { position: absolute; top: calc(100% + 8px); z-index: 60; min-width: 260px; padding: 6px; border: 1px solid var(--border-strong); border-radius: var(--radius-lg); background: var(--surface-2); box-shadow: var(--shadow-lg); }
    .pop-item { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 10px; border: 0; border-radius: var(--radius); background: none; color: var(--text); text-align: left; text-decoration: none; }
    .pop-item:hover, .pop-item[aria-selected='true'] { background: var(--surface-3); }
    .pop-item .grow { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .pop-item strong { font-size: 0.85rem; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pop-item small { font-size: 0.74rem; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pop-item app-icon { color: var(--text-muted); }
    .pop-item[aria-selected='true'] app-icon { color: var(--accent); }
    .pop-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 10px 10px; border-bottom: 1px solid var(--border); margin-bottom: 4px; }
    .pop-head .grow { display: flex; flex-direction: column; } .pop-head small { color: var(--text-muted); font-size: 0.74rem; }
    .pop-empty { padding: 14px 10px; color: var(--text-muted); font-size: 0.85rem; }
    .pop-foot { display: block; padding: 9px 10px 4px; border-top: 1px solid var(--border); margin-top: 4px; font-size: 0.8rem; font-weight: 600; }
    .signout { margin-top: 4px; border-top: 1px solid var(--border); border-radius: 0 0 var(--radius) var(--radius); }
    .signout:hover { color: var(--danger); }
    .pop-note { padding: 8px 10px 4px; border-top: 1px solid var(--border); margin-top: 4px; font-size: 0.74rem; color: var(--text-muted); }

    /* Every control in the bar is 36 px tall. */
    .theatre-btn { display: flex; align-items: center; gap: 10px; flex: 1; width: auto; min-width: 0; height: 48px; flex-shrink: 0; padding: 0 10px 0 6px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); color: var(--text); text-align: left; }
    .theatre-btn:hover { border-color: var(--border-strong); }
    .theatre-btn.single { cursor: default; border-color: transparent; background: none; }
    .theatre-btn.single:hover { border-color: transparent; }
    .theatre-btn > app-icon { color: var(--text-muted); width: 16px; height: 16px; }
    .t-logo { display: grid; place-items: center; width: 34px; height: 34px; flex-shrink: 0; padding: 3px; border-radius: var(--radius-sm); background: #fff; overflow: hidden; }
    .t-logo img { display: block; width: 100%; height: 100%; object-fit: contain; }
    .t-logo.mono { background: var(--accent); color: var(--on-accent); font-size: 0.78rem; font-weight: 800; }
    .t-logo.all { background: var(--accent-soft); color: var(--accent); }
    .t-text { display: flex; flex-direction: column; min-width: 0; line-height: 1.2; }
    .t-text small { font-size: 0.7rem; color: var(--text-muted); }
    .t-text strong { font-size: 0.86rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .theatre-pop { left: 0; width: 320px; max-height: 420px; overflow-y: auto; }

    .bell-pop { width: 360px; }
    .alert-item { align-items: flex-start; }
    .lvl { width: 8px; height: 8px; margin-top: 6px; border-radius: 50%; flex-shrink: 0; }
    .lvl.danger { background: var(--danger); } .lvl.warning { background: var(--warning); } .lvl.info { background: var(--info); }

    .profile .chev { width: 14px; height: 14px; margin-left: auto; color: var(--text-muted); }
    .profile { position: relative; display: flex; align-items: center; gap: 9px; width: 100%; height: 48px; padding: 0 8px 0 6px; border: 0; border-radius: var(--radius); background: none; color: var(--text); text-align: left; }
    .profile:hover { background: var(--surface-2); }
    .avatar { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50%; background: var(--accent); color: var(--on-accent); font-size: 0.72rem; font-weight: 800; flex-shrink: 0; }
    .who { display: flex; flex-direction: column; line-height: 1.2; }
    .who strong, .who small { white-space: nowrap; }
    .who strong { font-size: 0.82rem; } .who small { font-size: 0.72rem; color: var(--text-muted); }
    .user-pop { width: 290px; max-height: calc(100vh - 80px); overflow-y: auto; padding: 0; }
    .who-card { display: flex; flex-direction: column; gap: 2px; padding: 14px 16px 12px; border-bottom: 1px solid var(--border); }
    .who-card strong { font-size: 0.95rem; font-weight: 700; }
    .who-card span { font-size: 0.8rem; color: var(--text-muted); }
    .who-card small { font-size: 0.76rem; color: var(--text-faint); overflow-wrap: anywhere; }
    .signout-btn { display: flex; align-items: center; gap: 10px; width: 100%; padding: 12px 16px; border: 0; background: transparent; color: var(--text); font: inherit; font-weight: 600; font-size: 0.86rem; text-align: left; cursor: pointer; border-radius: 0 0 var(--radius-lg) var(--radius-lg); }
    .signout-btn:hover { color: var(--danger); background: var(--surface-3, transparent); }
    .pop-sub { padding: 8px 10px 4px; font-size: 0.66rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted); }
    .avatar.sm { width: 26px; height: 26px; font-size: 0.62rem; }

    @media (max-width: 1023px) {
      .app, .app.collapsed { grid-template-columns: minmax(0, 1fr); }
      .sidebar { position: fixed; inset: 0 auto 0 0; height: auto; width: 260px; transform: translateX(calc(-100% - 30px)); transition: transform 180ms ease; }
      .drawer-open .sidebar { transform: none; }
      .drawer-open .drawer-scrim { display: block; position: fixed; inset: 0; z-index: 35; background: var(--scrim); }
      .collapse { display: none; }
      .collapsed .nav-link span { display: initial; }
      .menu-btn { display: inline-flex; }
      .topbar { position: sticky; top: 0; z-index: 30; display: flex; align-items: center; gap: 10px; height: var(--header-h); padding: 0 14px; background: var(--topbar-bg); backdrop-filter: blur(8px); border-bottom: 1px solid var(--border-soft); }
      .dock .pop { left: 0; right: 0; width: auto; bottom: calc(100% + 8px); }
      .theatre-wrap .pop { left: 0; right: 0; width: auto; top: 70px; }
      .collapsed .t-text, .collapsed .who { display: flex; }
      .collapsed .profile .chev { display: block; }
      .collapsed .theatre-btn, .collapsed .profile { justify-content: flex-start; }
      .content { padding: 18px 16px 40px; }
    }
  `,
})
export class ShellComponent {
  readonly store = inject(AdminStore);
  private readonly router = inject(Router);
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly all = ALL_THEATRES;
  protected readonly auth = inject(AuthService);
  protected readonly themes = inject(ThemeService);
  protected readonly nextTheme = computed(() => (this.themes.theme() === 'dark' ? 'light' : 'dark'));
  readonly initialsOf = initials;
  /** One theatre: the entry is its page ("Theatre"), not a list. */
  readonly navItems = computed(() => {
    const single = this.store.theatres().length === 1;
    return this.nav
      .filter((i) => !(single && i.link === '/screens'))
      .map((i) => (single && i.link === '/theatre' ? { ...i, label: 'Theatre' } : i));
  });
  /** In the order the day goes: run the box office and the shows, handle cancellations and refunds; then the catalogue and reports; then setup. */
  readonly nav: NavItem[] = [
    { label: 'Overview', icon: 'overview', link: '/overview' },
    { label: 'Counter Booking', icon: 'ticket', link: '/counter' },
    { label: 'Shows', icon: 'shows', link: '/shows' },
    { label: 'Refunds', icon: 'refund', link: '/refunds' },
    { label: 'Reports', icon: 'reports', link: '/reports', gap: true },
    { label: 'Theatres', icon: 'theatre', link: '/theatre', gap: true },
    { label: 'Screens', icon: 'screen', link: '/screens' },
    { label: 'Settings', icon: 'settings', link: '/settings' },
  ];
  readonly lastSignIn = formatRelative(new Date(Date.now() - 3 * 3_600_000));

  readonly collapsed = signal(false);
  readonly drawerOpen = signal(false);
  readonly openMenu = signal<'theatre' | 'bell' | 'user' | null>(null);

  readonly selectedTheatre = computed(() => this.store.theatre(this.store.selectedTheatreId()) ?? null);
  readonly pendingRefunds = computed(() => this.store.scopedRefunds().filter((r) => r.status === 'pending' || r.status === 'approved' || r.status === 'failed').length);
  readonly draftCount = computed(() => this.store.scopedShows().filter((s) => s.publication === 'draft' && s.start > this.store.now()).length);
  /** The theatre switcher only does something when there is more than one theatre. */
  readonly multiTheatre = computed(() => this.store.theatres().length > 1);
  constructor() {
    // Close menus and the drawer whenever the page changes.
    toSignal(this.router.events.pipe(filter((e) => e instanceof NavigationEnd), map(() => {
      this.openMenu.set(null);
      this.drawerOpen.set(false);
      return true;
    })));
  }

  @HostListener('document:click', ['$event'])
  onDocClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('.pop-wrap')) this.openMenu.set(null);
  }

  toggle(menu: 'theatre' | 'bell' | 'user'): void {
    this.openMenu.update((m) => (m === menu ? null : menu));
  }


  signOut(): void {
    this.openMenu.set(null);
    this.auth.signOut();
    void this.router.navigateByUrl('/sign-in');
  }

  chooseTheatre(id: string): void {
    this.store.selectedTheatreId.set(id);
    this.openMenu.set(null);
  }

  queryOf(link: string): Record<string, string> | null {
    const q = link.split('?')[1];
    if (!q) return null;
    return Object.fromEntries(new URLSearchParams(q).entries());
  }
}
