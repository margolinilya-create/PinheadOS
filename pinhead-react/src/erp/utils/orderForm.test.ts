import { describe, it, expect, beforeEach } from 'vitest';
import {
  EMPTY_ITEM,
  EMPTY_PRINT,
  ORDER_DRAFT_KEY,
  clearOrderDraft,
  effectiveQty,
  emptyOrderForm,
  gridToPayload,
  gridTotal,
  isFormEmpty,
  isItemEmpty,
  loadOrderDraft,
  saveOrderDraft,
  SIZE_PRESETS,
  emptyPurchaseRow,
  isPurchaseRowEmpty,
  toggleSize,
  validateOrderForm,
  type DraftItem,
} from './orderForm';
import type { DraftGrid } from './orderForm';
import { factoryToday } from '../../utils/date';

function item(patch: Partial<DraftItem> = {}): DraftItem {
  return { ...EMPTY_ITEM, prints: [], size_grid: null, ...patch };
}

// ─── Черновик в localStorage ─────────────────────────────────────────────────

describe('черновик заказа (localStorage)', () => {
  beforeEach(() => localStorage.clear());

  it('сохраняется и восстанавливается', () => {
    const form = { ...emptyOrderForm('2026-07-17'), title: 'BOX39 свитшоты' };
    const items = [item({ product_type: 'свитшот', qty: '50' })];
    saveOrderDraft(form, items);

    const restored = loadOrderDraft();
    expect(restored).not.toBeNull();
    expect(restored!.form.title).toBe('BOX39 свитшоты');
    expect(restored!.items).toHaveLength(1);
    expect(restored!.items[0].product_type).toBe('свитшот');
  });

  it('нет черновика → null', () => {
    expect(loadOrderDraft()).toBeNull();
  });

  it('битый JSON или неверная форма → null', () => {
    localStorage.setItem(ORDER_DRAFT_KEY, '{oops');
    expect(loadOrderDraft()).toBeNull();
    localStorage.setItem(ORDER_DRAFT_KEY, JSON.stringify({ form: null, items: [] }));
    expect(loadOrderDraft()).toBeNull();
    localStorage.setItem(ORDER_DRAFT_KEY, JSON.stringify({ form: {}, items: [] }));
    expect(loadOrderDraft()).toBeNull();
  });

  it('clearOrderDraft удаляет черновик', () => {
    saveOrderDraft(emptyOrderForm(), [item({ product_type: 'футболка' })]);
    clearOrderDraft();
    expect(loadOrderDraft()).toBeNull();
  });

  it('старый черновик без has_branding: флаг выводится из наличия нанесений', () => {
    const legacy = {
      form: { ...emptyOrderForm(), title: 'Старый' },
      items: [
        { ...item({ product_type: 'худи' }), prints: [{ ...EMPTY_PRINT }] },
        { ...item({ product_type: 'кепка' }), prints: [] },
      ].map((it) => {
        const rest: Record<string, unknown> = { ...it };
        delete rest.has_branding;
        return rest;
      }),
      savedAt: '2026-07-17T10:00:00Z',
    };
    localStorage.setItem(ORDER_DRAFT_KEY, JSON.stringify(legacy));
    const restored = loadOrderDraft();
    expect(restored!.items[0].has_branding).toBe(true);
    expect(restored!.items[1].has_branding).toBe(false);
  });

  it('черновик дополняется дефолтами формы (новые поля не ломают восстановление)', () => {
    localStorage.setItem(
      ORDER_DRAFT_KEY,
      JSON.stringify({ form: { title: 'Без буфера' }, items: [{ product_type: 'шоппер' }] }),
    );
    const restored = loadOrderDraft();
    expect(restored!.form.buffer_days).toBe('0');
    expect(restored!.form.packaging).toBe('none');
    expect(restored!.items[0].production_type).toBe('sewing');
    expect(restored!.items[0].prints).toEqual([]);
  });
});

// ─── Размерная сетка: сумма и авторасчёт qty ─────────────────────────────────

