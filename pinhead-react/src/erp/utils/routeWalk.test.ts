import { describe, expect, it } from 'vitest';
import { buildItemRoute } from './routes';
import { buildQueueEntries } from './queueEntries';
import type { BrandingMethod, BrandingOn, ProductionType } from '../types';

/**
 * Заказ проходит ВЕСЬ маршрут — по каждому используемому типу.
 *
 * Пункты 2, 3, 5 и 9 документа заказчика 12.08: «проверить, что после создания
 * заказ попадает на первый этап», «что после завершения этапа он передаётся
 * на следующий и становится доступным ответственному подразделению», и сделать
 * это «по всем используемым типам маршрутов, а не только с закупкой».
 *
 * Прогон идёт через ТУ ЖЕ функцию, которой пользуются очередь цеха, канбан
 * и план (`buildQueueEntries`), а не через её пересказ: очередь, канбан
 * и фильтры однажды уже расходились в деталях, и второй источник правды тут —
 * это ровно тот способ, которым дефект возвращается.
 *
 * Что НЕ проверяется здесь и проверяется на живой базе: права, страж переходов,
 * плановые/фактические даты и количества. Это транзакции сервера, и мок их
 * не воспроизводит — он воспроизвёл бы сам себя.
 */

const DEPT_NAMES: Record<string, string> = {
  supply: 'Закупка', cutting: 'Закройный цех', sewing: 'Швейный цех',
  vto: 'ВТО цех', dtf: 'Цех ДТФ', silkscreen: 'Цех шелкографии',
  embroidery: 'Цех вышивки',
  // Приёмка готового изделия (правки 07.09, п. 9) — этап СКЛАДА, участок
  // непроизводственный, как закупка
  warehouse: 'Склад',
};

/** Непроизводственные участки маршрута: их этапы живут на своих экранах */
const NON_PRODUCTION = new Set(['supply', 'warehouse']);

/** Цеха как их отдаёт справочник; материальный гейт выключен (пустой список видов) */
const DEPARTMENTS = Object.entries(DEPT_NAMES).map(([code, name], i) => ({
  id: `dep-${code}`, code, name, sort_order: (i + 1) * 10,
  active: true, is_production: !NON_PRODUCTION.has(code), gate_material_kinds: [],
}));

interface Built {
  order: Record<string, unknown>;
  /** Этапы позиции в порядке маршрута — прогон закрывает их по одному */
  stages: { id: string; department_id: string; status: string; depends_on: string[] }[];
  codeOf: (id: string) => string;
}

/**
 * Материализует маршрут в заказ ровно так, как это делает `createOrder`:
 * `depends_on` из кодов превращается в id соседних этапов той же позиции.
 */
function makeOrder(input: {
  productionType: ProductionType;
  brandingMethods?: BrandingMethod[];
  brandingOn?: BrandingOn;
  materialSource?: string | null;
}): Built {
  const route = buildItemRoute({
    brandingMethods: [], brandingOn: 'cut', materialSource: 'pinhead', ...input,
  });
  /**
   * Код → id ПРОИЗВОДСТВЕННОГО этапа участка.
   *
   * `standalone` пропускается намеренно: с 12.09 у цеха вышивки этапов два
   * (разработка программы и сама вышивка), и простая карта по коду
   * перезаписывала бы одну другой — швейка начала бы зависеть от подготовки
   * вместо работы. Настоящий `createOrder` связывает этапы по ИНДЕКСАМ
   * в массиве, и такой неоднозначности у него нет.
   */
  const idByCode = new Map(
    route.map((r, i) => [r, `st${i + 1}`] as const)
      .filter(([r]) => !r.standalone)
      .map(([r, id]) => [r.departmentCode, id]),
  );
  const stages = route.map((r, i) => ({
    id: `st${i + 1}`,
    item_id: 'it1',
    department_id: `dep-${r.departmentCode}`,
    depends_on: r.dependsOnCodes.map((c) => idByCode.get(c)!).filter(Boolean),
    status: 'waiting',
    qty_done: 0,
    sort_order: r.sortOrder,
  }));
  const order = {
    id: 'o1', status: 'active', title: 'Тест маршрута', tz_required: false,
    items: [{ id: 'it1', qty: 100, stages }],
    materials: [], procurement_tasks: [], attachments: [], tz_documents: [],
  };
  return {
    order,
    stages,
    codeOf: (id) => stages.find((s) => s.id === id)!.department_id.replace('dep-', ''),
  };
}

