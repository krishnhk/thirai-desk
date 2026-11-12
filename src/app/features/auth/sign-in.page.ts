import { ChangeDetectionStrategy, Component, OnDestroy, computed, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';

import { AdminStore } from '../../core/admin-store';
import { AuthService } from '../../core/auth.service';
import { ThemeService } from '../../core/theme';
import { IconComponent } from '../../shared/icon.component';

const RESEND_SECONDS = 30;


@Component({
  selector: 'app-sign-in-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <div class="screen">
      <aside class="stage" aria-hidden="true">
        <div class="wall">
          @for (col of columns; track $index) {
            <div class="col" [class.up]="$index % 2 === 1" [style.--t]="(70 + $index * 12) + 's'">
              <div class="track">
                @for (p of col; track $index) { <img [src]="'/posters/' + p + '.jpg'" alt="" loading="lazy" /> }
                @for (p of col; track $index) { <img [src]="'/posters/' + p + '.jpg'" alt="" loading="lazy" /> }
              </div>
            </div>
          }
        </div>
        <div class="veil"></div>
        <div class="grain"></div>
        <div class="stage-top"><span class="tmark"><svg viewBox="0 6 64 54" aria-hidden="true" focusable="false"><path d="M5 22Q32 3 59 22" fill="none" stroke="#e5484d" stroke-width="9" stroke-linecap="round" /><rect x="6" y="34" width="52" height="9" rx="4.5" fill="#e5484d" /><rect x="12" y="43" width="7" height="14" rx="3.5" fill="#e5484d" /><rect x="45" y="43" width="7" height="14" rx="3.5" fill="#e5484d" /></svg></span><span class="by">thiraidesk</span></div>
        <div class="title">
          @if (cover(); as c) { <img [src]="c" alt="" /> } @else { <strong>{{ theatreName() }}</strong> }
          <span class="rule"></span>
          <span class="tagline">Box office · Shows · Refunds</span>
        </div>
        <div class="stage-foot">© ThiraiDesk</div>
      </aside>

      <main class="panel">
        <div class="progress" aria-hidden="true"><i [class.full]="step() === 'code'"></i></div>

        <div class="top">
          @if (step() === 'code') {
            <button type="button" class="round" aria-label="Back to sign in" title="Back to sign in" (click)="back()"><app-icon name="chevronLeft" /></button>
          } @else { <span class="spacer"></span> }
          <button type="button" class="round" [attr.aria-label]="'Switch to the ' + nextTheme() + ' theme'" [title]="'Switch to the ' + nextTheme() + ' theme'" (click)="themes.set(nextTheme())"><app-icon [name]="nextTheme() === 'light' ? 'sun' : 'moon'" /></button>
        </div>

        <div class="form-wrap">
          <header class="id">
            <span class="logo">@if (logo(); as l) { <img [src]="l" alt="" /> }</span>
            <div><strong>{{ theatreName() }}</strong><small>ThiraiDesk</small></div>
          </header>

          @if (step() === 'phone') {
            <form class="step" (submit)="$event.preventDefault(); signIn()" novalidate>
              <h1>Sign in</h1>
              <p class="lead">Use your email or mobile number and your password. We will then text you a code.</p>

              <div class="float plain" [class.bad]="!!error()" [class.has]="who().length > 0">
                <input id="si-who" type="text" inputmode="email" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder=" " [value]="who()" (input)="who.set($any($event.target).value); error.set('')" />
                <label for="si-who">Email or mobile number</label>
              </div>

              <div class="float plain pw" [class.bad]="!!error()" [class.has]="password().length > 0">
                <input id="si-pw" [type]="showPw() ? 'text' : 'password'" autocomplete="current-password" placeholder=" " [value]="password()" (input)="password.set($any($event.target).value); error.set('')" />
                <label for="si-pw">Password</label>
                <button type="button" class="eye" [attr.aria-label]="showPw() ? 'Hide password' : 'Show password'" [attr.aria-pressed]="showPw()" (click)="showPw.set(!showPw())"><app-icon [name]="showPw() ? 'eyeOff' : 'eye'" /></button>
              </div>
              @if (error()) { <span class="error-text">{{ error() }}</span> }

              <button class="go" type="submit" [disabled]="!who().trim() || !password() || locked()">Continue<app-icon name="chevronRight" /></button>
            </form>
          } @else {
            <form class="step" (submit)="$event.preventDefault(); verify()" novalidate>
              <h1>Enter the code</h1>
              <p class="lead">Password accepted. We sent a 6-digit code to <strong>{{ auth.codeSentTo }}</strong>.</p>

              <div class="otp" [class.bad]="!!error()">
                @for (i of boxes; track i) {
                  <span class="box" [class.on]="focused() && i === activeBox()" [class.filled]="i < code().length">{{ code()[i] ?? '' }}</span>
                }
                <input id="si-code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" aria-label="6-digit code" [value]="code()" (input)="onCode($event)" (focus)="focused.set(true)" (blur)="focused.set(false)" [disabled]="locked() || checking()" />
              </div>
              @if (error()) { <span class="error-text">{{ error() }}</span> }

              <button class="go" type="submit" [disabled]="code().length !== 6 || locked() || checking()">
                @if (checking()) { <span class="spin" aria-hidden="true"></span>Signing in… } @else { Sign in<app-icon name="chevronRight" /> }
              </button>
              <div class="links">
                @if (resendIn() > 0) { <span class="muted small">Resend code in {{ resendIn() }}s</span> }
                @else { <button type="button" class="link-btn" (click)="resend()">Resend code</button> }
                <span class="muted small">Step 2 of 2</span>
              </div>
            </form>
          }

          <p class="note"><app-icon name="lock" /><span>Staff access only. If you cannot sign in, ask your administrator.</span></p>
          <p class="proto">Prototype · any staff email or number, password <b>Hayat@2026</b>, code <b>123456</b></p>
        </div>
      </main>
    </div>
  `,
  styles: `
    :host { display: block; }
    .screen { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); min-height: 100vh; background: var(--bg); }

    /* The stage: always dark, whatever theme the app is in. One soft spotlight behind the title, nothing else. */
    .stage { position: relative; display: flex; flex-direction: column; justify-content: space-between; padding: 30px 38px 28px; overflow: hidden; color: #fff;
      background:
        radial-gradient(46% 38% at 50% 47%, rgba(255, 255, 255, 0.075), transparent 72%),
        radial-gradient(90% 70% at 50% 50%, transparent 55%, rgba(0, 0, 0, 0.45) 100%),
        linear-gradient(180deg, #0c0f15 0%, #111620 100%); }
    .wall { position: absolute; inset: -10% -6%; display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; transform: rotate(-8deg) scale(1.1); opacity: 0.5; filter: saturate(0.85); }
    .col { overflow: hidden; }
    .track { display: flex; flex-direction: column; gap: 16px; animation: drift var(--t) linear infinite; }
    .col.up .track { animation-direction: reverse; }
    .track img { display: block; width: 100%; aspect-ratio: 2 / 3; object-fit: cover; border-radius: 8px; }
    @keyframes drift { to { transform: translateY(-50%); } }
    /* Darkens the wall and leaves a calm pool of shade behind the title. */
    .veil { position: absolute; inset: 0; pointer-events: none;
      background:
        radial-gradient(58% 44% at 50% 49%, rgba(8, 10, 15, 0.93), rgba(8, 10, 15, 0.55) 70%, transparent 100%),
        linear-gradient(180deg, rgba(8, 10, 15, 0.82) 0%, rgba(8, 10, 15, 0.28) 35%, rgba(8, 10, 15, 0.28) 65%, rgba(8, 10, 15, 0.88) 100%); }
    .grain { position: absolute; inset: 0; pointer-events: none; opacity: 0.07; mix-blend-mode: overlay; background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.9 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>"); }
    .stage-top { position: relative; display: flex; align-items: center; gap: 12px; }
    .tmark svg { display: block; width: 36px; height: auto; }
    .by { font-size: 1.25rem; font-weight: 800; letter-spacing: -0.03em; color: #e5484d; }
    .title { position: relative; display: flex; flex-direction: column; align-items: center; gap: 24px; margin: auto; width: min(600px, 100%); text-align: center; }
    /* The wordmark is black on white; inverted and screened it becomes light lettering on the stage. */
    .title > img { display: block; width: 100%; height: auto; filter: invert(1) contrast(1.05); mix-blend-mode: screen; }
    .crest { display: grid; place-items: center; width: 76px; height: 76px; padding: 8px; border-radius: 20px; background: #fff; box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.35), 0 18px 44px -10px rgba(0, 0, 0, 0.7), 0 0 60px rgba(255, 255, 255, 0.10); }
    .crest img { display: block; width: 100%; height: 100%; object-fit: contain; filter: none; mix-blend-mode: normal; }
    .title strong { font-size: 2.6rem; letter-spacing: 0.04em; }
    .rule { width: 64px; height: 2px; border-radius: 2px; background: linear-gradient(90deg, transparent, var(--accent), transparent); }
    .tagline { font-size: 0.8rem; font-weight: 600; letter-spacing: 0.26em; text-transform: uppercase; color: rgba(255, 255, 255, 0.5); }
    .stage-foot { position: relative; font-size: 0.74rem; color: rgba(255, 255, 255, 0.34); }

    .panel { position: relative; display: flex; flex-direction: column; align-items: center; padding: 0 28px 28px;
      background: radial-gradient(70% 45% at 50% 0%, color-mix(in srgb, var(--accent) 7%, transparent), transparent 70%), var(--bg); }
    .progress { align-self: stretch; height: 3px; margin: 0 -28px; background: var(--surface-3); }
    .progress i { display: block; width: 50%; height: 100%; background: var(--accent); border-radius: 0 3px 3px 0; transition: width 320ms ease; }
    .progress i.full { width: 100%; }
    .top { align-self: stretch; display: flex; align-items: center; justify-content: space-between; min-height: 64px; }
    .spacer { width: 38px; }
    .round { display: grid; place-items: center; width: 38px; height: 38px; padding: 0; border: 1px solid var(--border); border-radius: 999px; background: var(--surface); color: var(--text-muted); }
    .round:hover { color: var(--text); border-color: var(--border-strong); }
    .round app-icon { width: 17px; height: 17px; }
    .form-wrap { width: min(400px, 100%); margin: auto 0; padding-bottom: 36px; }
    .id { display: flex; align-items: center; gap: 14px; margin-bottom: 34px; }
    .id div { display: flex; flex-direction: column; line-height: 1.25; }
    .id strong { font-size: 1.02rem; }
    .id small { font-size: 0.76rem; color: var(--text-muted); }
    .logo { display: grid; place-items: center; width: 52px; height: 52px; padding: 5px; border-radius: 14px; background: #fff; overflow: hidden; box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.08), 0 8px 20px -8px rgba(0, 0, 0, 0.4); }
    .logo img { display: block; width: 100%; height: 100%; object-fit: contain; }

    .step { animation: rise 320ms ease both; }
    @keyframes rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
    h1 { margin: 0; font-size: 2.3rem; letter-spacing: -0.03em; }
    .lead { margin: 10px 0 30px; font-size: 0.98rem; line-height: 1.55; color: var(--text-muted); }
    .lead strong { color: var(--text); font-weight: 600; }

    /* Floating label: the field is the whole control, the label rises when there is a value. */
    .float { position: relative; display: flex; align-items: center; height: 62px; border: 1px solid var(--border-strong); border-radius: 14px; background: var(--surface); transition: border-color 120ms ease, box-shadow 120ms ease; }
    .float:hover { border-color: var(--text-faint); }
    .float:focus-within { border-color: var(--text-muted); box-shadow: 0 0 0 4px color-mix(in srgb, var(--text) 10%, transparent); }
    .float.bad { border-color: var(--danger); }
    .cc { display: flex; align-items: center; gap: 8px; align-self: stretch; padding: 0 14px 0 16px; border-right: 1px solid var(--border); font-family: var(--mono); font-size: 0.95rem; color: var(--text-soft); }
    .flag { width: 18px; height: 12px; border-radius: 2px; background: linear-gradient(180deg, #ff9933 0 33%, #fff 33% 66%, #138808 66%); box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.18); }
    .float input { flex: 1; min-width: 0; height: 100%; padding: 22px 14px 6px; border: 0; outline: 0; background: none; color: var(--text); font-size: 1.15rem; letter-spacing: 0.08em; }
    .float label { position: absolute; left: 100px; top: 50%; translate: 0 -50%; font-size: 0.98rem; color: var(--text-faint); pointer-events: none; transition: top 140ms ease, font-size 140ms ease, color 140ms ease; }
    .float.plain input { padding-left: 16px; }
    .float.plain label { left: 17px; }
    .float.plain + .float.plain { margin-top: 12px; }
    .pw input { padding-right: 52px; }
    .eye { position: absolute; right: 8px; top: 50%; translate: 0 -50%; display: grid; place-items: center; width: 38px; height: 38px; padding: 0; border: 0; border-radius: 10px; background: none; color: var(--text-muted); }
    .eye:hover { color: var(--text); background: var(--surface-2); }
    .eye app-icon { width: 18px; height: 18px; }
    .proto { margin: 16px 2px 0; font-size: 0.76rem; line-height: 1.5; color: var(--text-faint); }
    .proto b { font-family: var(--mono); font-weight: 600; color: var(--text-muted); }
    .error-text { display: block; margin-top: 10px; }
    .float:focus-within label, .float.has label { top: 17px; font-size: 0.72rem; font-weight: 600; letter-spacing: 0.04em; color: var(--text-muted); }
    .float:focus-within label { color: var(--text); }
    .ok { width: 18px; height: 18px; margin-right: 16px; color: var(--success); }

    .otp { position: relative; display: flex; gap: 10px; }
    .otp input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; font-size: 16px; cursor: text; }
    .box { flex: 1; display: grid; place-items: center; height: 64px; border: 1px solid var(--border-strong); border-radius: 14px; background: var(--surface); font-family: var(--mono); font-size: 1.7rem; font-weight: 600; transition: border-color 120ms ease, box-shadow 120ms ease, transform 120ms ease; }
    .box.filled { border-color: var(--text-faint); transform: translateY(-1px); }
    .box.on { border-color: var(--text-muted); box-shadow: 0 0 0 4px color-mix(in srgb, var(--text) 10%, transparent); }
    .otp.bad .box { border-color: var(--danger); animation: shake 300ms ease; }
    @keyframes shake { 25% { translate: -4px 0; } 75% { translate: 4px 0; } }

    .go { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; height: 54px; margin-top: 22px; border: 0; border-radius: 14px; font-size: 1.02rem; font-weight: 700; color: var(--on-accent);
      background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 88%, white), var(--accent)); box-shadow: 0 10px 26px color-mix(in srgb, var(--accent) 28%, transparent), inset 0 1px 0 rgba(255, 255, 255, 0.3); transition: transform 120ms ease, box-shadow 120ms ease, filter 120ms ease; }
    .go app-icon { width: 18px; height: 18px; }
    .go:hover:not(:disabled) { transform: translateY(-1px); filter: brightness(1.05); }
    .go:active:not(:disabled) { transform: none; }
    .go:disabled { background: var(--surface-3); color: var(--text-faint); box-shadow: none; cursor: not-allowed; }
    .go:focus-visible { outline: 2px solid var(--text); outline-offset: 3px; }
    .spin { width: 16px; height: 16px; border: 2px solid color-mix(in srgb, var(--text-faint) 50%, transparent); border-top-color: var(--text-soft); border-radius: 50%; animation: turn 700ms linear infinite; }
    @keyframes turn { to { rotate: 360deg; } }
    .links { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 18px; }
    .links .link-btn { font-size: 0.88rem; }
    .links b { color: var(--text-soft); font-weight: 600; }

    .note { display: flex; align-items: flex-start; gap: 10px; margin: 30px 2px 0; font-size: 0.8rem; line-height: 1.5; color: var(--text-muted); }
    .note app-icon { flex: none; width: 15px; height: 15px; margin-top: 2px; color: var(--text-faint); }

    /* Light theme: meet in the middle. The right side is a soft grey-blue instead of glaring white; the left is a lighter, bluer stage. */
    :host-context([data-theme='light']) .panel { background: radial-gradient(70% 45% at 50% 0%, rgba(217, 58, 64, 0.07), transparent 70%), #e4e9f2; }
    :host-context([data-theme='light']) .float, :host-context([data-theme='light']) .box, :host-context([data-theme='light']) .round { background: #f7f9fc; border-color: #cdd5e3; }
    :host-context([data-theme='light']) .stage { background:
        radial-gradient(46% 38% at 50% 47%, rgba(255, 255, 255, 0.10), transparent 72%),
        linear-gradient(180deg, #1c2a4a 0%, #23345c 100%); }
    :host-context([data-theme='light']) .wall { opacity: 0.68; filter: saturate(0.95); }
    :host-context([data-theme='light']) .veil { background:
        radial-gradient(56% 42% at 50% 49%, rgba(20, 30, 58, 0.88), rgba(20, 30, 58, 0.45) 70%, transparent 100%),
        linear-gradient(180deg, rgba(20, 30, 58, 0.6) 0%, rgba(20, 30, 58, 0.12) 35%, rgba(20, 30, 58, 0.12) 65%, rgba(20, 30, 58, 0.65) 100%); }
    @media (max-width: 960px) {
      .screen { grid-template-columns: minmax(0, 1fr); }
      .stage { display: none; }
      .panel { min-height: 100vh; }
      h1 { font-size: 1.8rem; }
    }
    @media (prefers-reduced-motion: reduce) { .step, .otp.bad .box, .track, .spin { animation: none; } .progress i { transition: none; } }
  `,
})
export class SignInPage implements OnDestroy {
  protected readonly auth = inject(AuthService);
  protected readonly themes = inject(ThemeService);
  protected readonly nextTheme = computed(() => (this.themes.theme() === 'dark' ? 'light' : 'dark'));
  readonly checking = signal(false);
  private readonly store = inject(AdminStore);
  private readonly router = inject(Router);

  /** Where to go after signing in. */
  readonly returnUrl = input<string>();

  readonly step = signal<'phone' | 'code'>('phone');
  readonly who = signal('');
  readonly password = signal('');
  readonly showPw = signal(false);
  readonly code = signal('');
  readonly error = signal('');
  readonly locked = signal(false);
  readonly resendIn = signal(0);

  readonly theatreName = computed(() => this.store.theatres()[0]?.name ?? 'ThiraiDesk');
  readonly logo = computed(() => this.store.theatres()[0]?.logoUrl ?? '');
  readonly cover = computed(() => this.store.theatres()[0]?.coverUrl ?? '');
  /** Posters for the wall, shuffled into four columns. */
  readonly columns = (() => {
    const names = ['dorothy', 'jailer-2', 'baththa', 'scene', 'modha-rathiri', 'dc', 'jana-nayagan', 'coolie', 'dragon', 'retro', 'thug-life', 'karuppu', 'madharaasi', 'good-bad-ugly', 'couple-friendly', 'with-love'];
    return [0, 1, 2, 3].map((c) => names.filter((_, i) => i % 4 === c));
  })();
  readonly boxes = [0, 1, 2, 3, 4, 5];
  readonly focused = signal(false);
  readonly activeBox = computed(() => Math.min(this.code().length, 5));

  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    if (this.auth.signedIn()) void this.router.navigateByUrl(this.target());
    else this.focusSoon('si-who');
  }

  private focusSoon(id: string): void {
    setTimeout(() => document.getElementById(id)?.focus(), 60);
  }

  ngOnDestroy(): void { this.stopTimer(); }

  onCode(ev: Event): void {
    const el = ev.target as HTMLInputElement;
    const d = el.value.replace(/\D/g, '').slice(0, 6);
    if (d !== el.value) el.value = d;
    this.code.set(d);
    this.error.set('');
  }

  /** Step 1: email or mobile number and password. */
  signIn(): void {
    if (!this.who().trim() || !this.password() || this.locked()) return;
    const result = this.auth.checkPassword(this.who(), this.password());
    if (result === 'ok') {
      this.password.set('');
      this.code.set('');
      this.error.set('');
      this.locked.set(false);
      this.step.set('code');
      this.startTimer();
      this.focusSoon('si-code');
    } else if (result === 'locked') {
      this.locked.set(true);
      this.error.set('Too many attempts. Please try again later or ask your administrator.');
    } else {
      this.error.set(`The email, number or password is not right. ${this.auth.passwordTriesLeft} ${this.auth.passwordTriesLeft === 1 ? 'try' : 'tries'} left.`);
      this.password.set('');
      this.focusSoon('si-pw');
    }
  }

  verify(): void {
    if (this.code().length !== 6 || this.locked()) return;
    const result = this.auth.checkCode(this.code());
    if (result === 'ok') {
      this.store.signInAs(this.auth.userId());
      void this.router.navigateByUrl(this.target());
    } else if (result === 'locked') {
      this.locked.set(true);
      this.error.set('Too many wrong codes. Request a new code to try again.');
    } else {
      this.error.set(`That code is not right. ${this.auth.codeTriesLeft} ${this.auth.codeTriesLeft === 1 ? 'try' : 'tries'} left.`);
      this.code.set('');
      this.focusSoon('si-code');
    }
  }

  resend(): void {
    this.auth.resendCode();
    this.code.set('');
    this.error.set('');
    this.locked.set(false);
    this.startTimer();
  }

  back(): void {
    this.stopTimer();
    this.auth.cancelPending();
    this.step.set('phone');
    this.error.set('');
    this.locked.set(false);
    this.focusSoon('si-pw');
  }

  private target(): string {
    const url = this.returnUrl();
    return url && url.startsWith('/') && !url.startsWith('//') && !url.startsWith('/sign-in') ? url : '/overview';
  }

  private startTimer(): void {
    this.stopTimer();
    this.resendIn.set(RESEND_SECONDS);
    this.timer = setInterval(() => {
      this.resendIn.update((s) => Math.max(0, s - 1));
      if (this.resendIn() === 0) this.stopTimer();
    }, 1000);
  }

  private stopTimer(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }
}
