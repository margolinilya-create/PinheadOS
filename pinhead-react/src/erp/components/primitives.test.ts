import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { withoutJsComments } from '../utils/migrations.testutil';

/**
 * §4.3 обхода 04.09: примитивов не хватало там, где паттерн повторялся.
 * Заведены `Modal` (шесть рукописных оболочек диалога) и `FilterChip`
 * (двадцать одна копия чипа-фильтра).
 *
 * ЧТО ИМЕННО СТОРОЖИТСЯ. Не «красиво ли» и не «все ли мигрированы» —
 * ДОСТУПНОСТЬ. Копия оболочки диалога дублирует не разметку, а обещание:
 * `aria-modal="true"` без `useFocusTrap` уводит Tab под оверлей и оставляет
 * Escape без обработчика, и выглядит окно при этом нормально. Заметить можно
 * только клавиатурой, а проверяют мышью.
 *
 * Поэтому правило простое: файл, объявляющий `aria-modal`, обязан либо БЫТЬ
 * примитивом, либо звать трап сам. Список исключений перечислен поимённо
 * с причиной — так же, как ратчет `KNOWN` у сканера доступности.
 */

const ROOT = join(process.cwd(), 'src/erp');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return full.endsWith('.jsx') && !full.endsWith('.test.jsx') ? [full] : [];
  });
}

const FILES = walk(ROOT).map((f) => ({
  rel: f.slice(process.cwd().length + 1),
  src: withoutJsComments(readFileSync(f, 'utf8')),
}));

/**
 * Свои оболочки, у которых поведение отличается не оформлением:
 *  · `Modal` — сам примитив;
 *  · `Drawer` — боковая панель со своей анимацией и слоем `--z-drawer`;
 *  · `TzViewer`, `Lightbox` — полноэкранные просмотрщики (`--z-lightbox`),
 *    у них нет формы и нет действий, только содержимое и закрытие.
 */
const OWN_SHELLS = [
  'src/erp/components/Modal.jsx',
  'src/erp/components/Drawer.jsx',
  'src/erp/components/TzViewer.jsx',
  'src/erp/screens/queue/Lightbox.jsx',
];

describe('примитивы раздела', () => {
  it('окно с aria-modal либо примитив, либо ловит фокус само', () => {
    const bad = FILES
      .filter((f) => f.src.includes('aria-modal'))
      .filter((f) => !OWN_SHELLS.includes(f.rel))
      .filter((f) => !f.src.includes('useFocusTrap'))
      .map((f) => f.rel);
    expect(bad, `${bad.join(', ')} — объявляют aria-modal без ловушки фокуса`).toEqual([]);
  });

  it('чип-ПЕРЕКЛЮЧАТЕЛЬ несёт состояние для скринридера', () => {
    /**
     * Для скринридера это разница между «фильтр „Просрочено", нажат»
     * и просто «Просрочено», то есть между работающим фильтром и кнопкой
     * без состояния.
     *
     * ОТБОР ИДЁТ ПО ТЕРНАРНИКУ В `className`, а не по паре классов: чип,
     * у которого вид зависит от состояния, — переключатель, и состояние
     * обязан объявить. Чипы-ПОДСКАЗКИ справочника (`DictionaryChips`)
     * ничего не переключают, они дописывают текст в поле, и `aria-pressed`
     * на них был бы ложью; у чипа статуса этапа класс тоже фиксированный.
     *
     * `aria-expanded` засчитывается наравне: «Фильтры ▾» — раскрытие,
     * и два состояния разом (`pressed` + `expanded`) читались бы дважды.
     */
    const bad: string[] = [];
    for (const f of FILES) {
      const re = /<button[^>]*className=\{`[^`]*styles\.chip\}[^`]*styles\.chipBtn[^`]*\?[^`]*`\}[^>]*>/gs;
      for (const m of f.src.matchAll(re)) {
        const tag = m[0];
        if (!tag.includes('aria-pressed') && !tag.includes('aria-expanded')) {
          bad.push(`${f.rel}: ${tag.replace(/\s+/g, ' ').slice(0, 70)}…`);
        }
      }
    }
    expect(bad, bad.join('\n')).toEqual([]);
  });

  it('FilterChip и Modal существуют и экспортируются', () => {
    const names = FILES.map((f) => f.rel);
    expect(names).toContain('src/erp/components/Modal.jsx');
    expect(names).toContain('src/erp/components/FilterChip.jsx');
  });
});
