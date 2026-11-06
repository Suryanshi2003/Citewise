import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from './services/api.service';
import { apiError } from './services/auth.service';
import { DocumentMeta } from './models/types';

const MAX_MB = 15; // keep in sync with MAX_UPLOAD_MB on the backend
const SPINE_COLORS = ['#7b4a2b', '#5f7f52', '#a9553e', '#3f5b73', '#8c6a2f', '#6b4a63', '#4d6b6b'];

/** "Bookshelf": every uploaded paper is a book spine on a shelf. Lives in the dark side rail. */
@Component({
  selector: 'app-library',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="drop" [class.dragging]="dragging()"
         (dragover)="onDragOver($event)" (dragleave)="dragging.set(false)" (drop)="onDrop($event)">
      <p class="hand">Drop a paper here</p>
      <p class="hint">PDF or DOCX · up to {{ maxMb }} MB</p>
      <input type="file" accept=".pdf,.docx" hidden #fileInput (change)="onFileSelected($event)" />
      <button class="add" (click)="fileInput.click()">Choose file</button>
    </div>

    @if (selected(); as file) {
      <div class="meta">
        <p class="picked">📎 {{ file.name }}</p>
        <input class="input" [(ngModel)]="author" placeholder="Author (optional)" maxlength="100" />
        <div class="row">
          <input class="input" [(ngModel)]="year" type="number" placeholder="Year" min="1900" max="2100" />
          <input class="input" [(ngModel)]="topic" placeholder="Topic" maxlength="100" />
        </div>
        <div class="row">
          <button class="btn" (click)="submit()" [disabled]="uploading()">{{ uploading() ? 'Uploading…' : 'Put on shelf' }}</button>
          <button class="btn-ghost" (click)="cancel()" [disabled]="uploading()">Cancel</button>
        </div>
      </div>
    }

    @if (message()) { <p class="note">{{ message() }}</p> }
    @if (error()) { <p class="err">{{ error() }}</p> }

    <h3>Your shelf · {{ api.docs().length }} {{ api.docs().length === 1 ? 'paper' : 'papers' }}</h3>

    @if (api.docs().length) {
      <div class="shelf">
        @for (d of api.docs(); track d.id) {
          <button class="spine" [class.picked]="openId() === d.id" [class.processing]="d.status === 'processing'"
                  [class.failed]="d.status === 'failed'"
                  [style.background]="d.status === 'failed' ? '' : color(d.id)"
                  [style.height.px]="height(d.id)" [title]="d.filename" (click)="toggle(d.id)">
            <span>{{ d.filename.replace('.pdf', '').replace('.docx', '') }}</span>
          </button>
        }
      </div>

      @if (current(); as d) {
        <div class="detail">
          <p class="name">{{ d.filename }}</p>
          <p class="sub">{{ details(d) }}</p>
          <p class="status" [class]="d.status">
            {{ d.status === 'ready' ? '● Ready · ' + d.num_pages + ' pages'
              : d.status === 'processing' ? '● Reading this paper…'
              : '● Could not read it (scanned PDFs have no text)' }}
          </p>
          <button class="remove" (click)="remove(d)">Remove from shelf</button>
        </div>
      } @else {
        <p class="tip">Tap a spine to see its details.</p>
      }
    } @else {
      <p class="tip">The shelf is empty. Add your first paper above.</p>
    }
  `,
  styles: [`
    :host { display: block; }
    .drop {
      border: 2px dashed rgba(201, 162, 77, 0.6); border-radius: 12px; padding: 14px 10px; text-align: center;
      background: rgba(255, 240, 210, 0.05); transition: background 0.15s, border-color 0.15s;
    }
    .drop.dragging { background: rgba(201, 162, 77, 0.22); border-color: #e0b252; }
    .drop .hand { font-size: 1.5rem; margin: 0; color: #f6dc9a; }
    .hint { margin: 0 0 10px; font-size: 0.78rem; color: #b79b78; }
    .add { background: #c47f3c; color: #fff8e8; border: 0; border-radius: 9px; padding: 0.5rem 1rem; font-weight: 600; box-shadow: 0 3px 0 #8a5522; }
    .add:hover { background: #d18b46; }

    .meta { display: grid; gap: 8px; margin-top: 12px; background: var(--card); border-radius: 12px; padding: 12px; animation: pop-in 0.2s; }
    .picked { margin: 0; font-weight: 600; font-size: 0.88rem; word-break: break-all; color: var(--ink); }
    .row { display: flex; gap: 8px; }
    .row .input { min-width: 0; }
    .meta .btn { padding: 0.5rem 0.9rem; }
    .note { margin: 10px 0 0; font-size: 0.85rem; color: #b9dca6; }
    .err { margin: 10px 0 0; font-size: 0.85rem; color: #ffb4a0; }

    h3 { font-family: 'Lora', serif; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.1em; color: #b79b78; margin: 20px 0 6px; }

    /* The shelf: a grid of rows. Each row is 142px tall and draws a wooden board in its bottom 12px. */
    .shelf {
      display: grid; grid-template-columns: repeat(auto-fill, 32px); grid-auto-rows: 142px; gap: 0 4px; align-items: end;
      padding: 14px 4px 0; border-radius: 6px; background-color: rgba(0, 0, 0, 0.18);
      background-image: repeating-linear-gradient(180deg, transparent 0 130px, #8a5a36 130px 136px, #4d2d19 136px 142px);
      background-origin: content-box; /* keep the boards lined up with the rows despite the top padding */
    }
    .spine {
      width: 32px; margin-bottom: 12px; border: 0; border-radius: 3px 3px 0 0; padding: 8px 0 6px;
      color: #fff6e3; font-size: 0.72rem; font-weight: 600; letter-spacing: 0.02em;
      writing-mode: vertical-rl; text-align: left; overflow: hidden;
      box-shadow: inset 3px 0 0 rgba(255, 255, 255, 0.18), inset -3px 0 0 rgba(0, 0, 0, 0.22);
      border-top: 5px solid rgba(246, 220, 122, 0.7);
      transition: transform 0.15s;
    }
    .spine span { display: block; max-height: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .spine:hover { transform: translateY(-5px); }
    .spine.picked { transform: translateY(-9px); outline: 2px solid #f6dc9a; }
    .spine.processing { animation: pulse 1.3s ease-in-out infinite; }
    .spine.failed { background: repeating-linear-gradient(45deg, #6d4a42 0 6px, #55352f 6px 12px); color: #e9c1b6; }
    @keyframes pulse { 50% { opacity: 0.45; } }

    .detail { margin-top: 12px; background: var(--card); border-radius: 12px; padding: 12px 14px; animation: pop-in 0.18s; }
    .name { margin: 0; font-weight: 600; font-size: 0.92rem; word-break: break-word; color: var(--ink); }
    .sub { margin: 2px 0 6px; font-size: 0.8rem; color: var(--ink-soft); }
    .status { margin: 0 0 8px; font-size: 0.78rem; font-weight: 700; }
    .status.ready { color: var(--sage); } .status.processing { color: #9a7200; } .status.failed { color: var(--rust); }
    .remove { background: none; border: 0; padding: 0; color: var(--rust); font-size: 0.8rem; text-decoration: underline; }
    .tip { color: #b79b78; font-size: 0.84rem; margin: 8px 0 0; }
  `],
})
export class LibraryComponent implements OnInit, OnDestroy {
  protected api = inject(ApiService);
  protected maxMb = MAX_MB;

  dragging = signal(false);
  selected = signal<File | null>(null);
  uploading = signal(false);
  message = signal('');
  error = signal('');
  openId = signal<string | null>(null);

  author = '';
  year: number | null = null;
  topic = '';

  private timer?: ReturnType<typeof setInterval>;

  ngOnInit() {
    this.api.refreshDocs();
    // While any paper is still being read, check again every 3 seconds.
    this.timer = setInterval(() => {
      if (this.api.docs().some((d) => d.status === 'processing')) this.api.refreshDocs();
    }, 3000);
  }

  ngOnDestroy() {
    clearInterval(this.timer);
  }

  // ----- spine look: the same paper always gets the same colour and height -----
  private hash(id: string): number {
    let h = 0;
    for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return h;
  }
  color(id: string): string { return SPINE_COLORS[this.hash(id) % SPINE_COLORS.length]; }
  height(id: string): number { return 92 + (this.hash(id) % 5) * 9; } // 92..128px

  current(): DocumentMeta | undefined {
    return this.api.docs().find((d) => d.id === this.openId());
  }
  toggle(id: string) { this.openId.set(this.openId() === id ? null : id); }

  details(d: { author: string | null; year: number | null; topic: string | null }): string {
    return [d.author, d.year, d.topic].filter((v) => v !== null && v !== '').join(' · ') || 'No details added';
  }

  // ----- uploading -----
  onDragOver(event: DragEvent) { event.preventDefault(); this.dragging.set(true); }

  onDrop(event: DragEvent) {
    event.preventDefault();
    this.dragging.set(false);
    this.pick(event.dataTransfer?.files?.[0]);
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    this.pick(input.files?.[0]);
    input.value = ''; // lets you pick the same file again later
  }

  private pick(file?: File) {
    this.message.set('');
    this.error.set('');
    if (!file) return;
    if (!/\.(pdf|docx)$/i.test(file.name)) return this.error.set('Only PDF and DOCX files are supported.');
    if (file.size > MAX_MB * 1024 * 1024) return this.error.set(`That file is too big (max ${MAX_MB} MB).`);
    this.selected.set(file);
  }

  cancel() {
    this.selected.set(null);
    this.author = '';
    this.year = null;
    this.topic = '';
  }

  submit() {
    const file = this.selected();
    if (!file || this.uploading()) return;
    this.uploading.set(true);
    this.error.set('');

    this.api
      .upload(file, this.author.trim() || undefined, this.year ?? undefined, this.topic.trim() || undefined)
      .subscribe({
        next: (res) => {
          this.uploading.set(false);
          this.message.set('On the shelf! Reading it now — it will be ready in a moment.');
          this.cancel();
          this.api.refreshDocs();
          this.openId.set(res.id);
        },
        error: (err) => {
          this.uploading.set(false);
          this.error.set(apiError(err));
        },
      });
  }

  remove(d: DocumentMeta) {
    if (!confirm(`Remove "${d.filename}" from your shelf?`)) return;
    this.api.deleteDoc(d.id).subscribe({
      next: () => {
        this.openId.set(null);
        this.api.refreshDocs();
      },
      error: (err) => this.error.set(apiError(err)),
    });
  }
}
