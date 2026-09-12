import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * ОДИН КОНТРОЛ ВВОДА НА РАЗДЕЛ (обход 04.09).
 *
 * Примитив `Field` и класс `.input` — один и тот же элемент интерфейса,
 * заведённый дважды, и они разошлись по трём объявлениям сразу: рамка
 * (`--border-mid` 1,47:1 против `--border-control`), высота (36 против 40)
 * и скругление. Решение владельца 03.09 о границах, проходящих AA (1.4.11),
 * доехало до `.input` и не доехало до примитива.
 *
 * Сторож читает НАСТОЯЩИЙ CSS: разойтись обратно можно одной правкой,
 * и ни один функциональный тест этого не увидит — разметка та же, поведение
 * то же, отличается только вид.
 *
 * ФАЙЛ `.ts`, А НЕ `.jsx`: в `.jsx` конфиг ESLint даёт `no-undef` на `process`,
 * а путь к CSS иначе не собрать (`import.meta.url` в Vitest не файловая схема).
 * Тот же приём, что у `DevAnnotations.sources.test.ts`.
 */
function declarations(file: string, selector: string): Record<string, string> {
  const css = readFileSync(resolve(process.cwd(), file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ');
  const m = css.match(new RegExp(`\\n\\.${selector}[^{]*\\{([^}]*)\\}`));
  expect(m, `«${selector}» не найден в ${file}`).toBeTruthy();
  const out: Record<string, string> = {};
  for (const decl of (m as RegExpMatchArray)[1].split(';')) {
    const [prop, ...rest] = decl.split(':');
    if (!prop.trim() || rest.length === 0) continue;
    out[prop.trim()] = rest.join(':').trim();
  }
  return out;
}

describe('поле ввода — одно на раздел', () => {
  it('примитив и класс совпадают рамкой, высотой и скруглением', () => {
    const field = declarations('src/erp/components/Field.module.css', 'control');
    const input = declarations('src/erp/erp.module.css', 'input, .select');
    for (const prop of ['border', 'border-radius', 'min-height']) {
      expect(field[prop], `«${prop}» разошёлся`).toBe(input[prop]);
    }
  });

  /**
   * ≥44px НА ТАЧ-ЭКРАНЕ — ПРОВЕРЯЕТСЯ РАЗВОРОТОМ ТОКЕНА, А НЕ ПОИСКОМ ЧИСЛА.
   *
   * До 12.09 сторож искал литерал `min-height: 44px` в медиазапросе каждого
   * модуля. Высоты переехали в токены `--control-h*` (их тач-переопределение
   * стоит в `index.css` рядом с объявлением — как у `--dept-tab-h`), и числа
   * в модулях не стало: прежняя редакция прошла бы на ЛЮБОМ значении токена,
   * включая 24px. Ровно тот случай, что уже разбирался в `tokens.test.ts`:
   * перевод литералов на токены ослепляет сторожа, читающего литерал.
   *
   * Поэтому значение берётся оттуда, где оно объявлено, и проверяется
   * по существу: и база (никакой контрол не мельче самого себя), и тач-ветка.
   */
  it('токен высоты контрола на тач-экране не мельче 44px', () => {
    const index = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ');

    const coarse = index.match(/@media \(pointer: coarse\)\s*\{([\s\S]*?)\n\}/);
    expect(coarse, 'блок @media (pointer: coarse) в index.css не найден').toBeTruthy();

    const touch = new Map<string, number>();
    for (const m of (coarse as RegExpMatchArray)[1].matchAll(/(--control-h-[\w]+):\s*(\d+)px/g)) {
      touch.set(m[1], Number(m[2]));
    }
    expect(touch.size, 'тач-переопределения высот контролов нет вовсе').toBe(3);
    // Основной размер — тот, которым набраны действия цеха; правило ≥44px
    // адресует именно его. Мелкий поднимается до 40: он никогда не бывает
    // единственным способом нажать, рядом всегда есть полноразмерное действие.
    expect(touch.get('--control-h-md')).toBeGreaterThanOrEqual(44);
    expect(touch.get('--control-h-lg')).toBeGreaterThanOrEqual(44);
    expect(touch.get('--control-h-sm')).toBeGreaterThanOrEqual(40);
  });

  it('поле и кнопка берут высоту ИЗ ТОКЕНА, а не своим числом', () => {
    const field = readFileSync(resolve(process.cwd(), 'src/erp/components/Field.module.css'), 'utf8');
    const button = readFileSync(resolve(process.cwd(), 'src/erp/components/Button.module.css'), 'utf8');
    const erp = readFileSync(resolve(process.cwd(), 'src/erp/erp.module.css'), 'utf8');

    expect(field).toMatch(/\.control\s*\{[^}]*min-height:\s*var\(--control-h-md\)/);
    expect(button).toMatch(/\.btn\s*\{[^}]*min-height:\s*var\(--control-h-md\)/);
    expect(erp).toMatch(/\.input,\s*\.select\s*\{[^}]*min-height:\s*var\(--control-h-md\)/);

    // Своего медиазапроса высоты у модулей примитивов быть не должно: два
    // таких, в примитиве и в монолите, уже разъехались (36 против 40)
    expect(field).not.toMatch(/@media \(pointer: coarse\)[\s\S]*min-height/);
    expect(button).not.toMatch(/@media \(pointer: coarse\)[\s\S]*min-height/);
  });
});
