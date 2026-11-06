import { Component, EventEmitter, OnInit, Output, inject } from '@angular/core';
import { ApiService } from './services/api.service';
import { apiError } from './services/auth.service';
import { ChatSummary } from './models/types';

/** "Notebooks": the list of this person's previous chats, shown in the dark side rail. */
@Component({
  selector: 'app-history',
  standalone: true,
  template: `
    <button class="new" (click)="newChat()">
      <span class="plus">＋</span> Start a fresh page
    </button>

    @if (error) { <p class="err">{{ error }}</p> }

    <ul>
      @for (s of api.sessions(); track s.id) {
        <li [class.active]="s.id === api.activeSessionId()">
          <button class="open" (click)="open(s.id)" [title]="s.title">
            <span class="t">{{ s.title }}</span>
            <span class="d">{{ when(s.updated_at) }}</span>
          </button>
          <button class="del" (click)="remove(s)" aria-label="Delete this chat" title="Delete this chat">✕</button>
        </li>
      } @empty {
        <li class="empty">
          <span class="hand">Nothing written yet.</span>
          Ask your first question and it will be saved here, so you can come back to it.
        </li>
      }
    </ul>
  `,
  styles: [`
    :host { display: block; }
    .new {
      width: 100%; text-align: left; padding: 0.7rem 0.9rem; margin-bottom: 14px; border-radius: 10px;
      background: rgba(201, 162, 77, 0.14); color: #f6dc9a; border: 1.5px dashed rgba(201, 162, 77, 0.65);
      font-weight: 600; font-size: 0.95rem; transition: background 0.15s;
    }
    .new:hover { background: rgba(201, 162, 77, 0.26); }
    .plus { display: inline-block; margin-right: 6px; }

    ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
    li { display: flex; align-items: stretch; border-radius: 9px; position: relative; }
    li:hover { background: rgba(255, 240, 210, 0.07); }
    li.active { background: rgba(255, 240, 210, 0.13); }
    li.active::before { content: ''; position: absolute; left: 0; top: 8px; bottom: 8px; width: 3px; border-radius: 3px; background: #e0b252; }

    .open { flex: 1; min-width: 0; text-align: left; background: none; border: 0; color: #f3e5cb; padding: 9px 6px 9px 14px; display: grid; gap: 1px; }
    .t { font-size: 0.9rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .d { font-size: 0.72rem; color: #b79b78; }
    .del { background: none; border: 0; color: #a98d6c; padding: 0 10px; font-size: 0.8rem; opacity: 0; transition: opacity 0.15s; }
    li:hover .del, li.active .del, .del:focus-visible { opacity: 1; }
    .del:hover { color: #ff9d85; }
    @media (hover: none) { .del { opacity: 0.7; } }

    .empty { display: block; color: #bfa684; font-size: 0.86rem; padding: 10px 6px; }
    .empty:hover { background: none; }
    .empty .hand { display: block; font-size: 1.35rem; color: #e0b252; }
    .err { color: #ffb4a0; font-size: 0.85rem; }
  `],
})
export class HistoryComponent implements OnInit {
  protected api = inject(ApiService);
  @Output() picked = new EventEmitter<void>();
  error = '';

  ngOnInit() {
    this.api.refreshSessions();
  }

  newChat() {
    this.api.activeSessionId.set(null);
    this.picked.emit();
  }

  open(id: string) {
    this.api.activeSessionId.set(id);
    this.picked.emit();
  }

  remove(s: ChatSummary) {
    if (!confirm(`Delete the chat "${s.title}"? This can't be undone.`)) return;
    this.api.deleteSession(s.id).subscribe({
      next: () => {
        if (this.api.activeSessionId() === s.id) this.api.activeSessionId.set(null);
        this.api.refreshSessions();
      },
      error: (err) => (this.error = apiError(err)),
    });
  }

  /** "5 min ago", "Yesterday", "3 Nov" ... */
  when(iso: string): string {
    const then = new Date(iso);
    const mins = Math.round((Date.now() - then.getTime()) / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours} h ago`;
    const days = Math.round(hours / 24);
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    return then.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }
}
