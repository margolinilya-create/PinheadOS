import { describe, it, expect } from 'vitest';
import {
  stripCssComments,
  stripJsComments,
  isTokenDeclaration,
  findHexHits,
  findLineHits,
  uncoveredKeyframes,
} from './audit-rules.mjs';

/**
 * Правила аудита гайдбука.
 *
 * ЗАЧЕМ ЭТОТ ФАЙЛ. 19.08.2026 `npm run audit` был красным на всех пяти
 * проверках, и все пять находок оказались ЛОЖНЫМИ — то есть проверялка,
 * которую все научились игнорировать. Два дефекта из трёх были невидимыми:
 * комментарий, принятый за код, и зависимость результата от ПОРЯДКА ОБХОДА
 * ФАЙЛОВ. Ни то, ни другое не видно при чтении вывода — обе находки выглядят
 * как настоящие. Такое возвращается молча, поэтому здесь закреплено поимённо.
 *
 * Проверяется И обратное: что правила по-прежнему ЛОВЯТ нарушения. Аудит,
 * который всегда зелёный, не лучше того, что всегда красный.
 */

describe('снятие комментариев', () => {
  it('hex в комментарии — не находка, а объяснение', () => {
    const css = `/* Был #888888 и не проходил AA */\n.a { color: var(--text-dim); }`;
    expect(findHexHits(css)).toEqual([]);
  });

  it('номера строк не съезжают: комментарий заменяется пробелами, не вырезается', () => {
    const css = [
      '/* многострочный',
      '   комментарий */',
      '.a { color: #ff00aa; }',
    ].join('\n');
    expect(findHexHits(css)[0].line).toBe(3);
  });

  it('`//` внутри строки — не комментарий', () => {
    const js = `const url = 'https://example.com'; // хвост`;
    expect(stripJsComments(js)).toContain('https://example.com');
  });

  it('строчный комментарий снимается, только когда строка с него начинается', () => {
    expect(stripJsComments('  // весь текст').trim()).toBe('');
  });

  /**
   * Проверяем СВОЙСТВО, а не выписанное руками число пробелов: длина строки
   * сохраняется (иначе съедут колонки), содержимое комментария исчезает.
   */
  it('блочный комментарий заменяется пробелами той же длины', () => {
    const src = 'a /* секрет */ c';
    const out = stripCssComments(src);
    expect(out).toHaveLength(src.length);
    expect(out).not.toContain('секрет');
    expect(out.split(/\s+/).filter(Boolean)).toEqual(['a', 'c']);
  });
});

describe('1. цвета мимо токенов', () => {
  it('ловит хардкоженный цвет', () => {
    const hits = findHexHits('.a { color: #ff00aa; }', 'x.css');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ file: 'x.css', line: 1 });
    expect(hits[0].text).toContain('#ff00aa');
  });

  it('объявление самого токена — законное место для значения', () => {
    expect(findHexHits('  --text-dim: #636363;')).toEqual([]);
  });

  it('чёрный, белый и серая рамка токеном не выражаются', () => {
    expect(findHexHits('.a { color: #fff; border-color: #ccc; }')).toEqual([]);
  });

  it('rgba() и фолбэк var() не считаются хардкодом', () => {
    expect(findHexHits('.a { box-shadow: 0 0 0 rgba(0,0,0,.5); }')).toEqual([]);
    expect(findHexHits('.a { color: var(--color-error, #FF3B30); }')).toEqual([]);
  });
});

