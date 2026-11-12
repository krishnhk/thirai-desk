import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, output, signal } from '@angular/core';

import { AdminStore } from '../../core/admin-store';
import { StaffMember, Theatre } from '../../core/models';
import { ToastService } from '../../shared/feedback';
import { IconComponent } from '../../shared/icon.component';

/** Logos already in the app's public folder. */
export const THEATRE_LOGOS = [
  { url: '/theatres/hayat-cinemas.png', label: 'Hayat Cinemas' },
  { url: '/theatres/pvr.png', label: 'PVR' },
  { url: '/theatres/inox.png', label: 'INOX' },
  { url: '/theatres/ags-logo.png', label: 'AGS Cinemas' },
  { url: '/theatres/ega-logo.png', label: 'Ega Cinemas' },
  { url: '/theatres/rohini-logo.png', label: 'Rohini Cinemas' },
];

export const STAFF_ROLES = ['General Manager', 'Operations Manager', 'Projection Lead', 'Box Office Lead', 'Facilities', 'Food & Beverage'];

interface TheatreDraft { name: string; code: string; brand: string; city: string; area: string; address: string; pincode: string; phone: string; email: string; logoUrl: string; }

type Field = 'name' | 'code' | 'brand' | 'city' | 'area' | 'address' | 'pincode' | 'phone' | 'email';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[0-9][0-9 -]{7,15}$/;

