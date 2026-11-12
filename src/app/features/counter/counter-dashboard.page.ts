import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { AdminStore } from '../../core/admin-store';
import { formatDate, formatMoney, formatMoneyShort, formatNumber, formatPercent, formatRelative, formatTime, sameDay } from '../../core/format';
import { IconComponent } from '../../shared/icon.component';
import { EmptyStateComponent, KpiCardComponent, PageHeaderComponent, SkeletonComponent, StatusBadgeComponent } from '../../shared/ui';
import { BarListComponent, ChannelChartComponent, SeatSplitComponent } from './dashboard/charts';
import { ACTIVE_WINDOW_MINUTES, Bar, channelDays, counterStats, operatorDay, showOccupancy } from './dashboard/counter-stats';

/** Box office performance for the business date: sales, collections, operators, occupancy and channel mix. */
@Component({
  selector: 'app-counter-dashboard-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent, PageHeaderComponent, KpiCardComponent, StatusBadgeComponent, EmptyStateComponent, SkeletonComponent, BarListComponent, ChannelChartComponent, SeatSplitComponent],
  template: `
    <div class="page">
      <app-page-header [title]="full() ? 'Counter dashboard' : 'Your sales'" [crumbs]="[{ label: 'Counter Booking', link: '/counter' }, { label: 'Dashboard' }]"
        [subtitle]="dateLabel()">
        <a class="btn" routerLink="/counter"><app-icon name="ticket" />Sell tickets</a>
        <a class="btn" routerLink="/counter/history"><app-icon name="list" />Counter history</a>
      </app-page-header>

      @if (!full() && !own()) {
        <section class="card"><app-empty-state icon="lock" title="You cannot view counter reports" text="Counter reports are for counter supervisors and theatre administrators." /></section>
      } @else if (store.loading()) {
        <section class="card"><app-skeleton [rows]="8" /></section>
      } @else {
        @let s = stats();
        @if (!full()) {
          <div class="callout info"><app-icon name="info" /><span>Showing your own sales. Theatre-wide counter reports are for counter supervisors.</span></div>
        }
        <div class="kpis">
          <app-kpi-card [label]="full() ? 'Tickets sold today' : 'Your tickets today'" icon="ticket" [value]="num(s.total.tickets)" [hint]="s.total.count + ' bookings'" link="/counter/history" />
          <app-kpi-card [label]="full() ? 'Counter revenue today' : 'Your sales today'" icon="rupee" tone="success" [value]="short(s.total.amount)" [hint]="full() ? share() + ' of theatre sales today' : 'Confirmed sales'" />
          @if (full()) {
            <app-kpi-card label="Active operators" icon="user" tone="info" [value]="s.active.length" [hint]="s.active.length ? firstNames(s.active) : 'No sale in the last ' + activeHours + ' hours'" />
          }
          <app-kpi-card label="Cash collections" [value]="short(s.cash.amount)" [hint]="s.cash.count + ' sales · cash in drawer'" />
          <app-kpi-card label="UPI collections" [value]="short(s.upi.amount)" [hint]="s.upi.count + ' sales'" />
          <app-kpi-card label="Card collections" [value]="short(s.card.amount)" [hint]="s.card.count + ' sales'" />
          <app-kpi-card label="Cancelled counter tickets" icon="cancel" [tone]="s.cancelledTally.tickets ? 'danger' : 'default'" [value]="s.cancelledTally.tickets" [hint]="s.cancelledTally.count + ' bookings · ' + money(s.cancelledTally.amount) + ' sold'" />
        </div>

        <div class="grid-2">
          @if (full()) {
            <section class="card">
              <div class="card-head"><div><h2>Counter vs online sales</h2><p class="muted tiny">Confirmed sales by the day they were sold. Online includes the convenience fee.</p></div></div>
              <div class="card-body stack">
                <div class="today">
                  <div><span class="eyebrow">Counter today</span><strong>{{ money(channelToday().counter) }}</strong><small class="muted">{{ channelToday().counterTickets }} tickets</small></div>
                  <div><span class="eyebrow">Online today</span><strong>{{ money(channelToday().online) }}</strong><small class="muted">{{ channelToday().onlineTickets }} tickets</small></div>
                  <div><span class="eyebrow">Theatre total</span><strong>{{ money(channelToday().counter + channelToday().online) }}</strong><small class="muted">Counter share {{ share() }}</small></div>
                </div>
                <app-channel-chart [days]="days()" />
                <p class="muted tiny">Last 7 days: {{ money(weekTotal().counter) }} at the counter, {{ money(weekTotal().online) }} online.</p>
              </div>
            </section>
          }
          <section class="card">
            <div class="card-head"><h2>Sales by payment method</h2><span class="muted small">{{ money(s.total.amount) }}</span></div>
            <div class="card-body"><app-bar-list [bars]="methodBars()" empty="No counter sales on this date." /></div>
          </section>
          @if (full()) {
            <section class="card">
              <div class="card-head"><h2>Counter sales by screen</h2></div>
              <div class="card-body"><app-bar-list [bars]="screenBars()" empty="No counter sales on this date." /></div>
            </section>
            <section class="card">
              <div class="card-head"><div><h2>Operators</h2><p class="muted tiny">Active means a sale in the last {{ activeHours }} hours.</p></div></div>
              <div class="table-wrap">
                <table class="data-table">
                  <thead><tr><th>Operator</th><th class="num">Sales</th><th class="num">Tickets</th><th class="num">Amount</th><th class="num">Cash</th><th>Last sale</th></tr></thead>
                  <tbody>
                    @for (o of operators(); track o.name) {
                      <tr>
                        <td class="nowrap"><span class="dot" [class.on]="o.active"></span>{{ o.name }}<small class="sub">{{ o.role }} · {{ o.counter }}</small></td>
                        <td class="num">{{ o.count }}</td>
                        <td class="num">{{ o.tickets }}</td>
                        <td class="num money">{{ money(o.amount) }}</td>
                        <td class="num money muted">{{ money(o.cash) }}</td>
                        <td class="nowrap muted">{{ o.last ? relative(o.last) : '—' }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            </section>
          }
        </div>

        @if (full()) {
          <section class="card">
            <div class="card-head">
              <div><h2>Show occupancy by channel</h2><p class="muted tiny">Shows on {{ dateLabel() }}. Counter and online sell from the same seats.</p></div>
              <div class="legend small"><span><i class="sw counter"></i>Counter</span><span><i class="sw online"></i>Online</span><span><i class="sw free"></i>Available</span></div>
            </div>
            @if (occupancy().length) {
              <div class="table-wrap">
                <table class="data-table">
                  <thead><tr><th>Show</th><th>Status</th><th class="bar-col">Seats</th><th class="num">Counter</th><th class="num">Online</th><th class="num">Available</th><th class="num">Occupancy</th></tr></thead>
                  <tbody>
                    @for (o of occupancy(); track o.show.id) {
                      <tr>
                        <td class="nowrap"><a [routerLink]="['/shows', o.show.id]" class="strong film">{{ time(o.show.start) }} · {{ o.label }}</a><small class="sub">{{ o.screen }}</small></td>
                        <td><app-status-badge [status]="o.status" /></td>
                        <td class="bar-col"><app-seat-split [counter]="o.counter" [online]="o.online" [available]="o.available" [capacity]="o.capacity" /></td>
                        <td class="num">{{ o.counter }}</td>
                        <td class="num">{{ o.online }}</td>
                        <td class="num muted">{{ o.show.cancellation ? '—' : o.available }}</td>
                        <td class="num">{{ o.capacity ? pctOf(o.counter + o.online, o.capacity) : '—' }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            } @else {
              <app-empty-state icon="shows" title="No published shows on this date" />
            }
          </section>
        }

        <section class="card">
          <div class="card-head"><h2>{{ full() ? 'Recent counter transactions' : 'Your recent sales' }}</h2><a class="small" routerLink="/counter/history">All history</a></div>
          @if (s.recent.length) {
            <div class="table-wrap">
              <table class="data-table">
                <thead><tr><th>Booking</th><th>Show</th><th class="num">Tickets</th><th class="num">Total</th><th>Payment</th>@if (full()) { <th>Operator</th> }<th>Sold</th><th>Status</th></tr></thead>
                <tbody>
                  @for (r of s.recent; track r.booking.id) {
                    <tr>
                      <td><a class="mono strong" routerLink="/counter/history" [queryParams]="{ ref: r.booking.ref }">{{ r.booking.ref }}</a></td>
                      <td class="nowrap"><span class="film">{{ r.film }}</span><small class="sub">{{ r.screen }} · {{ r.showStart ? time(r.showStart) : '' }}</small></td>
                      <td class="num">{{ r.tickets }}</td>
                      <td class="num money">{{ money(r.booking.amount) }}</td>
                      <td>{{ r.method }}</td>
                      @if (full()) { <td class="nowrap">{{ r.operator }}</td> }
                      <td class="nowrap muted">{{ time(r.booking.bookedAt) }}</td>
                      <td><app-status-badge [status]="r.booking.status" /></td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          } @else {
            <app-empty-state icon="ticket" title="No counter sales on this date" text="Sales appear here as soon as they are confirmed at the counter.">
              <a class="btn" routerLink="/counter">Sell tickets</a>
            </app-empty-state>
          }
        </section>
      }
    </div>
  `,
  styles: `
    .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
    .today { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
    .today > div { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .today strong { font-size: 1.15rem; }
    .today small { font-size: 0.74rem; }
    .sub { display: block; color: var(--text-muted); font-size: 0.74rem; font-weight: 400; }
    .film { color: var(--text); font-weight: 600; }
    a.film:hover { color: var(--accent); }
    .bar-col { width: 34%; min-width: 160px; }
    .legend { display: flex; flex-wrap: wrap; gap: 6px 14px; color: var(--text-soft); }
    .legend span { display: inline-flex; align-items: center; gap: 6px; }
    .sw { display: inline-block; width: 10px; height: 10px; border-radius: 3px; }
    .sw.counter { background: var(--info); }
    .sw.online { background: var(--text-muted); }
    .sw.free { background: var(--surface-3); box-shadow: inset 0 0 0 1px var(--border-strong); }
    .dot { display: inline-block; width: 7px; height: 7px; margin-right: 8px; border-radius: 50%; background: var(--surface-3); vertical-align: middle; }
    .dot.on { background: var(--success); }
  `,
})
export class CounterDashboardPage {
  readonly store = inject(AdminStore);

