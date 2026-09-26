// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * РАТЧЕТ ПРЕДУПРЕЖДЕНИЙ ЛИНТЕРА ДЕРЖИТСЯ ОДНИМ ФЛАГОМ, И ОН МОЖЕТ ИСЧЕЗНУТЬ
 * МОЛЧА.
 *
 * `jsx-a11y` включён 15.09 с 95 находками на коде, который писался, пока
 * линтера не было. Поставить их `error` — оставить CI вечно красным, то есть
 * сторожем, мимо которого смотрят; выключить правила — потерять класс
 * целиком. Выбран потолок: `eslint . --max-warnings N` валит сборку на
 * девяносто шестом предупреждении, а разбор существующих идёт отдельно.
 *
 * Весь механизм — один флаг в одной строке `package.json`. Уберут его при
 * следующей правке скрипта (например, добавляя `--fix`), и линт снова станет
 * зелёным при любом числе находок: ратчет исчезнет, не сломав ничего,
 * то есть незаметно. Отсюда этот сторож.
 *
 * ПОТОЛОК ТОЛЬКО ОПУСКАЕТСЯ. Его подъём означает «мы добавили недоступный
 * интерфейс и узаконили это», и такое решение принимается вслух, а не
 * правкой числа: тест сравнивает с зафиксированным здесь значением.
 */

const MAX_WARNINGS_CEILING = 95;

describe('ратчет предупреждений линтера', () => {
  const pkg = JSON.parse(
    readFileSync(join(process.cwd(), 'package.json'), 'utf8'),
  ) as { scripts: Record<string, string> };

  it('скрипт lint несёт потолок предупреждений', () => {
    expect(pkg.scripts.lint, 'скрипт `lint` пропал из package.json').toBeTruthy();
    expect(
      pkg.scripts.lint,
      'из `npm run lint` исчез `--max-warnings` — ратчет доступности больше не действует',
    ).toMatch(/--max-warnings\s+\d+/);
  });

  it('потолок не поднят выше зафиксированного', () => {
    const found = pkg.scripts.lint.match(/--max-warnings\s+(\d+)/);
    expect(found).not.toBeNull();
    const value = Number(found![1]);
    expect(
      value,
      `потолок предупреждений поднят до ${value} при зафиксированных ${MAX_WARNINGS_CEILING}: `
      + 'ратчет только опускается. Опустили — обновите и константу в этом тесте',
    ).toBeLessThanOrEqual(MAX_WARNINGS_CEILING);
  });
});
