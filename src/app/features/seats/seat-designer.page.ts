import { ChangeDetectionStrategy, Component, HostListener, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { AdminStore } from '../../core/admin-store';
import { formatRelative } from '../../core/format';
import { layoutStats, loneCoupleCells, PHYSICAL, validateLayout } from '../../core/layout';
import { CellKind, Issue } from '../../core/models';
import { ConfirmService, ToastService } from '../../shared/feedback';
import { IconComponent } from '../../shared/icon.component';
import { EmptyStateComponent, PageHeaderComponent, SkeletonComponent } from '../../shared/ui';
import { CellEvent, DesignerGridComponent, isTyping } from './designer-grid.component';
import { DesignerPanelComponent, PanelTab } from './designer-panel.component';
import { clearLayout, key, LayoutEditor, paint, rowKeys, setCategory, starterLayout, Tool, updateCells, withKind } from './layout-editor';
import { PublishReviewComponent } from './publish-review.component';

interface ToolDef { id: Tool; label: string; key: string; hint: string; }

const TOOLS: ToolDef[] = [
  { id: 'select', label: 'Select', key: 'V', hint: 'Click, drag or Shift-click cells, then change them together' },
  { id: 'pan', label: 'Pan', key: 'H', hint: 'Drag to move around the layout (or hold Space)' },
  { id: 'seat', label: 'Seat', key: 'S', hint: 'Paint standard seats in the chosen category' },
  { id: 'couple', label: 'Couple', key: 'C', hint: 'Paint couple seats; each click adds a pair' },
  { id: 'wheelchair', label: 'Wheelchair', key: 'W', hint: 'Paint wheelchair-accessible spaces' },
  { id: 'blocked', label: 'Blocked', key: 'B', hint: 'Block seats from sale (they keep their category)' },
  { id: 'aisle', label: 'Aisle', key: 'A', hint: 'Paint aisles' },
  { id: 'empty', label: 'Empty', key: 'E', hint: 'Erase to empty space' },
];
const MIN_CELL = 10;
const MAX_CELL = 40;

/**
 * The seat layout designer: a top-down grid with paint tools, selection, row and category
 * settings, live counts, validation shown on the grid, undo and redo, and the draft/publish flow.
 */
@Component({
  selector: 'app-seat-designer-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent, PageHeaderComponent, EmptyStateComponent, SkeletonComponent,
    DesignerGridComponent, DesignerPanelComponent, PublishReviewComponent],
  template: `
    @if (screen(); as s) {
      <div class="page">
        <app-page-header [title]="s.name + ' seat layout'" [subtitle]="origin()"
          [crumbs]="[{ label: 'Theatre', link: '/theatre' }, { label: 'Screens', link: '/theatre?tab=screens' }, { label: s.name, link: '/screens/' + s.id }, { label: 'Seat layout' }]">
          @if (editor.dirty()) { <span class="unsaved" role="status">Unsaved changes</span> }
          @if (!s.layout) { <span class="badge warning" title="Shows can only be scheduled on a screen with a published layout">Not published</span> }
          <a class="btn ghost" [routerLink]="['/screens', s.id]">Screen details</a>
          <button class="btn ghost discard" type="button" [disabled]="!s.draftLayout && !editor.dirty()" (click)="discard()">{{ s.draftLayout ? 'Discard draft' : 'Discard changes' }}</button>
          <button class="btn" type="button" [disabled]="!editor.dirty()" (click)="saveDraft()" title="Ctrl+S">Save draft</button>
          <button class="btn primary" type="button" (click)="reviewing.set(true)"><app-icon name="upload" />Review and publish</button>
        </app-page-header>

        @if (s.layout && s.status === 'inactive') {
          <div class="callout info"><app-icon name="info" /><span>{{ s.name }} is inactive. Publishing a layout does not put it back in service.</span></div>
        }

        <p class="stats" aria-label="Layout counts">
          <span><b>{{ stats().sellable }}</b> bookable</span>
          @if (stats().physical !== stats().sellable) { <span><b>{{ stats().physical }}</b> configured</span> }
          <span><b>{{ stats().couplePairs }}</b> couple pairs</span>
          <span><b>{{ stats().wheelchair }}</b> wheelchair</span>
          <span><b>{{ stats().blocked }}</b> blocked</span>
          <span><b>{{ openPositions() }}</b> open positions</span>
          @for (c of layout().categories; track c.id) { <span class="chip"><span class="sw" [style.background]="c.color"></span>{{ c.name }} <b>{{ stats().byCategory[c.id] ?? 0 }}</b></span> }
        </p>

        <div class="workspace">
          <section class="card designer">
            <div class="toolbar">
              <div class="tools" role="toolbar" aria-label="Tools">
                @for (t of tools; track t.id) {
                  <button type="button" class="tool" [attr.aria-pressed]="tool() === t.id" [attr.title]="t.hint + ' (' + t.key + ')'" (click)="tool.set(t.id)">
                    <span class="glyph g-{{ t.id }}" [style.--c]="paintColor()">
                      @if (t.id === 'select') { <app-icon name="grid" /> } @else if (t.id === 'pan') { <app-icon name="move" /> } @else if (t.id === 'wheelchair') { <app-icon name="wheelchair" /> }
                    </span>{{ t.label }}
                  </button>
                }
              </div>
              <div class="row-wrap tools-right">
                <div class="row" role="group" aria-label="History">
                  <button class="btn sm icon" type="button" aria-label="Undo" title="Undo (Ctrl+Z)" [disabled]="!editor.canUndo()" (click)="editor.undo()"><app-icon name="undo" /></button>
                  <button class="btn sm icon" type="button" aria-label="Redo" title="Redo (Ctrl+Y)" [disabled]="!editor.canRedo()" (click)="editor.redo()"><app-icon name="redo" /></button>
                </div>
                <div class="row" role="group" aria-label="Zoom">
                  <button class="btn sm icon" type="button" aria-label="Zoom out" title="Zoom out (Ctrl + wheel)" [disabled]="cellSize() <= minCell" (click)="zoomBy(-1)"><app-icon name="zoomOut" /></button>
                  <span class="zoom small soft" aria-live="polite">{{ zoomPct() }}%</span>
                  <button class="btn sm icon" type="button" aria-label="Zoom in" title="Zoom in (Ctrl + wheel)" [disabled]="cellSize() >= maxCell" (click)="zoomBy(1)"><app-icon name="zoomIn" /></button>
                  <button class="btn sm" type="button" (click)="fit()">Fit</button>
                </div>
                <label class="check small"><input type="checkbox" [checked]="showNumbers()" (change)="showNumbers.set($any($event.target).checked)" />Numbers</label>
                <button class="btn sm danger-ghost" type="button" (click)="clearAll()">Clear</button>
              </div>
            </div>

            <div class="paintbar">
              @if (isPaintTool()) {
                <span class="small muted">Category</span>
                @if (needsCategory()) {
                  @for (c of layout().categories; track c.id) {
                    <button type="button" class="cat-chip" [attr.aria-pressed]="activeCategory() === c.id" (click)="paintCategory.set(c.id)"><span class="sw" [style.background]="c.color"></span>{{ c.name }}</button>
                  } @empty {
                    <span class="small warn">Add a category in the Categories tab first.</span>
                  }
                } @else {
                  <span class="small soft">{{ tool() === 'blocked' ? 'Blocked seats keep their category; empty cells take the chosen one.' : 'Not needed for aisles and empty space.' }}</span>
                }
                <span class="spacer"></span>
                <span class="small muted hint">Click or drag across cells to paint.</span>
              } @else if (selection().size) {
                <strong class="small">{{ selection().size }} {{ selection().size === 1 ? 'cell' : 'cells' }} selected</strong>
                <span class="small muted">Make</span>
                @for (k of kindActions; track k.id) { <button class="btn sm" type="button" (click)="makeKind(k.id)">{{ k.label }}</button> }
                <select class="select sm" aria-label="Set category of selected seats" (change)="setSelectionCategory($any($event.target))">
                  <option value="">Set category…</option>
                  @for (c of layout().categories; track c.id) { <option [value]="c.id">{{ c.name }}</option> }
                </select>
                <span class="spacer"></span>
                <button class="btn sm ghost" type="button" (click)="selection.set(empty)">Clear selection (Esc)</button>
              } @else {
                <span class="small muted">{{ tool() === 'pan' ? 'Drag the layout to move around it.' : 'Drag across cells or click a row letter to select. Shift-click adds to the selection.' }}</span>
              }
            </div>

            @if (store.loading()) {
              <app-skeleton [rows]="10" />
            } @else {
              <app-designer-grid [layout]="layout()" [tool]="tool()" [cellSize]="cellSize()" [selection]="selection()" [errorCells]="errorCells()" [errorRows]="errorRows()" [showNumbers]="showNumbers()"
                (down)="onDown($event)" (over)="onOver($event)" (up)="onUp()" (activate)="onActivate($event)" (rowClick)="onRowClick($event)" (zoom)="zoomBy($event)" />
            }

            <ul class="legend" aria-label="Legend">
              @for (c of layout().categories; track c.id) { <li><span class="lg seat" [style.--c]="c.color"></span>{{ c.name }}</li> }
              <li><span class="lg couple"></span>Couple pair</li>
              <li><span class="lg wc"><app-icon name="wheelchair" /></span>Wheelchair</li>
              <li><span class="lg blocked">×</span>Blocked</li>
              <li><span class="lg aisle"></span>Aisle</li>
              <li><span class="lg empty"></span>Empty</li>
              @if (errorCells().size || errorRows().size) { <li class="err-key"><span class="lg error"></span>Needs fixing</li> }
            </ul>
          </section>

          <aside class="card side">
            <app-designer-panel [layout]="layout()" [issues]="issues()" [errorRows]="errorRows()" [paintCategory]="activeCategory()" [(tab)]="panelTab"
              (edit)="editor.commit($event)" (focusIssue)="focusIssue($event)" (paintWith)="paintCategory.set($event)" />
          </aside>
        </div>
      </div>

      @if (reviewing()) {
        <app-publish-review [screen]="s" [layout]="layout()" [issues]="issues()" (closed)="reviewing.set(false)" (publish)="publish()" (focus)="focusIssue($event)" />
      }
    } @else {
      <div class="page">
        <app-page-header title="Screen not found" [crumbs]="[{ label: 'Screens', link: '/screens' }, { label: 'Not found' }]" />
        <section class="card">
          <app-empty-state icon="seats" title="This screen does not exist" text="It may have been deleted. Choose a screen from the Screens list.">
            <a class="btn" routerLink="/screens">Go to Screens</a>
          </app-empty-state>
        </section>
      </div>
    }
  `,
  styles: `
    .unsaved { padding: 3px 10px; border-radius: 999px; background: var(--violet-soft); color: var(--violet); font-size: 0.74rem; font-weight: 700; }
    .stats { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 20px; margin: 0; padding: 0 4px; font-size: 0.84rem; color: var(--text-muted); }
    .stats b { color: var(--text); font-weight: 700; }
    .chip { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; color: var(--text-soft); }
    .discard:hover:not(:disabled) { color: var(--danger); }
    .sw { width: 10px; height: 10px; border-radius: 3px; flex-shrink: 0; }
    .workspace { display: grid; grid-template-columns: minmax(0, 1fr) 330px; gap: 16px; align-items: stretch; }
    .designer { padding: 12px; display: flex; flex-direction: column; gap: 10px; }
    .side { min-width: 0; }
    .toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 12px; }
    .tools { display: flex; flex-wrap: wrap; gap: 2px; padding: 3px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface-2); }
    .tool { display: inline-flex; align-items: center; gap: 6px; min-height: 30px; padding: 3px 9px; border: 0; border-radius: var(--radius-sm); background: none; color: var(--text-muted); font-size: 0.8rem; font-weight: 600; }
    .tool:hover { color: var(--text); }
    .tool[aria-pressed='true'] { background: var(--accent-soft); color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent-line); }
    .tools-right { gap: 10px; margin-left: auto; }
    .glyph { display: inline-grid; place-items: center; width: 14px; height: 14px; border-radius: 3px 3px 1px 1px; font-size: 11px; line-height: 1; }
    .glyph app-icon { width: 14px; height: 14px; }
    .g-seat { background: var(--c); }
    .g-couple { width: 20px; background: var(--c); }
    .g-wheelchair { background: var(--text-soft); color: var(--bg); } .g-wheelchair app-icon { width: 12px; height: 12px; }
    .g-blocked { border: 1px dashed var(--text-muted); background: var(--surface-3); } .g-blocked::before { content: '×'; color: var(--text-muted); }
    .g-aisle { background: var(--surface-3); border-radius: 2px; }
    .g-empty { border: 1px dotted var(--text-muted); }
    .zoom { min-width: 40px; text-align: center; }
    .paintbar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; min-height: 40px; padding: 5px 10px; border: 1px solid var(--border-soft); border-radius: var(--radius); background: var(--surface-2); }
    .cat-chip { display: inline-flex; align-items: center; gap: 6px; min-height: 28px; padding: 2px 10px; border: 1px solid var(--border); border-radius: 999px; background: var(--surface); color: var(--text-soft); font-size: 0.8rem; font-weight: 600; }
    .cat-chip:hover { border-color: var(--border-strong); color: var(--text); }
    .cat-chip[aria-pressed='true'] { border-color: var(--accent); color: var(--text); box-shadow: 0 0 0 2px var(--accent-soft); }
    .select.sm { width: auto; min-height: 28px; padding: 3px 28px 3px 8px; font-size: 0.8rem; }
    .warn { color: var(--warning); }
    .legend { display: flex; flex-wrap: wrap; gap: 6px 16px; margin: 0; padding: 4px 4px 0; list-style: none; font-size: 0.78rem; color: var(--text-soft); }
    .legend li { display: inline-flex; align-items: center; gap: 7px; }
    .lg { display: inline-grid; place-items: center; width: 14px; height: 14px; border-radius: 3px 3px 1px 1px; font-size: 11px; line-height: 1; }
    .lg.seat { background: var(--c); }
    .lg.couple { width: 26px; background: var(--text-muted); }
    .lg.wc { background: var(--text-soft); color: var(--bg); } .lg.wc app-icon { width: 12px; height: 12px; }
    .lg.blocked { border: 1px dashed var(--text-muted); background: var(--surface-3); color: var(--text-faint); }
    .lg.aisle { background: var(--surface-3); border-radius: 2px; }
    .lg.empty { border: 1px dotted var(--text-muted); }
    .lg.error { box-shadow: 0 0 0 2px var(--danger); }
    .err-key { color: var(--danger); }
    @media (max-width: 1200px) {
      .workspace { grid-template-columns: minmax(0, 1fr); }
    }
    @media (max-width: 1100px) { .hint { display: none; } }
  `,
})
export class SeatDesignerPage {
  readonly store = inject(AdminStore);
  private readonly router = inject(Router);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  private readonly grid = viewChild(DesignerGridComponent);

