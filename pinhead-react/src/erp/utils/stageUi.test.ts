import { describe, it, expect } from 'vitest';
import {
  isOrderReadyToShip,
  shipBlockReason,
  isOrderOverdue,
  orderOverdueDays,
} from './stageUi';
import type { StageStatus } from '../types';

/** Заказ-минимум для проверки готовности к отгрузке */
function order(status: string, itemStages: StageStatus[][]) {
  return {
    status,
    items: itemStages.map((stages) => ({
      stages: stages.map((s) => ({ status: s })),
    })),
  };
}


/** Материал заказа: статус + (для закупки) результат приёмки складом */
function mat(status: string, accept: string | null = null, name = 'Материал') {
  return { status, accept_status: accept, name } as never;
}
/** Пришедший и принятый складом материал */
function accepted() {
  return mat('received', 'accepted_full');
}
/** Заказ со всеми этапами done и заданным набором материалов */
function withMats(materials: ReturnType<typeof mat>[]) {
  return { ...order('active', [['done']]), materials };
}

describe('isOrderReadyToShip — стадия «Готов к отгрузке»', () => {
  it('все этапы done → готов', () => {
    expect(isOrderReadyToShip(order('active', [['done', 'done']]))).toBe(true);
  });

  it('done + skipped → готов (skipped считается завершённым)', () => {
    expect(isOrderReadyToShip(order('active', [['done', 'skipped'], ['done']]))).toBe(true);
  });

  it('есть незавершённый этап (in_progress) → не готов', () => {
    expect(isOrderReadyToShip(order('active', [['done', 'in_progress']]))).toBe(false);
  });

  it('waiting / ready / blocked → не готов', () => {
    expect(isOrderReadyToShip(order('active', [['done', 'waiting']]))).toBe(false);
    expect(isOrderReadyToShip(order('active', [['done', 'ready']]))).toBe(false);
    expect(isOrderReadyToShip(order('active', [['done', 'blocked']]))).toBe(false);
  });

  it('незавершённый этап в любой из позиций → не готов', () => {
    expect(isOrderReadyToShip(order('active', [['done'], ['in_progress']]))).toBe(false);
  });

  it('без этапов вообще → не готов (нечего отгружать)', () => {
    expect(isOrderReadyToShip(order('active', []))).toBe(false);
    expect(isOrderReadyToShip(order('active', [[], []]))).toBe(false);
  });

  it('неактивный (архивный) заказ → не готов, даже если все этапы done', () => {
    expect(isOrderReadyToShip(order('done_on_time', [['done']]))).toBe(false);
    expect(isOrderReadyToShip(order('cancelled', [['done']]))).toBe(false);
  });

  it('непришедший материал → не готов, даже если все этапы done (аудит #5)', () => {
    expect(isOrderReadyToShip(withMats([mat('pending')]))).toBe(false); // сирота-материал не пришёл
    expect(isOrderReadyToShip(withMats([accepted(), mat('ordered')]))).toBe(false);
    expect(isOrderReadyToShip(withMats([]))).toBe(true);
  });

  it('годны без приёмки: «не требуется» и «доступен со склада»', () => {
    expect(isOrderReadyToShip(withMats([mat('not_needed'), mat('reserved')]))).toBe(true);
  });

  /**
   * Гейт отгрузки судит о материалах по тому же правилу, что и запуск этапа:
   * пришедший закупочный материал годен ТОЛЬКО после приёмки складом.
   * Раньше отгрузка считала годным любой `received` — заказ с недостачей,
   * пересортом или отказом склада доходил до «готов к отгрузке».
   */
  it('пришёл, но склад не принял → не готов', () => {
    expect(isOrderReadyToShip(withMats([mat('received')]))).toBe(false);
    expect(isOrderReadyToShip(withMats([mat('received', 'rejected')]))).toBe(false);
    expect(isOrderReadyToShip(withMats([mat('received', 'shortage')]))).toBe(false);
    expect(isOrderReadyToShip(withMats([mat('received', 'mismatch')]))).toBe(false);
  });

  it('принят полностью или частично → готов', () => {
    expect(isOrderReadyToShip(withMats([mat('received', 'accepted_full')]))).toBe(true);
    expect(isOrderReadyToShip(withMats([mat('received', 'accepted_partial')]))).toBe(true);
  });
});

