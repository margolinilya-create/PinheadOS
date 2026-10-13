import { describe, expect, it } from 'vitest';
import { buildOrderNow } from './orderNow';

/**
 * «Сейчас» — единственная строка, отвечающая менеджеру «где заказ и почему
 * стоит». Правило выбора важнее подписи: заказ показывает то, что мешает
 * СИЛЬНЕЕ ВСЕГО, а не то, что первое по маршруту.
 */

const DEPTS = [
  { id: 'd-cut', code: 'cutting', name: 'Закройный цех', is_production: true, active: true, sort_order: 1 },
  { id: 'd-sew', code: 'sewing', name: 'Швейный цех', is_production: true, active: true, sort_order: 2 },
] as never[];

let seq = 0;
function stage(over: Record<string, unknown> = {}) {
  seq += 1;
  return {
    id: `st-${seq}`,
    department_id: 'd-cut',
    status: 'ready',
    sort_order: 10,
    depends_on: [],
    qty_done: 0,
    qty_rework: 0,
    executor: 'internal',
    ...over,
  };
}

function order(stages: Record<string, unknown>[], over: Record<string, unknown> = {}) {
  return {
    id: 'o1',
    status: 'active',
    title: 'Заказ',
    tz_required: false,
    items: [{ id: 'i1', qty: 200, stages }],
    materials: [],
    procurement_tasks: [],
    ...over,
  } as never;
}

const nowOf = (o: unknown) => buildOrderNow([o] as never[], DEPTS).get('o1')!;

describe('«Сейчас» для заказа', () => {
  it('идущая работа названа участком и числами', () => {
    const now = nowOf(order([stage({ status: 'in_progress', qty_done: 80 })]));
    expect(now.where).toBe('Закройный цех');
    expect(now.what).toBe('в работе 80/200');
    expect(now.stopped).toBe(false);
    expect(now.variant).toBe('progress');
  });

  it('готовое к запуску задание — «готов к запуску»', () => {
    const now = nowOf(order([stage({ status: 'ready' })]));
    expect(now.what).toBe('готов к запуску');
    expect(now.stopped).toBe(false);
  });

  /**
   * ГЛАВНОЕ ПРАВИЛО. Заказ, у которого одна позиция шьётся, а вторая стоит
   * с проблемой, обязан показать ПРОБЛЕМУ: строка «в работе» скрыла бы затор,
   * а список читают именно ради него.
   */
  it('проблема цеха перебивает идущую работу', () => {
    const now = nowOf(order([
      stage({ status: 'in_progress', qty_done: 50 }),
      stage({ department_id: 'd-sew', status: 'blocked', block_reason: 'нет ниток 120', sort_order: 20 }),
    ]));
    expect(now.where).toBe('Швейный цех');
    expect(now.what).toBe('проблема');
    expect(now.why).toBe('нет ниток 120');
    expect(now.stopped).toBe(true);
    expect(now.variant).toBe('blocked');
  });

  it('ожидание предыдущего цеха считается остановкой и называет причину', () => {
    const first = stage({ status: 'in_progress' });
    const now = nowOf(order([
      first,
      stage({ department_id: 'd-sew', status: 'waiting', sort_order: 20, depends_on: [first.id] }),
    ]));
    expect(now.stopped).toBe(true);
    expect(now.why).toBeTruthy();
  });

  /**
   * «Наша работа кончилась» и «работа не заведена» — РАЗНЫЕ ответы. Второй
   * означает, что маршрут не материализовался, и чинит это диспетчер.
   */
  it('доделанный заказ ждёт склада, а заказ без этапов говорит об этом прямо', () => {
    const done = nowOf(order([stage({ status: 'done', qty_done: 200 })]));
    expect(done.what).toBe('готов к отгрузке');
    expect(done.stopped).toBe(false);

    const empty = nowOf(order([]));
    expect(empty.what).toBe('маршрута нет');
    expect(empty.stopped).toBe(true);
  });

  /**
   * ТРЕТИЙ ИСХОД, найденный на живом экране: этапы закрыты, но склад ещё
   * не может отгрузить (материалы не приняты). Первая редакция знала два
   * ответа и подписывала такой заказ «этапов нет» при четырёх закрытых
   * этапах — то есть врала о самом частом состоянии конца маршрута.
   */
  it('этапы закрыты, но отгрузить нельзя — причина названа, а не «этапов нет»', () => {
    const now = nowOf(order([stage({ status: 'done', qty_done: 200 })], {
      materials: [{ id: 'm1', item_id: null, kind: 'fabric', name: 'Кулирка', status: 'pending' }],
    }));
    expect(now.what).toBe('производство закончено');
    expect(now.why).toMatch(/Кулирка/);
    expect(now.stopped).toBe(true);
  });

  it('строка есть у каждого заказа списка, включая архивный', () => {
    const map = buildOrderNow(
      [order([stage()]), order([stage({ status: 'done' })], { id: 'o2', status: 'done_on_time' })] as never[],
      DEPTS,
    );
    expect(map.size).toBe(2);
    expect(map.get('o2')).toBeTruthy();
  });

  /**
   * Подрядный этап в очередь нашего цеха не попадает (правило проекта), значит
   * и «Сейчас» о нём молчит: показать его менеджеру как работу цеха было бы
   * неправдой — её делает внешний исполнитель.
   */
  it('подрядный этап не выдаётся за работу цеха', () => {
    const now = nowOf(order([stage({ status: 'ready', executor: 'contractor' })]));
    expect(now.what).not.toBe('готов к запуску');
  });
});