  readonly screenId = input.required<string>();

  readonly editor = new LayoutEditor();
  readonly tools = TOOLS;
  readonly kindActions: { id: CellKind; label: string }[] = [
    { id: 'seat', label: 'Seat' }, { id: 'couple', label: 'Couple' }, { id: 'wheelchair', label: 'Wheelchair' },
    { id: 'blocked', label: 'Blocked' }, { id: 'aisle', label: 'Aisle' }, { id: 'empty', label: 'Empty' },
  ];
  readonly minCell = MIN_CELL;
  readonly maxCell = MAX_CELL;
  readonly empty: ReadonlySet<string> = new Set();

  readonly tool = signal<Tool>('seat');
  readonly paintCategory = signal('');
  readonly selection = signal<ReadonlySet<string>>(this.empty);
  readonly cellSize = signal(24);
  readonly showNumbers = signal(true);
  readonly panelTab = signal<PanelTab>('layout');
  readonly reviewing = signal(false);
  /** Where the working copy came from, for the subtitle. */
  private readonly source = signal<'draft' | 'published' | 'starter'>('starter');

  /** Set on load; the grid zooms out to fit once it has rendered. */
  private readonly pendingFit = signal(false);
  private selectAnchor: CellEvent | null = null;
  private selectBase: ReadonlySet<string> = this.empty;
  private painting = false;

