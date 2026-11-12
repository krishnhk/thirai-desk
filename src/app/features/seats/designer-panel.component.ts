import { ChangeDetectionStrategy, Component, computed, effect, inject, input, model, output, signal } from '@angular/core';

import { formatMoney } from '../../core/format';
import { layoutStats, PHYSICAL } from '../../core/layout';
import { Issue, SeatLayout } from '../../core/models';
import { ConfirmService } from '../../shared/feedback';
import { IconComponent } from '../../shared/icon.component';
import {
  addCategory, CATEGORY_PRESETS, newCategory, reletterRows, removeCategory, resize, rowKeys, seatsLostByResize, setCategory, setRowLabel, updateCategory,
} from './layout-editor';

export type PanelTab = 'layout' | 'categories' | 'checks';

/** The designer's side panel: grid size, numbering and rows; seat categories; validation results. */
@Component({
  selector: 'app-designer-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <div class="tabs" role="tablist" aria-label="Designer settings">
      <button class="tab" type="button" role="tab" [attr.aria-selected]="tab() === 'layout'" (click)="tab.set('layout')">Layout</button>
      <button class="tab" type="button" role="tab" [attr.aria-selected]="tab() === 'categories'" (click)="tab.set('categories')">Categories <span class="count-pill">{{ layout().categories.length }}</span></button>
      <button class="tab" type="button" role="tab" [attr.aria-selected]="tab() === 'checks'" (click)="tab.set('checks')">
        Checks @if (errorCount()) { <span class="count-pill err">{{ errorCount() }}</span> } @else { <app-icon name="check" class="ok" /> }
      </button>
    </div>

    <div class="body" role="tabpanel">
      @switch (tab()) {
        @case ('layout') {
          <section class="sec">
            <h3>Grid size</h3>
            <div class="size">
              <div class="field"><label for="dp-rows">Rows</label><input id="dp-rows" class="input" type="number" min="1" max="40" [value]="rows()" (input)="rows.set(+$any($event.target).value)" /></div>
              <span class="x">×</span>
              <div class="field"><label for="dp-cols">Columns</label><input id="dp-cols" class="input" type="number" min="1" max="60" [value]="cols()" (input)="cols.set(+$any($event.target).value)" /></div>
              <button class="btn" type="button" [disabled]="!sizeChanged()" (click)="applySize()">Apply</button>
            </div>
            @if (sizeError()) { <p class="error-text">{{ sizeError() }}</p> } @else { <p class="hint">Up to 40 rows and 60 columns. New cells start empty.</p> }
          </section>

          <section class="sec">
            <h3>Seat numbering</h3>
            <div class="segmented" role="group" aria-label="Seat numbering direction">
              <button type="button" [attr.aria-pressed]="layout().numbering === 'left-to-right'" (click)="setNumbering('left-to-right')">Left to right</button>
              <button type="button" [attr.aria-pressed]="layout().numbering === 'right-to-left'" (click)="setNumbering('right-to-left')">Right to left</button>
            </div>
            <p class="hint">As seen facing the screen. Aisles and empty spaces are skipped; each half of a couple seat has its own number.</p>
          </section>

          <section class="sec">
            <div class="row"><h3>Rows</h3><span class="spacer"></span><label class="check small"><input type="checkbox" [checked]="skipIO()" (change)="skipIO.set($any($event.target).checked)" />Skip I and O</label><button class="btn sm" type="button" (click)="reletter()">Re-letter</button></div>
            <p class="hint">Row A is nearest the screen. Set a whole row's category here.</p>
            <ul class="rows">
              @for (r of rowInfo(); track r.index) {
                <li [class.err]="r.err">
                  <input class="input lbl-in" [id]="'row-label-' + r.index" [attr.aria-label]="'Label of row ' + (r.index + 1)" maxlength="3" [value]="r.label" (change)="setLabel(r.index, $any($event.target).value)" />
                  <span class="cnt small muted">{{ r.seats }} seats</span>
                  <select class="select sm" [attr.aria-label]="'Category for row ' + (r.label || r.index + 1)" [disabled]="!r.seats" (change)="setRowCategory(r.index, $any($event.target)); ">
                    <option value="">{{ r.category }}</option>
                    @for (c of layout().categories; track c.id) { <option [value]="c.id">All {{ c.name }}</option> }
                  </select>
                </li>
              }
            </ul>
          </section>
        }

        @case ('categories') {
          <p class="hint">Colours show on the seat map and legend. Base prices are the default ticket prices when scheduling.</p>
          <ul class="cats">
            @for (c of layout().categories; track c.id) {
              <li class="cat" [class.paint]="c.id === paintCategory()">
                <div class="cat-top">
                  <input class="swatch" type="color" [value]="c.color" [attr.aria-label]="'Colour of ' + c.name" (change)="patchCategory(c.id, { color: $any($event.target).value })" />
                  <input class="input name" [attr.aria-label]="'Name of category'" maxlength="24" [value]="c.name" (change)="patchCategory(c.id, { name: $any($event.target).value.trim() })" />
                  <button class="btn ghost sm icon" type="button" [attr.aria-label]="'Remove ' + c.name" title="Remove category" (click)="remove(c.id)"><app-icon name="trash" /></button>
                </div>
                <div class="cat-bottom">
                  <div class="input-group price"><span>₹</span><input class="input" type="number" min="0" step="10" [attr.aria-label]="'Base price of ' + c.name" [value]="c.basePrice" (change)="patchCategory(c.id, { basePrice: +$any($event.target).value })" /></div>
                  <input class="input rule" maxlength="40" placeholder="Pricing rule (optional)" [attr.aria-label]="'Pricing rule for ' + c.name" [value]="c.rule ?? ''" (change)="patchCategory(c.id, { rule: $any($event.target).value.trim() })" />
                </div>
                <div class="cat-foot small">
                  <span class="muted">{{ counts()[c.id] ?? 0 }} bookable seats · {{ money(c.basePrice) }}</span>
                  @if (c.id === paintCategory()) { <span class="painting">Painting with this</span> } @else { <button class="link-btn" type="button" (click)="paintWith.emit(c.id)">Paint with this</button> }
                </div>
              </li>
            }
          </ul>
          <div class="add">
            <select class="select" aria-label="Category to add" #preset>
              @for (p of presets(); track p.name) { <option [value]="p.name">{{ p.name }} · {{ money(p.price) }}</option> }
              <option value="">Custom category</option>
            </select>
            <button class="btn" type="button" (click)="add(preset.value)"><app-icon name="plus" />Add</button>
          </div>
        }

        @case ('checks') {
          @if (!issues().length) {
            <div class="callout success"><app-icon name="check" /><span><strong>Ready to publish.</strong> No problems found.</span></div>
          } @else {
            @if (errorCount()) {
              <p class="small soft">{{ errorCount() }} {{ errorCount() === 1 ? 'error blocks' : 'errors block' }} publishing. Select one to find it.</p>
            } @else {
              <div class="callout success"><app-icon name="check" /><span>No errors. Warnings do not block publishing.</span></div>
            }
            <ul class="issues">
              @for (i of issues(); track $index) {
                <li><button type="button" class="issue {{ i.level }}" (click)="focusIssue.emit(i)"><app-icon [name]="i.level === 'error' ? 'alert' : 'info'" /><span>{{ i.message }}</span></button></li>
              }
            </ul>
          }
        }
      }
    </div>
  `,
  styles: `
    :host { display: flex; flex-direction: column; min-width: 0; }
    .tabs { padding: 0 10px; }
    .tab { padding: 11px 10px; }
    .count-pill.err { background: var(--danger-soft); color: var(--danger); }
    .ok { width: 15px; height: 15px; color: var(--success); }
    .body { padding: 14px 16px 18px; overflow-y: auto; max-height: calc(100vh - 220px); }
    .sec + .sec { margin-top: 18px; padding-top: 16px; border-top: 1px solid var(--border-soft); }
    h3 { font-size: 0.82rem; margin-bottom: 8px; }
    .hint { margin-top: 6px; font-size: 0.76rem; color: var(--text-muted); }
    .size { display: flex; align-items: flex-end; gap: 8px; }
    .size .field { width: 80px; }
    .x { padding-bottom: 8px; color: var(--text-muted); }
    .rows { margin: 10px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; }
    .rows li { display: grid; grid-template-columns: 52px 64px minmax(0, 1fr); align-items: center; gap: 8px; }
    .rows li.err .lbl-in { border-color: var(--danger); }
    .lbl-in { min-height: 30px; padding: 4px 6px; text-align: center; font-weight: 700; text-transform: uppercase; }
    .select.sm { min-height: 30px; padding-top: 4px; padding-bottom: 4px; font-size: 0.8rem; }
    .cats { margin: 12px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; }
    .cat { padding: 10px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface-2); }
    .cat.paint { border-color: var(--accent-line); }
    .cat-top, .cat-bottom { display: flex; align-items: center; gap: 6px; }
    .cat-bottom { margin-top: 6px; }
    .swatch { width: 32px; height: 32px; flex-shrink: 0; padding: 0; border: 1px solid var(--border); border-radius: var(--radius-sm); background: none; cursor: pointer; }
    .swatch::-webkit-color-swatch-wrapper { padding: 3px; }
    .swatch::-webkit-color-swatch { border: 0; border-radius: 3px; }
    .name { font-weight: 600; min-height: 32px; }
    .price { width: 110px; flex-shrink: 0; }
    .price .input, .rule { min-height: 32px; }
    .cat-foot { display: flex; justify-content: space-between; gap: 8px; margin-top: 8px; }
    .painting { color: var(--accent); font-weight: 600; }
    .add { display: flex; gap: 8px; margin-top: 12px; }
    .issues { margin: 10px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; }
    .issue { display: flex; align-items: flex-start; gap: 9px; width: 100%; padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface-2); color: var(--text-soft); text-align: left; font-size: 0.82rem; }
    .issue:hover { border-color: var(--border-strong); color: var(--text); }
    .issue app-icon { width: 15px; height: 15px; margin-top: 2px; }
    .issue.error app-icon { color: var(--danger); }
    .issue.warning app-icon { color: var(--warning); }
  `,
})
export class DesignerPanelComponent {
  private readonly confirm = inject(ConfirmService);

  readonly layout = input.required<SeatLayout>();
  readonly issues = input.required<Issue[]>();
  readonly errorRows = input<ReadonlySet<number>>(new Set());
  readonly paintCategory = input<string>('');
  readonly tab = model<PanelTab>('layout');
  readonly edit = output<SeatLayout>();
  readonly focusIssue = output<Issue>();
  readonly paintWith = output<string>();

  readonly rows = signal(0);
  readonly cols = signal(0);
  readonly skipIO = signal(false);
  readonly money = (n: number) => formatMoney(n);

  readonly errorCount = computed(() => this.issues().filter((i) => i.level === 'error').length);
  readonly counts = computed(() => layoutStats(this.layout()).byCategory);
  readonly sizeChanged = computed(() => this.rows() !== this.layout().rows || this.cols() !== this.layout().cols);
  readonly sizeError = computed(() => {
    const r = this.rows(), c = this.cols();
    if (!Number.isInteger(r) || r < 1 || r > 40) return 'Rows must be a whole number from 1 to 40.';
    if (!Number.isInteger(c) || c < 1 || c > 60) return 'Columns must be a whole number from 1 to 60.';
    return '';
  });
  readonly presets = computed(() => {
    const names = new Set(this.layout().categories.map((c) => c.name.toLowerCase()));
    return CATEGORY_PRESETS.filter((p) => !names.has(p.name.toLowerCase()));
  });

  readonly rowInfo = computed(() => {
    const layout = this.layout();
    const names = new Map(layout.categories.map((c) => [c.id, c.name]));
    const errs = this.errorRows();
    return layout.cells.map((row, index) => {
      const seats = row.filter((c) => PHYSICAL.has(c.kind));
      const cats = new Set(seats.map((c) => c.categoryId ?? ''));
      const category = !seats.length ? 'No seats' : cats.size === 1 ? (names.get([...cats][0]!) ?? 'No category') : 'Mixed categories';
      return { index, label: layout.rowLabels[index] ?? '', seats: seats.length, category, err: errs.has(index) };
    });
  });

  constructor() {
    // Keep the size fields in step with the layout (undo, redo, apply).
    effect(() => {
      const l = this.layout();
      this.rows.set(l.rows);
      this.cols.set(l.cols);
    });
  }

  async applySize(): Promise<void> {
    if (this.sizeError()) return;
    const layout = this.layout();
    const lost = seatsLostByResize(layout, this.rows(), this.cols());
    if (lost) {
      const ok = await this.confirm.ask({
        title: 'Shrink the grid?',
        message: `${lost} seats are outside the new ${this.rows()} × ${this.cols()} grid and will be removed. You can undo this.`,
        confirmLabel: 'Shrink grid',
        tone: 'danger',
      });
      if (!ok) return;
    }
    this.edit.emit(resize(layout, this.rows(), this.cols()));
  }

  setNumbering(numbering: SeatLayout['numbering']): void {
    if (this.layout().numbering !== numbering) this.edit.emit({ ...this.layout(), numbering });
  }

  reletter(): void { this.edit.emit(reletterRows(this.layout(), this.skipIO())); }

  setLabel(r: number, value: string): void { this.edit.emit(setRowLabel(this.layout(), r, value)); }

  setRowCategory(r: number, select: HTMLSelectElement): void {
    const id = select.value;
    select.value = '';
    if (id) this.edit.emit(setCategory(this.layout(), rowKeys(this.layout(), r), id));
  }

  patchCategory(id: string, patch: Parameters<typeof updateCategory>[2]): void {
    if (patch.name !== undefined && !patch.name) return;
    if (patch.basePrice !== undefined && !(patch.basePrice >= 0)) return;
    this.edit.emit(updateCategory(this.layout(), id, patch));
  }

  add(name: string): void {
    const preset = CATEGORY_PRESETS.find((p) => p.name === name);
    const layout = this.layout();
    let label = preset?.name ?? 'New category';
    for (let n = 2; layout.categories.some((c) => c.name === label); n++) label = `${preset?.name ?? 'New category'} ${n}`;
    const cat = newCategory(layout, label, preset?.price ?? 200, preset?.rule);
    this.edit.emit(addCategory(layout, cat));
    this.paintWith.emit(cat.id);
  }

  async remove(id: string): Promise<void> {
    const layout = this.layout();
    const cat = layout.categories.find((c) => c.id === id);
    if (!cat) return;
    const used = layout.cells.reduce((n, row) => n + row.filter((c) => c.categoryId === id).length, 0);
    const moveTo = layout.categories.find((c) => c.id !== id) ?? null;
    if (used) {
      const ok = await this.confirm.ask({
        title: `Remove ${cat.name}?`,
        message: moveTo
          ? `${used} seats use ${cat.name}. They will move to ${moveTo.name}. You can undo this.`
          : `${used} seats use ${cat.name}. They will have no category until you add one and assign it.`,
        confirmLabel: 'Remove category',
        tone: 'danger',
      });
      if (!ok) return;
    }
    this.edit.emit(removeCategory(layout, id, moveTo?.id ?? null));
    if (this.paintCategory() === id && moveTo) this.paintWith.emit(moveTo.id);
  }
}
