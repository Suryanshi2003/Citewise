import { Component, ElementRef, EventEmitter, Input, OnChanges, Output, SimpleChanges, ViewChild } from '@angular/core';
import { environment } from '../environments/environment';
import { Citation } from './models/types';
import { getToken } from './services/auth.service';

/** Slide-in panel showing the cited page, with the cited sentence highlighted. */
@Component({
  selector: 'app-citation-viewer',
  standalone: true,
  template: `
    @if (citation) {
      <aside class="viewer">
        <header>
          <div>
            <h3>{{ citation.filename }}</h3>
            <p class="hand">page {{ citation.page_num }}</p>
          </div>
          <button class="close" (click)="closed.emit()" aria-label="Close">✕</button>
        </header>

        <p class="label">The sentence behind this answer</p>
        <blockquote>{{ citation.highlighted_sentence }}</blockquote>

        @if (isPdf) {
          <div class="canvas-wrap">
            <canvas #pdfCanvas></canvas>
            @if (loading) { <p class="hint">Opening the page…</p> }
            @if (loadError) { <p class="error-note">{{ loadError }}</p> }
          </div>
        } @else {
          <p class="hint">
            Word files can't be previewed here, and their page numbers are approximate
            (the text is split into ~3000-character "pages").
          </p>
        }
      </aside>
    }
  `,
  styles: [`
    .viewer {
      position: fixed; top: 0; right: 0; bottom: 0; width: min(540px, 100vw); z-index: 20;
      background: var(--card); border-left: 4px solid var(--brown); padding: 18px 20px 24px;
      overflow-y: auto; box-shadow: -18px 0 40px -18px rgba(74, 44, 26, 0.6);
      animation: slide 0.22s ease-out;
    }
    @keyframes slide { from { transform: translateX(40px); opacity: 0; } to { transform: none; opacity: 1; } }
    header { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
    h3 { font-size: 1.15rem; word-break: break-word; }
    header .hand { margin: 0; font-size: 1.4rem; color: var(--caramel); }
    .close { background: none; border: 0; font-size: 1.2rem; color: var(--ink-soft); padding: 4px 8px; border-radius: 8px; }
    .close:hover { background: var(--paper-dark); }
    .label { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--ink-soft); margin: 16px 0 6px; }
    blockquote {
      margin: 0 0 16px; padding: 10px 14px; font-style: italic; border-radius: 4px;
      background: linear-gradient(transparent 8%, var(--highlight) 8%, var(--highlight) 92%, transparent 92%);
      background-color: rgba(246, 220, 122, 0.25);
      border-left: 4px solid var(--caramel);
    }
    .canvas-wrap { border: 1px solid var(--line); border-radius: 8px; overflow: auto; background: #fff; }
    canvas { display: block; width: 100%; }
    .hint { font-size: 0.85rem; color: var(--ink-soft); padding: 4px 8px; }
  `],
})
export class CitationViewerComponent implements OnChanges {
  @Input() citation: Citation | null = null;
  @Output() closed = new EventEmitter<void>();
  @ViewChild('pdfCanvas') canvasRef?: ElementRef<HTMLCanvasElement>;

  loading = false;
  loadError = '';
  private renderId = 0; // lets us ignore a slow render if the user clicked another citation

  get isPdf(): boolean {
    return !!this.citation?.filename.toLowerCase().endsWith('.pdf');
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['citation'] && this.citation && this.isPdf) {
      // Wait a tick so the <canvas> exists after the template renders.
      setTimeout(() => this.renderPage(), 0);
    }
  }

  private async renderPage() {
    const citation = this.citation;
    if (!citation || !this.canvasRef) return;
    const myId = ++this.renderId;
    this.loading = true;
    this.loadError = '';

    try {
      const pdfjsLib = await import('pdfjs-dist');
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

      // The file endpoint is login-protected, so we send our token along.
      const pdf = await pdfjsLib.getDocument({
        url: `${environment.apiBaseUrl}/documents/${citation.doc_id}/file`,
        httpHeaders: { Authorization: `Bearer ${getToken() ?? ''}` },
      }).promise;
      const page = await pdf.getPage(citation.page_num);
      if (myId !== this.renderId) return;

      const viewport = page.getViewport({ scale: 1.4 });
      const canvas = this.canvasRef.nativeElement;
      const context = canvas.getContext('2d')!;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: context, viewport } as any).promise;

      // Best-effort highlight: paint over text pieces that belong to the cited sentence.
      const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
      const target = norm(citation.highlighted_sentence);
      const items = (await page.getTextContent()).items as any[];
      let matches = items.filter((i) => typeof i.str === 'string' && norm(i.str).length >= 4 && target.includes(norm(i.str)));
      if (matches.length === 0) {
        const start = target.slice(0, 20);
        matches = items.filter((i) => typeof i.str === 'string' && norm(i.str).includes(start));
      }

      context.fillStyle = 'rgba(255, 214, 0, 0.38)';
      for (const item of matches) {
        const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
        const h = item.height * viewport.scale;
        context.fillRect(tx[4], tx[5] - h, item.width * viewport.scale, h * 1.25);
      }
    } catch {
      this.loadError = 'Could not open this page preview. The source file may no longer be available.';
    } finally {
      if (myId === this.renderId) this.loading = false;
    }
  }
}