describe('gridTotal / effectiveQty', () => {
  /**
   * Тип обязателен: без него строки выводятся как союз двух РАЗНЫХ форм
   * (у второй нет ключа L), и `sizes` перестаёт быть `Record<string, number>`.
   * Ровно это и проверяет тест — что пропущенный размер считается за ноль.
   */
  const grid: DraftGrid = {
    sizes: ['S', 'M', 'L'],
    rows: [
      { color: 'чёрный', sizes: { S: 5, M: 10, L: 0 } },
      { color: 'белый', sizes: { S: 2, M: 3 } },
    ],
  };

  it('сумма по всем строкам и активным размерам', () => {
    expect(gridTotal(grid)).toBe(20);
  });

  it('убранный чипс-размер не считается, хотя значение сохранено в row.sizes', () => {
    const without = toggleSize(grid, 'M'); // выключили M
    expect(without.sizes).toEqual(['S', 'L']);
    expect(gridTotal(without)).toBe(7);
    // повторное добавление — количества вернулись (ничего не потеряно)
    const back = toggleSize(without, 'M');
    expect(gridTotal(back)).toBe(20);
  });

  it('пустая/отсутствующая сетка = 0', () => {
    expect(gridTotal(null)).toBe(0);
    expect(gridTotal({ sizes: [], rows: [] })).toBe(0);
    expect(gridTotal({ sizes: ['S'], rows: [] })).toBe(0);
  });

  it('effectiveQty: сетка заполнена → сумма сетки, иначе ручное значение', () => {
    expect(effectiveQty({ qty: '99', size_grid: grid })).toBe(20);
    expect(effectiveQty({ qty: '99', size_grid: null })).toBe(99);
    expect(effectiveQty({ qty: '', size_grid: null })).toBe(0);
  });
});

