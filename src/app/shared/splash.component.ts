import { ChangeDetectionStrategy, Component, OnDestroy, signal } from '@angular/core';


const SEEN_KEY = 'thiraihub.admin.splash.seen';
const HOLD_MS = 3000;
const FADE_MS = 400;

/** Opening screen, shared with the customer app: the screen curve draws itself, the seats pop in, then the name appears. Plays once per session. */
@Component({
  selector: 'app-splash',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visible()) {
      <div class="splash" [class.leaving]="leaving()" role="status" aria-label="Loading ThiraiDesk" (click)="dismiss()">
        <div class="scene" aria-hidden="true">
          <div class="wall">
            @for (col of columns; track $index) {
              <div class="col" [class.up]="$index % 2 === 1" [style.--t]="(60 + $index * 10) + 's'">
                <div class="track">
                  @for (p of col; track $index) { <img [src]="'/posters/' + p + '.jpg'" alt="" /> }
                  @for (p of col; track $index) { <img [src]="'/posters/' + p + '.jpg'" alt="" /> }
                </div>
              </div>
            }
          </div>
          <div class="veil"></div>
          <div class="edge top"><span>ThiraiDesk</span><span>Operations Console</span><span>Now showing</span></div>
        </div>
        <div class="lock">
          <div class="stack">
          <div class="brand">
          <svg viewBox="0 6 64 54" aria-hidden="true" focusable="false">
            <path class="arc" pathLength="1" d="M5 22Q32 3 59 22" fill="none" stroke="#e5484d" stroke-width="9" stroke-linecap="round" />
            <rect class="seat" style="--i: 0" x="6" y="34" width="52" height="9" rx="4.5" fill="#e5484d" />
            <rect class="seat" style="--i: 1" x="12" y="43" width="7" height="14" rx="3.5" fill="#e5484d" />
            <rect class="seat" style="--i: 2" x="45" y="43" width="7" height="14" rx="3.5" fill="#e5484d" />
          </svg>
          <span class="wm" aria-hidden="true">
            @for (letter of letters; track $index) {
              <i [style.--i]="$index">{{ letter }}</i>
            }
          </span>
          </div>
          </div>
          <span class="load" aria-hidden="true"><i></i></span>
        </div>
      </div>
    }
  `,
  styles: `
    .splash {
      position: fixed;
      inset: 0;
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      /* Always the dark stage, like the sign-in page, whatever theme the app is in. */
      --bg: #0c0f15;
      --text: #fff;
      --brand: var(--accent);
      --on-primary: var(--on-accent);
      background: linear-gradient(180deg, #0c0f15 0%, #111620 100%);
      transition: opacity 400ms ease;
    }
    .splash.leaving { opacity: 0; pointer-events: none; }

    .scene { position: absolute; inset: 0; animation: fade-in 700ms both; }
    .wall { position: absolute; inset: -10% -6%; display: grid; grid-template-columns: repeat(6, 1fr); gap: 16px; transform: rotate(-8deg) scale(1.1); opacity: 0.42; filter: saturate(0.85); }
    .col { overflow: hidden; }
    .track { display: flex; flex-direction: column; gap: 16px; animation: drift var(--t) linear infinite; }
    .col.up .track { animation-direction: reverse; }
    .track img { display: block; width: 100%; aspect-ratio: 2 / 3; object-fit: cover; border-radius: 8px; }
    @keyframes drift { to { transform: translateY(-50%); } }
    .veil { position: absolute; inset: 0; pointer-events: none;
      background:
        radial-gradient(52% 50% at 50% 50%, rgba(8, 10, 15, 0.97), rgba(8, 10, 15, 0.82) 55%, rgba(8, 10, 15, 0.35) 85%, transparent 100%),
        linear-gradient(180deg, rgba(8, 10, 15, 0.8) 0%, rgba(8, 10, 15, 0.25) 35%, rgba(8, 10, 15, 0.25) 65%, rgba(8, 10, 15, 0.85) 100%); }
    .edge { position: absolute; top: 24px; left: 0; right: 0; display: flex; justify-content: space-between; padding: 0 36px; font-size: 0.7rem; font-weight: 700; letter-spacing: 0.28em; text-transform: uppercase; color: rgba(255, 255, 255, 0.45); }
    @media (max-width: 760px) { .wall { grid-template-columns: repeat(3, 1fr); } .edge span:nth-child(2) { display: none; } }

    .stack { display: grid; place-items: center; }
    .brand { grid-area: 1 / 1; display: flex; flex-direction: column; align-items: center; gap: 22px; }
    .load { position: relative; display: block; width: clamp(120px, 14vw, 180px); height: 2px; margin-top: 8px; overflow: hidden; border-radius: 2px; background: rgba(255, 255, 255, 0.14); }
    .load i { position: absolute; inset: 0; width: 100%; transform-origin: left; background: #e5484d; animation: fill 2.8s cubic-bezier(0.3, 0.1, 0.2, 1) both; }
    @keyframes fill { from { transform: scaleX(0); } to { transform: scaleX(1); } }

    .lock { position: relative; display: flex; flex-direction: column; align-items: center; gap: 22px; }
    svg { width: clamp(84px, 13vw, 120px); height: auto; overflow: visible; display: block; }

    .wm { font-weight: 800; font-size: clamp(32px, 6vw, 56px); letter-spacing: -0.03em; line-height: 1; color: #E5484D; white-space: nowrap; }
    .wm i { font-style: normal; display: inline-block; animation: fade-up 400ms calc(1.7s + var(--i) * 60ms) both; }

    .arc { stroke-dasharray: 1; animation: draw-arc 1s cubic-bezier(0.4, 0, 0.2, 1) 0.2s both; }
    .seat { transform-box: fill-box; transform-origin: center; animation: pop 400ms calc(1.2s + var(--i) * 90ms) cubic-bezier(0.3, 1.6, 0.5, 1) both; }
    @keyframes draw-arc { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
    @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
    @keyframes fade-up { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
    @keyframes pop { 0% { transform: scale(0); } 70% { transform: scale(1.25); } 100% { transform: scale(1); } }

    @media (prefers-reduced-motion: reduce) {
      .splash *, .splash { animation: none !important; transition: none !important; }
    }
  `,
})
export class SplashComponent implements OnDestroy {
  readonly letters = 'thiraidesk'.split('');
  /** Posters for the wall, shuffled into six columns. */
  readonly columns = (() => {
    const names = ['dorothy', 'jailer-2', 'baththa', 'scene', 'modha-rathiri', 'dc', 'jana-nayagan', 'coolie', 'dragon', 'retro', 'thug-life', 'karuppu', 'madharaasi', 'good-bad-ugly', 'couple-friendly', 'with-love', '29', 'thaai-kizhavi'];
    return [0, 1, 2, 3, 4, 5].map((c) => names.filter((_, i) => i % 6 === c));
  })();
  readonly visible = signal(false);
  readonly leaving = signal(false);

  private holdTimer?: ReturnType<typeof setTimeout>;
  private fadeTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    if (this.alreadySeen() || this.prefersReducedMotion()) {
      return;
    }

    this.visible.set(true);
    // the page behind must not show its scrollbar over the opening screen
    document.documentElement.style.overflow = 'hidden';
    this.holdTimer = setTimeout(() => this.dismiss(), HOLD_MS);
  }

  ngOnDestroy(): void {
    clearTimeout(this.holdTimer);
    clearTimeout(this.fadeTimer);
    document.documentElement.style.overflow = '';
  }

  dismiss(): void {
    if (!this.visible() || this.leaving()) {
      return;
    }

    clearTimeout(this.holdTimer);
    this.markSeen();
    this.leaving.set(true);
    this.fadeTimer = setTimeout(() => {
      this.visible.set(false);
      document.documentElement.style.overflow = '';
    }, FADE_MS);
  }

  private alreadySeen(): boolean {
    try {
      return sessionStorage.getItem(SEEN_KEY) === '1';
    } catch {
      return false;
    }
  }

  private markSeen(): void {
    try {
      sessionStorage.setItem(SEEN_KEY, '1');
    } catch {
      // storage can be blocked; the splash then plays on every load
    }
  }

  private prefersReducedMotion(): boolean {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
}
