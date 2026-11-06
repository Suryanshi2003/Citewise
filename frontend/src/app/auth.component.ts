import { Component, ElementRef, NgZone, OnInit, ViewChild, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService, apiError } from './services/auth.service';
import { StickerComponent } from './sticker.component';

// "google" is created by Google's script (loaded below), so TypeScript can't know about it.
declare const google: any;

@Component({
  selector: 'app-auth',
  standalone: true,
  imports: [FormsModule, StickerComponent],
  template: `
    <div class="auth">
      <!-- Left: the "cover" -->
      <aside class="cover">
        <app-sticker class="s s1" kind="coffee" [size]="84" [tilt]="-10" />
        <app-sticker class="s s2" kind="magnifier" [size]="80" [tilt]="12" />
        <app-sticker class="s s3" kind="flask" [size]="70" [tilt]="8" />
        <app-sticker class="s s4" kind="bookmark" [size]="64" [tilt]="-6" />
        <app-sticker class="s s5" kind="pencil" [size]="66" [tilt]="-14" />

        <p class="hand welcome">Welcome, researcher ✦</p>
        <h1>Your papers, answered with receipts.</h1>
        <ul>
          <li>Ask questions across all your papers at once</li>
          <li>Every answer is footnoted to the exact page and sentence</li>
          <li>Your library is private — only you can see it</li>
        </ul>
      </aside>

      <!-- Right: the form -->
      <section class="card form-card">
        @if (registrationOpen()) {
          <div class="tabs" role="tablist">
            <button role="tab" [class.active]="mode() === 'login'" (click)="setMode('login')">Log in</button>
            <button role="tab" [class.active]="mode() === 'register'" (click)="setMode('register')">Create account</button>
          </div>
        }

        <h2>{{ mode() === 'login' ? 'Good to see you again' : 'Start your library' }}</h2>
        <p class="sub">
          {{ mode() === 'login' ? 'Log in to open your papers.' : 'It takes ten seconds. No credit card.' }}
        </p>

        <!-- Google renders its own official button inside this box (hidden until it has loaded) -->
        <div class="google" [hidden]="!googleReady()">
          <div #googleBtn></div>
          <div class="or"><span>or use your email</span></div>
        </div>

        <label>
          Email
          <input class="input" type="email" [(ngModel)]="email" placeholder="you@university.edu"
                 autocomplete="email" (keydown.enter)="submit()" />
        </label>

        <label>
          Password
          <div class="pw">
            <input class="input" [type]="showPassword() ? 'text' : 'password'" [(ngModel)]="password"
                   [placeholder]="mode() === 'register' ? 'At least 8 characters' : 'Your password'"
                   [autocomplete]="mode() === 'login' ? 'current-password' : 'new-password'"
                   (keydown.enter)="submit()" />
            <button type="button" class="toggle" (click)="showPassword.set(!showPassword())">
              {{ showPassword() ? 'Hide' : 'Show' }}
            </button>
          </div>
        </label>

        @if (error()) {
          <p class="error-note">{{ error() }}</p>
        }

        <button class="btn submit" (click)="submit()" [disabled]="loading()">
          {{ loading() ? 'One moment…' : mode() === 'login' ? 'Open my library' : 'Create my library' }}
        </button>
      </section>
    </div>
  `,
  styles: [`
    .auth {
      display: grid; grid-template-columns: 1.1fr 1fr; gap: 28px; align-items: stretch;
      min-height: 600px; animation: pop-in 0.35s ease-out;
    }
    .cover {
      position: relative; overflow: hidden; border-radius: 20px; padding: 48px 40px;
      color: #fbefd8; display: flex; flex-direction: column; justify-content: center;
      background:
        repeating-linear-gradient(0deg, transparent 0 31px, rgba(255, 240, 210, 0.07) 31px 32px),
        linear-gradient(145deg, #4a2c1a, #6d4027);
      box-shadow: var(--shadow);
    }
    .cover::before { content: ''; position: absolute; left: 22px; top: 0; bottom: 0; width: 3px; background: rgba(246, 220, 122, 0.55); }
    .welcome { font-size: 1.7rem; margin: 0 0 6px; color: var(--highlight); }
    h1 { color: #fff6e3; font-size: 2.5rem; margin-bottom: 22px; max-width: 420px; }
    ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 10px; max-width: 420px; }
    li { padding-left: 26px; position: relative; opacity: 0.92; }
    li::before { content: '✓'; position: absolute; left: 0; color: var(--highlight); font-weight: 700; }

    .s { position: absolute; animation: bob 5s ease-in-out infinite; --tilt: 0deg; }
    .s1 { right: 28px; top: 24px; }
    .s2 { right: 34px; bottom: 36px; animation-delay: -1s; }
    .s3 { left: 52px; bottom: 26px; animation-delay: -2s; }
    .s4 { right: 120px; top: 120px; animation-delay: -3s; }
    .s5 { left: 150px; bottom: 40px; animation-delay: -4s; }

    .form-card { padding: 32px 34px; display: flex; flex-direction: column; gap: 14px; justify-content: center; }
    .tabs { display: flex; gap: 6px; background: var(--paper-dark); padding: 5px; border-radius: 12px; }
    .tabs button { flex: 1; border: 0; background: transparent; padding: 0.55rem; border-radius: 9px; font-weight: 600; color: var(--ink-soft); }
    .tabs button.active { background: var(--card); color: var(--brown-dark); box-shadow: 0 1px 4px rgba(74, 44, 26, 0.2); }
    h2 { font-size: 1.7rem; margin-top: 8px; }
    .sub { margin: -8px 0 4px; color: var(--ink-soft); }

    .google { display: grid; gap: 14px; justify-items: center; }
    .or { width: 100%; display: flex; align-items: center; gap: 10px; color: var(--ink-soft); font-size: 0.8rem; }
    .or::before, .or::after { content: ''; flex: 1; height: 1px; background: var(--line); }

    label { display: grid; gap: 5px; font-size: 0.85rem; font-weight: 600; color: var(--ink-soft); }
    .pw { position: relative; }
    .pw .input { padding-right: 4.2rem; }
    .toggle { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); background: none; border: 0; color: var(--brown); font-size: 0.8rem; font-weight: 600; }
    .submit { margin-top: 6px; padding: 0.8rem; font-size: 1rem; }

    @media (max-width: 860px) {
      .auth { grid-template-columns: 1fr; }
      .cover { padding: 32px 26px 90px; }
      h1 { font-size: 1.9rem; }
      .s4, .s5 { display: none; }
    }
  `],
})
export class AuthComponent implements OnInit {
  private auth = inject(AuthService);
  private zone = inject(NgZone);
  @ViewChild('googleBtn', { static: true }) googleBtn!: ElementRef<HTMLElement>;

