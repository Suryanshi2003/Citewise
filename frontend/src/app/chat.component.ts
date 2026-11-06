import { Component, ElementRef, OnDestroy, ViewChild, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { ApiService } from './services/api.service';
import { apiError } from './services/auth.service';
import { Citation, EvalTrace, HistoryMessage } from './models/types';
import { CitationViewerComponent } from './citation-viewer.component';
import { StickerComponent } from './sticker.component';

// ---- Turning the model's text into safe, displayable pieces (no innerHTML, so no XSS) ----
interface Part { text: string; bold?: boolean; marker?: number; }
interface Block { bullet: boolean; parts: Part[]; }

function parseAnswer(text: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of text.split('\n')) {
    let line = raw.trim();
    if (!line) continue;
    line = line.replace(/^#{1,6}\s+/, ''); // the prompt forbids headings, but just in case
    const bullet = /^([-*•]|\d+[.)])\s+/.test(line);
    if (bullet) line = line.replace(/^([-*•]|\d+[.)])\s+/, '');

    const parts: Part[] = [];
    // split into: **bold**, [1] or [1, 2] citation markers, and plain text
    for (const token of line.split(/(\*\*[^*]+\*\*|\[\d+(?:\s*,\s*\d+)*\])/g)) {
      if (!token) continue;
      if (token.startsWith('**') && token.endsWith('**') && token.length > 4) {
        parts.push({ text: token.slice(2, -2), bold: true });
      } else if (/^\[\d/.test(token)) {
        for (const n of token.slice(1, -1).split(',')) parts.push({ text: n.trim(), marker: Number(n) });
      } else {
        parts.push({ text: token });
      }
    }
    blocks.push({ bullet, parts });
  }
  return blocks;
}

interface DisplayMessage {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  citations: Citation[];
  blocks: Block[];
}

