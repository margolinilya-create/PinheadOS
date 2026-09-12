import { describe, it, expect, beforeEach } from 'vitest';
import {
  EMPTY_ITEM,
  emptyLabel,
  emptyPrint,
  normalizeDraft,
  ORDER_DRAFT_KEY,
  clearOrderDraft,
  effectiveQty,
  emptyOrderForm,
  gridToPayload,
  gridTotal,
  rowTotal,
  isFormEmpty,
  isItemEmpty,
  loadOrderDraft,
  SIZE_PRESETS,
  emptyPurchaseRow,
  toggleSize,
  validateOrderForm,
  brandingOnOptions,
  normalizeBrandingOn,
  type DraftItem,
} from './orderForm';
import type { DraftGrid } from './orderForm';
import { factoryToday } from '../../utils/date';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { latestMatching } from './migrations.testutil';

const SRC = join(process.cwd(), 'src');

function item(patch: Partial<DraftItem> = {}): DraftItem {
  return { ...EMPTY_ITEM, prints: [], size_grid: null, ...patch };
}

// ─── Нанесение «на крое» / «на готовом» (правки 07.09, п. 8) ─────────────────

describe('brandingOnOptions / normalizeBrandingOn', () => {
  it('у готового изделия остаётся только «на готовом»', () => {
    expect(brandingOnOptions('ready_garment')).toEqual(['finished']);
  });

  it('у остальных типов производства выбор прежний', () => {
    for (const t of ['sewing', 'cut', 'samples', 'no_product', 'outsource']) {
      expect(brandingOnOptions(t)).toEqual(['cut', 'finished']);
    }
  });

  /**
   * ВТОРАЯ ПОЛОВИНА ПРАВИЛА, и без неё первая ничего не решает: селект про
   * смену типа производства не знает, и позиция, переключённая на «Готовое
   * изделие» ПОСЛЕ выбора «на крое», уехала бы в payload с `cut`.
   */
  it('уже выбранное «на крое» при переходе на готовое изделие становится «на готовом»', () => {
    expect(normalizeBrandingOn('ready_garment', 'cut')).toBe('finished');
  });

  it('допустимое значение не трогается', () => {
    expect(normalizeBrandingOn('ready_garment', 'finished')).toBe('finished');
    expect(normalizeBrandingOn('sewing', 'cut')).toBe('cut');
    expect(normalizeBrandingOn('sewing', 'finished')).toBe('finished');
  });

  it('мусор приводится к первому допустимому', () => {
    expect(normalizeBrandingOn('sewing', '')).toBe('cut');
    expect(normalizeBrandingOn('ready_garment', 'что-то')).toBe('finished');
  });
});

// ─── Черновик в localStorage ─────────────────────────────────────────────────

/**
 * Снимок черновика, КАК ЕГО ПИСАЛА ПРЕЖНЯЯ ВЕРСИЯ формы.
 *
 * Писателя (`saveOrderDraft`) больше нет: черновики живут в `erp_order_drafts`,
 * а localStorage остался только на ЧТЕНИЕ — разовый перенос того, что человек
 * начал до перехода на базу. Тест поэтому кладёт снимок напрямую: круг
 * «сами записали — сами прочли» проверял бы собственную симметрию, а нужен
 * ровно обратный сценарий — чужая запись, наше чтение.
 */
function writeLegacyDraft(
  form: unknown, items: unknown[], purchase: unknown[] = [], notes: unknown[] = [],
): void {
  localStorage.setItem(ORDER_DRAFT_KEY, JSON.stringify({
    form, items, purchase, notes, savedAt: new Date().toISOString(),
  }));
}

