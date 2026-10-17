/**
 * Санитайзер SVG — белый список (план вехи 5а, решение 10; проверка
 * безопасности M1, H1). Чистая функция на `DOMParser('image/svg+xml')`
 * и `XMLSerializer`, без разбора HTML-строкой.
 *
 * Где применяется: флэты (при сиде и повторно перед показом), логотипы в PDF
 * (что-то вырезано — PDF ставит растр и пометку), сцена PDF целиком (режим
 * `scene`). Логотип на холсте идёт `<img>` из Blob — там скрипты не исполняются,
 * но Blob всё равно собирается из очищенного текста (H2, задача 5).
 *
 * Правила:
 * - элементы — только пространства SVG и из белого списка; в режиме `scene`
 *   ещё `text`, `tspan` и `image` (только `data:image/(png|svg+xml);base64,`);
 * - атрибуты — по `localName` из белого списка; `on*` и `style` — прочь;
 *   `href` любого префикса — только `#id`; `url(` — только `url(#id)`;
 *   `xml:base` — прочь; объявления `xmlns:*` — только SVG и xlink;
 * - узлы — только элементы и текст (комментарии, CDATA, инструкции — прочь);
 * - `<!DOCTYPE`/`<!ENTITY`, битый XML, корень не `<svg>` из пространства SVG,
 *   больше 5 МБ — отказ целиком;
 * - `<use>` — не больше 500, без цепочек (цель — не `<use>` и не содержит его),
 *   на существующий id.
 */
import { MAX_SVG_BYTES } from '../limits';

export type SanitizeMode = 'asset' | 'scene';

export type SanitizeResult =
  | { ok: true; svg: string; removed: string[] }
  | { ok: false; error: string };

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const MAX_USE = 500;

const ELEMENTS = new Set([
  'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'defs', 'clipPath', 'mask', 'linearGradient', 'radialGradient', 'stop', 'title', 'desc', 'use',
]);
const SCENE_ELEMENTS = new Set(['text', 'tspan', 'image']);

const ATTRS = new Set([
  'id', 'class', 'd', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'fx', 'fy', 'fr',
  'width', 'height', 'viewBox', 'preserveAspectRatio', 'points', 'transform', 'version', 'baseProfile',
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap',
  'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'opacity', 'color',
  'clip-path', 'clip-rule', 'clipPathUnits', 'mask', 'maskUnits', 'maskContentUnits',
  'gradientUnits', 'gradientTransform', 'spreadMethod', 'offset', 'stop-color', 'stop-opacity',
  'display', 'visibility', 'overflow', 'shape-rendering', 'vector-effect', 'paint-order',
  'enable-background', 'mix-blend-mode', 'isolation',
  'font-size', 'font-family', 'font-weight', 'font-style', 'text-anchor', 'letter-spacing',
  'dominant-baseline', 'href',
]);

const LOCAL_REF = /^#[A-Za-z_][\w.-]*$/;
const SCENE_IMAGE = /^data:image\/(png|svg\+xml);base64,[A-Za-z0-9+/=\s]*$/;

function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** Все `url(…)` значения ссылаются только на свои id */
function urlsLocal(value: string): boolean {
  const re = /url\(\s*(['"]?)([^)'"]*)\1\s*\)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value))) if (!m[2].trim().startsWith('#')) return false;
  // «url(» без закрывающей скобки — тоже прочь
  return !/url\(/i.test(value.replace(re, ''));
}

/** Причина убрать атрибут; `null` — оставить */
function attrVerdict(el: Element, a: Attr, scene: boolean): string | null {
  const ns = a.namespaceURI;
  const local = a.localName;
  if (ns === XMLNS_NS) {
    const okDecl = (local === 'xmlns' && a.value === SVG_NS) || (local === 'xlink' && a.value === XLINK_NS);
    return okDecl ? null : 'xmlns';
  }
  if (ns === XML_NS) return local === 'space' ? null : 'xml';
  if (ns !== null && ns !== XLINK_NS) return 'ns';
  if (/^on/i.test(local)) return 'event';
  if (local === 'style') return 'style';
  if (local === 'href') {
    if (LOCAL_REF.test(a.value)) return null;
    return scene && el.localName === 'image' && SCENE_IMAGE.test(a.value) ? null : 'href';
  }
  if (ns === XLINK_NS) return 'xlink';
  const known = ATTRS.has(local) || (scene && /^data-[a-z0-9-]+$/.test(local));
  if (!known) return 'attr';
  return urlsLocal(a.value) ? null : 'url';
}

function cleanAttributes(el: Element, scene: boolean, removed: string[]): void {
  for (const a of Array.from(el.attributes)) {
    const why = attrVerdict(el, a, scene);
    if (why) {
      el.removeAttributeNode(a);
      removed.push(`${el.localName}@${a.name} (${why})`);
    }
  }
}

function cleanTree(el: Element, scene: boolean, removed: string[]): void {
  cleanAttributes(el, scene, removed);
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 3) continue; // текст
    if (node.nodeType !== 1) {
      el.removeChild(node);
      removed.push(`#${node.nodeName}`);
      continue;
    }
    const child = node as Element;
    const allowed = child.namespaceURI === SVG_NS
      && (ELEMENTS.has(child.localName) || (scene && SCENE_ELEMENTS.has(child.localName)));
    if (!allowed) {
      el.removeChild(child);
      removed.push(`<${child.nodeName}>`);
      continue;
    }
    cleanTree(child, scene, removed);
  }
}

function hrefOf(el: Element): string {
  return el.getAttribute('href') ?? el.getAttributeNS(XLINK_NS, 'href') ?? '';
}

/** `<use>`: цель существует, не `<use>` и не содержит `<use>`; не больше 500 */
function cleanUses(root: Element, removed: string[]): void {
  const ids = new Map<string, Element>();
  for (const el of Array.from(root.getElementsByTagName('*'))) {
    const id = el.getAttribute('id');
    if (id && !ids.has(id)) ids.set(id, el);
  }
  let kept = 0;
  for (const use of Array.from(root.getElementsByTagNameNS(SVG_NS, 'use'))) {
    const target = ids.get(hrefOf(use).slice(1));
    const chain = !target || target.localName === 'use' || target.getElementsByTagNameNS(SVG_NS, 'use').length > 0;
    if (chain || kept >= MAX_USE) {
      use.parentNode?.removeChild(use);
      removed.push(`<use ${hrefOf(use) || '—'}>`);
      continue;
    }
    kept += 1;
  }
}

/** Очистить SVG-текст. Отказ — текстом для показа */
export function sanitizeSvg(text: string, mode: SanitizeMode = 'asset'): SanitizeResult {
  if (byteLength(text) > MAX_SVG_BYTES) return { ok: false, error: 'SVG больше 5 МБ' };
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) return { ok: false, error: 'SVG с DOCTYPE или сущностями не принимается' };
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  } catch {
    return { ok: false, error: 'Файл не читается как SVG' };
  }
  if (doc.getElementsByTagName('parsererror').length > 0) return { ok: false, error: 'Файл не читается как SVG' };
  const root = doc.documentElement;
  if (!root || root.namespaceURI !== SVG_NS || root.localName !== 'svg') {
    return { ok: false, error: 'В файле нет SVG-рисунка' };
  }
  const removed: string[] = [];
  cleanTree(root, mode === 'scene', removed);
  cleanUses(root, removed);
  return { ok: true, svg: new XMLSerializer().serializeToString(root), removed };
}
