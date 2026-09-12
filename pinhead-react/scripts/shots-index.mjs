#!/usr/bin/env node
/**
 * КОНТАКТНЫЙ ЛИСТ СТЕНДА СНИМКОВ.
 *
 * Собирает из `.shots/<метка>/*.png` одну HTML-страницу, которую человек
 * листает глазами. С двумя метками кладёт снимки ПАРАМИ — «до» слева,
 * «после» справа: разницу вида ловит глаз, а не число, и пара рядом
 * отвечает на вопрос «это я так задумал или сломал» за секунду.
 *
 *   node scripts/shots-index.mjs                 # все метки, что есть
 *   node scripts/shots-index.mjs before after    # ровно эти две, парами
 *
 * Страница пишется в `.shots/index.html` (каталог в .gitignore).
 */
import { readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = '.shots';

if (!existsSync(ROOT)) {
  console.error('Нет каталога .shots — сначала `npm run shots`');
  process.exit(1);
}

const asked = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const labels = (asked.length ? asked : readdirSync(ROOT, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
  .map((d) => d.name));

const missing = labels.filter((l) => !existsSync(join(ROOT, l)));
if (missing.length) {
  console.error(`Нет снимков с меткой: ${missing.join(', ')}`);
  process.exit(1);
}

/** `dashboard-1440-light.png` → { shot, width, theme } */
function parse(file) {
  const m = /^(.+)-(\d+)-(light|dark)\.png$/.exec(file);
  return m ? { shot: m[1], width: m[2], theme: m[3] } : null;
}

const rows = new Map();
for (const label of labels) {
  for (const file of readdirSync(join(ROOT, label))) {
    const p = parse(file);
    if (!p) continue;
    const key = `${p.shot}|${p.width}|${p.theme}`;
    if (!rows.has(key)) rows.set(key, { ...p, files: {} });
    rows.get(key).files[label] = `${label}/${file}`;
  }
}

const sorted = [...rows.values()].sort((a, b) => (
  a.shot.localeCompare(b.shot)
  || Number(b.width) - Number(a.width)
  || a.theme.localeCompare(b.theme)
));

const cells = (r) => labels.map((l) => (r.files[l]
  ? `<figure><figcaption>${l}</figcaption><a href="${r.files[l]}" target="_blank"><img loading="lazy" src="${r.files[l]}" alt="${r.shot} ${r.width} ${r.theme} ${l}"></a></figure>`
  : '<figure class="gap"><figcaption>—</figcaption></figure>')).join('');

const html = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<title>Снимки ERP — ${labels.join(' / ')}</title>
<style>
  body { margin: 0; padding: 24px; background: #14120E; color: #EDE8DD;
         font: 14px/1.4 system-ui, sans-serif; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .hint { color: #9A9184; margin-bottom: 20px; }
  .filters { position: sticky; top: 0; background: #14120E; padding: 8px 0 12px; z-index: 2; }
  .filters button { margin-right: 6px; padding: 5px 10px; border: 1px solid #403A30;
                    border-radius: 999px; background: transparent; color: inherit; cursor: pointer; }
  .filters button[aria-pressed="true"] { background: #2B2BF0; border-color: #2B2BF0; color: #fff; }
  section { margin-bottom: 28px; }
  h2 { font-size: 14px; letter-spacing: .08em; text-transform: uppercase; color: #BDB5A7;
       border-bottom: 1px solid #302B23; padding-bottom: 6px; }
  .pair { display: grid; grid-template-columns: repeat(${labels.length}, 1fr); gap: 12px; }
  figure { margin: 0; }
  figcaption { color: #978E7F; font-size: 12px; margin-bottom: 4px; }
  img { width: 100%; border: 1px solid #302B23; border-radius: 8px; background: #fff; }
  .gap { opacity: .3; }
</style></head><body>
<h1>Снимки раздела «Производство» — ${labels.join(' · ')}</h1>
<div class="hint">${sorted.length} состояний. Клик по картинке — полный размер.</div>
<div class="filters" id="f">
  <button data-w="all" aria-pressed="true">Все ширины</button>
  <button data-w="1440" aria-pressed="false">1440</button>
  <button data-w="768" aria-pressed="false">768 планшет</button>
  <button data-w="375" aria-pressed="false">375</button>
  <button data-t="all" aria-pressed="true">Обе темы</button>
  <button data-t="light" aria-pressed="false">Светлая</button>
  <button data-t="dark" aria-pressed="false">Тёмная</button>
</div>
${sorted.map((r) => `<section data-w="${r.width}" data-t="${r.theme}">
  <h2>${r.shot} · ${r.width} · ${r.theme}</h2>
  <div class="pair">${cells(r)}</div>
</section>`).join('\n')}
<script>
  let w = 'all', t = 'all';
  const apply = () => {
    document.querySelectorAll('section').forEach((s) => {
      const okW = w === 'all' || s.dataset.w === w;
      const okT = t === 'all' || s.dataset.t === t;
      s.hidden = !(okW && okT);
    });
    document.querySelectorAll('#f button').forEach((b) => {
      const on = b.dataset.w ? b.dataset.w === w : b.dataset.t === t;
      b.setAttribute('aria-pressed', String(on));
    });
  };
  document.getElementById('f').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.w) w = b.dataset.w; else t = b.dataset.t;
    apply();
  });
  apply();
</script>
</body></html>`;

writeFileSync(join(ROOT, 'index.html'), html);
console.log(`Готово: .shots/index.html — ${sorted.length} состояний, метки: ${labels.join(', ')}`);