  readonly screen = computed(() => this.store.screen(this.screenId()) ?? null);
  readonly theatreName = computed(() => this.store.theatre(this.screen()?.theatreId ?? '')?.name ?? '');
  readonly layout = this.editor.layout;
  readonly stats = computed(() => layoutStats(this.layout()));
  readonly issues = computed(() => {
    const list = validateLayout(this.layout());
    return [...list.filter((i) => i.level === 'error'), ...list.filter((i) => i.level === 'warning')];
  });
  readonly openPositions = computed(() => this.layout().cells.reduce((n, row) => n + row.filter((c) => c.kind === 'empty').length, 0));
  readonly zoomPct = computed(() => Math.round((this.cellSize() / 24) * 100));
  readonly isPaintTool = computed(() => this.tool() !== 'select' && this.tool() !== 'pan');
  readonly needsCategory = computed(() => ['seat', 'couple', 'wheelchair', 'blocked'].includes(this.tool()));
  readonly activeCategory = computed(() => {
    const cats = this.layout().categories;
    return cats.some((c) => c.id === this.paintCategory()) ? this.paintCategory() : cats[0]?.id ?? '';
  });
  readonly paintColor = computed(() => this.layout().categories.find((c) => c.id === this.activeCategory())?.color ?? 'var(--text-muted)');