describe('черновик заказа прежней версии (localStorage, только чтение)', () => {
  beforeEach(() => localStorage.clear());

  it('сохраняется и восстанавливается', () => {
    const form = { ...emptyOrderForm('2026-07-17'), title: 'BOX39 свитшоты' };
    const items = [item({ product_type: 'свитшот', qty: '50' })];
    writeLegacyDraft(form, items);

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
    writeLegacyDraft(emptyOrderForm(), [item({ product_type: 'футболка' })]);
    clearOrderDraft();
    expect(loadOrderDraft()).toBeNull();
  });

  it('старый черновик без has_branding: флаг выводится из наличия нанесений', () => {
    const legacy = {
      form: { ...emptyOrderForm(), title: 'Старый' },
      items: [
        { ...item({ product_type: 'худи' }), prints: [emptyPrint()] },
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
      JSON.stringify({ form: { title: 'Только название' }, items: [{ product_type: 'шоппер' }] }),
    );
    const restored = loadOrderDraft();
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

  // Итог по цвету (правки 07.09, п. 6): «справа показывать итог по цвету»
  it('rowTotal: сумма по строке одного цвета', () => {
    expect(rowTotal(grid.rows![0], grid.sizes)).toBe(15);
    expect(rowTotal(grid.rows![1], grid.sizes)).toBe(5);
  });

  /**
   * Считается по тем же АКТИВНЫМ размерам, что и общий итог: иначе сумма
   * строк не сошлась бы с «Всего» ровно тогда, когда чипс размера снят,
   * а количества в нём остались.
   */
  it('rowTotal и gridTotal согласованы: сумма строк = общий итог', () => {
    const sum = grid.rows!.reduce((s, r) => s + rowTotal(r, grid.sizes), 0);
    expect(sum).toBe(gridTotal(grid));

    const without = toggleSize(grid, 'M');
    const sum2 = without.rows!.reduce((s, r) => s + rowTotal(r, without.sizes), 0);
    expect(sum2).toBe(gridTotal(without));
  });

  it('rowTotal: пустая строка и отсутствие размеров дают 0', () => {
    expect(rowTotal(null, grid.sizes)).toBe(0);
    expect(rowTotal({ color: 'синий', sizes: {} }, grid.sizes)).toBe(0);
    expect(rowTotal(grid.rows![0], [])).toBe(0);
  });
});

describe('размерный ряд', () => {
  it('покрывает 3XS—5XL — прямое требование заказчика 16.08', () => {
    expect(SIZE_PRESETS.adult[0]).toBe('3XS');
    expect(SIZE_PRESETS.adult).toContain('5XL');
  });

  it('идёт по возрастанию, без пропусков в середине; ONE — в конце', () => {
    /**
     * `ONE` (безразмерный) добавлен правкой 07.09, п. 7 и стоит ПОСЛЕДНИМ:
     * он не часть возрастающего ряда, и место в середине разорвало бы шкалу.
     */
    expect(SIZE_PRESETS.adult).toEqual(
      ['3XS', '2XS', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', 'ONE'],
    );
  });

  it('колонки из документа 07.09 все перечислены', () => {
    // «2XS, XS, S, M, L, XL, 2XL, 3XL, 4XL, ONE и другие размеры»
    for (const sz of ['2XS', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', 'ONE']) {
      expect(SIZE_PRESETS.adult).toContain(sz);
    }
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
  /**
   * Базовая ВАЛИДНАЯ форма. С 20.08 в неё входит отметка «закупка
   * не требуется»: заказ без листа закупки и без отметки создать нельзя
   * (документ: «если не выполнено ни одно условие — заказ создать нельзя»),
   * и без этого поля каждая проверка ниже спотыкалась бы о лист закупки
   * вместо того, что она проверяет.
   */
  const okForm = { ...emptyOrderForm(today), title: 'Заказ', purchase_required: false };

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
      [item({ product_type: 'футболка', qty: '10', has_branding: true, prints: [emptyPrint()] })],
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

  it('срок клиента в прошлом — это invalid, а не missing', () => {
    // Черновик восстанавливается назавтра с вчерашним сроком. Раньше поле
    // попадало в missing, и подсказка говорила «Осталось заполнить: Срок
    // клиента» при заполненном поле — указывая не на ту проблему.
    const v = validateOrderForm(
      { ...okForm, launch_date: '2026-07-01', due_date: '2026-07-02' },
      [item({ product_type: 'ф', qty: '1' })],
      today,
    );
    expect(v.invalid).toContain('Срок клиента');
    expect(v.missing).not.toContain('Срок клиента');
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

  /**
   * Правка заказчика 30.08, п. 10: дату запуска разрешено ставить любую,
   * включая прошедшую, — заказ переносят в ERP задним числом. Прошлое
   * стоит в этом списке НАРЯДУ с сегодня и будущим, а не отдельным тестом:
   * именно так формулируется требование — дата запуска не зависит от
   * текущего дня вовсе.
   */
  it('дата запуска любая — сегодня, в прошлом, в будущем или пустая', () => {
    for (const launch_date of [today, '2026-07-01', '2026-07-20', '']) {
      const v = validateOrderForm(
        { ...okForm, launch_date },
        [item({ product_type: 'ф', qty: '1' })],
        today,
      );
      expect(v.errors.launch_date).toBeUndefined();
    }
  });

  /**
   * ПРОТИВОРЕЧИЕ «СРОК РАНЬШЕ ЗАПУСКА» стало достижимым той же правкой:
   * пока прошедший запуск запрещался, запуск был не раньше сегодня, а срок —
   * не раньше запуска по построению, и проверять было нечего. Сняв
   * ограничение, мы открыли опечатку в дате у заказа, заводимого задним
   * числом, — а от даты запуска считается подстановка плана этапа.
   */
  it('срок раньше даты запуска — ошибка, а не молчаливый приём', () => {
    const v = validateOrderForm(
      { ...okForm, launch_date: '2026-09-10', due_date: '2026-09-01' },
      [item({ product_type: 'ф', qty: '1' })],
      today,
    );
    expect(v.errors.due_date).toBe('Срок клиента раньше даты запуска — проверьте даты');
    expect(v.invalid).toContain('Срок клиента');
    expect(v.missing).not.toContain('Срок клиента');
  });

  it('срок позже запуска — обе даты в будущем и ошибки нет', () => {
    const v = validateOrderForm(
      { ...okForm, launch_date: '2026-09-01', due_date: '2026-09-10' },
      [item({ product_type: 'ф', qty: '1' })],
      today,
    );
    expect(v.errors.due_date).toBeUndefined();
  });

  it('прошедший срок называет себя прошедшим, а не «раньше запуска»', () => {
    // Две ошибки на одном поле спорят: у заказа задним числом прошедшими
    // будут ОБЕ даты, и человеку надо назвать ту причину, которую он чинит
    const v = validateOrderForm(
      { ...okForm, launch_date: '2026-07-01', due_date: '2026-07-10' },
      [item({ product_type: 'ф', qty: '1' })],
      today,
    );
    expect(v.errors.due_date).toBe('Срок клиента в прошлом — проверьте дату');
  });

  /**
   * ЛИСТ ЗАКУПКИ — ФАЙЛ (документ 20.08), и строк-подсказок больше нет
   * (правки 07.09, п. 14): проверки `purchase_{i}_name` / `purchase_{i}_qty`
   * ушли вместе с блоком, четвёртым аргументом стал `hasPurchaseList`.
   */
  describe('лист закупки', () => {
    const okItems = [item({ product_type: 'ф', qty: '1' })];

    /**
     * ГЛАВНОЕ ПРАВИЛО ДОКУМЕНТА 20.08: потребность задаёт ФАЙЛ, и без него
     * (или без явной отметки «закупка не требуется») заказ создать нельзя.
     * Проверка живёт здесь, а не в сабмите: только отсюда работают рамка,
     * `aria-invalid`, автоскролл и раскрытие секции.
     */
    describe('файл листа или отметка «не требуется»', () => {
      const needsPurchase = { ...okForm, purchase_required: true };

      it('ни файла, ни отметки — заказ не создать', () => {
        const v = validateOrderForm(needsPurchase, okItems, today, false);
        expect(v.errors.purchase_list)
          .toBe('Приложите лист закупки или отметьте «Закупка не требуется»');
        expect(v.missing).toContain('Лист закупки');
      });

      it('файл приложен — проходит', () => {
        const v = validateOrderForm(needsPurchase, okItems, today, true);
        expect(v.errors.purchase_list).toBeUndefined();
      });

      it('отмечено «закупка не требуется» — файл не нужен', () => {
        const v = validateOrderForm(okForm, okItems, today, false);
        expect(v.errors.purchase_list).toBeUndefined();
      });

      /**
       * Сдвиг аргумента (`hasPurchaseList` был пятым, стал четвёртым) —
       * ровно то место, где забытый вызывающий молча передал бы список строк
       * и получил истинное значение. Проверяем ПОЗИЦИЮ явно.
       */
      it('четвёртый аргумент — именно «приложен ли файл»', () => {
        expect(validateOrderForm(needsPurchase, okItems, today, true).errors.purchase_list)
          .toBeUndefined();
        expect(validateOrderForm(needsPurchase, okItems, today, false).errors.purchase_list)
          .toBeDefined();
      });
    });

    /** Лист не передан вовсе — поведение прежнее (умолчание «не приложен») */
    it('без четвёртого аргумента лист считается неприложенным', () => {
      expect(validateOrderForm(okForm, okItems, today).errors).toEqual({});
      expect(validateOrderForm({ ...okForm, purchase_required: true }, okItems, today)
        .errors.purchase_list).toBeDefined();
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
    expect(isItemEmpty(item({ prints: [emptyPrint()] }))).toBe(false);
    expect(isItemEmpty(item({
      size_grid: { sizes: ['S'], rows: [{ color: '', sizes: { S: 1 } }] },
    }))).toBe(false);
  });
});

// ─── Строки закупки: только восстановление старых черновиков ─────────────────

/**
 * Блока «Подсказки закупщику строками» в форме БОЛЬШЕ НЕТ (правки 07.09,
 * п. 14), но снимки со строками лежат и в localStorage, и в
 * `erp_order_drafts`. `normalizeDraft` обязан разбирать их, не падая —
 * иначе человек, начавший заказ до правки, получил бы пустую форму вместо
 * своего черновика. Эти тесты сторожат именно совместимость.
 */
describe('строки закупки в старом черновике', () => {
  beforeEach(() => localStorage.clear());

  /*
    Тесты `isPurchaseRowEmpty` сняты 07.09 вместе с самой функцией: строк
    листа в форме больше нет (п. 14), и «пустая ли строка» перестало быть
    вопросом — отправлять их некому. Совместимость со старым черновиком
    держат тесты НИЖЕ: они проверяют, что снимок с листом читается
    и дополняется значениями по умолчанию, а это по-прежнему живой путь.
  */
  it('лист сохраняется в черновик и восстанавливается', () => {
    const rows = [{ ...emptyPurchaseRow('k1'), name: 'Кулирка', qty_expected: '120' }];
    writeLegacyDraft(emptyOrderForm(), [item({ product_type: 'Худи', qty: 10 })], rows);
    expect(loadOrderDraft()?.purchase).toEqual(rows);
  });

  it('черновик БЕЗ листа (сохранён до правки 16.08) восстанавливается с пустым', () => {
    // Человек мог начать заказ вчера — падать на этом нельзя
    writeLegacyDraft(emptyOrderForm(), [item({ product_type: 'Худи', qty: 10 })]);
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

/**
 * Правки заказчика 22.08: основная ткань, бирки, ключи нанесений.
 */
describe('бирки и основная ткань (правка 22.08)', () => {
  /**
   * П. 5.3. Позиция, в которой заполнена ТОЛЬКО бирка, пустой не является:
   * иначе форма молча выбросила бы её из заказа вместе с набранным текстом —
   * пустые дополнительные позиции валидация пропускает.
   */
  it('позиция с одной биркой пустой не считается', () => {
    expect(isItemEmpty(item({ labels: [emptyLabel()] }))).toBe(false);
    expect(isItemEmpty(item({ main_fabric: 'шерпа 240' }))).toBe(false);
    expect(isItemEmpty(item({}))).toBe(true);
  });

  /**
   * П. 5.2. У каждого нанесения СВОЙ ключ: по нему макет находит своё
   * нанесение, пока строки `erp_item_prints` ещё не существует. Общая
   * константа дала бы всем нанесениям один ключ, то есть один макет на всех.
   */
  it('у каждого нанесения свой ключ', () => {
    expect(emptyPrint().key).not.toBe(emptyPrint().key);
    expect(emptyLabel().key).not.toBe(emptyLabel().key);
  });

  it('черновик, сохранённый до правки, получает ключи при восстановлении', () => {
    localStorage.setItem(ORDER_DRAFT_KEY, JSON.stringify({
      form: emptyOrderForm(),
      items: [{
        ...item({ product_type: 'Худи', qty: 10 }),
        prints: [{ method: 'embroidery', zone: 'спина' }],
      }],
      savedAt: new Date().toISOString(),
    }));
    const restored = loadOrderDraft();
    expect(restored?.items[0].prints[0].key).toBeTruthy();
    // И бирок в старом черновике нет вовсе — восстановление не падает
    expect(restored?.items[0].labels).toEqual([]);
  });

  /**
   * `normalizeDraft` — ОДНА функция и для локального снимка, и для строки
   * из базы (п. 5.5): чинить нужно оба, и вторая копия рядом означала бы,
   * что часть черновиков остаётся сломанной.
   */
  it('снимок из базы чинится тем же нормализатором', () => {
    const fromDb = normalizeDraft({
      form: emptyOrderForm(),
      items: [{ ...item({ product_type: 'Худи', qty: 10 }), prints: [{ method: 'dtf' }] }],
    });
    expect(fromDb?.items[0].prints[0].key).toBeTruthy();
    expect(normalizeDraft(null)).toBeNull();
    expect(normalizeDraft({ items: [] })).toBeNull();
  });
});

/**
 * ПОЛЕ «ЦВЕТ / ПОСТАВЩИК» (правка 12.09, п. 3) — СТОРОЖ ВСЕГО ПУТИ.
 *
 * Главный класс дефекта при добавлении поля — «половина требования выглядит
 * как сделанное требование»: поле пишется в базу и нигде не читается, либо
 * читается, но не доезжает. Путь у него семь звеньев, и проверка «поле есть
 * в форме» не поймала бы обрыв ни в одном из остальных шести.
 *
 * Читаются ИСХОДНИКИ: сверка «в типе есть колонка» живёт в `schema.test.ts`
 * и отвечает на другой вопрос — про схему, а не про то, доходит ли значение
 * от человека до цеха.
 */
describe('цвет / поставщик доходит от формы до цеха (правка 12.09)', () => {
  const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

  it('позиция с одним «цветом / поставщиком» пустой не считается', () => {
    // Иначе форма молча выбросила бы её из заказа вместе с набранным текстом
    expect(isItemEmpty(item({ color_supplier: 'пыльная роза, Атлас' }))).toBe(false);
  });

  it('поле объявлено в пустой позиции — иначе инпут станет неконтролируемым', () => {
    expect(EMPTY_ITEM.color_supplier).toBe('');
  });

  it('форма собирает значение в payload заказа', () => {
    expect(read('erp/screens/orders/CreateOrderModal.jsx'))
      .toMatch(/color_supplier: it\.color_supplier/);
    expect(read('erp/store/slices/orderWriteSlice.ts'))
      .toMatch(/color_supplier: it\.color_supplier \|\| null/);
  });

  /**
   * Колонка, не попавшая в СПИСОЧНУЮ выборку, приезжает `undefined` МОЛЧА,
   * а техблок читает именно её — `TzBlock` стоит в строке очереди цеха,
   * самом списочном из экранов.
   */
  it('колонка едет в обеих выборках заказа', () => {
    const helpers = read('erp/store/orderHelpers.ts');
    expect(helpers).toMatch(/color_supplier/);
  });

  it('цех видит поле в техблоке ТЗ', () => {
    expect(read('erp/screens/queue/TzBlock.jsx'))
      .toMatch(/\['color_supplier', 'Цвет \/ поставщик'\]/);
  });

  /**
   * Сервер обязан ПИСАТЬ колонку, иначе поле заполняется и теряется
   * при создании заказа. Спрашиваем миграцию, пересобравшую `erp_create_order`:
   * она делает это заменой в `pg_get_functiondef`, и проверка «замена
   * сработала» стоит внутри самой миграции — здесь сторожим, что миграция
   * с такой заменой вообще есть.
   */
  it('создание заказа пишет колонку', () => {
    const sql = latestMatching(/add column if not exists color_supplier/, 'color_supplier');
    // Кавычки УДВОЕНЫ: вставка живёт внутри строкового литерала DO-блока,
    // и одинарные здесь означали бы, что мы сверяемся с несуществующим текстом
    expect(sql).toMatch(/v_item->>''color_supplier''/);
    expect(sql).toMatch(/replace\(v_def, v_cols_old, v_cols_new\)/);
  });
});
