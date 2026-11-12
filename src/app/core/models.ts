/**
 * The domain of the theatre operations console. Everything is front-end state for the prototype;
 * the shapes mirror what the real API will return so screens do not change when it arrives.
 */

export type ActiveStatus = 'active' | 'inactive';

export interface StaffMember {
  name: string;
  role: string;
  phone: string;
  email: string;
}

export interface Theatre {
  id: string;
  /** Short operational code, such as "HYT-PRR". */
  code: string;
  name: string;
  brand: string;
  city: string;
  area: string;
  address: string;
  pincode: string;
  phone: string;
  email: string;
  logoUrl?: string;
  /** The theatre's full horizontal logo (mark and name). Printed on tickets in place of the square logo and typed name when set. */
  titleUrl?: string;
  /** The cover photo shown at the top of the theatre's page. A default backdrop is used when none is set. */
  coverUrl?: string;
  /** True when the cover artwork already carries the logo and name, so the page does not repeat them on top. */
  coverBranded?: boolean;
  status: ActiveStatus;
  staff: StaffMember[];
  updatedAt: Date;
}

export const SCREEN_TYPES = ['2D', '3D', 'IMAX', 'Dolby Atmos', '4DX', 'EPIQ'] as const;
export type ScreenType = (typeof SCREEN_TYPES)[number];

/** What one grid cell of a seat layout holds. */
export type CellKind = 'seat' | 'couple' | 'aisle' | 'empty' | 'blocked' | 'wheelchair';

export interface SeatCell {
  kind: CellKind;
  /** The seat category, for seat, couple, blocked and wheelchair cells. */
  categoryId?: string;
}

export interface SeatCategory {
  id: string;
  name: string;
  /** A hex colour used on the seat map and the legend. */
  color: string;
  basePrice: number;
  /** An optional pricing rule shown to staff, such as "+₹50 on weekends". */
  rule?: string;
}

export type NumberingDirection = 'left-to-right' | 'right-to-left';

export interface SeatLayout {
  rows: number;
  cols: number;
  /** One label per row, front (nearest the screen) first. */
  rowLabels: string[];
  /** cells[row][col]. A couple seat takes two neighbouring "couple" cells. */
  cells: SeatCell[][];
  categories: SeatCategory[];
  numbering: NumberingDirection;
  version: number;
  updatedAt: Date;
  updatedBy: string;
}

export interface Screen {
  id: string;
  theatreId: string;
  number: number;
  name: string;
  type: ScreenType;
  status: ActiveStatus;
  /** The published layout customers book from; null until the first layout is published. */
  layout: SeatLayout | null;
  /** Work in progress from the seat designer, not yet published. */
  draftLayout: SeatLayout | null;
  /** Sound system and projection notes shown on the screen page. */
  sound: string;
  projection: string;
  updatedAt: Date;
}

export const CERTIFICATIONS = ['U', 'UA 7+', 'UA 13+', 'UA 16+', 'A'] as const;
export type Certification = (typeof CERTIFICATIONS)[number];

export const PROJECTION_FORMATS = ['2D', '3D', 'IMAX 2D', 'IMAX 3D', '4DX', 'Dolby Atmos'] as const;
export type ProjectionFormat = (typeof PROJECTION_FORMATS)[number];

export interface Movie {
  id: string;
  title: string;
  posterUrl?: string;
  languages: string[];
  runtime: number;
  genres: string[];
  certification: Certification;
  releaseDate: Date;
  formats: ProjectionFormat[];
  director: string;
  cast: string[];
  synopsis: string;
}

export type PublicationStatus = 'draft' | 'published';
/** Where a show is in its life. Derived from the clock and cancellation, never stored. */
export type ShowStatus = 'scheduled' | 'running' | 'completed' | 'cancelled';

export interface ShowCancellation {
  at: Date;
  by: string;
  reason: CancellationReason;
  notes: string;
  notifyCustomers: boolean;
}

export const CANCELLATION_REASONS = [
  'Projection or equipment failure',
  'Power outage',
  'Distributor withdrew print',
  'Low advance bookings',
  'Screen maintenance',
  'Government or police order',
  'Scheduling error',
  'Other',
] as const;
export type CancellationReason = (typeof CANCELLATION_REASONS)[number];

export interface Show {
  id: string;
  theatreId: string;
  screenId: string;
  movieId: string;
  format: ProjectionFormat;
  language: string;
  start: Date;
  /** Interval length in minutes; 0 for no interval. */
  intermission: number;
  /** Ticket price for each seat category of the screen, by category id. */
  prices: Record<string, number>;
  publication: PublicationStatus;
  cancellation: ShowCancellation | null;
  createdAt: Date;
  createdBy: string;
  updatedAt: Date;
  publishedAt: Date | null;
}

export type PaymentMethod = 'UPI' | 'Credit card' | 'Debit card' | 'Net banking' | 'Wallet' | 'Cash' | 'Card' | 'Other';

/** Where a booking was made: the website or app, or the theatre's box office. */
export type BookingChannel = 'online' | 'counter';

/** Payment methods a box office can take. Which ones are enabled is an operational setting. */
export const COUNTER_PAYMENT_METHODS = ['Cash', 'UPI', 'Card', 'Other'] as const;
export type CounterPaymentMethod = (typeof COUNTER_PAYMENT_METHODS)[number];

