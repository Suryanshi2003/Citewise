/**
 * Hand-drawn style "stickers" (inline SVG, no image files needed).
 * Use anywhere:  <app-sticker kind="coffee" [size]="72" [tilt]="-8" />
 * kinds: coffee | magnifier | flask | papers | pencil | bookmark
 */
import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-sticker',
  standalone: true,
  template: `
    <svg [attr.width]="size" [attr.height]="size" viewBox="0 0 64 64" aria-hidden="true"
         [style.transform]="'rotate(' + tilt + 'deg)'">
      @switch (kind) {
        @case ('coffee') {
          <path d="M22 15c-3-3 3-5 0-9M32 15c-3-3 3-5 0-9" stroke="#c47f3c" stroke-width="3" fill="none" stroke-linecap="round"/>
          <path d="M46 29h3a6 6 0 0 1 0 12h-4" fill="none" stroke="#4a2c1a" stroke-width="3.5" stroke-linecap="round"/>
          <path d="M10 24h34v13a14 14 0 0 1-14 14h-6a14 14 0 0 1-14-14z" fill="#fcf7ea" stroke="#4a2c1a" stroke-width="3.5" stroke-linejoin="round"/>
          <ellipse cx="27" cy="24" rx="17" ry="3.6" fill="#7b4a2b" stroke="#4a2c1a" stroke-width="3"/>
          <path d="M6 57h42" stroke="#4a2c1a" stroke-width="3.5" stroke-linecap="round"/>
        }
        @case ('magnifier') {
          <path d="M38 38l15 15" stroke="#4a2c1a" stroke-width="11" stroke-linecap="round"/>
          <path d="M38 38l15 15" stroke="#7b4a2b" stroke-width="6" stroke-linecap="round"/>
          <circle cx="26" cy="26" r="17" fill="#fcf7ea" stroke="#4a2c1a" stroke-width="4"/>
          <path d="M16 25a10 10 0 0 1 8-9" stroke="#c47f3c" stroke-width="3.5" fill="none" stroke-linecap="round"/>
        }
        @case ('flask') {
          <path d="M26 6h12M28 6v16L11 50a5 5 0 0 0 4.4 7.5h33.2A5 5 0 0 0 53 50L36 22V6" fill="#fcf7ea" stroke="#4a2c1a" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"/>
          <path d="M18 42h28l6 9a3 3 0 0 1-2.5 4.5h-35A3 3 0 0 1 12 51z" fill="#c47f3c"/>
          <circle cx="29" cy="48" r="2.2" fill="#fcf7ea"/><circle cx="37" cy="45" r="1.6" fill="#fcf7ea"/>
          <path d="M26 6h12" stroke="#4a2c1a" stroke-width="3.5" stroke-linecap="round"/>
        }
        @case ('papers') {
          <rect x="11" y="8" width="34" height="44" rx="3" fill="#e8d9bd" stroke="#4a2c1a" stroke-width="3.5" transform="rotate(-9 28 30)"/>
          <rect x="18" y="11" width="34" height="46" rx="3" fill="#fcf7ea" stroke="#4a2c1a" stroke-width="3.5"/>
          <path d="M25 23h20M25 31h20M25 39h12" stroke="#7b4a2b" stroke-width="3" stroke-linecap="round"/>
          <circle cx="44" cy="46" r="4" fill="#b0503a"/>
        }
        @case ('pencil') {
          <g transform="rotate(45 32 32)">
            <rect x="25" y="4" width="14" height="9" rx="2" fill="#b0503a" stroke="#4a2c1a" stroke-width="3"/>
            <rect x="25" y="13" width="14" height="31" fill="#e0a04a" stroke="#4a2c1a" stroke-width="3"/>
            <path d="M25 44h14l-7 15z" fill="#f3e8d3" stroke="#4a2c1a" stroke-width="3" stroke-linejoin="round"/>
            <path d="M29.5 54h5l-2.5 5z" fill="#4a2c1a"/>
          </g>
        }
        @case ('bookmark') {
          <path d="M16 5h32v54L32 46 16 59z" fill="#b0503a" stroke="#4a2c1a" stroke-width="3.5" stroke-linejoin="round"/>
          <path d="M32 15l3 6.5 7 .8-5.2 4.8 1.5 7-6.3-3.6-6.3 3.6 1.5-7-5.2-4.8 7-.8z" fill="#f6dc7a" stroke="#4a2c1a" stroke-width="1.8" stroke-linejoin="round"/>
        }
      }
    </svg>
  `,
  styles: [`
    :host { display: inline-block; line-height: 0; }
    svg {
      /* white "sticker border" + soft shadow */
      filter:
        drop-shadow(2px 0 0 #fffdf6) drop-shadow(-2px 0 0 #fffdf6)
        drop-shadow(0 2px 0 #fffdf6) drop-shadow(0 -2px 0 #fffdf6)
        drop-shadow(0 5px 6px rgba(74, 44, 26, 0.35));
    }
  `],
})
export class StickerComponent {
  @Input() kind: 'coffee' | 'magnifier' | 'flask' | 'papers' | 'pencil' | 'bookmark' = 'papers';
  @Input() size = 64;
  @Input() tilt = 0;
}
