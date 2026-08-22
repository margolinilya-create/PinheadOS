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
const FONT_DIR = join(process.cwd(), 'public', 'fonts');
/**
 * Комментарии снимаются: объяснение, ПОЧЕМУ шрифты больше не берутся с CDN,
 * содержит те же слова, что и запрещаемая ссылка. На этом сторожа в проекте
 * уже спотыкались — и этот споткнулся на первом же прогоне.
 */
const withoutComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const TOKENS = readFileSync(join(SRC, 'index.css'), 'utf8');

function cssFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) cssFiles(p, out);
    else if (entry.endsWith('.css')) out.push(p);
  }
  return out;
}

/**
 * Семейства, реально загружаемые страницей.
 *
 * Раньше читалось из `index.html` — там стояла ссылка на Google Fonts.
 * С 22.08 шрифты СВОИ: `@font-face` в `index.css`, файлы в `public/fonts`.
 * Источник правды переехал, и сторож обязан был переехать вместе с ним —
 * иначе он продолжал бы проверять несуществующую ссылку и зеленел впустую.
 */
function loadedFamilies(): string[] {
  const families: string[] = [];
  for (const m of TOKENS.matchAll(/@font-face\s*\{[^}]*?font-family:\s*'([^']+)'/g)) {
    families.push(m[1]);
  }
  return [...new Set(families)];
}

/** Файлы, на которые ссылаются объявления */
function referencedFiles(): string[] {
  return [...TOKENS.matchAll(/url\('\/fonts\/([^']+)'\)/g)].map((m) => m[1]);
}

describe('шрифты', () => {
  it('страница не ходит за шрифтами на сторонний домен', () => {
    /**
     * Шрифты грузились с fonts.googleapis.com, и это ломалось молча дважды:
     * на раннере CI они не приезжали вовсе (весь интерфейс рисовался
     * системным фолбэком, и визуальные эталоны не сходились никогда),
     * а в цеху типографика зависела от чужого домена при нестабильном Wi-Fi.
     */
    expect(INDEX_HTML).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
    expect(withoutComments(TOKENS)).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
  });

  it('каждый объявленный файл шрифта лежит в public/fonts', () => {
    // Опечатка в имени файла даёт молчаливый фолбэк на системный шрифт —
    // ровно тот отказ, ради которого шрифты и переехали к себе
    const present = new Set(readdirSync(FONT_DIR));
    const referenced = referencedFiles();
    expect(referenced.length).toBeGreaterThan(0);
    for (const file of referenced) {
      expect(present, `нет файла public/fonts/${file}`).toContain(file);
    }
  });

  it('в public/fonts нет файлов, на которые никто не ссылается', () => {
    const referenced = new Set(referencedFiles());
    const orphans = readdirSync(FONT_DIR).filter((f) => f.endsWith('.woff2') && !referenced.has(f));
    expect(orphans, `осиротевшие файлы шрифтов:\n${orphans.join('\n')}`).toEqual([]);
  });

  it('объявлены ровно те семейства, что нужны токенам', () => {
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
