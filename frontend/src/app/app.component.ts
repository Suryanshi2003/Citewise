import { Component, OnInit, inject } from '@angular/core';
import { AuthService } from './services/auth.service';
import { ApiService } from './services/api.service';
import { AuthComponent } from './auth.component';
import { HistoryComponent } from './history.component';
import { LibraryComponent } from './library.component';
import { ChatComponent } from './chat.component';
import { StickerComponent } from './sticker.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [AuthComponent, HistoryComponent, LibraryComponent, ChatComponent, StickerComponent],
  template: `
    @if (!auth.ready()) {
      <p class="loading hand">Opening the reading room…</p>
    } @else if (!auth.user()) {
      <div class="logged-out">
        <header class="brand-top">
          <app-sticker kind="papers" [size]="52" [tilt]="-8" />
          <div>
            <h1>CiteWise</h1>
            <p class="hand">ask your papers anything — every answer comes with receipts</p>
          </div>
        </header>
        <app-auth />
      </div>
    } @else {
      <div class="shell">
        @if (api.railOpen()) { <div class="scrim" (click)="api.railOpen.set(false)"></div> }

        <!-- The dark leather side rail: past chats + the bookshelf -->
        <aside class="rail" [class.open]="api.railOpen()">
          <div class="brand">
            <app-sticker kind="papers" [size]="44" [tilt]="-8" />
            <div>
              <h1>CiteWise</h1>
              <p class="hand">your reading room</p>
            </div>
            <button class="x" (click)="api.railOpen.set(false)" aria-label="Close menu">✕</button>
          </div>

          <nav class="tabs">
            <button [class.on]="api.railTab() === 'chats'" (click)="api.railTab.set('chats')">
              Notebooks <b>{{ api.sessions().length }}</b>
            </button>
            <button [class.on]="api.railTab() === 'shelf'" (click)="api.railTab.set('shelf')">
              Bookshelf <b>{{ api.docs().length }}</b>
            </button>
          </nav>

          <!-- both stay alive; we only hide one, so nothing reloads when you switch -->
          <div class="pane" [class.hide]="api.railTab() !== 'chats'">
            <app-history (picked)="api.railOpen.set(false)" />
          </div>
          <div class="pane" [class.hide]="api.railTab() !== 'shelf'">
            <app-library />
          </div>

          <footer class="me">
            <span class="email" [title]="auth.user()!.email">{{ auth.user()!.email }}</span>
            <button (click)="auth.logout()">Log out</button>
          </footer>
        </aside>

        <main><app-chat /></main>
      </div>
    }
  `,
  styles: [`
    :host { display: block; }
    .loading { text-align: center; font-size: 2rem; color: var(--brown); padding: 120px 0; }

    /* ---- logged-out page ---- */
    .logged-out { max-width: 1240px; margin: 0 auto; padding: 22px; }
    .brand-top { display: flex; align-items: center; gap: 14px; margin-bottom: 22px; }
    .brand-top h1 { font-size: 2.3rem; font-weight: 800; }
    .brand-top .hand { margin: -2px 0 0; font-size: 1.3rem; color: var(--ink-soft); }

    /* ---- logged-in: rail + notebook ---- */
    .shell { display: grid; grid-template-columns: 330px minmax(0, 1fr); height: 100vh; height: 100dvh; }
    main { padding: 16px 18px 16px 10px; min-height: 0; min-width: 0; }

    .rail {
      position: relative; display: flex; flex-direction: column; min-height: 0; padding: 18px 20px 14px; color: #f3e5cb;
      background:
        radial-gradient(rgba(255, 240, 210, 0.05) 1px, transparent 1px) 0 0 / 7px 7px,
        linear-gradient(180deg, #3d2417, #2b1810);
    }
    .rail::after { /* leather stitching */
      content: ''; position: absolute; top: 10px; bottom: 10px; right: 8px; border-right: 2px dashed rgba(201, 162, 77, 0.4); pointer-events: none;
    }
    .brand { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
    .brand h1 { color: #fff1d6; font-size: 1.6rem; font-weight: 800; }
    .brand .hand { margin: -4px 0 0; font-size: 1.15rem; color: #e0b252; }
    .x { display: none; margin-left: auto; background: none; border: 0; color: #f3e5cb; font-size: 1.2rem; }

    .tabs { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; padding: 4px; background: rgba(0, 0, 0, 0.28); border-radius: 11px; margin-bottom: 14px; }
    .tabs button { border: 0; background: none; color: #c9b18d; padding: 0.5rem 0.4rem; border-radius: 8px; font-weight: 600; font-size: 0.88rem; }
    .tabs button b { font-size: 0.72rem; background: rgba(255, 240, 210, 0.14); border-radius: 99px; padding: 1px 7px; margin-left: 3px; }
    .tabs button.on { background: #f0e0bf; color: var(--brown-dark); }
    .tabs button.on b { background: rgba(74, 44, 26, 0.15); }

    .pane { flex: 1; min-height: 0; overflow-y: auto; padding-right: 6px; }
    .pane.hide { display: none; }
    .pane { scrollbar-color: #6f4c33 transparent; }

    .me { display: flex; align-items: center; gap: 8px; padding-top: 12px; margin-top: 8px; border-top: 1px solid rgba(255, 240, 210, 0.14); font-size: 0.82rem; }
    .email { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #c9b18d; }
    .me button { background: none; border: 1.5px solid rgba(240, 224, 191, 0.5); color: #f0e0bf; border-radius: 8px; padding: 0.25rem 0.7rem; font-size: 0.8rem; font-weight: 600; }
    .me button:hover { background: rgba(240, 224, 191, 0.14); }

    .scrim { display: none; }

    @media (max-width: 860px) {
      .shell { display: block; }
      main { padding: 8px; height: 100vh; height: 100dvh; }
      .rail {
        position: fixed; z-index: 30; top: 0; bottom: 0; left: 0; width: min(340px, 88vw);
        transform: translateX(-102%); transition: transform 0.22s ease-out; box-shadow: 10px 0 40px rgba(0, 0, 0, 0.5);
      }
      .rail.open { transform: none; }
      .x { display: block; }
      .scrim { display: block; position: fixed; inset: 0; z-index: 25; background: rgba(30, 16, 8, 0.55); }
    }
  `],
})
export class AppComponent implements OnInit {
  protected auth = inject(AuthService);
  protected api = inject(ApiService);

  ngOnInit() {
    this.auth.restoreSession();
  }
}
