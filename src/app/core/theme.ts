import { Injectable, signal } from '@angular/core';

export type ThemeName = 'dark' | 'light';
const KEY = 'thiraihub.theme';
const META: Record<ThemeName, string> = { dark: '#0c0e11', light: '#f4f6fa' };

/** The chosen colour theme. Dark is the default; the choice is kept in local storage and applied at once. */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly theme = signal<ThemeName>(this.read());

  constructor() {
    this.apply(this.theme());
  }

  set(theme: ThemeName): void {
    this.theme.set(theme);
    this.apply(theme);
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      /* storage blocked: the choice lasts for this visit */
    }
  }

  private read(): ThemeName {
    try {
      return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  }

  private apply(theme: ThemeName): void {
    document.documentElement.dataset['theme'] = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', META[theme]);
  }
}
