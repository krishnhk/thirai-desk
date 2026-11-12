/**
 * Realistic sample data for the prototype: Chennai theatres, their screens and seat layouts, the
 * films now showing, two weeks of shows around today, bookings, refunds and an audit trail.
 * Generated from a fixed seed relative to today, so it is the same on every load of a given day.
 */
import { addDays, addMinutes, startOfDay } from './format';
import { buildLayout, seatNumbers, SELLABLE } from './layout';
import {
  AuditEntry, Booking, Movie, OperationalSettings, PaymentMethod, Refund, RefundStatus, Screen, SeatCategory, SeatLayout,
  Show, ShowCancellation, StaffUser, Theatre, WALK_IN,
} from './models';

export const USERS = {
  owner: { name: 'Krish', role: 'Owner' as const },
  gm: { name: 'Mukesh', role: 'General Manager' as const },
  ops: { name: 'Krish', role: 'Operations Staff' as const },
  ops2: { name: 'Veeraa', role: 'Operations Staff' as const },
  admin: { name: 'Krish', role: 'Theatre Administrator' as const },
  supervisor: { name: 'Veeraa', role: 'Counter Supervisor' as const },
  counter1: { name: 'Thiru', role: 'Counter Operator' as const },
  counter2: { name: 'Vetri', role: 'Counter Operator' as const },
  counter3: { name: 'Kathir', role: 'Counter Operator' as const },
};

/** Everyone who can sign in to the console, for the role switcher and operator filters. */
export const STAFF_USERS: StaffUser[] = [
  { id: 'u-admin', name: USERS.admin.name, role: 'Theatre Administrator', email: 'krish@hayatcinemas.example', phone: '9840055001', initials: 'K' },
  { id: 'u-gm', name: USERS.gm.name, role: 'General Manager', email: 'mukesh@hayatcinemas.example', phone: '9840011223', initials: 'M' },
  { id: 'u-sup', name: USERS.supervisor.name, role: 'Counter Supervisor', email: 'veeraa@hayatcinemas.example', phone: '9840055002', initials: 'V', counter: 'Counter 1' },
  { id: 'u-c1', name: USERS.counter1.name, role: 'Counter Operator', email: 'thiru@hayatcinemas.example', phone: '9840055003', initials: 'T', counter: 'Counter 1' },
  { id: 'u-c2', name: USERS.counter2.name, role: 'Counter Operator', email: 'vetri@hayatcinemas.example', phone: '9840055004', initials: 'V', counter: 'Counter 2' },
  { id: 'u-c3', name: USERS.counter3.name, role: 'Counter Operator', email: 'kathir@hayatcinemas.example', phone: '9840055005', initials: 'K', counter: 'Counter 3' },
];

export const DEFAULT_SETTINGS: OperationalSettings = {
  bufferMinutes: 20,
  defaultIntermission: 15,
  convenienceFee: 30,
  salesCutoffMinutes: 15,
  autoApproveShowRefunds: true,
  notifyCustomersByDefault: true,
  counterPaymentMethods: ['Cash', 'UPI', 'Card', 'Other'],
  counterCancellationCutoffMinutes: 30,
  counterCancellationFeePerTicket: 20,
  counterAdvanceBookingDays: 7,
};