/** Edits the theatre in place on its page: either its details (identity, logo, address, contact) or its staff, depending on `section`. Saves through the store. */
@Component({
  selector: 'app-theatre-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <form class="edit" novalidate (submit)="$event.preventDefault(); save()">
      @if (section() === 'details') {
      <section class="card">
        <div class="card-head"><h2>Identity</h2></div>
        <div class="grid">
          <div class="field">
            <label for="tf-name">Theatre name</label>
            <input id="tf-name" class="input" [class.invalid]="show('name')" [value]="v().name" (input)="set('name', $event)" placeholder="PVR Phoenix Velachery" />
            @if (show('name')) { <span class="error-text">{{ errors()['name'] }}</span> }
          </div>
          <div class="field">
            <label for="tf-brand">Brand</label>
            <input id="tf-brand" class="input" [class.invalid]="show('brand')" [value]="v().brand" (input)="set('brand', $event)" placeholder="PVR INOX" />
            @if (show('brand')) { <span class="error-text">{{ errors()['brand'] }}</span> }
          </div>
          <div class="field">
            <label for="tf-code">Theatre code</label>
            <input id="tf-code" class="input mono" [class.invalid]="show('code')" [value]="v().code" (input)="set('code', $event, true)" placeholder="PVR-VEL" maxlength="12" />
            @if (show('code')) { <span class="error-text">{{ errors()['code'] }}</span> } @else { <span class="hint">Printed on tickets and reports.</span> }
          </div>
          <div class="field" role="group" aria-labelledby="tf-logo-l">
            <span class="field-label" id="tf-logo-l">Logo</span>
            <div class="logos">
              @for (l of logos; track l.url) {
                <button type="button" class="logo-opt" [attr.aria-pressed]="v().logoUrl === l.url" [attr.title]="l.label" [attr.aria-label]="l.label" (click)="patch({ logoUrl: l.url })"><img [src]="l.url" alt="" /></button>
              }
              <button type="button" class="logo-opt none" [attr.aria-pressed]="!v().logoUrl" title="No logo, show initials" aria-label="No logo" (click)="patch({ logoUrl: '' })">{{ initialsOf(v().name) }}</button>
            </div>
          </div>
        </div>
      </section>

      <section class="card">
        <div class="card-head"><h2>Address and contact</h2></div>
        <div class="grid">
          <div class="field wide">
            <label for="tf-address">Street address</label>
            <input id="tf-address" class="input" [class.invalid]="show('address')" [value]="v().address" (input)="set('address', $event)" placeholder="Phoenix MarketCity, 142 Velachery Main Road" />
            @if (show('address')) { <span class="error-text">{{ errors()['address'] }}</span> }
          </div>
          <div class="field">
            <label for="tf-area">Area</label>
            <input id="tf-area" class="input" [class.invalid]="show('area')" [value]="v().area" (input)="set('area', $event)" placeholder="Velachery" />
            @if (show('area')) { <span class="error-text">{{ errors()['area'] }}</span> }
          </div>
          <div class="field pair">
            <div class="field">
              <label for="tf-city">City</label>
              <input id="tf-city" class="input" [class.invalid]="show('city')" [value]="v().city" (input)="set('city', $event)" />
              @if (show('city')) { <span class="error-text">{{ errors()['city'] }}</span> }
            </div>
            <div class="field">
              <label for="tf-pin">PIN code</label>
              <input id="tf-pin" class="input" inputmode="numeric" maxlength="6" [class.invalid]="show('pincode')" [value]="v().pincode" (input)="set('pincode', $event)" placeholder="600042" />
              @if (show('pincode')) { <span class="error-text">{{ errors()['pincode'] }}</span> }
            </div>
          </div>
          <div class="field">
            <label for="tf-phone">Operations phone</label>
            <input id="tf-phone" class="input" type="tel" [class.invalid]="show('phone')" [value]="v().phone" (input)="set('phone', $event)" placeholder="+91 44 4000 0000" />
            @if (show('phone')) { <span class="error-text">{{ errors()['phone'] }}</span> }
          </div>
          <div class="field">
            <label for="tf-email">Operations email</label>
            <input id="tf-email" class="input" type="email" [class.invalid]="show('email')" [value]="v().email" (input)="set('email', $event)" placeholder="ops@theatre.example" />
            @if (show('email')) { <span class="error-text">{{ errors()['email'] }}</span> }
          </div>
        </div>
      </section>

      }

      @if (section() === 'staff') {
      <section class="card">
        <div class="card-head"><h2>Staff</h2><button type="button" class="btn sm" (click)="addStaff()"><app-icon name="plus" />Add staff member</button></div>
        @if (staff().length) {
          <div class="staff">
            <div class="staff-row head" aria-hidden="true"><span>Name</span><span>Role</span><span>Phone</span><span>Email</span><span></span></div>
            @for (m of staff(); track $index; let i = $index) {
              <div class="staff-row">
                <input class="input" [class.invalid]="submitted() && staffErrors()[i]?.name" aria-label="Name" placeholder="Name" [value]="m.name" (input)="setStaff(i, 'name', $event)" />
                <select class="select" aria-label="Role" [value]="m.role" (change)="setStaff(i, 'role', $event)">
                  @for (r of rolesFor(m.role); track r) { <option [value]="r" [selected]="m.role === r">{{ r }}</option> }
                </select>
                <input class="input" [class.invalid]="submitted() && staffErrors()[i]?.phone" aria-label="Phone" placeholder="Phone" [value]="m.phone" (input)="setStaff(i, 'phone', $event)" />
                <input class="input" [class.invalid]="submitted() && staffErrors()[i]?.email" aria-label="Email" placeholder="Email" [value]="m.email" (input)="setStaff(i, 'email', $event)" />
                <button type="button" class="btn ghost icon" aria-label="Remove staff member" title="Remove" (click)="removeStaff(i)"><app-icon name="trash" /></button>
              </div>
            }
          </div>
          @if (submitted() && staffInvalid()) { <p class="error-text staff-err">Each staff member needs a name, a valid phone number and a valid email.</p> }
        } @else {
          <p class="empty">No staff listed. Add the general manager and duty managers so operations can reach them.</p>
        }
      </section>
      }

      <div class="savebar">
        <span class="msg">
          @if (submitted() && !valid()) { <span class="bad"><app-icon name="alert" />Fix the highlighted fields to save.</span> } @else { <span class="muted small">Changes are saved to the theatre and recorded in the activity log.</span> }
        </span>
        <div class="actions">
          <button type="button" class="btn" (click)="closed.emit()">Cancel</button>
          <button type="submit" class="btn primary">{{ section() === 'staff' ? 'Save staff' : 'Save details' }}</button>
        </div>
      </div>
    </form>
  `,
  styles: `
    :host { display: block; }
    .edit { display: flex; flex-direction: column; gap: 16px; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px 20px; padding: 18px 20px 20px; }
    .field.wide { grid-column: 1 / -1; }
    .field.pair { display: grid; grid-template-columns: minmax(0, 1fr) 120px; gap: 12px; }
    .logos { display: flex; flex-wrap: wrap; gap: 8px; }
    .logo-opt { display: grid; place-items: center; width: 52px; height: 52px; padding: 5px; border: 1px solid var(--border); border-radius: var(--radius); background: #fff; color: #1b1e24; font-size: 0.8rem; font-weight: 800; overflow: hidden; }
    .logo-opt img { display: block; width: 100%; height: 100%; object-fit: contain; }
    .logo-opt:hover { border-color: var(--border-strong); }
    .logo-opt[aria-pressed='true'] { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
    .logo-opt:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .logo-opt.none { background: var(--surface-3); color: var(--text-soft); }
    .staff { display: flex; flex-direction: column; gap: 8px; padding: 14px 20px 18px; }
    .staff-row { display: grid; grid-template-columns: minmax(0, 1.1fr) 190px minmax(0, 1fr) minmax(0, 1.4fr) 38px; gap: 10px; align-items: center; }
    .staff-row.head { font-size: 0.72rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-muted); }
    .staff-err { margin: 0; padding: 0 20px 14px; }
    .empty { margin: 0; padding: 18px 20px; font-size: 0.86rem; color: var(--text-muted); }
    .savebar { position: sticky; bottom: 0; z-index: 5; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 20px; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); box-shadow: var(--shadow); }
    .bad { display: inline-flex; align-items: center; gap: 6px; font-size: 0.86rem; font-weight: 600; color: var(--danger); }
    .bad app-icon { width: 15px; height: 15px; }
    .actions { display: flex; gap: 8px; }
    @media (max-width: 900px) {
      .grid { grid-template-columns: minmax(0, 1fr); }
      .staff-row { grid-template-columns: repeat(2, minmax(0, 1fr)); padding-bottom: 10px; border-bottom: 1px solid var(--border-soft); }
      .staff-row.head { display: none; }
      .staff-row .btn { grid-column: 1 / -1; justify-self: end; }
    }
  `,
})
export class TheatreFormComponent implements OnInit {
  private readonly store = inject(AdminStore);
  private readonly toast = inject(ToastService);

  readonly theatre = input.required<Theatre>();
  /** Which part is being edited: the theatre's own details, or its staff. Never both at once. */
  readonly section = input<'details' | 'staff'>('details');
  readonly closed = output<void>();
  readonly saved = output<string>();

  readonly logos = THEATRE_LOGOS;
  readonly roles = STAFF_ROLES;

  readonly v = signal<TheatreDraft>({ name: '', code: '', brand: '', city: '', area: '', address: '', pincode: '', phone: '', email: '', logoUrl: '' });
  readonly staff = signal<StaffMember[]>([]);
  readonly submitted = signal(false);
  private readonly touched = signal<ReadonlySet<string>>(new Set());

  ngOnInit(): void {
    const t = this.theatre();
    this.v.set({ name: t.name, code: t.code, brand: t.brand, city: t.city, area: t.area, address: t.address, pincode: t.pincode, phone: t.phone, email: t.email, logoUrl: t.logoUrl ?? '' });
    this.staff.set(t.staff.map((m) => ({ ...m })));
  }

  readonly errors = computed<Partial<Record<Field, string>>>(() => {
    const v = this.v();
    const e: Partial<Record<Field, string>> = {};
    const own = this.theatre();
    if (!v.name.trim()) e.name = 'Enter the theatre name.';
    else if (this.store.theatres().some((t) => t.id !== own.id && t.name.trim().toLowerCase() === v.name.trim().toLowerCase())) e.name = 'Another theatre already has this name.';
    if (!v.code.trim()) e.code = 'Enter a theatre code.';
    else if (!/^[A-Z0-9][A-Z0-9-]{2,11}$/.test(v.code)) e.code = 'Use 3 to 12 letters, digits or hyphens, such as PVR-VEL.';
    else if (this.store.theatres().some((t) => t.id !== own.id && t.code === v.code)) e.code = `${v.code} is already used by another theatre.`;
    if (!v.brand.trim()) e.brand = 'Enter the brand or operator.';
    if (!v.address.trim()) e.address = 'Enter the street address.';
    if (!v.area.trim()) e.area = 'Enter the area or locality.';
    if (!v.city.trim()) e.city = 'Enter the city.';
    if (!/^[1-9][0-9]{5}$/.test(v.pincode)) e.pincode = 'Enter a 6-digit PIN code.';
    if (!PHONE.test(v.phone.trim())) e.phone = 'Enter a phone number with the area code, such as +91 44 4500 1100.';
    if (!EMAIL.test(v.email.trim())) e.email = 'Enter a valid email address.';
    return e;
  });

  readonly staffErrors = computed(() => this.staff().map((m) => ({
    name: !m.name.trim(), phone: !PHONE.test(m.phone.trim()), email: !EMAIL.test(m.email.trim()),
  })));
  readonly staffInvalid = computed(() => this.staffErrors().some((e) => e.name || e.phone || e.email));
  readonly valid = computed(() => this.section() === 'staff' ? !this.staffInvalid() : Object.keys(this.errors()).length === 0);

  show(f: Field): boolean { return !!this.errors()[f] && (this.submitted() || this.touched().has(f)); }

  set(f: Field, ev: Event, upper = false): void {
    let value = (ev.target as HTMLInputElement).value;
    if (upper) value = value.toUpperCase();
    this.v.update((x) => ({ ...x, [f]: value }));
    this.touched.update((s) => new Set(s).add(f));
  }
  patch(p: Partial<TheatreDraft>): void { this.v.update((x) => ({ ...x, ...p })); }

  addStaff(): void { this.staff.update((l) => [...l, { name: '', role: 'Operations Manager', phone: '', email: '' }]); }
  removeStaff(i: number): void { this.staff.update((l) => l.filter((_, k) => k !== i)); }
  setStaff(i: number, key: keyof StaffMember, ev: Event): void {
    const value = (ev.target as HTMLInputElement).value;
    this.staff.update((l) => l.map((m, k) => (k === i ? { ...m, [key]: value } : m)));
  }

  /** The standard roles, plus a custom role already on record. */
  rolesFor(role: string): string[] { return this.roles.includes(role) ? this.roles : [role, ...this.roles]; }

  initialsOf(name: string): string {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '—';
  }

  save(): void {
    this.submitted.set(true);
    if (!this.valid()) return;
    const v = this.v();
    const own = this.theatre();
    if (this.section() === 'staff') {
      this.store.updateTheatre(own.id, { staff: this.staff().map((m) => ({ name: m.name.trim(), role: m.role, phone: m.phone.trim(), email: m.email.trim() })) });
      this.toast.success('Staff updated', `${own.name} staff list is saved.`);
    } else {
      const data = {
        name: v.name.trim(), code: v.code.trim(), brand: v.brand.trim(), city: v.city.trim(), area: v.area.trim(), address: v.address.trim(),
        pincode: v.pincode.trim(), phone: v.phone.trim(), email: v.email.trim(), logoUrl: v.logoUrl || undefined,
      };
      this.store.updateTheatre(own.id, data);
      this.toast.success('Theatre updated', `${data.name} details are saved.`);
    }
    this.saved.emit(own.id);
    this.closed.emit();
  }
}
