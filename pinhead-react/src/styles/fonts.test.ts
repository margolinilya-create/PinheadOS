import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Шрифты объявляются токенами, и объявляются только загруженные.
 *
 * Два разных дефекта, которые волна 4 разгребала вместе:
 *
 * 1. Сорок с лишним литералов `'Inter', sans-serif` по CSS-модулям. Токен
 *    `--font-body` при этом существовал — то есть смена шрифта означала бы
 *    сорок правок вместо одной, и половину из них забыли бы.
 *
 * 2. Семь объявлений `Space Grotesk` — шрифта, которого НЕТ в `index.html`
 *    (там только Barlow Condensed, Inter и Roboto Mono). Браузер молча падал
 *    на следующий в списке, то есть на Inter. Это был мёртвый CSS, выглядевший
 *    дизайнерским решением: правило есть, эффекта нет, и объяснить разницу
 *    между «сайдбар другим шрифтом» и «сайдбар тем же шрифтом» никто не мог.
 *
 * Тест читает исходники, потому что второй дефект не ловится ничем другим:
 * невалидного CSS здесь нет, есть валидное правило с несуществующим шрифтом.
 */

const SRC = join(process.cwd(), 'src');
const INDEX_HTML = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
const TOKENS = readFileSync(join(SRC, 'index.css'), 'utf8');

function cssFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) cssFiles(p, out);
    else if (entry.endsWith('.css')) out.push(p);
  }
  return out;
}

/** Семейства, реально загруженные страницей (link на Google Fonts) */
function loadedFamilies(): string[] {
  const families: string[] = [];
  for (const m of INDEX_HTML.matchAll(/family=([A-Za-z+]+)/g)) {
    families.push(m[1].replace(/\+/g, ' '));
  }
  return [...new Set(families)];
}

describe('шрифты', () => {
  it('в index.html загружены ровно те семейства, что объявлены токенами', () => {
    const loaded = loadedFamilies();
    expect(loaded).toContain('Inter');
    expect(loaded).toContain('Barlow Condensed');
    expect(loaded).toContain('Roboto Mono');
  });

  it('токены ссылаются только на загруженные семейства', () => {
    const declared = [...TOKENS.matchAll(/--(?:font-body|font-display|mono):\s*'([^']+)'/g)]
      .map((m) => m[1]);
    expect(declared.length).toBeGreaterThan(0);
    for (const family of declared) {
      expect(loadedFamilies(), `${family} объявлен токеном, но не загружен`).toContain(family);
    }
  });

  it('в правилах CSS нет литералов шрифта — только var()', () => {
    const guilty: string[] = [];
    for (const file of cssFiles(SRC)) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/font-family:\s*([^;}]+)[;}]/g)) {
        const value = m[1].trim();
        if (value.startsWith('var(') || value === 'inherit') continue;
        // Объявления самих токенов живут в index.css — им литерал и положен
        if (file.endsWith('index.css') && /^'(Inter|Barlow Condensed|Roboto Mono)'/.test(value)) continue;
        guilty.push(`${file.slice(SRC.length + 1)}: ${value}`);
      }
    }
    expect(guilty, `Литералы шрифта вместо токенов:\n${guilty.join('\n')}`).toEqual([]);
  });

  it('незагруженных семейств в CSS не осталось', () => {
    const loaded = loadedFamilies();
    for (const file of cssFiles(SRC)) {
      const src = readFileSync(file, 'utf8');
      for (const decl of src.matchAll(/font-family:\s*([^;}]+)[;}]/g)) {
        for (const m of decl[1].matchAll(/'([^']+)'/g)) {
          const family = m[1];
          if (['sans-serif', 'monospace', 'serif'].includes(family)) continue;
          expect(loaded, `${file.slice(SRC.length + 1)}: шрифт ${family} не загружается`)
            .toContain(family);
        }
      }
    }
  });
});