  /** Seats without a valid category and unpaired couple halves. */
  private readonly missingCategory = computed(() => {
    const l = this.layout();
    const ids = new Set(l.categories.map((c) => c.id));
    const out = new Set<string>();
    l.cells.forEach((row, r) => row.forEach((cell, c) => {
      if (PHYSICAL.has(cell.kind) && (!cell.categoryId || !ids.has(cell.categoryId))) out.add(key(r, c));
    }));
    return out;
  });
  readonly errorCells = computed<ReadonlySet<string>>(() => new Set([...this.missingCategory(), ...loneCoupleCells(this.layout())]));
  /** Rows with a missing or repeated label. */
  readonly errorRows = computed<ReadonlySet<number>>(() => {
    const labels = this.layout().rowLabels.map((l) => l.trim().toUpperCase());
    const out = new Set<number>();
    labels.forEach((l, i) => { if (!l || labels.indexOf(l) !== labels.lastIndexOf(l)) out.add(i); });
    return out;
  });

  readonly origin = computed(() => {
    const s = this.screen();
    if (!s) return '';
    const parts: string[] = [];
    if (this.source() === 'draft' && s.draftLayout) parts.push(`Draft saved by ${s.draftLayout.updatedBy} ${formatRelative(s.draftLayout.updatedAt, this.store.now())}`);
    else if (this.source() === 'published' && s.layout) parts.push(`Editing a copy of published version ${s.layout.version}`);
    else parts.push('Starter layout; nothing saved yet');
    parts.push(s.layout ? `customers book from version ${s.layout.version}` : 'no published layout');
    return `${s.type} · ${parts.join(' · ')}`;
  });