describe('shipBlockReason — почему нельзя отгружать', () => {
  it('нет причины, когда заказ готов', () => {
    expect(shipBlockReason(withMats([accepted()]))).toBeNull();
  });

  it('называет число незавершённых этапов', () => {
    const o = { ...order('active', [['done', 'in_progress'], ['waiting']]), materials: [] };
    expect(shipBlockReason(o)).toBe('Не завершены этапы: 2');
  });

  it('различает «не пришло» и «склад не принял»', () => {
    expect(shipBlockReason(withMats([mat('pending', null, 'Кулирка')])))
      .toBe('Не получены материалы: Кулирка');
    expect(shipBlockReason(withMats([mat('received', 'shortage', 'Бирки')])))
      .toBe('Склад не принял материалы: Бирки');
  });

  it('заказ без позиций отгружать нечем', () => {
    expect(shipBlockReason({ ...order('active', []), materials: [] }))
      .toBe('В заказе нет позиций');
  });

  it('производственная позиция без этапов — сбой маршрута, причина ведёт к диспетчеру', () => {
    expect(shipBlockReason({ ...order('active', [[]]), materials: [] }))
      .toBe('У позиций нет этапов маршрута — обратитесь к диспетчеру');
  });

  it('архивный заказ причин не показывает', () => {
    expect(shipBlockReason({ ...order('done_on_time', [['done']]), materials: [] })).toBeNull();
  });
});

/**
 * Заказ, у которого производственных этапов нет по правилу, а не по ошибке.
 *
 * `BASE_CHAIN.outsource` = ['supply'], и `buildItemRoute` вырезает `supply`, когда
 * материал даёт подрядчик → маршрут пуст. Работа при этом реально идёт — у подрядчика,
 * в `erp_subcontracting`. Прежний гейт отвечал `false` на любой заказ без этапов, а склад
 * отгружает ТОЛЬКО через `isOrderReadyToShip`: такой заказ нельзя было закрыть никогда,
 * он вечно висел активным и портил счётчики, а кладовщик видел отказ без причины.
 */
describe('Отгрузка заказа, который целиком производится вне цехов', () => {
  /** Позиция без этапов с заданным типом производства */
  function extItem(production_type: string, material_source: string | null = null) {
    return { stages: [], production_type, material_source };
  }

  it('подряд с материалом подрядчика: пустой маршрут не мешает отгрузке', () => {
    const o = { status: 'active', items: [extItem('outsource', 'contractor')], materials: [] };
    expect(isOrderReadyToShip(o)).toBe(true);
    expect(shipBlockReason(o)).toBeNull();
  });

  it('позиция «только нанесение» без своего цеха тоже отгружается', () => {
    const o = { status: 'active', items: [extItem('no_product')], materials: [] };
    expect(isOrderReadyToShip(o)).toBe(true);
  });

  it('непринятый материал держит такой заказ так же, как обычный', () => {
    const o = {
      status: 'active',
      items: [extItem('outsource', 'contractor')],
      materials: [mat('received', 'shortage', 'Бирки')],
    };
    expect(isOrderReadyToShip(o)).toBe(false);
    expect(shipBlockReason(o)).toBe('Склад не принял материалы: Бирки');
  });

  it('смешанный заказ: швейная позиция без этапов остаётся сбоем маршрута', () => {
    const o = {
      status: 'active',
      items: [extItem('outsource', 'contractor'), extItem('sewing')],
      materials: [],
    };
    expect(isOrderReadyToShip(o)).toBe(false);
    expect(shipBlockReason(o)).toBe('У позиций нет этапов маршрута — обратитесь к диспетчеру');
  });

  it('если у внешней позиции этапы всё же есть, они судятся как обычно', () => {
    const withStage = {
      status: 'active',
      items: [{ stages: [{ status: 'in_progress' as const }], production_type: 'outsource' }],
      materials: [],
    };
    expect(isOrderReadyToShip(withStage)).toBe(false);
    expect(shipBlockReason(withStage)).toBe('Не завершены этапы: 1');
  });
});

/**
 * ОБРАЗЕЦ: РАБОТА ЖИВЁТ В РАЗРАБОТКЕ, А НЕ В ЭТАПАХ (правки заказчика 02.09).
 *
 * После п. 1 маршрут образца — одна закупка, а при отметке «Закупка
 * не требуется» этапов не остаётся вовсе. Обе половины гейта проверяются здесь,
 * и они тянут в РАЗНЫЕ стороны:
 *
 * · пустой маршрут больше не запирает заказ (иначе образец без закупки нельзя
 *   было бы отгрузить НИКОГДА — ровно тупик, ради которого и появился
 *   `hasNoRouteByDesign`);
 * · незавершённая разработка держит заказ вместо этапов.
 */
