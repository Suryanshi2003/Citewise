/**
 * All calls to the backend for documents, chat and the retrieval trace.
 * (Login calls live in auth.service.ts.)
 */
import { Injectable, effect, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { ChatSummary, Citation, DocumentMeta, EvalTrace, HistoryMessage } from '../models/types';
import { AuthService, apiError, getToken } from './auth.service';

export type StreamEvent =
  | { type: 'token'; token: string }
  | { type: 'done'; citations: Citation[]; messageId: string | null };

export interface AskFilters {
  author?: string;
  year?: number;
  topic?: string;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  private base = environment.apiBaseUrl;

  /** The logged-in user's documents. Shared so the library and the chat filters stay in sync. */
  readonly docs = signal<DocumentMeta[]>([]);

  /** Past chats shown in the sidebar, and which one is open (null = a fresh blank page). */
  readonly sessions = signal<ChatSummary[]>([]);
  readonly activeSessionId = signal<string | null>(null);

  /** Small bits of screen state that several components share. */
  readonly railTab = signal<'chats' | 'shelf'>('chats');
  readonly railOpen = signal(false); // the sidebar drawer on phones

  constructor() {
    // Privacy: when someone logs out, forget everything we loaded for them, so the next
    // person who logs in on this browser can never glimpse the previous person's data.
    effect(
      () => {
        if (!this.auth.user()) this.reset();
      },
      { allowSignalWrites: true },
    );
  }

  private reset() {
    this.docs.set([]);
    this.sessions.set([]);
    this.activeSessionId.set(null);
    this.railTab.set('chats');
    this.railOpen.set(false);
  }

  // ---------- Documents ----------

  refreshDocs() {
    this.http.get<DocumentMeta[]>(`${this.base}/documents`).subscribe({
      next: (docs) => this.docs.set(docs),
    });
  }

  upload(file: File, author?: string, year?: number, topic?: string) {
    const form = new FormData();
    form.append('file', file);
    if (author) form.append('author', author);
    if (year) form.append('year', String(year));
    if (topic) form.append('topic', topic);
    return this.http.post<{ id: string; filename: string; status: string }>(`${this.base}/documents/upload`, form);
  }

  deleteDoc(docId: string) {
    return this.http.delete<{ deleted: string }>(`${this.base}/documents/${docId}`);
  }

  // ---------- Chat ----------

  createSession() {
    return this.http.post<{ session_id: string }>(`${this.base}/chat/session`, {});
  }

  refreshSessions() {
    this.http.get<ChatSummary[]>(`${this.base}/chat/sessions`).subscribe({
      next: (s) => this.sessions.set(s),
    });
  }

  getHistory(sessionId: string) {
    return this.http.get<HistoryMessage[]>(`${this.base}/chat/${sessionId}/history`);
  }

  deleteSession(sessionId: string) {
    return this.http.delete<{ deleted: string }>(`${this.base}/chat/${sessionId}`);
  }

  getTrace(messageId: string) {
    return this.http.get<EvalTrace>(`${this.base}/eval/${messageId}`);
  }

  /**
   * The backend streams Server-Sent Events over a POST response, which the
   * browser's built-in EventSource can't do (it only supports GET). So we read
   * the fetch stream ourselves and parse the "data: {...}" lines by hand.
   * Errors (including the backend's friendly "AI service had a problem")
   * arrive through the Observable's error channel as an Error with a readable message.
   */
  ask(sessionId: string, question: string, filters: AskFilters = {}): Observable<StreamEvent> {
    return new Observable<StreamEvent>((subscriber) => {
      const controller = new AbortController();

      fetch(`${this.base}/chat/${sessionId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken() ?? ''}`,
        },
        body: JSON.stringify({ question, ...filters }),
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok || !response.body) {
            let message = `Request failed (${response.status})`;
            try {
              message = apiError({ status: response.status, error: await response.json() });
            } catch {
              /* response had no JSON body */
            }
            if (response.status === 401) this.auth.logout();
            subscriber.error(new Error(message));
            return;
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const events = buffer.split('\n\n');
            buffer = events.pop() ?? '';

            for (const line of events) {
              if (!line.startsWith('data: ')) continue;
              const payload = JSON.parse(line.slice(6));
              if (payload.error) {
                subscriber.error(new Error(payload.error));
                return;
              } else if (payload.done) {
                subscriber.next({
                  type: 'done',
                  citations: payload.citations ?? [],
                  messageId: payload.message_id ?? null,
                });
              } else if (payload.token !== undefined) {
                subscriber.next({ type: 'token', token: payload.token });
              }
            }
          }
          subscriber.complete();
        })
        .catch((err) => {
          if (err?.name === 'AbortError') return;
          subscriber.error(new Error("Can't reach the server. Please try again."));
        });

      return () => controller.abort();
    });
  }
}
