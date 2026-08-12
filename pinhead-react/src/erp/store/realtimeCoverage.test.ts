import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Подписки realtime и обработчики событий обязаны сходиться.
 *
 * Расходятся они молча, и по-разному в каждую сторону:
 *   · подписка без обработчика — событие падает в `scheduleFullReload()`,
 *     то есть в полную перезагрузку всех заказов на каждую запись в таблицу;
 *   · обработчик без подписки — недостижимый код, который выглядит рабочим.
 *
 * Второе и нашлось разбором 11.08: `applyRealtimeEvent` умел разбирать
 * `erp_experimental_ops`, а подписки на них не было — возврат образца
 * из швейки не обновлял экран разработки, пока его не перезагрузят руками.
 * Ни один тест этого не видел: обе стороны по отдельности выглядели целыми.
 * Сама таблица убрана 12.08 вместе с фазовой моделью; правило осталось.
 */

const SRC = readFileSync(
  join(process.cwd(), 'src/erp/store/slices/realtimeSlice.ts'),
  'utf8',
);

/** Таблицы, на которые подписан канал (`.on('postgres_changes', { table })`) */
function subscribed(): string[] {
  return [...SRC.matchAll(/table:\s*'(\w+)'/g)].map((m) => m[1]).sort();
}

/**
 * Таблицы, которые умеет разобрать `applyRealtimeEvent`: сравнения с `ev.table`
 * плюс карта дочерних таблиц `TABLE_TO_CHILD`.
 */
function handled(): string[] {
  const direct = [...SRC.matchAll(/ev\.table\s*===\s*'(\w+)'/g)].map((m) => m[1]);
  const mapBlock = SRC.slice(SRC.indexOf('TABLE_TO_CHILD'), SRC.indexOf('};', SRC.indexOf('TABLE_TO_CHILD')));
  const viaMap = [...mapBlock.matchAll(/^\s*(erp_\w+):/gm)].map((m) => m[1]);
  return [...new Set([...direct, ...viaMap])].sort();
}

describe('realtime: подписки и обработчики сходятся', () => {
  const SUB = subscribed();
  const HANDLED = handled();

  it('обе стороны найдены — иначе тест сторожит пустоту', () => {
    expect(SUB.length).toBeGreaterThan(8);
    expect(HANDLED.length).toBeGreaterThan(8);
  });

  it('у каждой подписки есть обработчик', () => {
    // Иначе каждая запись в таблицу роняет всё в полную перезагрузку заказов
    const orphan = SUB.filter((t) => !HANDLED.includes(t));
    expect(orphan, `подписка без обработчика: ${orphan.join(', ')}`).toEqual([]);
  });

  it('у каждого обработчика есть подписка', () => {
    // Иначе ветка недостижима, а выглядит рабочей
    const dead = HANDLED.filter((t) => !SUB.includes(t));
    expect(dead, `обработчик без подписки: ${dead.join(', ')}`).toEqual([]);
  });

  it('задачи разработки подписаны — их статус ведёт триггер', () => {
    // Цех закрывает этап у себя; без подписки открытая карточка разработки
    // показывала бы старое состояние до перезагрузки руками
    expect(SUB).toContain('erp_experimental_tasks');
  });
});