  mode = signal<'login' | 'register'>('login');
  showPassword = signal(false);
  loading = signal(false);
  error = signal('');
  googleReady = signal(false);
  registrationOpen = signal(true);

  email = '';
  password = '';

  ngOnInit() {
    // Ask the backend what to show. If it can't be reached we just show email + password.
    this.auth.loadConfig().subscribe({
      next: (cfg) => {
        this.registrationOpen.set(cfg.allow_registration);
        if (!cfg.allow_registration) this.mode.set('login');
        if (cfg.google_client_id) this.setupGoogle(cfg.google_client_id);
      },
      error: () => {},
    });
  }

  private loadGoogleScript(): Promise<void> {
    if ((window as any).google?.accounts?.id) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Google script blocked'));
      document.head.appendChild(script);
    });
  }

  private async setupGoogle(clientId: string) {
    try {
      await this.loadGoogleScript();
      google.accounts.id.initialize({
        client_id: clientId,
        // Google calls this outside Angular, so hop back in so the screen updates
        callback: (resp: { credential: string }) => this.zone.run(() => this.onGoogle(resp.credential)),
      });
      google.accounts.id.renderButton(this.googleBtn.nativeElement, {
        type: 'standard', theme: 'outline', size: 'large', shape: 'pill',
        text: 'continue_with', logo_alignment: 'left', width: 300,
      });
      this.googleReady.set(true);
    } catch {
      // Blocked by an ad-blocker or offline: the email form still works, so stay quiet.
      this.googleReady.set(false);
    }
  }

  private onGoogle(credential: string) {
    this.error.set('');
    this.loading.set(true);
    this.auth.google(credential).subscribe({
      error: (err) => {
        this.loading.set(false);
        this.error.set(apiError(err));
      },
      complete: () => this.loading.set(false),
    });
  }

  setMode(mode: 'login' | 'register') {
    this.mode.set(mode);
    this.error.set('');
  }

  submit() {
    if (this.loading()) return;
    const email = this.email.trim();

    if (!/^\S+@\S+\.\S+$/.test(email)) return this.error.set('Please enter a valid email address.');
    if (!this.password) return this.error.set('Please enter your password.');
    if (this.mode() === 'register' && this.password.length < 8) {
      return this.error.set('Your password needs at least 8 characters.');
    }

    this.error.set('');
    this.loading.set(true);
    const request =
      this.mode() === 'login' ? this.auth.login(email, this.password) : this.auth.register(email, this.password);

    request.subscribe({
      error: (err) => {
        this.loading.set(false);
        this.error.set(apiError(err));
      },
      complete: () => this.loading.set(false),
    });
  }
}
