# ThiraiDesk: architecture

A front-end prototype of the theatre operations console. Data is mock data held in front-end state; there are no API calls. The shapes and rules mirror what the real backend will provide.

## Stack

- Angular 22. All components are standalone, use OnPush change detection and signals (`signal`, `computed`, `input`, `output`, `model`), with zoneless change detection.
- Every section of the app is a lazy-loaded page, defined in `src/app/app.routes.ts`.
- Routes bind their parameters to component inputs (`withComponentInputBinding`). For example, `shows/:showId` reaches the page as `readonly showId = input.required<string>()`. Query parameters such as `?tab=drafts` arrive the same way, as `readonly tab = input<string>()`.

## Folders

```
src/app/
  core/
    models.ts        domain types (Theatre, Screen, SeatLayout, Movie, Show, Booking, Refund, AuditEntry …)
    admin-store.ts   the single store: signals for every record, derived values, all operations and business rules
    mock-data.ts     seeded sample data (Chennai theatres, two weeks of shows, bookings, refunds, audit)
    layout.ts        seat layout rules: seat ids, stats, validation, resize, build
    format.ts        money, dates, times, durations (Indian locale)
  shared/            reusable UI: icon, page header, KPI card, status badge, empty state, skeleton,
                     paginator, meter, sort header, modal, toasts and confirm dialog, table state
  shell/             sidebar and header (theatre selector, operational date, search, notifications, user)
  features/<area>/   one folder per section; pages are <name>.page.ts
```

## Rules of the road

- **The store owns the data.** Pages read the store's signals and call its methods (`createShow`, `publishShows`, `cancelShow`, `initiateRefunds` …). A page never changes a record itself. Every store operation writes its own audit entry.
- **Scope.** The header's theatre selector sets `store.selectedTheatreId`. Lists should use the `scoped*` signals, or filter with `store.inScope(theatreId)`. The operational date is `store.operationalDate`.
- **Business rules live in the store and `core/layout.ts`:**
  - `validateShow` checks overlaps, the cleaning buffer, an inactive screen or one with no layout, past times, format and language.
  - `validateLayout` checks rows, labels, categories, couple pairing and that the layout has at least one seat.
  - `screenDependencies` lists what blocks deleting a screen.
  - Show status (scheduled, running, completed, cancelled) is derived with `store.showStatus(show)` and never stored.
  - A refund moves through pending, approved, processing, then successful or failed. It shows as successful only once the simulated gateway confirms it.
- **Counter (box office) sales:**
  - Counter bookings are a second channel (`booking.channel = 'counter'`) on the same seat inventory as online bookings, so `store.seatsTaken(showId)` covers both.
  - `createCounterBooking` re-checks the seats when the sale is confirmed, so a seat can't be sold twice.
  - Walk-ins are always "Guest / Walk-in"; no personal data is stored.
  - Payments are recorded once, in `counterPayment`, and never edited.
  - Cancelling a counter booking opens a refund; it does not complete one. Cash is handed back at the counter with `confirmCashRefund`, and digital refunds go through the gateway. `initiateRefunds` skips cash refunds.
  - Tickets print through `TicketPrinter` (80 mm thermal layout with a QR code per seat).
- **Roles:** `store.can(permission)` checks `ROLE_PERMISSIONS`. The profile menu can switch the signed-in user to try each role; this is for the prototype only.
- **Feedback.** Use `ToastService` (`success`, `error`, `info`) after actions. Use `ConfirmService.ask({...})`, which returns a `Promise<boolean>`, before anything destructive or important. Pass `tone: 'danger'` for destructive actions; `requireText` makes the user type a word to confirm.
- **Loading.** `store.loading()` is true for the first moment after load. Show `<app-skeleton>` in its place.
- **Styling.**
  - Global tokens and classes live in `src/styles.css`: `.btn`, `.btn.primary`, `.card`, `.card-head`, `.data-table`, `.badge`, `.filters`, `.field`, `.input`, `.select`, `.tabs` and `.tab`, `.segmented`, `.callout`, `.facts`, `.meter`, `.form-grid`, `.page`.
  - Use them before writing new CSS, and keep feature-specific CSS in the component.
  - Colours always come from the tokens. Amber (`--accent`) is reserved for primary actions, focus and the current item. Status colours come from `<app-status-badge [status]="...">`.
- **Copy.**
  - Write plain, specific labels and messages.
  - Error messages say what is wrong and how to fix it.
  - Don't add filler text.
  - Use `formatMoney`, `formatTime`, `formatDate` and the other helpers from `core/format.ts` for every number and date.
- **Layout.** The app is designed desktop-first and must also work on tablets. Nothing may overflow the page at 1024 px. Wide tables scroll inside `.table-wrap`.

## Running

```bash
cd admin
npm install
npm start        # http://localhost:4201
npm run build    # output in admin/dist/admin/browser
```