/** A small deterministic random generator (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const pick = <T>(r: () => number, list: readonly T[]): T => list[Math.floor(r() * list.length)]!;

const CUSTOMER_FIRST = ['Aravind', 'Meena', 'Sanjay', 'Lakshmi', 'Vignesh', 'Keerthana', 'Rahul', 'Divya', 'Harish', 'Nandhini',
  'Prakash', 'Swetha', 'Manoj', 'Revathi', 'Gokul', 'Anitha', 'Suresh', 'Kavya', 'Dinesh', 'Pooja', 'Bharath', 'Sneha',
  'Ashwin', 'Janani', 'Karthik', 'Priyanka', 'Naveen', 'Deepa', 'Sathish', 'Vidhya', 'Mohammed', 'Fathima', 'John', 'Sharon'];
const CUSTOMER_LAST = ['Kumar', 'Rajan', 'Subramanian', 'Krishnan', 'Venkatesh', 'Murugan', 'Iyer', 'Pillai', 'Shankar', 'Balaji',
  'Natarajan', 'Sundaram', 'Ganesh', 'Raghavan', 'Arumugam', 'Selvam', 'Ibrahim', 'Joseph', 'Mani', 'Ramesh'];
const PAYMENT_METHODS: PaymentMethod[] = ['UPI', 'UPI', 'UPI', 'Credit card', 'Debit card', 'Net banking', 'Wallet'];

function category(id: string, name: string, color: string, basePrice: number, rule?: string): SeatCategory {
  return { id, name, color, basePrice, rule };
}

export function buildMockData(today = new Date()) {
  const day0 = startOfDay(today);
  const r = rng(hash(day0.toDateString()) ^ 0x5eed);
  const ago = (days: number, hours = 10) => addMinutes(addDays(day0, -days), hours * 60);

  // ---------------------------------------------------------------- Theatres
  const theatres: Theatre[] = [
    {
      id: 't-hayat-porur', code: 'HYT-PRR', name: 'Hayat Cinemas', brand: 'Hayat Cinemas', city: 'Chennai', area: 'Porur',
      address: 'Lakshmi Nagar, Porur', pincode: '600116',
      phone: '+91 44 2476 0000', email: 'ops@hayatcinemas.example', logoUrl: '/theatres/hayat-cinemas.png', titleUrl: '/theatres/hayat-cinemas-title.png', coverUrl: '/theatres/hayat-cinemas-cover.png', coverBranded: true, status: 'active',
      staff: [
        { name: 'Mukesh', role: 'General Manager', phone: '+91 98400 11223', email: 'mukesh@hayatcinemas.example' },
        { name: 'Krish', role: 'Theatre Administrator', phone: '+91 98400 55001', email: 'krish@hayatcinemas.example' },
        { name: 'Veeraa', role: 'Counter Supervisor', phone: '+91 98400 55002', email: 'veeraa@hayatcinemas.example' },
        { name: 'Thiru', role: 'Counter Operator', phone: '+91 98400 55003', email: 'thiru@hayatcinemas.example' },
      ],
      updatedAt: ago(3, 16),
    },
  ];

  // ---------------------------------------------------------------- Screens and layouts
  const regular = (p: number) => category('cat-regular', 'Regular', '#7c8aa0', p);
  const premium = (p: number) => category('cat-premium', 'Premium', '#e5a93d', p, '+₹30 on Fri–Sun');
  const recliner = (p: number) => category('cat-recliner', 'Recliner', '#a68bfa', p, 'Includes F&B voucher');
  const couple = (p: number) => category('cat-couple', 'Couple Seat', '#d36bc6', p);
  const vip = (p: number) => category('cat-vip', 'VIP', '#43c07f', p);

  type Preset = (by: string, at: Date) => SeatLayout;
  const presets: Record<string, Preset> = {
    large: (by, at) => buildLayout(22, [
      { rows: 4, category: regular(190) }, { rows: 7, category: premium(250) }, { rows: 2, category: recliner(480) },
    ], [5, 16], by, at),
    imax: (by, at) => buildLayout(26, [
      { rows: 5, category: regular(260) }, { rows: 8, category: premium(380) }, { rows: 2, category: recliner(650) },
    ], [6, 19], by, at),
    medium: (by, at) => buildLayout(16, [
      { rows: 3, category: regular(170) }, { rows: 6, category: premium(220) }, { rows: 1, category: couple(460), kind: 'couple' },
    ], [3, 12], by, at),
    atmos: (by, at) => buildLayout(18, [
      { rows: 3, category: regular(200) }, { rows: 6, category: premium(280) }, { rows: 2, category: vip(420) },
    ], [4, 13], by, at),
    small: (by, at) => buildLayout(12, [
      { rows: 2, category: premium(320) }, { rows: 5, category: recliner(560) },
    ], [6], by, at),
  };

  const screenSpecs: { theatreId: string; number: number; name: string; type: Screen['type']; preset: string | null; status?: 'inactive'; sound: string; projection: string }[] = [
    { theatreId: 't-hayat-porur', number: 1, name: 'Screen 1', type: 'Dolby Atmos', preset: 'large', sound: 'Dolby Atmos', projection: 'Barco RGB laser' },
    { theatreId: 't-hayat-porur', number: 2, name: 'Screen 2', type: '3D', preset: 'medium', sound: 'Dolby Atmos', projection: 'Barco 2K with RealD 3D' },
    { theatreId: 't-hayat-porur', number: 3, name: 'Screen 3', type: '2D', preset: null, sound: 'Dolby 7.1', projection: 'Barco 2K' },
  ];

  const screens: Screen[] = screenSpecs.map((s) => {
    const at = ago(10 + s.number * 3, 15);
    const layout = s.preset ? presets[s.preset]!(USERS.gm.name, at) : null;
    if (layout) layout.version = 1 + (s.number % 3);
    return {
      id: `s-${s.theatreId.slice(2)}-${s.number}`,
      theatreId: s.theatreId,
      number: s.number,
      name: s.name,
      type: s.type,
      status: s.status ?? 'active',
      layout,
      // Screen 3 is new: its layout is still a draft, so it cannot be scheduled yet.
      draftLayout: s.preset ? null : presets['small']!(USERS.ops.name, ago(1, 18)),
      sound: s.sound,
      projection: s.projection,
      updatedAt: at,
    };
  });

  // ---------------------------------------------------------------- Movies
  const m = (id: string, title: string, poster: string, runtime: number, languages: string[], genres: string[],
    certification: Movie['certification'], release: string, formats: Movie['formats'], director: string, cast: string[], synopsis: string): Movie => ({
    id, title, posterUrl: `/posters/${poster}.jpg`, runtime, languages, genres, certification, releaseDate: new Date(release),
    formats, director, cast, synopsis,
  });
  const movies: Movie[] = [
    m('m-scene', 'Scene', 'scene', 149, ['Tamil'], ['Action', 'Comedy'], 'UA 13+', '2026-11-06', ['2D', 'Dolby Atmos'], 'Jithu Madhavan', ['Suriya', 'Naslen', 'Nazriya Nazim'], 'An action comedy directed by Jithu Madhavan, with Suriya, Naslen and Nazriya Nazim.'),
    m('m-jailer2', 'Jailer 2', 'jailer-2', 165, ['Tamil', 'Telugu', 'Hindi'], ['Action', 'Comedy'], 'UA 16+', '2026-10-15', ['2D', 'IMAX 2D', 'Dolby Atmos', '4DX'], 'Nelson Dilipkumar', ['Rajinikanth', 'Ramya Krishnan'], 'Rajinikanth returns in the sequel to Jailer, directed by Nelson Dilipkumar.'),
    m('m-baththa', 'Baththa', 'baththa', 158, ['Tamil'], ['Comedy', 'Drama'], 'UA 7+', '2026-10-01', ['2D'], 'Balaji Tharaneetharan', ['Vijay Sethupathi'], 'A comedy drama written and directed by Balaji Tharaneetharan, with Vijay Sethupathi in the title role.'),
    m('m-dorothy', 'Dorothy', 'dorothy', 146, ['Tamil'], ['Crime', 'Drama'], 'UA 13+', '2026-09-25', ['2D', 'Dolby Atmos'], 'Karthik Subbaraj', ['Keerthy Suresh'], 'A crime drama written and directed by Karthik Subbaraj, with Keerthy Suresh.'),
    m('m-modha', 'Modha Rathiri', 'modha-rathiri', 143, ['Tamil'], ['Comedy', 'Drama'], 'UA 7+', '2026-08-21', ['2D'], 'Raja Karuppasamy', ['Kalaiyarasan', 'Vani Bhojan'], 'A comedy drama from debut director Raja Karuppasamy.'),
    m('m-dc', 'DC', 'dc', 142, ['Tamil'], ['Action', 'Thriller'], 'A', '2026-08-07', ['2D', 'Dolby Atmos'], 'Arun Matheswaran', ['Lokesh Kanagaraj', 'Wamiqa Gabbi'], 'An action thriller directed by Arun Matheswaran, with Lokesh Kanagaraj in the lead.'),
    m('m-jana', 'Jana Nayagan', 'jana-nayagan', 183, ['Tamil', 'Telugu', 'Hindi'], ['Action', 'Drama'], 'UA 13+', '2026-07-23', ['2D', 'IMAX 2D', 'Dolby Atmos'], 'H. Vinoth', ['Vijay', 'Pooja Hegde', 'Bobby Deol'], 'A political action film directed by H. Vinoth, billed as Vijay’s final film as an actor.'),
    m('m-karuppu', 'Karuppu', 'karuppu', 152, ['Tamil', 'Telugu'], ['Fantasy', 'Action'], 'UA 13+', '2026-05-15', ['2D', '3D', 'Dolby Atmos'], 'RJ Balaji', ['Suriya', 'Trisha Krishnan'], 'A fantasy action drama directed by RJ Balaji and rooted in the folk deity Karuppu, with Suriya in the lead.'),
    m('m-29', '29', '29', 137, ['Tamil'], ['Romance', 'Drama'], 'UA 7+', '2026-05-08', ['2D'], 'Rathna Kumar', ['Vidhu', 'Preethi Asrani'], 'A romantic drama written and directed by Rathna Kumar, with Vidhu and Preethi Asrani in the lead.'),
    m('m-thaai', 'Thaai Kizhavi', 'thaai-kizhavi', 142, ['Tamil'], ['Comedy', 'Drama'], 'U', '2026-04-10', ['2D'], 'Sivakumar Murugesan', ['Radikaa Sarathkumar'], 'A comedy drama about a godmother figure, from debut director Sivakumar Murugesan.'),
    m('m-couple', 'Couple Friendly', 'couple-friendly', 121, ['Telugu', 'Tamil'], ['Romance', 'Drama'], 'UA 7+', '2026-02-14', ['2D'], 'Ashwin Chandrasekar', ['Santosh Sobhan', 'Manasa Varanasi'], 'A romantic drama from writer-director Ashwin Chandrasekar, with Santosh Sobhan and Manasa Varanasi.'),
    m('m-withlove', 'With Love', 'with-love', 140, ['Tamil'], ['Romance', 'Comedy'], 'U', '2026-02-06', ['2D'], 'Madhan', ['Abishan Jeevinth', 'Anaswara Rajan'], 'A teen romantic comedy written and directed by Madhan, with Abishan Jeevinth and Anaswara Rajan.'),
    m('m-madharaasi', 'Madharaasi', 'madharaasi', 168, ['Tamil'], ['Action', 'Thriller'], 'UA 13+', '2025-09-05', ['2D', 'Dolby Atmos'], 'A.R. Murugadoss', ['Sivakarthikeyan', 'Rukmini Vasanth'], 'An action thriller directed by A.R. Murugadoss, with Sivakarthikeyan.'),
    m('m-coolie', 'Coolie', 'coolie', 170, ['Tamil', 'Telugu', 'Hindi'], ['Action', 'Thriller'], 'A', '2025-08-14', ['2D', 'IMAX 2D'], 'Lokesh Kanagaraj', ['Rajinikanth', 'Nagarjuna', 'Shruti Haasan'], 'An action thriller directed by Lokesh Kanagaraj, with Rajinikanth.'),
    m('m-thuglife', 'Thug Life', 'thug-life', 163, ['Tamil'], ['Crime', 'Action'], 'UA 16+', '2025-06-05', ['2D', 'IMAX 2D'], 'Mani Ratnam', ['Kamal Haasan', 'Silambarasan', 'Trisha Krishnan'], 'A crime action film directed by Mani Ratnam, with Kamal Haasan.'),
    m('m-retro', 'Retro', 'retro', 168, ['Tamil'], ['Romance', 'Action'], 'UA 13+', '2025-05-01', ['2D'], 'Karthik Subbaraj', ['Suriya', 'Pooja Hegde'], 'A romantic action film directed by Karthik Subbaraj, with Suriya.'),
    m('m-gbu', 'Good Bad Ugly', 'good-bad-ugly', 139, ['Tamil'], ['Action', 'Comedy'], 'UA 13+', '2025-04-10', ['2D'], 'Adhik Ravichandran', ['Ajith Kumar', 'Trisha Krishnan'], 'An action comedy directed by Adhik Ravichandran, with Ajith Kumar.'),
    m('m-dragon', 'Dragon', 'dragon', 155, ['Tamil', 'Telugu'], ['Comedy', 'Drama'], 'UA 7+', '2025-02-21', ['2D'], 'Ashwath Marimuthu', ['Pradeep Ranganathan', 'Anupama Parameswaran'], 'A comedy drama directed by Ashwath Marimuthu, with Pradeep Ranganathan.'),
  ];
  // Films currently in theatres: the most recent releases, strongest first.
  const nowShowing = ['m-scene', 'm-jailer2', 'm-baththa', 'm-dorothy', 'm-modha', 'm-dc', 'm-jana', 'm-karuppu'];

  // ---------------------------------------------------------------- Shows
  const shows: Show[] = [];
  const slotSets = [[9, 30], [13, 15], [17, 0], [20, 45]];
  const formatFor = (screen: Screen, movie: Movie): Show['format'] => {
    if (screen.type === 'IMAX' && movie.formats.includes('IMAX 2D')) return 'IMAX 2D';
    if (screen.type === 'Dolby Atmos' && movie.formats.includes('Dolby Atmos')) return 'Dolby Atmos';
    if (screen.type === '3D' && movie.formats.includes('3D')) return '3D';
    return '2D';
  };
  let showSeq = 1;
  const schedulable = screens.filter((s) => s.layout && s.status === 'active');
  for (let d = -6; d <= 6; d++) {
    const day = addDays(day0, d);
    schedulable.forEach((screen, si) => {
      const t = theatres.find((x) => x.id === screen.theatreId)!;
      if (t.status !== 'active') return;
      // Leave a gap so the alerts have something to show: Screen 2 has nothing scheduled from day +5.
      if (screen.id === 's-hayat-porur-2' && d >= 5) return;
      const slots = d >= 5 && si % 3 === 0 ? slotSets.slice(0, 2) : slotSets;
      slots.forEach(([h, mm], k) => {
        const movieId = nowShowing[(si + k + Math.max(0, d) * (k % 2)) % nowShowing.length]!;
        const movie = movies.find((x) => x.id === movieId)!;
        const start = addMinutes(day, h! * 60 + mm! + ((si * 15) % 45));
        const draft = (d >= 4 && (si + k) % 2 === 0) || (d === 1 && si === 2 && k === 3) || (d === 2 && si % 5 === 1 && k >= 2);
        const layout = screen.layout!;
        const prices: Record<string, number> = {};
        layout.categories.forEach((c) => (prices[c.id] = c.basePrice + (day.getDay() === 0 || day.getDay() >= 5 ? 30 : 0)));
        const createdAt = addMinutes(addDays(day, -(8 + (k % 3))), 10 * 60 + 25 + ((si * 37 + k * 53) % 420));
        shows.push({
          id: `sh-${String(showSeq++).padStart(4, '0')}`,
          theatreId: screen.theatreId,
          screenId: screen.id,
          movieId,
          format: formatFor(screen, movie),
          language: movie.languages[(si + k) % movie.languages.length]!,
          start,
          intermission: movie.runtime > 150 ? 15 : 10,
          prices,
          publication: draft ? 'draft' : 'published',
          cancellation: null,
          createdAt,
          createdBy: k % 2 ? USERS.ops.name : USERS.gm.name,
          updatedAt: addMinutes(createdAt, 90),
          publishedAt: draft ? null : addMinutes(createdAt, 120),
        });
      });
    });
  }

  // Cancellations: one two days ago, one earlier today, one tomorrow.
  const cancelAt = (screenId: string, dayOffset: number, slot: number, reason: ShowCancellation) => {
    const day = addDays(day0, dayOffset);
    const list = shows.filter((s) => s.screenId === screenId && s.start >= day && s.start < addDays(day, 1) && s.publication === 'published');
    const show = list[slot];
    if (show) show.cancellation = reason;
    return show;
  };
  const cancelled = [
    cancelAt('s-hayat-porur-2', -2, 3, { at: addMinutes(addDays(day0, -2), 17 * 60), by: USERS.gm.name, reason: 'Projection or equipment failure', notes: 'Laser projector fault reported at 4:40 PM. Barco engineer visit booked.', notifyCustomers: true }),
    cancelAt('s-hayat-porur-1', 0, 0, { at: addMinutes(day0, 7 * 60 + 40), by: USERS.ops2.name, reason: 'Power outage', notes: 'TNEB feeder trip at 7:15 AM; generator could not hold the projector load.', notifyCustomers: true }),
    cancelAt('s-hayat-porur-2', 1, 1, { at: addMinutes(day0, -3 * 60), by: USERS.gm.name, reason: 'Screen maintenance', notes: 'Screen surface repair scheduled with Harkness for tomorrow afternoon.', notifyCustomers: true }),
  ].filter((s): s is Show => !!s);

  // ---------------------------------------------------------------- Bookings
  const bookings: Booking[] = [];
  let bookingSeq = 1;
  const now = today.getTime();
  for (const show of shows) {
    if (show.publication !== 'published') continue;
    const screen = screens.find((s) => s.id === show.screenId)!;
    const layout = screen.layout!;
    const seatInfo: { id: string; cat: string }[] = [];
    layout.cells.forEach((row, ri) => {
      const nums = seatNumbers(layout, ri);
      row.forEach((cell, ci) => {
        if (SELLABLE.has(cell.kind) && nums[ci] != null) seatInfo.push({ id: `${layout.rowLabels[ri]}${nums[ci]}`, cat: cell.categoryId! });
      });
    });
    const dayOffset = Math.round((startOfDay(show.start).getTime() - day0.getTime()) / 86_400_000);
    const weekend = show.start.getDay() === 0 || show.start.getDay() >= 5;
    const evening = show.start.getHours() >= 17;
    let target = 0.25 + r() * 0.45 + (weekend ? 0.15 : 0) + (evening ? 0.1 : 0);
    if (dayOffset > 0) target *= Math.max(0.15, 1 - dayOffset * 0.17);
    target = Math.min(0.97, target);
    const sell = Math.floor(seatInfo.length * target);
    // Customers book from the middle rows outwards; take seats from a shuffled middle-first order.
    const order = seatInfo
      .map((s, i) => ({ s, w: Math.abs(i / seatInfo.length - 0.6) + r() * 0.35 }))
      .sort((a, b) => a.w - b.w)
      .map((x) => x.s);
    let taken = 0;
    while (taken < sell) {
      const size = Math.min(sell - taken, 1 + Math.floor(r() * r() * 5));
      const seats = order.slice(taken, taken + size);
      taken += size;
      const ticketTotal = seats.reduce((sum, s) => sum + (show.prices[s.cat] ?? 0), 0);
      const fee = DEFAULT_SETTINGS.convenienceFee * seats.length;
      const first = pick(r, CUSTOMER_FIRST);
      const last = pick(r, CUSTOMER_LAST);
      const leadDays = 0.1 + r() * Math.min(6, 6 + dayOffset);
      let bookedAt = new Date(show.start.getTime() - leadDays * 86_400_000);
      if (bookedAt.getTime() > now) bookedAt = new Date(now - r() * 6 * 3_600_000);
      const ref = 'TH' + (hash(`${show.id}-${bookingSeq}`) % 36 ** 6).toString(36).toUpperCase().padStart(6, '0');
      const counterOpen = show.start.getTime() - 3 * 3_600_000 < now && dayOffset <= 0;
      if (counterOpen && r() < 0.27) {
        const counterMethod = pick(r, ['Cash', 'Cash', 'Cash', 'UPI', 'UPI', 'Card', 'Other'] as const);
        const counterRef = 'TC' + ref.slice(2);
        const operator = pick(r, [USERS.counter1.name, USERS.counter2.name, USERS.counter3.name, USERS.supervisor.name]);
        let soldAt = new Date(show.start.getTime() - (5 + r() * 170) * 60_000);
        if (soldAt.getTime() > now) soldAt = new Date(now - r() * 40 * 60_000);
        const collected = counterMethod === 'Cash' ? Math.ceil(ticketTotal / 100) * 100 + (r() < 0.3 ? 100 : 0) : ticketTotal;
        bookings.push({
          id: `b-${String(bookingSeq++).padStart(6, '0')}`,
          ref: counterRef,
          showId: show.id,
          customerName: WALK_IN,
          customerPhone: '',
          customerEmail: '',
          seats: seats.map((x) => x.id),
          amount: ticketTotal,
          convenienceFee: 0,
          paymentMethod: counterMethod,
          paymentRef: counterMethod === 'Cash' ? `CASH-${counterRef}` : (counterMethod === 'UPI' ? 'UPI' : counterMethod === 'Card' ? 'POS' : 'VCH') + String(hash(counterRef + 'p') % 1e10).padStart(10, '0'),
          bookedAt: soldAt,
          status: 'confirmed',
          cancelledAt: null,
          channel: 'counter',
          operator,
          ticketRefs: seats.map((_, i) => `${counterRef}-${i + 1}`),
          counterPayment: {
            method: counterMethod,
            amountCollected: collected,
            change: collected - ticketTotal,
            txnRef: counterMethod === 'Cash' ? null : (counterMethod === 'UPI' ? 'UPI' : counterMethod === 'Card' ? 'POS' : 'VCH') + String(hash(counterRef + 't') % 1e10).padStart(10, '0'),
            confirmedAt: soldAt,
          },
          printCount: r() < 0.06 ? 2 : 1,
        });
        continue;
      }
      const method = pick(r, PAYMENT_METHODS);
      bookings.push({
        id: `b-${String(bookingSeq++).padStart(6, '0')}`,
        ref,
        showId: show.id,
        customerName: `${first} ${last}`,
        customerPhone: `+91 9${String(hash(ref) % 1_000_000_000).padStart(9, '0')}`,
        customerEmail: `${first.toLowerCase()}.${last.toLowerCase()}${hash(ref) % 90 + 10}@gmail.example`,
        seats: seats.map((s) => s.id),
        amount: ticketTotal + fee,
        convenienceFee: fee,
        paymentMethod: method,
        paymentRef: (method === 'UPI' ? 'UPI' : method === 'Wallet' ? 'WAL' : 'PG') + String(hash(ref + 'p') % 1e10).padStart(10, '0'),
        bookedAt,
        status: 'confirmed',
        cancelledAt: null,
        channel: 'online',
        operator: null,
        ticketRefs: seats.map((_, i) => `${ref}-${i + 1}`),
        counterPayment: null,
        printCount: 0,
      });
    }
  }

  // ---------------------------------------------------------------- Refunds
  const refunds: Refund[] = [];
  let refundSeq = 1;
  const ev = (status: RefundStatus, at: Date, by: string, note: string) => ({ status, at, by, note });
  const makeRefund = (b: Booking, show: Show, reason: Refund['reason'], plan: RefundStatus, requestedAt: Date): Refund => {
    // Cash is paid back at the counter, never through the gateway: it is either waiting for the customer or handed over.
    const cash = b.paymentMethod === 'Cash';
    if (cash && (plan === 'processing' || plan === 'failed')) plan = 'approved';
    let cashRefundRef: string | null = null;
    const amount = reason === 'Show cancelled' ? b.amount : Math.max(0, b.amount - b.convenienceFee - 20 * b.seats.length);
    const history = [ev('pending', requestedAt, 'System', reason === 'Show cancelled' ? 'Created when the show was cancelled.' : 'Customer asked to cancel the booking.')];
    const step = (mins: number) => addMinutes(requestedAt, mins);
    let gatewayRef: string | null = null;
    let failureReason: string | null = null;
    let attempts = 0;
    if (plan === 'rejected') history.push(ev('rejected', step(45), USERS.gm.name, 'Cancellation requested after the sales cut-off; not eligible under policy.'));
    if (['approved', 'processing', 'successful', 'failed'].includes(plan)) history.push(ev('approved', step(20), USERS.gm.name, 'Approved for refund.'));
    if (cash && plan === 'successful') { cashRefundRef = 'CR-' + b.ref.slice(2); history.push(ev('successful', step(40), USERS.supervisor.name, `Cash handed back at the counter. Cash refund reference ${cashRefundRef}.`)); }
    else if (['processing', 'successful', 'failed'].includes(plan)) { attempts = 1; history.push(ev('processing', step(25), USERS.gm.name, `Refund sent to the payment gateway (${b.paymentMethod}).`)); }
    if (plan === 'successful' && !cash) { gatewayRef = 'RFN' + String(hash(b.ref + 'r') % 1e10).padStart(10, '0'); history.push(ev('successful', step(32), 'Payment gateway', `Credited to the customer. Gateway reference ${gatewayRef}.`)); }
    if (plan === 'failed') { failureReason = b.paymentMethod === 'Wallet' ? 'Wallet account closed by the customer.' : 'Issuing bank declined the reversal (code 51).'; history.push(ev('failed', step(34), 'Payment gateway', failureReason)); }
    const last = history[history.length - 1]!;
    return {
      id: `rf-${String(refundSeq++).padStart(5, '0')}`, bookingId: b.id, showId: show.id, reason, amount, method: b.paymentMethod,
      status: plan, requestedAt, updatedAt: last.at, gatewayRef, failureReason, attempts, history,
      channel: b.channel, cashRefundRef,
    };
  };
  for (const show of cancelled) {
    const list = bookings.filter((b) => b.showId === show.id);
    const daysAgo = Math.round((day0.getTime() - startOfDay(show.cancellation!.at).getTime()) / 86_400_000);
    list.forEach((b, i) => {
      b.status = 'cancelled';
      b.cancelledAt = show.cancellation!.at;
      let plan: RefundStatus;
      if (daysAgo >= 2) plan = i % 17 === 5 ? 'failed' : 'successful';
      else if (daysAgo >= 0 && show.start < today) plan = i % 9 === 0 ? 'failed' : i % 4 === 0 ? 'processing' : i % 3 === 0 ? 'approved' : 'successful';
      else plan = 'pending';
      refunds.push(makeRefund(b, show, 'Show cancelled', plan, addMinutes(show.cancellation!.at, 2)));
    });
  }
  // Individual customer cancellations on upcoming shows.
  const upcoming = bookings.filter((b) => b.status === 'confirmed' && shows.find((s) => s.id === b.showId)!.start > today);
  const customerPlans: RefundStatus[] = ['pending', 'pending', 'pending', 'approved', 'successful', 'successful', 'rejected', 'failed', 'pending', 'successful'];
  customerPlans.forEach((plan, i) => {
    const b = upcoming[(i * 97 + 13) % upcoming.length];
    if (!b) return;
    const show = shows.find((s) => s.id === b.showId)!;
    b.status = 'cancelled';
    b.cancelledAt = addMinutes(today, -(i + 1) * 95);
    refunds.push(makeRefund(b, show, i === 7 ? 'Duplicate payment' : 'Customer cancellation', plan, b.cancelledAt));
  });

  // ---------------------------------------------------------------- Audit trail
  const audit: AuditEntry[] = [];
  let auditSeq = 1;
  const log = (at: Date, who: { name: string; role: string }, action: AuditEntry['action'], theatreId: string | null, target: string, summary: string, extra: Partial<AuditEntry> = {}) =>
    audit.push({ id: `a-${String(auditSeq++).padStart(5, '0')}`, at, user: who.name, role: who.role, action, theatreId, target, summary, ...extra });
  const tName = (id: string) => theatres.find((t) => t.id === id)!.name;
  const sName = (id: string) => { const s = screens.find((x) => x.id === id)!; return `${s.name} · ${tName(s.theatreId)}`; };
  const mTitle = (id: string) => movies.find((x) => x.id === id)!.title;

  log(ago(9, 12), USERS.owner, 'theatre.updated', 't-hayat-porur', 'Hayat Cinemas', 'Added the box office supervisor to the theatre staff.', { changes: [{ field: 'Staff', from: '3 people', to: '4 people' }], link: '/theatre' });
  log(ago(5, 15), USERS.gm, 'layout.published', 't-hayat-porur', sName('s-hayat-porur-2'), 'Published layout version 2: the back row became couple seats.', { changes: [{ field: 'Row J', from: '16 Premium seats', to: '6 Couple Seat pairs' }, { field: 'Bookable seats', from: '146', to: '140' }], link: '/seats/s-hayat-porur-2' });
  log(ago(4, 10), USERS.ops, 'screen.created', 't-hayat-porur', sName('s-hayat-porur-3'), 'Created Screen 3 (2D).', { link: '/screens/s-hayat-porur-3' });
  log(ago(1, 18), USERS.ops, 'layout.saved', 't-hayat-porur', sName('s-hayat-porur-3'), 'Saved a draft layout with 2 Premium and 5 Recliner rows.', { link: '/seats/s-hayat-porur-3' });
  log(ago(3, 16), USERS.gm, 'theatre.updated', 't-hayat-porur', 'Hayat Cinemas', 'Updated the operations phone number.', { changes: [{ field: 'Phone', from: '+91 44 2476 1111', to: '+91 44 2476 0000' }], link: '/theatre' });
  // Publication of the current week's schedule.
  theatres.filter((t) => t.status === 'active').forEach((t, i) => {
    const count = shows.filter((s) => s.theatreId === t.id && s.publishedAt && s.start >= day0 && s.start < addDays(day0, 4)).length;
    log(ago(3 - (i % 2), 18 + i), i % 2 ? USERS.ops2 : USERS.gm, 'show.published', t.id, `${t.name} schedule`, `Published ${count} shows for the next four days.`, { link: '/shows' });
  });
  shows.filter((s) => s.publication === 'draft').slice(0, 4).forEach((s, i) =>
    log(addMinutes(today, -(i + 2) * 70), USERS.ops, 'show.created', s.theatreId, `${mTitle(s.movieId)} · ${sName(s.screenId)}`, 'Created a draft show.', { link: `/shows/${s.id}` }));
  for (const s of cancelled) {
    const c = s.cancellation!;
    const affected = bookings.filter((b) => b.showId === s.id).length;
    log(c.at, c.by === USERS.gm.name ? USERS.gm : USERS.ops2, 'show.cancelled', s.theatreId, `${mTitle(s.movieId)} · ${sName(s.screenId)}`, `Cancelled the show (${c.reason}). ${affected} bookings affected.`, { link: `/shows/${s.id}` });
  }
  refunds.filter((rf) => rf.status === 'successful').slice(0, 6).forEach((rf) => {
    const show = shows.find((s) => s.id === rf.showId)!;
    const b = bookings.find((x) => x.id === rf.bookingId)!;
    log(rf.updatedAt, USERS.gm, 'refund.succeeded', show.theatreId, `Booking ${b.ref}`, `Refund of ₹${rf.amount} credited by ${rf.method}.`, { link: `/refunds/${rf.id}` });
  });
  refunds.filter((rf) => rf.status === 'failed').slice(0, 3).forEach((rf) => {
    const show = shows.find((s) => s.id === rf.showId)!;
    const b = bookings.find((x) => x.id === rf.bookingId)!;
    log(rf.updatedAt, USERS.gm, 'refund.failed', show.theatreId, `Booking ${b.ref}`, `Refund of ₹${rf.amount} failed: ${rf.failureReason}`, { link: `/refunds/${rf.id}` });
  });
  const counterUsers = [USERS.counter1, USERS.counter2, USERS.counter3, USERS.supervisor];
  bookings.filter((b) => b.channel === 'counter').sort((a, b) => b.bookedAt.getTime() - a.bookedAt.getTime()).slice(0, 40).forEach((b) => {
    const show = shows.find((s) => s.id === b.showId)!;
    const who = counterUsers.find((u) => u.name === b.operator) ?? USERS.counter1;
    log(b.bookedAt, who, 'counter.booked', show.theatreId, `Booking ${b.ref}`, `Sold ${b.seats.length} ticket${b.seats.length === 1 ? '' : 's'} (${b.seats.join(', ')}) for ${mTitle(show.movieId)} · ₹${b.amount} by ${b.paymentMethod}.`, { link: `/counter/history?ref=${b.ref}` });
  });
  audit.sort((a, b) => b.at.getTime() - a.at.getTime());

  return { theatres, screens, movies, shows, bookings, refunds, audit, settings: { ...DEFAULT_SETTINGS } };
}