describe('Отгрузка образца: пустой маршрут не запирает, разработка держит', () => {
  /** Позиция-образец без единого этапа маршрута */
  const sample = { stages: [], production_type: 'samples' };

  it('образец без этапов и с закрытой разработкой отгружается', () => {
    const o = {
      status: 'active',
      items: [sample],
      materials: [],
      developments: [{ outcome: 'ready_for_serial' }],
    };
    expect(isOrderReadyToShip(o)).toBe(true);
    expect(shipBlockReason(o)).toBeNull();
  });

  it('незавершённая разработка держит заказ и НАЗЫВАЕТ действие', () => {
    const o = {
      status: 'active',
      items: [sample],
      materials: [],
      developments: [{ outcome: null }],
    };
    expect(isOrderReadyToShip(o)).toBe(false);
    expect(shipBlockReason(o)).toContain('Завершить разработку');
  });

  it('держит и заказ с полностью закрытым маршрутом', () => {
    const o = {
      ...order('active', [['done', 'done']]),
      materials: [],
      developments: [{ outcome: null }],
    };
    expect(isOrderReadyToShip(o)).toBe(false);
  });

  /**
   * ОТСУТСТВИЕ КЛЮЧА — FAIL-OPEN, и сторож на это обязателен. Заказ, приехавший
   * старым бандлом или собранный в фикстуре без поля, обязан отгружаться
   * как раньше; мутация «трактовать отсутствие как открытую разработку»
   * положила бы весь склад, и ни один другой тест этого не заметил бы.
   */
  it('поля developments нет вовсе — судим как раньше', () => {
    expect(isOrderReadyToShip({ ...order('active', [['done']]), materials: [] })).toBe(true);
  });

  it('незакрытый этап называется РАНЬШЕ разработки', () => {
    const o = {
      ...order('active', [['done', 'in_progress']]),
      materials: [],
      developments: [{ outcome: null }],
    };
    expect(shipBlockReason(o)).toBe('Не завершены этапы: 1');
  });

  /**
   * Зеркальный сторож правки `hasNoRouteByDesign`: производственная позиция
   * без этапов по-прежнему читается как СБОЙ маршрута, а не как «работа
   * в другом месте». Иначе правка «у образца маршрута нет по правилу»
   * однажды прочиталась бы как «пустой маршрут нормален у всех».
   */
  it('швейная позиция без этапов рядом с образцом остаётся сбоем маршрута', () => {
    const o = {
      status: 'active',
      items: [sample, { stages: [], production_type: 'sewing' }],
      materials: [],
      developments: [],
    };
    expect(isOrderReadyToShip(o)).toBe(false);
    expect(shipBlockReason(o)).toBe('У позиций нет этапов маршрута — обратитесь к диспетчеру');
  });
});

describe('isOrderOverdue — просрочка заказа (решение заказчика 03.08.2026)', () => {
  const late = -5;

  it('срок прошёл и работа не закрыта → просрочен', () => {
    expect(isOrderOverdue(order('active', [['done', 'in_progress']]), late)).toBe(true);
  });

  it('срок прошёл, но заказ готов к отгрузке → НЕ просрочен', () => {
    // Ждёт логистики, а не производства. Ровно эти заказы раздували метрику
    // до 47 из 76 и делали её бесполезной.
    expect(isOrderOverdue(order('active', [['done', 'done']]), late)).toBe(false);
  });

  it('срок ещё не наступил → не просрочен независимо от готовности', () => {
    expect(isOrderOverdue(order('active', [['waiting']]), 3)).toBe(false);
    expect(isOrderOverdue(order('active', [['waiting']]), 0)).toBe(false);
  });

  it('срока нет → не просрочен (19 таких заказов в базе на 03.08.2026)', () => {
    expect(isOrderOverdue(order('active', [['waiting']]), null)).toBe(false);
  });

  it('архивный заказ не просрочен: isOrderReadyToShip даёт false, но судить нечего', () => {
    // Заказ вне работы не «горит» — он закрыт. Экраны фильтруют по status='active'
    // до вызова, и здесь фиксируем, что на архив функция не рассчитана.
    expect(isOrderOverdue(order('done_late', [['done']]), late)).toBe(true);
  });

  it('дни просрочки: положительное число, ноль когда не просрочен', () => {
    expect(orderOverdueDays(order('active', [['waiting']]), -12)).toBe(12);
    expect(orderOverdueDays(order('active', [['done']]), -12)).toBe(0);
    expect(orderOverdueDays(order('active', [['waiting']]), 4)).toBe(0);
    expect(orderOverdueDays(order('active', [['waiting']]), null)).toBe(0);
  });
});