describe('размерный ряд', () => {
  it('покрывает 3XS—5XL — прямое требование заказчика 16.08', () => {
    expect(SIZE_PRESETS.adult[0]).toBe('3XS');
    expect(SIZE_PRESETS.adult.at(-1)).toBe('5XL');
  });

  it('идёт по возрастанию, без пропусков в середине', () => {
    expect(SIZE_PRESETS.adult).toEqual(
      ['3XS', '2XS', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'],
    );
  });

  it('написание одно: XXL из прежнего набора не соседствует с 2XL', () => {
    // Иначе в одном ряду стояли бы два разных правила подряд (XXL, затем 3XL).
    // Прежним заказам это не мешает: размеры хранятся ключами JSON в size_grid,
    // и показывают их из самих данных, а не из этого списка.
    expect(SIZE_PRESETS.adult).not.toContain('XXL');
  });

  it('детский ряд не тронут', () => {
    expect(SIZE_PRESETS.kids).toContain('92');
    expect(SIZE_PRESETS.kids).toContain('146');
  });
});

describe('toggleSize', () => {
  it('добавляет и убирает размер без дублей', () => {
    let g = toggleSize(null, 'XL');
    expect(g.sizes).toEqual(['XL']);
    g = toggleSize(g, 'XL');
    expect(g.sizes).toEqual([]);
  });
});

describe('gridToPayload', () => {
  it('в payload попадают только активные размеры и непустые строки', () => {
    const payload = gridToPayload({
      sizes: ['S', 'M'],
      rows: [
        { color: '', sizes: { S: 3, XL: 7 } }, // XL выключен — не должен попасть
        { color: '', sizes: {} }, // пустая строка — отбрасывается
        { color: 'красный', sizes: {} }, // только цвет — остаётся
      ],
    });
    expect(payload).toEqual([
      { color: '—', sizes: { S: 3 } },
      { color: 'красный', sizes: {} },
    ]);
  });

  it('нет строк → null', () => {
    expect(gridToPayload(null)).toBeNull();
    expect(gridToPayload({ sizes: ['S'], rows: [] })).toBeNull();
    expect(gridToPayload({ sizes: [], rows: [{ color: '', sizes: {} }] })).toBeNull();
  });
});

// ─── Валидация ────────────────────────────────────────────────────────────────

describe('validateOrderForm', () => {
  const today = '2026-07-17';
  const okForm = { ...emptyOrderForm(today), title: 'Заказ' };

  it('пустое название — ошибка с привязкой к полю', () => {
    const v = validateOrderForm({ ...okForm, title: '  ' }, [item({ product_type: 'ф', qty: '1' })], today);
    expect(v.errors.title).toBe('Укажите название заказа');
    expect(v.missing).toContain('Название');
  });

  it('брендирование без единого нанесения — заказ не проходит', () => {
    const v = validateOrderForm(
      okForm,
      [item({ product_type: 'футболка', qty: '10', has_branding: true, prints: [] })],
      today,
    );
    expect(v.errors.item_0_prints).toBe('Добавьте хотя бы одно нанесение');
    expect(v.missing).toContain('Нанесения');
  });

  it('брендирование с нанесением — ок', () => {
    const v = validateOrderForm(
      okForm,
      [item({ product_type: 'футболка', qty: '10', has_branding: true, prints: [{ ...EMPTY_PRINT }] })],
      today,
    );
    expect(v.errors).toEqual({});
    expect(v.missing).toEqual([]);
  });

  it('qty из размерной сетки засчитывается (ручное поле пустое)', () => {
    const v = validateOrderForm(
      okForm,
      [item({
        product_type: 'худи',
        qty: '',
        size_grid: { sizes: ['S'], rows: [{ color: '', sizes: { S: 4 } }] },
      })],
      today,
    );
    expect(v.errors).toEqual({});
  });

  it('пустая сетка и пустое qty — ошибка количества', () => {
    const v = validateOrderForm(okForm, [item({ product_type: 'худи', qty: '' })], today);
    expect(v.errors.item_0_qty).toBe('Количество должно быть больше 0');
    expect(v.missing).toContain('Кол-во');
  });

  it('пустая дополнительная строка позиции пропускается, ошибки нумеруются', () => {
    const v = validateOrderForm(
      okForm,
      [item({ product_type: 'футболка', qty: '5' }), item()],
      today,
    );
    expect(v.errors).toEqual({});

    const v2 = validateOrderForm(
      okForm,
      [item({ product_type: 'футболка', qty: '5' }), item({ variant: 'синие' })],
      today,
    );
    expect(v2.errors.item_1_product_type).toBe('Укажите изделие');
    expect(v2.missing).toContain('Изделие (поз. 2)');
  });

  it('срок клиента в прошлом — ошибка', () => {
    const v = validateOrderForm(
      { ...okForm, due_date: '2026-07-01' },
      [item({ product_type: 'ф', qty: '1' })],
      today,
    );
    expect(v.errors.due_date).toBe('Срок клиента в прошлом — проверьте дату');
  });

  it('дата в прошлом — это invalid, а не missing', () => {
    // Черновик восстанавливается назавтра с вчерашней датой запуска. Раньше поле
    // попадало в missing, и подсказка говорила «Осталось заполнить: Дата запуска»
    // при заполненном поле — указывая не на ту проблему.
    const v = validateOrderForm(
      { ...okForm, launch_date: '2026-07-01', due_date: '2026-07-02' },
      [item({ product_type: 'ф', qty: '1' })],
      today,
    );
    expect(v.errors.launch_date).toBe('Дата запуска в прошлом — проверьте дату');
    expect(v.invalid).toContain('Дата запуска');
    expect(v.invalid).toContain('Срок клиента');
    expect(v.missing).not.toContain('Дата запуска');
  });

  it('подряд с доработкой требует следующего участка', () => {
    const base = {
      product_type: 'ф', qty: '10',
      production_type: 'outsource', subcontract_kind: 'operation',
    };
    const withFurther = validateOrderForm(
      okForm, [item({ ...base, needs_further: true, return_dept: '' })], today,
    );
    expect(withFurther.errors.item_0_return_dept).toBe('Выберите участок для доработки');
    expect(withFurther.missing).toContain('Следующий участок');

    // Участок выбран либо доработка не нужна — ошибки нет
    for (const it of [
      item({ ...base, needs_further: true, return_dept: 'sewing' }),
      item({ ...base, needs_further: false, return_dept: '' }),
      item({ product_type: 'ф', qty: '10' }),
    ]) {
      expect(validateOrderForm(okForm, [it], today).errors.item_0_return_dept).toBeUndefined();
    }
  });

  it('дата запуска сегодня, в будущем или пустая — без ошибки', () => {
    for (const launch_date of [today, '2026-07-20', '']) {
      const v = validateOrderForm(
        { ...okForm, launch_date },
        [item({ product_type: 'ф', qty: '1' })],
        today,
      );
      expect(v.errors.launch_date).toBeUndefined();
    }
  });

  /**
   * Лист закупки. Оба поля подписаны звёздочкой, но не проверялись вовсе —
   * дефект найден прокликиванием на боевой базе: заказ создался со строкой
   * закупки без количества. Молча: `supply.missingPlan` требует `qty_expected`,
   * поэтому такая закупка не закроется автоматически никогда.
   */
  describe('лист закупки', () => {
    const row = (patch = {}) => ({ ...emptyPurchaseRow('k1'), ...patch });
    const okItems = [item({ product_type: 'ф', qty: '1' })];

    it('начатая строка без количества — ошибка у поля', () => {
      const v = validateOrderForm(okForm, okItems, today, [row({ name: 'Футер 320' })]);
      expect(v.errors.purchase_0_qty).toBe('Количество должно быть больше 0');
      expect(v.missing).toContain('Кол-во закупки');
    });

    it('строка без названия — ошибка у поля', () => {
      const v = validateOrderForm(okForm, okItems, today, [row({ qty_expected: '120' })]);
      expect(v.errors.purchase_0_name).toBe('Укажите материал');
      expect(v.missing).toContain('Материал закупки');
    });

    /** Нажали «+ Позиция закупки» и передумали — это не ошибка */
    it('совсем пустая строка не мешает создать заказ', () => {
      const v = validateOrderForm(okForm, okItems, today, [row()]);
      expect(v.errors).toEqual({});
    });

    it('заполненная строка проходит', () => {
      const v = validateOrderForm(okForm, okItems, today,
        [row({ name: 'Футер 320', qty_expected: '120' })]);
      expect(v.errors).toEqual({});
    });

    it('ошибки нумеруются по строкам', () => {
      const v = validateOrderForm(okForm, okItems, today, [
        row({ name: 'Футер 320', qty_expected: '120' }),
        { ...emptyPurchaseRow('k2'), name: 'Рибана' },
      ]);
      expect(v.errors.purchase_1_qty).toBeDefined();
      expect(v.errors.purchase_0_qty).toBeUndefined();
      expect(v.missing).toContain('Кол-во закупки (строка 2)');
    });

    /** Лист не передан вовсе (старые вызовы) — поведение прежнее */
    it('без листа закупки валидация работает как раньше', () => {
      expect(validateOrderForm(okForm, okItems, today).errors).toEqual({});
    });
  });
});

// ─── Пустота формы ────────────────────────────────────────────────────────────

describe('isFormEmpty / isItemEmpty', () => {
  const launch = factoryToday();

  it('свежая форма с дефолтной датой запуска — пустая', () => {
    expect(isFormEmpty(emptyOrderForm(launch), [item()], launch)).toBe(true);
  });

  it('любое заполненное поле — форма не пустая', () => {
    expect(isFormEmpty({ ...emptyOrderForm(launch), title: 'X' }, [item()], launch)).toBe(false);
    expect(isFormEmpty(emptyOrderForm(launch), [item({ variant: 'син' })], launch)).toBe(false);
    expect(isFormEmpty({ ...emptyOrderForm(launch), packaging: 'zip' }, [item()], launch)).toBe(false);
  });

  it('позиция с сеткой или нанесением — не пустая', () => {
    expect(isItemEmpty(item())).toBe(true);
    expect(isItemEmpty(item({ prints: [{ ...EMPTY_PRINT }] }))).toBe(false);
    expect(isItemEmpty(item({
      size_grid: { sizes: ['S'], rows: [{ color: '', sizes: { S: 1 } }] },
    }))).toBe(false);
  });
});

// ─── Лист закупки ────────────────────────────────────────────────────────────

describe('лист закупки в черновике', () => {
  beforeEach(() => localStorage.clear());

  it('строка считается пустой, пока в ней нет ни одного значащего поля', () => {
    const r = emptyPurchaseRow('k1');
    expect(isPurchaseRowEmpty(r)).toBe(true);
    // Тип и роль имеют значения по умолчанию — сами по себе они не данные
    expect(isPurchaseRowEmpty({ ...r, kind: 'labels', role: 'trim' })).toBe(true);
  });

  it('любое заполненное поле делает строку значащей', () => {
    const r = emptyPurchaseRow('k1');
    expect(isPurchaseRowEmpty({ ...r, name: 'Кулирка' })).toBe(false);
    expect(isPurchaseRowEmpty({ ...r, color: 'чёрный' })).toBe(false);
    expect(isPurchaseRowEmpty({ ...r, qty_expected: '120' })).toBe(false);
    expect(isPurchaseRowEmpty({ ...r, manager_note: 'как в прошлый раз' })).toBe(false);
  });

  it('ноль в количестве — не данные: поле трогали, но ничего не сказали', () => {
    expect(isPurchaseRowEmpty({ ...emptyPurchaseRow('k1'), qty_expected: '0' })).toBe(true);
  });

  it('лист сохраняется в черновик и восстанавливается', () => {
    const rows = [{ ...emptyPurchaseRow('k1'), name: 'Кулирка', qty_expected: '120' }];
    saveOrderDraft(emptyOrderForm(), [item({ product_type: 'Худи', qty: 10 })], rows);
    expect(loadOrderDraft()?.purchase).toEqual(rows);
  });

  it('черновик БЕЗ листа (сохранён до правки 16.08) восстанавливается с пустым', () => {
    // Человек мог начать заказ вчера — падать на этом нельзя
    saveOrderDraft(emptyOrderForm(), [item({ product_type: 'Худи', qty: 10 })]);
    expect(loadOrderDraft()?.purchase).toEqual([]);
  });

  it('строка из старого черновика дополняется значениями по умолчанию', () => {
    localStorage.setItem(ORDER_DRAFT_KEY, JSON.stringify({
      form: emptyOrderForm(),
      items: [item({ product_type: 'Худи', qty: 10 })],
      purchase: [{ key: 'k1', name: 'Кулирка' }],
      savedAt: new Date().toISOString(),
    }));
    const restored = loadOrderDraft()?.purchase?.[0];
    expect(restored?.kind).toBe('fabric');
    expect(restored?.item_index).toBeNull();
    expect(restored?.name).toBe('Кулирка');
  });
});