const MAX_QUESTION = 1000; // keep in sync with MAX_QUESTION_CHARS on the backend

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [FormsModule, CitationViewerComponent, StickerComponent],
  template: `
    <section class="page">
      <div class="holes"></div>

      <header class="bar">
        <button class="menu" (click)="api.railOpen.set(true)" aria-label="Open menu">☰</button>
        <div class="ttl">
          <h2>{{ title() }}</h2>
          <p class="hand">{{ today }}</p>
        </div>
        @if (authors().length || years().length || topics().length) {
          <button class="focus" [class.on]="filterCount() > 0" (click)="showFilters.set(!showFilters())">
            ◎ Focus @if (filterCount()) { <b>{{ filterCount() }}</b> }
          </button>
        }
      </header>

      @if (showFilters()) {
        <div class="filters">
          <span class="hand">Only look at:</span>
          @if (authors().length) {
            <select class="input" [(ngModel)]="author">
              <option value="">Any author</option>
              @for (a of authors(); track a) { <option [value]="a">{{ a }}</option> }
            </select>
          }
          @if (years().length) {
            <select class="input" [(ngModel)]="year">
              <option value="">Any year</option>
              @for (y of years(); track y) { <option [value]="y">{{ y }}</option> }
            </select>
          }
          @if (topics().length) {
            <select class="input" [(ngModel)]="topic">
              <option value="">Any topic</option>
              @for (t of topics(); track t) { <option [value]="t">{{ t }}</option> }
            </select>
          }
        </div>
      }

      <div class="scroller" #scroller>
        @if (loadingHistory()) {
          <p class="hand muted">Turning back the pages…</p>
        }

        @if (!loadingHistory() && messages().length === 0 && streamingText() === null) {
          <div class="welcome">
            <div class="stickers">
              <app-sticker kind="coffee" [size]="78" [tilt]="-8" />
              <app-sticker kind="flask" [size]="70" [tilt]="6" />
              <app-sticker kind="bookmark" [size]="60" [tilt]="-4" />
            </div>
            <h3>A fresh page.</h3>
            @if (readyCount() === 0) {
              <p>Put a paper on your bookshelf, wait until it says <strong>Ready</strong>, then ask it anything.</p>
              <button class="btn" (click)="openShelf()">Open the bookshelf</button>
            } @else {
              <p>{{ readyCount() }} {{ readyCount() === 1 ? 'paper is' : 'papers are' }} ready. Start with one of these, or write your own:</p>
              <div class="ideas">
                @for (idea of ideas; track idea) {
                  <button class="hand" (click)="send(idea)" [disabled]="sending()">{{ idea }}</button>
                }
              </div>
            }
          </div>
        }

        @for (m of messages(); track $index) {
          @if (m.role === 'user') {
            <div class="entry q">
              <span class="qm hand">Q.</span>
              <p class="hand"><span class="qt">{{ m.content }}</span></p>
            </div>
          } @else {
            <article class="entry a">
              @for (b of m.blocks; track $index) {
                <p [class.bullet]="b.bullet">
                  @for (p of b.parts; track $index) {
                    @if (p.marker !== undefined) {
                      <sup><button class="sup" [class.dead]="!has(m, p.marker)" (click)="openMarker(m, p.marker)"
                                   [title]="has(m, p.marker) ? 'Show the source' : ''">{{ p.marker }}</button></sup>
                    } @else if (p.bold) {
                      <strong>{{ p.text }}</strong>
                    } @else {
                      <span>{{ p.text }}</span>
                    }
                  }
                </p>
              }

              @if (m.citations.length) {
                <ol class="notes">
                  @for (c of m.citations; track c.marker) {
                    <li>
                      <button class="fnum" (click)="activeCitation.set(c)">{{ c.marker }}</button>
                      <div>
                        <button class="fsrc" (click)="activeCitation.set(c)">{{ c.filename }}, p.&nbsp;{{ c.page_num }}</button>
                        <q>{{ c.highlighted_sentence }}</q>
                      </div>
                    </li>
                  }
                </ol>
              }

              @if (m.id) {
                <button class="trace-toggle" (click)="toggleTrace(m)">
                  {{ openTraceId() === m.id ? 'Hide' : 'How was this found?' }}
                </button>
                @if (openTraceId() === m.id) {
                  <div class="trace">
                    @if (traceLoading()) { <p>Loading…</p> }
                    @if (trace(); as t) {
                      <h4>Passages the AI was given ({{ t.retrieved_chunks.length }})</h4>
                      @for (c of t.retrieved_chunks; track c.child_id) {
                        <div class="chunk"><small>{{ c.filename }} · page {{ c.page_num }}</small>{{ c.text }}</div>
                      }
                    }
                  </div>
                }
              }
            </article>
          }
        }

        @if (streamingText() !== null) {
          <article class="entry a">
            @if (streamingText() === '') {
              <p class="muted"><span class="dots"><i></i><i></i><i></i></span> reading your papers…</p>
            } @else {
              @for (b of streamBlocks(); track $index) {
                <p [class.bullet]="b.bullet">
                  @for (p of b.parts; track $index) {
                    @if (p.marker !== undefined) { <sup><span class="sup">{{ p.marker }}</span></sup> }
                    @else if (p.bold) { <strong>{{ p.text }}</strong> }
                    @else { <span>{{ p.text }}</span> }
                  }
                </p>
              }
              <span class="cursor">▍</span>
            }
          </article>
        }
      </div>

      @if (errorMsg()) { <p class="error-note err">{{ errorMsg() }}</p> }

      <div class="ask">
        <textarea [(ngModel)]="question" rows="2" maxlength="1000"
                  [placeholder]="readyCount() === 0 ? 'Add a paper to your bookshelf first…' : 'Write your question here…'"
                  (keydown.enter)="onEnter($any($event))" [disabled]="sending() || readyCount() === 0"></textarea>
        @if (question.length > 800) { <span class="count">{{ question.length }}/1000</span> }
        <button class="btn" (click)="send()" [disabled]="sending() || !question.trim() || readyCount() === 0">
          {{ sending() ? 'Reading…' : '✎ Ask' }}
        </button>
      </div>
    </section>

    @if (activeCitation()) {
      <div class="backdrop" (click)="activeCitation.set(null)"></div>
      <app-citation-viewer [citation]="activeCitation()" (closed)="activeCitation.set(null)" />
    }
  `,
  styles: [`
    :host { display: block; height: 100%; min-height: 0; }

    /* ===== the notebook page ===== */
    .page {
      position: relative; height: 100%; display: flex; flex-direction: column; overflow: hidden;
      background: #fdf8ec; border-radius: 6px 18px 18px 6px;
      box-shadow: 0 1px 0 rgba(74, 44, 26, 0.1), 0 26px 40px -26px rgba(74, 44, 26, 0.6), inset 12px 0 16px -14px rgba(74, 44, 26, 0.45);
    }
    .page::before { /* the red margin line */
      content: ''; position: absolute; left: 66px; top: 0; bottom: 0; width: 2px; background: rgba(176, 80, 58, 0.38); pointer-events: none;
    }
    .holes { /* punched binder holes */
      position: absolute; left: 16px; top: 0; bottom: 0; width: 28px; pointer-events: none;
      background: radial-gradient(circle at 14px 14px, var(--paper) 0 7px, rgba(74, 44, 26, 0.35) 8px 9px, transparent 10px) 0 60px / 28px 200px repeat-y;
    }

    .bar { display: flex; align-items: center; gap: 12px; padding: 18px 26px 10px 90px; }
    .menu { display: none; background: none; border: 0; font-size: 1.4rem; color: var(--brown-dark); padding: 2px 6px; }
    .ttl { flex: 1; min-width: 0; }
    h2 { font-size: 1.45rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ttl .hand { margin: 0; font-size: 1.15rem; color: var(--caramel); }
    .focus { background: none; border: 1.5px solid var(--line); border-radius: 99px; padding: 0.3rem 0.85rem; color: var(--brown); font-weight: 600; font-size: 0.85rem; }
    .focus.on, .focus:hover { border-color: var(--caramel); background: #f7e7c4; }
    .focus b { background: var(--caramel); color: #fff; border-radius: 99px; padding: 0 6px; margin-left: 2px; font-size: 0.75rem; }

    .filters { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 0 26px 10px 90px; animation: pop-in 0.18s; }
    .filters .hand { font-size: 1.25rem; color: var(--brown); }
    .filters select { width: auto; flex: 1; min-width: 120px; padding: 0.4rem 0.6rem; font-size: 0.85rem; }

    .scroller { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 30px 20px 90px; }
    .muted { color: var(--ink-soft); } .hand.muted { font-size: 1.5rem; text-align: center; margin-top: 40px; }

    /* ===== welcome ===== */
    .welcome { max-width: 480px; margin: 40px auto; text-align: center; animation: pop-in 0.3s; }
    .stickers { display: flex; justify-content: center; gap: 14px; margin-bottom: 8px; }
    .welcome h3 { font-size: 2rem; }
    .welcome p { color: var(--ink-soft); margin: 6px 0 14px; }
    .ideas { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; }
    .ideas button {
      background: #fff3c6; border: 0; padding: 0.35rem 0.9rem; font-size: 1.25rem; color: var(--brown-dark);
      box-shadow: 2px 4px 8px -3px rgba(74, 44, 26, 0.45); transition: transform 0.12s;
    }
    .ideas button:nth-child(odd) { transform: rotate(-1.5deg); } .ideas button:nth-child(even) { transform: rotate(1.2deg); }
    .ideas button:hover:not(:disabled) { transform: rotate(0) translateY(-3px); }

    /* ===== a question (handwritten, sits in the margin) and its answer (typeset) ===== */
    .entry { position: relative; animation: pop-in 0.2s ease-out; }
    .q { margin: 26px 0 8px; }
    .q p { margin: 0; font-size: 1.75rem; line-height: 1.25; color: var(--brown-dark); }
    .qm { position: absolute; left: -58px; top: 0; font-size: 2rem; color: var(--rust); line-height: 1.1; }
    .qt { background: linear-gradient(transparent 60%, rgba(246, 220, 122, 0.8) 60%); padding: 0 4px; box-decoration-break: clone; -webkit-box-decoration-break: clone; }

    .a { font-size: 1.02rem; line-height: 1.75; max-width: 70ch; }
    .a p { margin: 0 0 10px; }
    .a p.bullet { padding-left: 20px; position: relative; }
    .a p.bullet::before { content: '❧'; position: absolute; left: 0; color: var(--caramel); }
    .sup { background: none; border: 0; padding: 0 1px; color: var(--rust); font-weight: 700; font-size: 0.78rem; }
    button.sup:hover { text-decoration: underline; }
    button.sup.dead { color: var(--ink-soft); cursor: default; }

    .notes { list-style: none; margin: 14px 0 0; padding: 12px 0 0; border-top: 1px solid var(--line); display: grid; gap: 10px; counter-reset: none; }
    .notes li { display: flex; gap: 10px; font-size: 0.86rem; line-height: 1.5; color: var(--ink-soft); }
    .fnum { flex: none; width: 22px; height: 22px; margin-top: 1px; border-radius: 50%; background: var(--brown); color: #fff8e8; border: 0; font-weight: 700; font-size: 0.72rem; }
    .fnum:hover { background: var(--caramel); }
    .fsrc { background: none; border: 0; padding: 0; font-weight: 600; font-size: inherit; color: var(--brown-dark); text-decoration: underline dotted; text-underline-offset: 3px; text-align: left; }
    .fsrc:hover { color: var(--caramel); }
    q { display: block; font-style: italic; margin-top: 2px; quotes: '“' '”'; }

    .trace-toggle { display: block; margin-top: 10px; background: none; border: 0; padding: 0; color: var(--ink-soft); font-size: 0.78rem; text-decoration: underline; }
    .trace { margin-top: 8px; font-size: 0.82rem; }
    .trace h4 { font-size: 0.9rem; margin-bottom: 6px; }
    .chunk { border-left: 3px solid var(--caramel); padding: 4px 10px; margin-bottom: 6px; background: #fffaf0; }
    .chunk small { display: block; color: var(--ink-soft); font-weight: 600; }

    .cursor { animation: blink 1s step-start infinite; color: var(--brown); }
    @keyframes blink { 50% { opacity: 0; } }
    .dots i { display: inline-block; width: 7px; height: 7px; margin: 0 2px; border-radius: 50%; background: var(--caramel); animation: bounce 1s infinite; }
    .dots i:nth-child(2) { animation-delay: 0.15s; } .dots i:nth-child(3) { animation-delay: 0.3s; }
    @keyframes bounce { 0%, 60%, 100% { transform: translateY(0); } 30% { transform: translateY(-6px); } }

    /* ===== the question card at the bottom ===== */
    .err { margin: 0 30px 8px 90px; }
    .ask {
      position: relative; margin: 0 26px 18px 90px; display: flex; gap: 10px; align-items: flex-end;
      background: #fffdf5; border: 1.5px solid var(--line); border-radius: 12px; padding: 8px 8px 8px 14px;
      box-shadow: 0 6px 0 -3px rgba(74, 44, 26, 0.14);
    }
    .ask:focus-within { border-color: var(--caramel); }
    textarea { flex: 1; border: 0; background: transparent; resize: none; font: inherit; font-size: 1rem; color: var(--ink); outline: none; max-height: 140px; padding: 4px 0; }
    textarea::placeholder { color: #a88f76; }
    .count { position: absolute; right: 100px; top: -20px; font-size: 0.75rem; color: var(--ink-soft); }
    .backdrop { position: fixed; inset: 0; background: rgba(58, 36, 23, 0.4); z-index: 10; }

    @media (max-width: 860px) {
      .page { border-radius: 14px; }
      .page::before { left: 34px; } .holes { display: none; }
      .bar { padding: 14px 14px 8px 14px; } .menu { display: block; }
      .filters { padding: 0 14px 8px; }
      .scroller { padding: 4px 16px 16px 48px; }
      .qm { left: -36px; font-size: 1.7rem; } .q p { font-size: 1.5rem; }
      .err { margin: 0 14px 8px; } .ask { margin: 0 12px 12px; }
    }
  `],
})
export class ChatComponent implements OnDestroy {
  protected api = inject(ApiService);
  @ViewChild('scroller') scroller?: ElementRef<HTMLElement>;

