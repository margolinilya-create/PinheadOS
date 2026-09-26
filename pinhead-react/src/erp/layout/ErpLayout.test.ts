// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ПРАВКА ЗАКАЗЧИКА 13.09, П. 1: «Полностью убрать строку глобального поиска
 * „Поиск: заказ, № сделки, менеджер…" из верхней шапки на всех экранах ERP.
 * Локальные поиски внутри конкретных разделов и таблиц не трогать».
 *
 * Поле висело на КАЖДОМ экране раздела, а фильтровало ровно один: по Enter
 * оно уводило на «Заказы» и там же применялось. На очереди цеха, складе
 * и закупке оно предлагало искать в чужом списке и занимало место рядом
 * с локальным поиском самого экрана.
 *
 * Сторож читает исходник, а не рендерит оболочку: `ErpLayout` тянет за собой
 * подписку realtime, бутстрап и сайдбар — то есть проверял бы всё, кроме
 * того, ради чего заведён.
 */

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('Шапка ERP — глобального поиска нет', () => {
  const layout = read('src/erp/layout/ErpLayout.jsx');

  it('поля в шапке не осталось', () => {
    expect(layout).not.toContain('useErpSearch');
    expect(layout).not.toContain('headerSearch');
    expect(layout).not.toContain('Глобальный поиск');
  });

  it('его класс снят и из CSS — правило без носителя это мусор', () => {
    expect(read('src/erp/erp.module.css')).not.toContain('headerSearch');
  });

  /**
   * ВТОРАЯ ПОЛОВИНА ТРЕБОВАНИЯ. «Локальные поиски… не трогать» — и главный
   * из них живёт на экране «Заказы» на том же сторе. Сторож, проверяющий
   * только исчезновение, засчитал бы за исполнение и случай, когда поиск
   * по заказам выкинули заодно.
   */
  it('поиск на экране «Заказы» остался', () => {
    const orders = read('src/erp/screens/OrdersScreen.jsx');
    expect(orders).toContain('useErpSearch');
    expect(orders).toContain("aria-label=\"Поиск заказов\"");
  });
});
