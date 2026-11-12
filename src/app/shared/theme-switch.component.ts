import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { ThemeService } from '../core/theme';
import { IconComponent } from './icon.component';

/** One icon button that switches between the dark and light themes. It shows the theme you would switch to. */
@Component({
  selector: 'app-theme-switch',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <button type="button" [attr.aria-label]="'Switch to the ' + next() + ' theme'" [title]="'Switch to the ' + next() + ' theme'" (click)="themes.set(next())">
      <app-icon [name]="next() === 'light' ? 'sun' : 'moon'" />
    </button>
  `,
  styles: `
    :host { display: inline-flex; }
    button { display: inline-grid; place-items: center; width: 36px; height: 36px; padding: 0; border: 0; border-radius: var(--radius); background: none; color: var(--text-muted); }
    button:hover { background: var(--surface-3); color: var(--text); }
    app-icon { width: 18px; height: 18px; }
  `,
})
export class ThemeSwitchComponent {
  readonly themes = inject(ThemeService);
  readonly next = computed(() => (this.themes.theme() === 'dark' ? 'light' : 'dark'));
}