  constructor() {
    effect(() => {
      const id = this.screenId();
      untracked(() => this.load(id));
    });
    effect(() => {
      if (!this.grid() || !this.pendingFit()) return;
      untracked(() => setTimeout(() => { this.pendingFit.set(false); this.fit(true); }));
    });
  }

  private load(id: string): void {
    const s = this.store.screen(id);
    if (!s) return;
    const start = s.draftLayout ?? s.layout ?? starterLayout(this.store.currentUser().name);
    this.source.set(s.draftLayout ? 'draft' : s.layout ? 'published' : 'starter');
    this.editor.reset(start);
    this.selection.set(this.empty);
    this.paintCategory.set(start.categories[0]?.id ?? '');
    this.pendingFit.set(true);
  }

  // ---------------------------------------------------------------- Grid gestures

  onDown(e: CellEvent): void {
    if (this.tool() === 'select') {
      const k = key(e.r, e.c);
      this.selectAnchor = e;
      this.selectBase = e.additive ? this.selection() : this.empty;
      if (e.additive && this.selection().has(k)) {
        const next = new Set(this.selection());
        next.delete(k);
        this.selection.set(next);
        this.selectAnchor = null;
      } else {
        this.selection.set(new Set([...this.selectBase, k]));
      }
      return;
    }
    if (!this.isPaintTool()) return;
    this.painting = true;
    this.editor.beginStroke();
    this.paintAt(e.r, e.c);
  }

