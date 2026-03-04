// ═══════════════════════════════════════════
// SVG Mockup — все типы изделий
// Designer SVGs + fallback inline для остальных
// ═══════════════════════════════════════════
import { findColorEntry } from '../data';

// Designer SVGs (raw import via Vite)
import tshirtSVG from '../assets/garments/tshirt.svg?raw';
import longSVG from '../assets/garments/longsleeve.svg?raw';
import poloSVG from '../assets/garments/polo.svg?raw';
import sweatSVG from '../assets/garments/sweatshirt.svg?raw';
import hoodieSVG from '../assets/garments/hoodie.svg?raw';
import shopperSVG from '../assets/garments/shopper.svg?raw';

// Map designer SVG to mockup type keys
const DESIGNER_SVGS = {
  tee: tshirtSVG,
  longsleeve: longSVG,
  polo: poloSVG,
  sweat: sweatSVG,
  hoodie: hoodieSVG,
  'zip-hoodie': hoodieSVG,
  shopper: shopperSVG,
};

function shade(hex, amt) {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, Math.max(0, (n >> 16) + amt));
  const g = Math.min(255, Math.max(0, ((n >> 8) & 0xff) + amt));
  const b = Math.min(255, Math.max(0, (n & 0xff) + amt));
  return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
}

// Recolor designer SVG: replace gray fill with user color, black stroke with darker shade
function recolorSVG(svg, color, strokeColor) {
  return svg
    .replace(/fill="#d9d9d9"/g, `fill="${color}"`)
    .replace(/fill="rgb\(85\.098267%, ?85\.098267%, ?85\.098267%\)"/g, `fill="${color}"`)
    .replace(/stroke="#000"/g, `stroke="${strokeColor}"`)
    .replace(/stroke="rgb\(0%, ?0%, ?0%\)"/g, `stroke="${strokeColor}"`);
}

export function getGarmentSVG(type, colorCode) {
  const colorEntry = findColorEntry(colorCode);
  const c = colorEntry ? colorEntry.hex : '#ccc';
  const str = shade(c, -55);

  // Use designer SVG if available
  const designerSVG = DESIGNER_SVGS[type];
  if (designerSVG) {
    return recolorSVG(designerSVG, c, str);
  }

  // Fallback: inline SVGs for types without designer mockups
  const mid = shade(c, 18);
  const dk = shade(c, -28);

  const svgs = {
    'half-zip': `<svg viewBox="0 0 220 255" fill="none"><path d="M58 48 L16 72 L34 92 L30 208 L190 208 L186 92 L204 72 L162 48 L142 36 Q110 54 78 36Z" fill="${c}" stroke="${str}" stroke-width="1.5"/><path d="M30 94 L34 208 L60 208 L58 102Z" fill="${dk}" opacity=".25"/><path d="M186 94 L190 208 L160 208 L162 102Z" fill="${dk}" opacity=".25"/><path d="M78 36 Q110 54 142 36 L142 18 Q128 10 110 8 Q92 10 78 18Z" fill="${mid}" stroke="${str}" stroke-width="1.3"/><line x1="110" y1="10" x2="110" y2="68" stroke="${str}" stroke-width="1.3"/><path d="M58 48 L16 72 L34 92 L62 70Z" fill="${mid}" stroke="${str}" stroke-width="1.2"/><path d="M162 48 L204 72 L186 92 L158 70Z" fill="${mid}" stroke="${str}" stroke-width="1.2"/></svg>`,
    tank: `<svg viewBox="0 0 220 250" fill="none"><path d="M56 36 L32 60 L50 76 L46 206 L174 206 L170 76 L188 60 L164 36 L140 20 Q110 36 80 20Z" fill="${c}" stroke="${str}" stroke-width="1.5"/><path d="M46 78 L50 206 L72 206 L70 86Z" fill="${dk}" opacity=".25"/><path d="M170 78 L174 206 L148 206 L150 86Z" fill="${dk}" opacity=".25"/><path d="M80 20 Q110 36 140 20 Q130 34 110 36 Q90 34 80 20Z" fill="${mid}" stroke="${str}" stroke-width="1"/></svg>`,
    pants: `<svg viewBox="0 0 220 290" fill="none"><rect x="30" y="14" width="160" height="22" rx="2" fill="${mid}" stroke="${str}" stroke-width="1.4"/><path d="M30 34 L20 274 L100 274 L110 148 Z" fill="${c}" stroke="${str}" stroke-width="1.4" stroke-linejoin="round"/><path d="M190 34 L200 274 L120 274 L110 148 Z" fill="${c}" stroke="${str}" stroke-width="1.4" stroke-linejoin="round"/><path d="M30 34 L26 86 L54 86 L56 40Z" fill="${dk}" opacity=".2"/><path d="M190 34 L194 86 L166 86 L164 40Z" fill="${dk}" opacity=".2"/><line x1="110" y1="36" x2="110" y2="148" stroke="${str}" stroke-width="1.1" stroke-dasharray="3 2" opacity=".45"/></svg>`,
    shorts: `<svg viewBox="0 0 220 200" fill="none"><rect x="30" y="14" width="160" height="22" rx="2" fill="${mid}" stroke="${str}" stroke-width="1.4"/><path d="M30 34 L24 164 L106 164 L110 98Z" fill="${c}" stroke="${str}" stroke-width="1.4" stroke-linejoin="round"/><path d="M190 34 L196 164 L114 164 L110 98Z" fill="${c}" stroke="${str}" stroke-width="1.4" stroke-linejoin="round"/><path d="M30 34 L26 70 L54 70 L54 40Z" fill="${dk}" opacity=".2"/><path d="M190 34 L194 70 L166 70 L166 40Z" fill="${dk}" opacity=".2"/></svg>`,
  };

  return svgs[type] || '';
}