  readonly money = formatMoney;
  readonly short = formatMoneyShort;
  readonly num = formatNumber;
  readonly time = formatTime;
  readonly activeHours = ACTIVE_WINDOW_MINUTES / 60;
  readonly relative = (d: Date) => formatRelative(d, this.store.now());
  readonly firstNames = (names: string[]) => names.map((n) => n.split(' ')[0]).join(', ');
  readonly pctOf = (n: number, of: number) => formatPercent(n / of);

  readonly full = computed(() => this.store.can('counter.reports'));
  readonly own = computed(() => this.store.can('counter.sell'));
  readonly day = computed(() => this.store.operationalDate());
  readonly dateLabel = computed(() => formatDate(this.day()));
  readonly isToday = computed(() => sameDay(this.day(), this.store.now()));

  readonly stats = computed(() => counterStats(this.store, this.day(), this.full() ? null : this.store.currentUser().name));
  readonly days = computed(() => channelDays(this.store, this.day()));
  readonly channelToday = computed(() => this.days()[this.days().length - 1]!);
  readonly weekTotal = computed(() => this.days().reduce((t, d) => ({ counter: t.counter + d.counter, online: t.online + d.online }), { counter: 0, online: 0 }));
  readonly share = computed(() => {
    const d = this.channelToday();
    const t = d.counter + d.online;
    return t ? formatPercent(d.counter / t) : '—';
  });
  readonly occupancy = computed(() => showOccupancy(this.store, this.day()));
  readonly operators = computed(() => operatorDay(this.store, this.day()));

  readonly methodBars = computed<Bar[]>(() => {
    const s = this.stats();
    const total = s.total.amount;
    return s.byMethod
      .filter((m) => m.count || this.store.settings().counterPaymentMethods.includes(m.method))
      .map((m) => ({ key: m.method, label: m.method, sub: `${m.count} sales`, value: m.amount, text: `${formatMoney(m.amount)} · ${total ? formatPercent(m.amount / total) : '0%'}` }));
  });
  readonly screenBars = computed<Bar[]>(() => this.stats().byScreen.map((b) => ({ ...b, text: formatMoney(b.value) })));
}