  ideas = ['Summarize the main findings', 'What methods were used?', 'What are the limitations?'];
  today = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

  messages = signal<DisplayMessage[]>([]);
  streamingText = signal<string | null>(null);
  streamBlocks = computed(() => parseAnswer(this.streamingText() ?? ''));
  sending = signal(false);
  loadingHistory = signal(false);
  errorMsg = signal('');
  activeCitation = signal<Citation | null>(null);
  showFilters = signal(false);

  openTraceId = signal<string | null>(null);
  trace = signal<EvalTrace | null>(null);
  traceLoading = signal(false);

  question = '';
  author = '';
  year = '';
  topic = '';

  /** Which chat this component is currently showing. Stops the effect below from reloading what we already have. */
  private loadedId: string | null = null;
  private streamSub?: Subscription;

  title = computed(() => {
    const id = this.api.activeSessionId();
    return this.api.sessions().find((s) => s.id === id)?.title ?? 'A fresh page';
  });

  // Filter dropdowns are built from the papers on your shelf
  private distinct = (pick: (d: { author: string | null; year: number | null; topic: string | null }) => string | number | null) =>
    [...new Set(this.api.docs().filter((d) => d.status === 'ready').map(pick).filter((v) => v !== null && v !== ''))] as (string | number)[];
  authors = computed(() => this.distinct((d) => d.author) as string[]);
  years = computed(() => (this.distinct((d) => d.year) as number[]).sort((a, b) => b - a));
  topics = computed(() => this.distinct((d) => d.topic) as string[]);
  readyCount = computed(() => this.api.docs().filter((d) => d.status === 'ready').length);
  filterCount = () => [this.author, this.year, this.topic].filter(Boolean).length;

