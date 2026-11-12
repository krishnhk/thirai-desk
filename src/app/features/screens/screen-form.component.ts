import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, output, signal } from '@angular/core';

import { ALL_THEATRES, AdminStore } from '../../core/admin-store';
import { Screen, SCREEN_TYPES, ScreenType } from '../../core/models';
import { ToastService } from '../../shared/feedback';
import { ModalComponent } from '../../shared/modal.component';

/** Create or edit a screen's details. The screen number is assigned by the store on create. */
@Component({
  selector: 'app-screen-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ModalComponent],
  template: `
    <app-modal [title]="screen() ? 'Edit ' + screen()!.name : 'New screen'" [eyebrow]="screen() ? theatreName() : 'Screens'" (closed)="closed.emit()">
      <form id="screen-form" class="form-grid" (submit)="$event.preventDefault(); save()" novalidate>
        <div class="field full">
          <label for="sf-theatre">Theatre</label>
          @if (screen()) {
            <input id="sf-theatre" class="input" [value]="theatreName()" disabled />
          } @else {
            <select id="sf-theatre" class="select" [class.invalid]="tried() && !theatreId()" [value]="theatreId()" (change)="theatreId.set($any($event.target).value)">
              <option value="" disabled>Choose a theatre</option>
              @for (t of theatres(); track t.id) { <option [value]="t.id">{{ t.name }} · {{ t.area }}@if (t.status === 'inactive') { (inactive) }</option> }
            </select>
            @if (tried() && !theatreId()) { <span class="error-text">Choose the theatre this screen belongs to.</span> }
            @if (theatreId()) { <span class="hint">It will be screen number {{ nextNumber() }} at this theatre.</span> }
          }
        </div>
        <div class="field">
          <label for="sf-name">Screen name</label>
          <input id="sf-name" class="input" maxlength="40" placeholder="Audi 6" [class.invalid]="tried() && !!nameError()" [value]="name()" (input)="name.set($any($event.target).value)" />
          @if (tried() && nameError()) { <span class="error-text">{{ nameError() }}</span> }
        </div>
        <div class="field">
          <label for="sf-type">Screen type</label>
          <select id="sf-type" class="select" [value]="type()" (change)="type.set($any($event.target).value)">
            @for (t of types; track t) { <option [value]="t">{{ t }}</option> }
          </select>
        </div>
        <div class="field">
          <label for="sf-sound">Sound system</label>
          <input id="sf-sound" class="input" maxlength="60" placeholder="Dolby 7.1" [value]="sound()" (input)="sound.set($any($event.target).value)" />
        </div>
        <div class="field">
          <label for="sf-proj">Projection</label>
          <input id="sf-proj" class="input" maxlength="60" placeholder="Barco 4K" [value]="projection()" (input)="projection.set($any($event.target).value)" />
        </div>
        @if (!screen()) {
          <p class="full callout info small">New screens start active with no seat layout. Design and publish the layout before scheduling shows.</p>
        }
      </form>
      <ng-container footer>
        <button class="btn" type="button" (click)="closed.emit()">Cancel</button>
        <button class="btn primary" type="submit" form="screen-form">{{ screen() ? 'Save changes' : 'Create screen' }}</button>
      </ng-container>
    </app-modal>
  `,
})
export class ScreenFormComponent implements OnInit {
  private readonly store = inject(AdminStore);
  private readonly toast = inject(ToastService);

  /** The screen to edit; null to create one. */
  readonly screen = input<Screen | null>(null);
  readonly closed = output<void>();
  readonly saved = output<Screen>();

  readonly types = SCREEN_TYPES;
  readonly theatreId = signal('');
  readonly name = signal('');
  readonly type = signal<ScreenType>('2D');
  readonly sound = signal('');
  readonly projection = signal('');
  readonly tried = signal(false);

  readonly theatres = computed(() => this.store.scopedTheatres());
  readonly theatreName = computed(() => this.store.theatre(this.screen()?.theatreId ?? this.theatreId())?.name ?? '');
  readonly nextNumber = computed(() => Math.max(0, ...this.store.screens().filter((s) => s.theatreId === this.theatreId()).map((s) => s.number)) + 1);

  readonly nameError = computed(() => {
    const n = this.name().trim();
    if (!n) return 'Enter a screen name.';
    const tid = this.screen()?.theatreId ?? this.theatreId();
    const clash = this.store.screens().some((s) => s.theatreId === tid && s.id !== this.screen()?.id && s.name.trim().toLowerCase() === n.toLowerCase());
    return clash ? `${this.theatreName() || 'This theatre'} already has a screen called ${n}.` : '';
  });

  ngOnInit(): void {
    const s = this.screen();
    if (s) {
      this.theatreId.set(s.theatreId);
      this.name.set(s.name);
      this.type.set(s.type);
      this.sound.set(s.sound);
      this.projection.set(s.projection);
    } else {
      const sel = this.store.selectedTheatreId();
      this.theatreId.set(sel !== ALL_THEATRES ? sel : '');
    }
  }

  save(): void {
    this.tried.set(true);
    if (this.nameError() || !this.theatreId()) return;
    const data = { name: this.name().trim(), type: this.type(), sound: this.sound().trim(), projection: this.projection().trim() };
    const existing = this.screen();
    if (existing) {
      this.store.updateScreen(existing.id, data);
      this.toast.success('Screen updated', `${data.name} · ${this.theatreName()}`);
      this.saved.emit(this.store.screen(existing.id) ?? existing);
    } else {
      const created = this.store.addScreen({ ...data, theatreId: this.theatreId() });
      this.toast.success('Screen created', `${created.name} is screen ${created.number} at ${this.theatreName()}.`);
      this.saved.emit(created);
    }
  }
}
