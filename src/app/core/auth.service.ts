import { Injectable, signal } from '@angular/core';

import { STAFF_USERS } from './mock-data';
import { StaffUser } from './models';

/**
 * Two-step sign-in. Step 1: an email address or mobile number and a password. Step 2: a one-time code sent to the
 * person's mobile. The prototype accepts the password below and the code 123456; the real password check and the SMS
 * code will be done by the server. The signed-in state lasts for this browser tab, so a refresh does not ask again.
 */
export const PROTOTYPE_PASSWORD = 'Hayat@2026';
const PROTOTYPE_CODE = '123456';
const MAX_PASSWORD_TRIES = 5;
const MAX_CODE_TRIES = 3;
const DEFAULT_USER = 'u-gm';
const SESSION_KEY = 'thiraihub.admin.session';

interface Session { phone: string; userId: string; }

function readSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function writeSession(session: Session | null): void {
  try {
    if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Storage can be blocked; the person then signs in again after a refresh.
  }
}

const digits = (v: string) => v.replace(/\D/g, '').slice(-10);

export type PasswordCheck = 'ok' | 'invalid' | 'locked';
export type CodeCheck = 'ok' | 'wrong' | 'locked';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly restored = readSession();
  readonly signedIn = signal(this.restored !== null);
  /** The staff user this session belongs to. */
  readonly userId = signal(this.restored?.userId ?? DEFAULT_USER);

  private phone = this.restored?.phone ?? '';
  /** Who passed step 1 and is waiting for the code. */
  private pending: StaffUser | null = null;
  /** True when they signed in with an email, so the code goes to that email. */
  private viaEmail = false;
  private passwordTries = 0;
  private codeTries = 0;

  /** The last four digits of the mobile the code goes to. */
  get maskedPhone(): string { return this.phone.slice(-4); }
  /** Where the code was sent, partly hidden. */
  get codeSentTo(): string {
    const email = this.pending?.email;
    if (this.viaEmail && email) {
      const [name, domain] = email.split('@');
      return `${name![0]}••••@${domain}`;
    }
    return `+91 ••••${this.maskedPhone}`;
  }
  get passwordTriesLeft(): number { return Math.max(0, MAX_PASSWORD_TRIES - this.passwordTries); }
  get codeTriesLeft(): number { return Math.max(0, MAX_CODE_TRIES - this.codeTries); }

  /** Step 1: finds the person by email or mobile number and checks the password. */
  checkPassword(identifier: string, password: string): PasswordCheck {
    if (this.passwordTries >= MAX_PASSWORD_TRIES) return 'locked';
    const id = identifier.trim().toLowerCase();
    const user = STAFF_USERS.find((u) => (id.includes('@') ? u.email.toLowerCase() === id : !!u.phone && digits(u.phone) === digits(id)));
    if (user && password === PROTOTYPE_PASSWORD) {
      this.pending = user;
      this.viaEmail = id.includes('@');
      this.phone = digits(user.phone ?? '');
      this.passwordTries = 0;
      this.codeTries = 0;
      return 'ok';
    }
    this.passwordTries++;
    return this.passwordTries >= MAX_PASSWORD_TRIES ? 'locked' : 'invalid';
  }

  /** Step 2: the one-time code. */
  checkCode(code: string): CodeCheck {
    if (!this.pending || this.codeTries >= MAX_CODE_TRIES) return 'locked';
    if (code === PROTOTYPE_CODE) {
      this.userId.set(this.pending.id);
      this.signedIn.set(true);
      writeSession({ phone: this.phone, userId: this.pending.id });
      this.pending = null;
      return 'ok';
    }
    this.codeTries++;
    return this.codeTries >= MAX_CODE_TRIES ? 'locked' : 'wrong';
  }

  /** Sends a new code and gives three fresh tries. */
  resendCode(): void { this.codeTries = 0; }

  /** Goes back to step 1. */
  cancelPending(): void { this.pending = null; }

  /** Keeps the session in step when the prototype's user switcher changes who is signed in. */
  setUser(id: string): void {
    this.userId.set(id);
    if (this.signedIn()) writeSession({ phone: this.phone, userId: id });
  }

  signOut(): void {
    this.signedIn.set(false);
    this.userId.set(DEFAULT_USER);
    this.pending = null;
    this.phone = '';
    this.passwordTries = 0;
    this.codeTries = 0;
    writeSession(null);
  }
}