/** Коды цехов, чьи этапы прямо сейчас готовы к запуску */
function readyCodes(built: Built): string[] {
  return buildQueueEntries([built.order], DEPARTMENTS as never)
    .filter((e) => e.group === 'ready')
    .map((e) => built.codeOf(e.stage.id))
    .sort();
}

/** Id этапов, готовых прямо сейчас */
function readyIds(built: Built): string[] {
  return buildQueueEntries([built.order], DEPARTMENTS as never)
    .filter((e) => e.group === 'ready')
    .map((e) => e.stage.id);
}

/** Причина ожидания у этапа конкретного цеха (null — не ждёт) */
function reasonFor(built: Built, code: string): string | null {
  const entry = buildQueueEntries([built.order], DEPARTMENTS as never)
    .find((e) => built.codeOf(e.stage.id) === code);
  return entry?.reason ?? null;
}

/**
 * Прогоняет маршрут до конца: на каждом шаге закрывает ВСЕ готовые этапы
 * и записывает, кто был готов. Возвращает историю шагов.
 *
 * Шагов не больше числа этапов + 1: если маршрут где-то встал, цикл не зависнет,
 * а вернёт короткую историю — и тест это увидит.
 */
function walk(built: Built): string[][] {
  const steps: string[][] = [];
  for (let guard = 0; guard <= built.stages.length; guard++) {
    const ready = readyCodes(built);
    if (ready.length === 0) break;
    steps.push(ready);
    /**
      * Закрываем по ID, а не по коду: у позиции с вышивкой этапов этого цеха
      * два, и закрытие по коду гасило бы саму вышивку вместе с подготовкой —
      * прогон объявлял бы маршрут пройденным, ни разу его не пройдя.
      */
    for (const id of readyIds(built)) {
      const st = built.stages.find((x) => x.id === id);
      if (st) st.status = 'done';
    }
  }
  return steps;
}

/** Все ли этапы закрыты — маршрут дошёл до конца */
function allDone(built: Built): boolean {
  return built.stages.every((s) => s.status === 'done');
}