describe('2–3, 5. построчные проверки', () => {
  const CSS = `.a { font-family: 'Barlow Condensed', sans-serif; }`;

  it('ловит шрифт мимо токена', () => {
    expect(findLineHits(CSS, /Barlow Condensed/i, { strip: stripCssComments })).toHaveLength(1);
  });

  it('правильное употребление через var() не считается нарушением', () => {
    const ok = `.a { font-family: var(--font-display); }  /* Barlow Condensed */`;
    expect(findLineHits(ok, /Barlow Condensed/i, {
      strip: stripCssComments, exclude: 'var(--font-display)',
    })).toEqual([]);
  });

  /**
   * Проверки шрифтов не смотрели `index.css` вовсе — то есть хардкод шрифта
   * в главном файле стилей прошёл бы мимо аудита. Область расширена, а
   * объявление токена отсеивается предикатом: иначе токен объявить нечем.
   */
  it('объявление токена шрифта — не нарушение, а его определение', () => {
    const decl = `  --font-display: 'Barlow Condensed', sans-serif;`;
    expect(isTokenDeclaration(decl)).toBe(true);
    expect(findLineHits(decl, /Barlow Condensed/i, {
      strip: stripCssComments, skip: isTokenDeclaration,
    })).toEqual([]);
  });

  it('ловит fill="currentColor" в иконке', () => {
    const jsx = `<path fill="currentColor" d="M0 0" />`;
    expect(findLineHits(jsx, /fill=["']currentColor["']/)).toHaveLength(1);
  });

  it('тот же текст в комментарии — не находка', () => {
    const jsx = `// иконки без fill="currentColor"\nexport const A = 1;`;
    expect(findLineHits(jsx, /fill=["']currentColor["']/)).toEqual([]);
  });
});

describe('4. анимации без prefers-reduced-motion', () => {
  const GLOBAL_OVERRIDE = `
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 0.01ms !important;
        transition-duration: 0.01ms !important;
      }
    }`;

  it('анимация без покрытия — находка', () => {
    expect(uncoveredKeyframes(['@keyframes spin { from {} to {} }'])).toEqual(['spin']);
  });

  it('своё правило покрывает свою анимацию', () => {
    const css = `
      @keyframes spin { from {} to {} }
      @media (prefers-reduced-motion: reduce) { .x { animation: spin 0s; } }`;
    expect(uncoveredKeyframes([css])).toEqual([]);
  });

  /**
   * ГЛАВНЫЙ СЛУЧАЙ. Раньше имена и покрытие собирались за ОДИН проход по
   * файлам, поэтому глобальный override засчитывался только тем анимациям,
   * что встретились до него по порядку обхода. `fadeSlideIn` объявлена
   * в `wizard.css`, а override живёт в `utils.css` — файле, идущем раньше
   * по алфавиту, — и покрытая анимация рапортовалась как непокрытая.
   */
  it('глобальный override покрывает анимацию из ЛЮБОГО файла, включая последующие', () => {
    const later = '@keyframes fadeSlideIn { from {} to {} }';
    expect(uncoveredKeyframes([GLOBAL_OVERRIDE, later])).toEqual([]);
  });

  it('…и порядок файлов ничего не решает', () => {
    const later = '@keyframes fadeSlideIn { from {} to {} }';
    expect(uncoveredKeyframes([later, GLOBAL_OVERRIDE])).toEqual([]);
  });

  it('без глобального override анимации снова видны как непокрытые', () => {
    const noStar = GLOBAL_OVERRIDE.replace('*, *::before, *::after', '.only-this');
    expect(uncoveredKeyframes([noStar, '@keyframes fadeSlideIn { from {} to {} }']))
      .toEqual(['fadeSlideIn']);
  });

  /**
   * Прежняя регулярка «любая звёздочка» считала универсальным правилом
   * ЛЮБОЙ блок со звёздочкой —
   * например с арифметикой в `calc()`. Одного такого блока хватало, чтобы все
   * анимации проекта разом объявились покрытыми, то есть проверка тихо
   * переставала проверять что-либо.
   *
   * Комментарий для этого уже не годится: `uncoveredKeyframes` снимает их
   * первым делом, и сам этот тест поначалу проходил при ОБЕИХ реализациях —
   * то есть был декоративным. Нужен `*`, доживающий до регулярки.
   */
  it('звёздочка в calc() не выдаётся за универсальный селектор', () => {
    const css = `
      @keyframes spin { from {} to {} }
      @media (prefers-reduced-motion: reduce) {
        .unrelated { width: calc(100% * .5); }
      }`;
    expect(uncoveredKeyframes([css])).toEqual(['spin']);
  });
});
