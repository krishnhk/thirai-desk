import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { ThemeService } from './core/theme';
import { PrintHostComponent } from './shared/counter-ticket.component';
import { FeedbackHostComponent } from './shared/feedback-host.component';
import { SplashComponent } from './shared/splash.component';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, FeedbackHostComponent, PrintHostComponent, SplashComponent],
  template: `<app-splash /><router-outlet /><app-feedback-host /><app-print-host />`,
})
export class App {
  /** Injected so the saved theme is applied as soon as the app starts. */
  private readonly theme = inject(ThemeService);
}
