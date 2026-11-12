/** Formatting helpers shared by every screen. Indian locale and rupees throughout. */

const LOCALE = 'en-IN';

export const MINUTE = 60_000;
export const DAY = 86_400_000;

export function formatMoney(amount: number, decimals = 0): string {
  return '₹' + amount.toLocaleString(LOCALE, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** "₹1.24 L" for large sums on KPI cards. */
export function formatMoneyShort(amount: number): string {
  if (amount >= 10_000_000) return '₹' + (amount / 10_000_000).toFixed(2) + ' Cr';
  if (amount >= 100_000) return '₹' + (amount / 100_000).toFixed(2) + ' L';
  return formatMoney(amount);
}

export function formatNumber(n: number): string {
  return n.toLocaleString(LOCALE);
}

export function formatPercent(ratio: number): string {
  return Math.round(ratio * 100) + '%';
}

/** "10:30 AM" */
export function formatTime(d: Date): string {
  return d.toLocaleTimeString(LOCALE, { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase();
}

/** "Mon, 9 Nov" */
export function formatDay(d: Date): string {
  return d.toLocaleDateString(LOCALE, { weekday: 'short', day: 'numeric', month: 'short' });
}

/** "9 Nov 2026" */
export function formatDate(d: Date): string {
  return d.toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "9 Nov 2026, 10:30 AM" */
export function formatDateTime(d: Date): string {
  return `${formatDate(d)}, ${formatTime(d)}`;
}

/** "2h 32m" */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** "5 min ago", "in 2 h", "3 days ago" relative to now. */
export function formatRelative(d: Date, now = new Date()): string {
  const diff = d.getTime() - now.getTime();
  const abs = Math.abs(diff);
  const future = diff > 0;
  const say = (n: number, unit: string) => (future ? `in ${n} ${unit}` : `${n} ${unit} ago`);
  if (abs < MINUTE) return 'just now';
  if (abs < 60 * MINUTE) return say(Math.round(abs / MINUTE), 'min');
  if (abs < DAY) return say(Math.round(abs / (60 * MINUTE)), 'h');
  const days = Math.round(abs / DAY);
  return say(days, days === 1 ? 'day' : 'days');
}

/** Midnight at the start of the given day, local time. */
export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

export function addMinutes(d: Date, minutes: number): Date {
  return new Date(d.getTime() + minutes * MINUTE);
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** yyyy-mm-dd in local time, for date inputs and URL params. */
export function toDateInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function fromDateInput(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/** hh:mm (24 h) for time inputs. */
export function toTimeInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** A date with the time from an hh:mm value. */
export function withTime(day: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  const x = new Date(day);
  x.setHours(h || 0, m || 0, 0, 0);
  return x;
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
}