  onOver(e: CellEvent): void {
    if (this.tool() === 'select' && this.selectAnchor) {
      const a = this.selectAnchor;
      const next = new Set(this.selectBase);
      for (let r = Math.min(a.r, e.r); r <= Math.max(a.r, e.r); r++) for (let c = Math.min(a.c, e.c); c <= Math.max(a.c, e.c); c++) next.add(key(r, c));
      this.selection.set(next);
    } else if (this.painting) {
      this.paintAt(e.r, e.c);
    }
  }

  onUp(): void {
    this.selectAnchor = null;
    if (this.painting) {
      this.painting = false;
      this.editor.endStroke();
    }
  }

  /** Keyboard: Enter or Space applies the tool to the focused cell. */
  onActivate(e: CellEvent): void {
    if (this.tool() === 'select') {
      const k = key(e.r, e.c);
      const next = new Set(e.additive ? this.selection() : this.empty);
      if (e.additive && this.selection().has(k)) next.delete(k); else next.add(k);
      this.selection.set(next);
    } else if (this.isPaintTool()) {
      this.editor.commit(paint(this.layout(), e.r, e.c, this.tool() as CellKind, this.activeCategory() || undefined));
    }
  }

  onRowClick(e: CellEvent): void {
    const keys = rowKeys(this.layout(), e.r);
    this.tool.set('select');
    this.selection.set(new Set([...(e.additive ? this.selection() : []), ...keys]));
  }

  private paintAt(r: number, c: number): void {
    this.editor.strokeTo(paint(this.layout(), r, c, this.tool() as CellKind, this.activeCategory() || undefined));
  }

  // ---------------------------------------------------------------- Selection actions

  makeKind(kind: CellKind): void {
    const cat = this.activeCategory() || undefined;
    this.editor.commit(updateCells(this.layout(), this.selection(), (cell) => withKind(cell, kind, PHYSICAL.has(cell.kind) ? cell.categoryId ?? cat : cat)));
  }

  setSelectionCategory(select: HTMLSelectElement): void {
    const id = select.value;
    select.value = '';
    if (id) this.editor.commit(setCategory(this.layout(), this.selection(), id));
  }

  // ---------------------------------------------------------------- View

  zoomBy(step: number): void {
    this.cellSize.update((s) => Math.min(MAX_CELL, Math.max(MIN_CELL, s + step * 4)));
  }

  /** Fits every column in view; with `shrinkOnly`, only zooms out when the layout is too wide. */
  fit(shrinkOnly = false): void {
    const g = this.grid();
    if (!g) return;
    const size = Math.min(MAX_CELL, Math.max(MIN_CELL, g.fitSize(this.layout().cols)));
    this.cellSize.set(shrinkOnly ? Math.min(30, size) : Math.min(36, size));
  }

  // ---------------------------------------------------------------- Issues

  focusIssue(issue: Issue): void {
    this.reviewing.set(false);
    const where = issue.where ?? '';
    if (/^\d+,\d+$/.test(where)) {
      this.tool.set('select');
      this.selection.set(new Set([where]));
      this.grid()?.focusCell(where);
      return;
    }
    const rowMatch = /^row:(\d+)$/.exec(where);
    const row = rowMatch ? Number(rowMatch[1]) : where === 'rows' ? this.layout().rowLabels.findIndex((l) => !l.trim()) : -1;
    if (row >= 0) {
      this.panelTab.set('layout');
      this.grid()?.focusCell(key(row, 0));
      setTimeout(() => document.getElementById(`row-label-${row}`)?.focus(), 350);
      return;
    }
    if (/no category/.test(issue.message) && this.missingCategory().size) {
      this.tool.set('select');
      this.selection.set(new Set(this.missingCategory()));
      this.grid()?.focusCell([...this.missingCategory()][0]!);
      return;
    }
    this.panelTab.set(/categor|price/i.test(issue.message) ? 'categories' : 'layout');
  }