  constructor() {
    // When someone clicks a past chat (or "fresh page") in the sidebar, show it here.
    effect(() => {
      const id = this.api.activeSessionId();
      untracked(() => this.onActiveChanged(id));
    });
  }

  ngOnDestroy() {
    this.streamSub?.unsubscribe();
  }

  private onActiveChanged(id: string | null) {
    if (id === this.loadedId) return; // it's the chat we just created ourselves
    this.loadedId = id;

    // Stop anything still streaming for the previous chat and wipe the page
    this.streamSub?.unsubscribe();
    this.sending.set(false);
    this.streamingText.set(null);
    this.messages.set([]);
    this.errorMsg.set('');
    this.openTraceId.set(null);
    this.activeCitation.set(null);
    if (id === null) {
      this.loadingHistory.set(false);
      return;
    }

    this.loadingHistory.set(true);
    this.api.getHistory(id).subscribe({
      next: (msgs: HistoryMessage[]) => {
        if (this.loadedId !== id) return; // user already clicked something else
        this.messages.set(msgs.map((m) => ({ id: m.id, role: m.role, content: m.content, citations: m.citations, blocks: parseAnswer(m.content) })));
        this.loadingHistory.set(false);
        this.scrollSoon();
      },
      error: (err) => {
        if (this.loadedId !== id) return;
        this.loadingHistory.set(false);
        this.errorMsg.set(apiError(err));
      },
    });
  }

