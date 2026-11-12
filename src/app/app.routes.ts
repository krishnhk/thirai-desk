import { inject } from '@angular/core';
import { CanDeactivateFn, Router, Routes } from '@angular/router';

import { AdminStore } from './core/admin-store';
import { authGuard } from './core/auth.guard';

import { ShellComponent } from './shell/shell.component';

/** Asks pages with unsaved work (they implement canLeave) before the user navigates away. */
const leaveGuard: CanDeactivateFn<{ canLeave?: () => boolean | Promise<boolean> }> = (page) => (page.canLeave ? page.canLeave() : true);

/** One theatre: its page is where theatre and screen management live. */
const theatrePage = (tab?: string) => () => {
  return inject(Router).createUrlTree(['/theatre'], tab ? { queryParams: { tab } } : {});
};

/** Every section loads on demand, so the first screen stays fast. */
export const routes: Routes = [
  { path: 'sign-in', title: 'Sign in', loadComponent: () => import('./features/auth/sign-in.page').then((m) => m.SignInPage) },
  {
    path: '',
    component: ShellComponent,
    canActivate: [authGuard],
    children: [
      { path: 'overview', title: 'Overview', loadComponent: () => import('./features/overview/overview.page').then((m) => m.OverviewPage) },
      { path: 'theatre', title: 'Theatre', loadComponent: () => import('./features/theatres/theatre-detail.page').then((m) => m.TheatreDetailPage) },
      { path: 'theatres', redirectTo: theatrePage() },
      { path: 'theatres/:theatreId', redirectTo: theatrePage() },
      { path: 'screens', pathMatch: 'full', redirectTo: theatrePage('screens') },
      { path: 'screens/:screenId', title: 'Screen', loadComponent: () => import('./features/screens/screen-detail.page').then((m) => m.ScreenDetailPage) },
      { path: 'seats/:screenId', title: 'Seat designer', canDeactivate: [leaveGuard], loadComponent: () => import('./features/seats/seat-designer.page').then((m) => m.SeatDesignerPage) },
      { path: 'shows', title: 'Shows', loadComponent: () => import('./features/shows/shows.page').then((m) => m.ShowsPage) },
      { path: 'shows/new', title: 'Create show', loadComponent: () => import('./features/shows/show-editor.page').then((m) => m.ShowEditorPage) },
      { path: 'shows/:showId/edit', title: 'Edit show', loadComponent: () => import('./features/shows/show-editor.page').then((m) => m.ShowEditorPage) },
      { path: 'shows/:showId', title: 'Show', loadComponent: () => import('./features/shows/show-detail.page').then((m) => m.ShowDetailPage) },
      { path: 'counter', title: 'Counter Booking', loadComponent: () => import('./features/counter/counter.page').then((m) => m.CounterPage) },
      { path: 'counter/history', title: 'Counter history', loadComponent: () => import('./features/counter/counter-history.page').then((m) => m.CounterHistoryPage) },
      { path: 'counter/dashboard', title: 'Counter dashboard', loadComponent: () => import('./features/counter/counter-dashboard.page').then((m) => m.CounterDashboardPage) },
      { path: 'shows/:showId/cancel', title: 'Cancel show', loadComponent: () => import('./features/cancellations/cancel-show.page').then((m) => m.CancelShowPage) },
      { path: 'cancellations', pathMatch: 'full', redirectTo: '/shows?tab=cancelled' },
      { path: 'cancellations/:showId', redirectTo: ({ params }) => '/shows/' + params['showId'] + '/cancel' },
      { path: 'refunds', title: 'Refunds', loadComponent: () => import('./features/refunds/refunds.page').then((m) => m.RefundsPage) },
      { path: 'refunds/:refundId', title: 'Refund', loadComponent: () => import('./features/refunds/refund-detail.page').then((m) => m.RefundDetailPage) },
      { path: 'reports', title: 'Reports', loadComponent: () => import('./features/reports/reports.page').then((m) => m.ReportsPage) },
      { path: 'settings', title: 'Settings', loadComponent: () => import('./features/settings/settings.page').then((m) => m.SettingsPage) },
      { path: '', pathMatch: 'full', redirectTo: 'overview' },
    ],
  },
  { path: '**', redirectTo: '' },
];