  // ---------------------------------------------------------------- Draft and publish

  saveDraft(): void {
    const s = this.screen();
    if (!s || !this.editor.dirty()) return;
    this.store.saveLayoutDraft(s.id, this.layout());
    this.editor.markSaved();
    this.source.set('draft');
    const errors = this.issues().filter((i) => i.level === 'error').length;
    this.toast.success('Draft saved', errors ? `${errors} problems to fix before it can be published.` : `${this.stats().sellable} bookable seats. Ready to publish.`);
  }

  publish(): void {
    const s = this.screen();
    if (!s) return;
    const errors = this.store.publishLayout(s.id, this.layout());
    if (errors.length) {
      this.toast.error('Layout not published', errors[0]!.message);
      return;
    }
    const published = this.store.screen(s.id)?.layout;
    if (published) this.editor.reset(published);
    this.source.set('published');
    this.reviewing.set(false);
    this.toast.success(`Layout version ${published?.version ?? ''} published`, `${s.name} now sells ${this.stats().sellable} seats.`);
  }

  async discard(): Promise<void> {
    const s = this.screen();
    if (!s) return;
    const dirty = this.editor.dirty();
    if (s.draftLayout) {
      const ok = await this.confirm.ask({
        title: 'Discard the draft?',
        message: `The saved draft${dirty ? ' and your unsaved changes' : ''} will be deleted. The designer goes back to ${s.layout ? `published version ${s.layout.version}` : 'a starter layout'}.`,
        confirmLabel: 'Discard draft',
        tone: 'danger',
      });
      if (!ok) return;
      this.store.discardLayoutDraft(s.id);
      this.load(s.id);
      this.toast.info('Draft discarded');
    } else if (dirty) {
      const ok = await this.confirm.ask({ title: 'Discard unsaved changes?', message: 'Every change since the layout was opened will be lost.', confirmLabel: 'Discard changes', tone: 'danger' });
      if (!ok) return;
      this.load(s.id);
    }
  }

  async clearAll(): Promise<void> {
    const ok = await this.confirm.ask({
      title: 'Clear the layout?',
      message: `All ${this.stats().physical} seats become empty space. The grid size, row labels and categories stay. You can undo this.`,
      confirmLabel: 'Clear layout',
      tone: 'danger',
    });
    if (ok) {
      this.editor.commit(clearLayout(this.layout()));
      this.selection.set(this.empty);
    }
  }

  back(): void {
    // The route's leave guard asks about unsaved changes, for this button and every other way out.
    void this.router.navigate(['/screens']);
  }

  /** Called by the route guard before leaving the designer by any route. */
  async canLeave(): Promise<boolean> {
    if (!this.editor.dirty()) return true;
    return this.confirm.ask({
      title: 'Leave without saving?',
      message: 'Your changes to this layout have not been saved as a draft and will be lost.',
      confirmLabel: 'Leave without saving',
      cancelLabel: 'Keep editing',
      tone: 'danger',
    });
  }

  // ---------------------------------------------------------------- Keyboard

  @HostListener('document:keydown', ['$event'])
  onKey(e: KeyboardEvent): void {
    if (isTyping(e) || this.confirm.pending() || this.reviewing()) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === 'z' && !e.shiftKey) { e.preventDefault(); this.editor.undo(); return; }
    if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); this.editor.redo(); return; }
    if (mod && k === 's') { e.preventDefault(); this.saveDraft(); return; }
    if (mod || e.altKey) return;
    if (e.key === 'Escape') { this.selection.set(this.empty); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.selection().size) { e.preventDefault(); this.makeKind('empty'); return; }
    const t = TOOLS.find((x) => x.key.toLowerCase() === k);
    if (t) this.tool.set(t.id);
  }

  @HostListener('window:beforeunload', ['$event'])
  onUnload(e: BeforeUnloadEvent): void {
    if (this.editor.dirty()) e.preventDefault();
  }
}