  onEnter(event: KeyboardEvent) {
    if (event.shiftKey) return; // Shift+Enter = new line
    event.preventDefault();
    this.send();
  }

  openShelf() {
    this.api.railTab.set('shelf');
    this.api.railOpen.set(true);
  }

  send(text?: string) {
    const q = (text ?? this.question).trim();
    if (!q || this.sending()) return;
    if (q.length > MAX_QUESTION) return this.errorMsg.set(`Questions can be up to ${MAX_QUESTION} characters.`);

    this.messages.update((m) => [...m, { role: 'user', content: q, citations: [], blocks: [] }]);
    this.question = '';
    this.errorMsg.set('');
    this.sending.set(true);
    this.streamingText.set('');
    this.scrollSoon();

    const existing = this.api.activeSessionId();
    if (existing) return this.stream(existing, q);

    // First question on a fresh page: only now do we create the chat (so empty chats never pile up)
    this.streamSub = this.api.createSession().subscribe({
      next: (res) => {
        this.loadedId = res.session_id; // set BEFORE publishing, so the effect doesn't reload the page
        this.api.activeSessionId.set(res.session_id);
        this.stream(res.session_id, q);
      },
      error: (err) => this.fail(apiError(err), q),
    });
  }

  private stream(sessionId: string, q: string) {
    let answer = '';
    let citations: Citation[] = [];
    let messageId: string | undefined;

    this.streamSub = this.api
      .ask(sessionId, q, {
        author: this.author || undefined,
        year: this.year ? Number(this.year) : undefined,
        topic: this.topic || undefined,
      })
      .subscribe({
        next: (event) => {
          if (event.type === 'token') {
            answer += event.token;
            this.streamingText.set(answer);
            this.scrollSoon();
          } else {
            citations = event.citations;
            messageId = event.messageId ?? undefined;
          }
        },
        error: (err: Error) => this.fail(err.message || 'Something went wrong. Please try again.', q),
        complete: () => {
          this.messages.update((m) => [
            ...m,
            { id: messageId, role: 'assistant', content: answer, citations, blocks: parseAnswer(answer) },
          ]);
          this.streamingText.set(null);
          this.sending.set(false);
          this.api.refreshSessions(); // the new chat appears in the sidebar
          this.scrollSoon();
        },
      });
  }

  /** Something went wrong: take the question back out of the page and put it in the box so nothing is lost. */
  private fail(message: string, q: string) {
    this.messages.update((m) => m.slice(0, -1));
    this.question = q;
    this.sending.set(false);
    this.streamingText.set(null);
    this.errorMsg.set(message);
  }

  has(m: DisplayMessage, marker: number): boolean {
    return m.citations.some((c) => c.marker === marker);
  }

  openMarker(m: DisplayMessage, marker: number) {
    this.activeCitation.set(m.citations.find((c) => c.marker === marker) ?? null);
  }

  toggleTrace(m: DisplayMessage) {
    if (!m.id) return;
    if (this.openTraceId() === m.id) {
      this.openTraceId.set(null);
      return;
    }
    this.openTraceId.set(m.id);
    this.trace.set(null);
    this.traceLoading.set(true);
    this.api.getTrace(m.id).subscribe({
      next: (t) => { this.trace.set(t); this.traceLoading.set(false); },
      error: () => this.traceLoading.set(false),
    });
  }

  private scrollSoon() {
    setTimeout(() => {
      const el = this.scroller?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    }, 0);
  }
}
