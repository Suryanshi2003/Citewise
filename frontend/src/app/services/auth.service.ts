/**
 * Everything about being logged in, in one file.
 *
 *  - AuthService:     login / register / logout + "who is logged in" (user signal)
 *  - authInterceptor: automatically adds "Authorization: Bearer <token>" to every
 *                     request we send to our backend (so no other file has to remember)
 *  - getToken():      reads the saved token (used by the chat stream and PDF viewer too)
 *
 * The token is kept in the browser's localStorage so you stay logged in after a refresh.
 */
import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpInterceptorFn } from '@angular/common/http';
import { catchError, tap, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthConfig, AuthResponse, AuthUser } from '../models/types';

const TOKEN_KEY = 'citewise_token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function saveToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage blocked (private mode) — login just won't survive a refresh */
  }
}

/** Turns a failed backend call into a short message a person can read. */
export function apiError(err: any): string {
  if (err?.status === 0) return "Can't reach the server. Please check your connection and try again.";
  const detail = err?.error?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail) && detail[0]?.msg) return String(detail[0].msg).replace(/^Value error, /, '');
  return err?.message ?? 'Something went wrong. Please try again.';
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private base = `${environment.apiBaseUrl}/auth`;

  readonly user = signal<AuthUser | null>(null);
  /** false until we've checked whether a saved token is still valid */
  readonly ready = signal(false);

  /** Called once when the app opens: is the saved token still good? */
  restoreSession() {
    if (!getToken()) {
      this.ready.set(true);
      return;
    }
    this.http.get<AuthUser>(`${this.base}/me`).subscribe({
      next: (u) => {
        this.user.set(u);
        this.ready.set(true);
      },
      error: () => {
        saveToken(null);
        this.ready.set(true);
      },
    });
  }

  login(email: string, password: string) {
    return this.http
      .post<AuthResponse>(`${this.base}/login`, { email, password })
      .pipe(tap((res) => this.startSession(res)));
  }

  register(email: string, password: string) {
    return this.http
      .post<AuthResponse>(`${this.base}/register`, { email, password })
      .pipe(tap((res) => this.startSession(res)));
  }

  /** What the login screen should offer (Google button? sign-ups open?) */
  loadConfig() {
    return this.http.get<AuthConfig>(`${this.base}/config`);
  }

  /** `credential` is the signed ID token Google's button gives us; the backend verifies it. */
  google(credential: string) {
    return this.http
      .post<AuthResponse>(`${this.base}/google`, { credential })
      .pipe(tap((res) => this.startSession(res)));
  }

  logout() {
    saveToken(null);
    this.user.set(null);
  }

  private startSession(res: AuthResponse) {
    saveToken(res.access_token);
    this.user.set(res.user);
  }
}

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const token = getToken();

  if (token && req.url.startsWith(environment.apiBaseUrl)) {
    req = req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
  }

  return next(req).pipe(
    catchError((err) => {
      // Token expired or invalid -> send the user back to the login screen
      const isLoginCall = ['/auth/login', '/auth/register', '/auth/google'].some((p) => req.url.includes(p));
      if (err.status === 401 && !isLoginCall) auth.logout();
      return throwError(() => err);
    }),
  );
};
