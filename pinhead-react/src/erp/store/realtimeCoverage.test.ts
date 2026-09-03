import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Все исходники стора одним текстом (тесты не в счёт) */
function readAll(dir: string): string {
  let out = '';
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out += readAll(full);
    else if (/\.(ts|js)$/.test(entry) && !/\.test\./.test(entry)) out += readFileSync(full, 'utf8');
  }
  return out;
}

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

  /**
   * ТРЕТИЙ ВОПРОС, которого этот сторож не задавал.
   *
   * Проверки выше сверяют файл САМ С СОБОЙ: подписки против обработчиков внутри
   * `realtimeSlice`. Таблица, строки которой лежат в сторе, а подписки на неё
   * нет вовсе, обе проверки проходит — её просто нет ни в одном из двух
   * перечислений. Ровно так до 03.09 жили `erp_order_items` (после частичной
   * отгрузки остаток в чужой вкладке врал) и `erp_calendar_slots` (план ставит
   * один человек, факт вносит другой — на одной доске).
   *
   * Теперь список таблиц берётся ИЗ КОДА: `.from('erp_…')` во всех файлах стора
   * плюс вложенные `select`-ы выборки заказа. Каждая обязана быть либо
   * подписана, либо названа здесь с причиной — «почему её устаревание
   * не навредит». Забыть пополнить такой список нельзя: новая таблица валит
   * тест сразу.
   */
  const NO_REALTIME: Record<string, string> = {
    // Настройки и справочники: приезжают пакетом `erp_bootstrap` при загрузке,
    // правит их администратор у себя, и цена устаревания — до перезагрузки
    erp_departments: 'состав участков правит админ; приезжает бутстрапом',
    erp_dictionaries: 'подсказки ввода, правит админ',
    erp_role_permissions: 'матрица прав, правит админ; смена прав на живой вкладке — редкость',
    erp_settings: 'мощность производства, одно число, правит админ',
    erp_employees: 'список сотрудников, экран админки перечитывает сам',
    erp_invites: 'приглашения видит только тот, кто их выписал',
    // Части КАРТОЧКИ заказа: грузятся при открытии (`loadOrderBundle`) и живут
    // столько, сколько открыта карточка. Правит их обычно тот же человек
    erp_order_comments: 'комментарии карточки: перечитываются при открытии',
    erp_stage_events: 'лента истории: перечитывается при открытии',
    erp_order_attachments: 'вложения карточки: перечитываются при открытии',
    erp_item_prints: 'нанесения позиции: часть ТЗ, меняются при правке заказа',
    erp_item_labels: 'бирки позиции: часть ТЗ, меняются при правке заказа',
    erp_order_notes: 'заметки заказа: часть ТЗ, меняются при правке заказа',
    erp_order_drafts: 'черновик формы — личный снимок автора, чужих правок не бывает',
    erp_material_suppliers: 'варианты поставщика: ведёт закупщик в своей карточке',
    erp_plan_comments: 'переписка по задаче дня: перечитывается при открытии шторки',
    // Журнал подряда: его rollup правит `erp_item_stages`, а ТА подписана —
    // движение количеств доезжает до всех, обновляется и очередь цеха
    erp_subcontract_moves: 'журнал подряда: количества доезжают через erp_item_stages',
  };

  it('таблица, чьи строки лежат в сторе, либо подписана, либо названа с причиной', () => {
    const store = readAll(join(process.cwd(), 'src/erp/store'));
    const fromTables = [...store.matchAll(/\.from\(\s*'(erp_\w+)'/g)].map((m) => m[1]);
    const helpers = readFileSync(join(process.cwd(), 'src/erp/store/orderHelpers.ts'), 'utf8');
    const embedded = [...helpers.matchAll(/:\s*(erp_\w+)\s*[!(]/g)].map((m) => m[1]);
    const inStore = [...new Set([...fromTables, ...embedded])].sort();
    expect(inStore.length, 'разбор не нашёл таблиц — сторож сторожит пустоту')
      .toBeGreaterThan(20);

    const silent = inStore.filter((t) => !SUB.includes(t) && !(t in NO_REALTIME));
    expect(
      silent,
      `строки этих таблиц лежат в сторе без подписки: ${silent.join(', ')} — `
      + 'в чужой вкладке они будут врать. Подпишите или впишите в NO_REALTIME с причиной',
    ).toEqual([]);

    // Причина, которая перестала быть причиной, — это протухший список
    const stale = Object.keys(NO_REALTIME).filter((t) => SUB.includes(t));
    expect(stale, `уже подписаны, уберите из NO_REALTIME: ${stale.join(', ')}`).toEqual([]);
  });

  it('задачи разработки подписаны — их статус ведёт триггер', () => {
    // Цех закрывает этап у себя; без подписки открытая карточка разработки
    // показывала бы старое состояние до перезагрузки руками
    expect(SUB).toContain('erp_experimental_tasks');
  });
});