describe('маршрут проходится целиком — по каждому типу', () => {
  const CASES: {
    name: string;
    input: Parameters<typeof makeOrder>[0];
    expected: string[][];
  }[] = [
    {
      name: 'пошив без нанесения',
      input: { productionType: 'sewing' },
      expected: [['supply'], ['cutting'], ['sewing'], ['vto']],
    },
    {
      name: 'пошив + нанесение на крое (ветка между закроем и швейкой)',
      input: { productionType: 'sewing', brandingMethods: ['dtf'], brandingOn: 'cut' },
      expected: [['supply'], ['cutting'], ['dtf'], ['sewing'], ['vto']],
    },
    {
      name: 'пошив + две ветки нанесения на крое идут ПАРАЛЛЕЛЬНО',
      input: {
        productionType: 'sewing', brandingMethods: ['dtf', 'embroidery'], brandingOn: 'cut',
      },
      /**
       * Обе ветки готовы одновременно, швейка ждёт обе.
       *
       * В ПЕРВОЙ ВОЛНЕ ТЕПЕРЬ ДВОЕ (правка 12.09, п. 2): вместе с закупкой
       * готова разработка программы вышивки. Это и есть требование дословно —
       * «задача должна создаваться независимо от этапа „Закрой"»: она доступна
       * цеху с первого дня и никого не ждёт. Сама вышивка по-прежнему приходит
       * третьей волной, после кроя, и закрываются они независимо — прогон
       * идёт через `buildQueueEntries`, то есть проверяет настоящую готовность,
       * а не список этапов.
       */
      expected: [
        ['embroidery', 'supply'], ['cutting'], ['dtf', 'embroidery'], ['sewing'], ['vto'],
      ],
    },
    {
      name: 'пошив + нанесение на готовом (после ВТО)',
      input: { productionType: 'sewing', brandingMethods: ['silkscreen'], brandingOn: 'finished' },
      expected: [['supply'], ['cutting'], ['sewing'], ['vto'], ['silkscreen']],
    },
    {
      name: 'только закрой',
      input: { productionType: 'cut' },
      expected: [['supply'], ['cutting']],
    },
    {
      // Приёмка готового изделия складом до нанесения (правки 07.09, п. 9).
      // Прогон идёт через `buildQueueEntries` — то есть проверяет, что этап
      // склада ДЕЙСТВИТЕЛЬНО держит цех нанесения, а не просто стоит в списке
      name: 'готовое изделие + нанесение: склад → нанесение → ВТО',
      input: { productionType: 'ready_garment', brandingMethods: ['dtf'], brandingOn: 'finished' },
      expected: [['supply'], ['warehouse'], ['dtf'], ['vto']],
    },
    {
      name: 'готовое изделие без нанесений — приёмки нет',
      input: { productionType: 'ready_garment' },
      expected: [['supply']],
    },
    {
      // Образец шьётся внутри ЭКС (правки 02.09, пп. 1 и 3): в маршруте
      // позиции остаётся одна закупка. Крой и пошив ведёт доска разработки,
      // нанесение заводит `erp_experimental_task_send` при входе в шаг
      name: 'образец — только закупка, остальное внутри ЭКС',
      input: { productionType: 'samples' },
      expected: [['supply']],
    },
    {
      // Тот же образец с нанесением: маршрут НЕ меняется — ветка нанесения
      // в него не попадает вовсе
      name: 'образец с нанесением — маршрут прежний',
      input: { productionType: 'samples', brandingMethods: ['silkscreen'], brandingOn: 'cut' },
      expected: [['supply']],
    },
    {
      name: 'подряд, материал Pinhead — закупка есть',
      input: { productionType: 'outsource', materialSource: 'pinhead' },
      expected: [['supply']],
    },
    {
      name: 'подряд, материал подрядчика — закупки нет вовсе',
      input: { productionType: 'outsource', materialSource: 'contractor' },
      expected: [],
    },
  ];

  it.each(CASES)('$name', ({ input, expected }) => {
    const built = makeOrder(input);
    expect(walk(built)).toEqual(expected);
    expect(allDone(built), 'маршрут не дошёл до конца — где-то этап не открылся').toBe(true);
  });

  it('первым готов ровно один этап — заказ попадает на начало маршрута', () => {
    // Пункт 2 документа. Второй этап в этот момент ОБЯЗАН ждать
    const built = makeOrder({ productionType: 'sewing' });
    expect(readyCodes(built)).toEqual(['supply']);
    expect(reasonFor(built, 'cutting')).toBe('Закупка: ещё не завершено');
  });

  it('закупка закрыта → следующий этап становится доступен своему цеху', () => {
    // Пункты 3 и 9 документа — ровно то, что стояло у заказчика
    const built = makeOrder({ productionType: 'sewing' });
    expect(readyCodes(built)).toEqual(['supply']);
    built.stages.find((s) => s.id === 'st1')!.status = 'done';
    expect(readyCodes(built)).toEqual(['cutting']);
    expect(reasonFor(built, 'cutting')).toBeNull();
  });

  it('пропущенный этап открывает следующий так же, как завершённый', () => {
    // Иначе аварийный пропуск (правки 10.08) оставлял бы маршрут стоять
    const built = makeOrder({ productionType: 'sewing' });
    built.stages.find((s) => s.id === 'st1')!.status = 'skipped';
    expect(readyCodes(built)).toEqual(['cutting']);
  });

  it('швейка ждёт ОБЕ ветки нанесения, а не первую закрывшуюся', () => {
    /**
     * Параллельные ветки — место, где отсечка «по порядку» уже однажды
     * отправляла партию в пошив без печати (см. правило про `stageDefect`).
     */
    const built = makeOrder({
      productionType: 'sewing', brandingMethods: ['dtf', 'embroidery'], brandingOn: 'cut',
    });
    /**
     * Закрываем ПОДГОТОВКУ И ЦЕПОЧКУ ДО ВЕТОК — по смыслу, а не по номерам
     * `st1`/`st2`: с 12.09 первым этапом идёт разработка программы вышивки,
     * и жёсткие номера молча закрыли бы не то, что назвали.
     */
    for (const st of built.stages) {
      if (['supply', 'cutting', 'embroidery'].includes(built.codeOf(st.id))
          && st.depends_on.length === 0) {
        st.status = 'done';
      }
      if (built.codeOf(st.id) === 'cutting') st.status = 'done';
    }
    expect(readyCodes(built)).toEqual(['dtf', 'embroidery']);

    // Закрываем только ДТФ — швейка обязана продолжать ждать вышивку
    const dtf = built.stages.find((s) => built.codeOf(s.id) === 'dtf')!;
    dtf.status = 'done';
    expect(readyCodes(built)).toEqual(['embroidery']);
    expect(reasonFor(built, 'sewing')).toBe('Цех вышивки: ещё не завершено');
  });

  it('маршрут без производственных этапов не создаёт пробки', () => {
    // `no_product` — пустая цепочка: ждать нечего и некого
    const built = makeOrder({ productionType: 'no_product' });
    expect(built.stages).toEqual([]);
    expect(walk(built)).toEqual([]);
    expect(allDone(built)).toBe(true);
  });
});
