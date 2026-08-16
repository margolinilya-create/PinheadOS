import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ORDER_LIST_SELECT } from '../store/orderHelpers';

/**
 * Подрядный этап не должен выглядеть работой нашего цеха.
 *
 * ЗАЧЕМ ЭТОТ СТОРОЖ. Правило одно («этап с `executor='contractor'` пропускаем»),
 * а мест, где по этапам ходят и раскладывают их по цехам, — несколько: очередь,
 * канбан, счётчики цеха в оболочке, перенумерация приоритетов, загрузка цехов.
 * Копия одного правила в нескольких файлах в этом проекте УЖЕ расходилась молча:
 * так `fg_receipt` забыли в одном из двух списков терминальных статусов, и бейдж
 * «Склад» не гас никогда.
 *
 * Цена промаха здесь выше бейджа: рабочий увидел бы в своей очереди задание,
 * которого он не сделает, а план и загрузка показали бы перегруз там, где
 * работы у нас нет вовсе.
 */

const SRC = join(process.cwd(), 'src');

/** Файлы, которые раскладывают этапы по цехам и обязаны отсеивать подряд */
const CONSUMERS = [
  'erp/utils/queueEntries.js',
  'erp/store/orderHelpers.ts',
  'erp/utils/deptLoad.ts',
];

describe('подрядный этап не попадает в очередь и загрузку нашего цеха', () => {
  for (const rel of CONSUMERS) {
    it(`${rel} отсеивает подрядные этапы`, () => {
      const src = readFileSync(join(SRC, rel), 'utf8');
      expect(
        src.includes('isOutsourced'),
        `${rel} ходит по этапам цеха, но не отсеивает подряд — рабочий увидит чужую работу`,
      ).toBe(true);
      // Именно общая утилита, а не своя проверка: правило должно быть одно
      expect(src).toMatch(/from '.*outsourcing'/);
    });
  }

  /**
   * Колонка новая, и списочный запрос перечисляет поля этапа ПОИМЁННО.
   * Без неё `executor` приезжает `undefined`, отсев молча перестаёт работать,
   * и ошибки не видно ничем: подрядные задания просто снова окажутся в очереди.
   */
  it('executor есть в списочном запросе — иначе отсев работает вхолостую', () => {
    expect(ORDER_LIST_SELECT).toContain('executor');
    expect(ORDER_LIST_SELECT).toContain('contractor');
    expect(ORDER_LIST_SELECT).toContain('operation');
  });

  /**
   * Сравнение обязано быть С `'contractor'`, а не с `!== 'internal'`:
   * у этапов из старых фикстур и урезанных выборок поля нет вовсе, и второй
   * вариант отправил бы в подряд ВСЁ производство разом.
   */
  it('правило fail-open к отсутствующему полю', () => {
    const src = readFileSync(join(SRC, 'erp/utils/outsourcing.ts'), 'utf8');
    expect(src).toMatch(/executor === 'contractor'/);
    expect(src).not.toMatch(/executor !== 'internal'/);
  });
});