/** How a counter sale was paid. Recorded once at confirmation and never edited afterwards. */
export interface CounterPayment {
  method: CounterPaymentMethod;
  /** What the operator collected: for cash, the notes handed over; otherwise the amount charged. */
  amountCollected: number;
  /** Cash only: collected minus payable. */
  change: number;
  /** UPI/card/other: the terminal or UPI transaction reference. Null for cash. */
  txnRef: string | null;
  confirmedAt: Date;
}

/** The customer label for every counter booking. No personal data is taken at the counter. */
export const WALK_IN = 'Guest / Walk-in';

export interface Booking {
  id: string;
  /** Customer-facing reference, such as "TH8K2Q4M". */
  ref: string;
  showId: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  seats: string[];
  /** Amount paid, including the convenience fee. */
  amount: number;
  convenienceFee: number;
  paymentMethod: PaymentMethod;
  paymentRef: string;
  bookedAt: Date;
  status: 'confirmed' | 'cancelled';
  cancelledAt: Date | null;
  channel: BookingChannel;
  /** Counter bookings: the operator who sold the tickets. Null online. */
  operator: string | null;
  /** One reference per ticket (seat), printed on the ticket and scanned at entry. */
  ticketRefs: string[];
  /** Counter bookings: how it was paid. Null online (the payment gateway record is paymentRef). */
  counterPayment: CounterPayment | null;
  /** How many times the ticket was printed (1 = original, more = reprints). */
  printCount: number;
}

export const REFUND_STATUSES = ['pending', 'approved', 'processing', 'successful', 'failed', 'rejected'] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];
export type RefundReason = 'Show cancelled' | 'Customer cancellation' | 'Duplicate payment' | 'Seat not available';

export interface RefundEvent {
  status: RefundStatus;
  at: Date;
  by: string;
  note: string;
}

export interface Refund {
  id: string;
  bookingId: string;
  showId: string;
  reason: RefundReason;
  /** Amount to return to the customer. */
  amount: number;
  /** Refunds go back to the original payment method. */
  method: PaymentMethod;
  status: RefundStatus;
  requestedAt: Date;
  updatedAt: Date;
  /** The gateway's refund reference, set only once the gateway accepts the refund. */
  gatewayRef: string | null;
  failureReason: string | null;
  /** The channel of the original booking. Counter cash refunds are paid out at the box office. */
  channel: BookingChannel;
  /** Cash refunds: the reference the operator recorded when handing the cash back. */
  cashRefundRef: string | null;
  attempts: number;
  history: RefundEvent[];
}

export type AuditAction =
  | 'theatre.created' | 'theatre.updated' | 'theatre.activated' | 'theatre.deactivated'
  | 'screen.created' | 'screen.updated' | 'screen.activated' | 'screen.deactivated' | 'screen.deleted'
  | 'layout.saved' | 'layout.published'
  | 'movie.created' | 'movie.updated'
  | 'show.created' | 'show.updated' | 'show.duplicated' | 'show.deleted' | 'show.published' | 'show.cancelled'
  | 'refund.approved' | 'refund.initiated' | 'refund.succeeded' | 'refund.failed' | 'refund.rejected' | 'refund.retried'
  | 'settings.updated'
  | 'counter.booked' | 'counter.reprinted' | 'counter.cancelled' | 'counter.cash-refunded';

export interface AuditEntry {
  id: string;
  at: Date;
  user: string;
  role: string;
  action: AuditAction;
  theatreId: string | null;
  /** What was acted on, such as "Screen 2 · Hayat Cinemas". */
  target: string;
  summary: string;
  /** Field-level changes, shown when the entry is expanded. */
  changes?: { field: string; from: string; to: string }[];
  /** Where to open the record. */
  link?: string;
}

export type UserRole = 'Owner' | 'General Manager' | 'Operations Staff' | 'Theatre Administrator' | 'Counter Supervisor' | 'Counter Operator';

/** Things a signed-in user may be allowed to do; see ROLE_PERMISSIONS in the store. */
export type Permission =
  | 'counter.sell' | 'counter.history.own' | 'counter.history.all' | 'counter.cancel' | 'counter.refund'
  | 'counter.reports' | 'counter.configure' | 'counter.operators' | 'admin.all';

/** A member of staff who can sign in to the console. */
export interface StaffUser {
  id: string;
  name: string;
  role: UserRole;
  email: string;
  /** Mobile number they sign in with. */
  phone?: string;
  initials: string;
  /** Counter staff only: the counter they usually work. */
  counter?: string;
}

export interface CurrentUser {
  name: string;
  role: UserRole;
  email: string;
  initials: string;
}

/** A finding from validating a layout or a show: errors block publishing, warnings do not. */
export interface Issue {
  level: 'error' | 'warning';
  message: string;
  /** Where the problem is, such as a field name or a "row,col" cell key. */
  where?: string;
}

export interface OperationalSettings {
  /** Minutes the screen needs between one show's end and the next show's start. */
  bufferMinutes: number;
  defaultIntermission: number;
  convenienceFee: number;
  /** How long before the start a show stops selling. */
  salesCutoffMinutes: number;
  autoApproveShowRefunds: boolean;
  notifyCustomersByDefault: boolean;
  /** Payment methods the box office accepts. */
  counterPaymentMethods: CounterPaymentMethod[];
  /** Counter tickets can be cancelled until this many minutes before the show. */
  counterCancellationCutoffMinutes: number;
  /** Deducted per ticket when a counter booking is cancelled by the customer. */
  counterCancellationFeePerTicket: number;
  /** How many days ahead the box office can sell (0 = today only). */
  counterAdvanceBookingDays: number;
}
